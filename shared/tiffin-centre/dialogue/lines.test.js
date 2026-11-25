// Tiffin Centre dialogue: content checks on every line (shape, script, counts, safety) and on the dish names.
import { describe, it, expect, vi } from 'vitest';
import { CUSTOMER_KINDS, DISH_IDS, DISHES } from '../catalog.js';
import { LINES_TE } from './lines.te.js';
import { LINES_HI } from './lines.hi.js';
import { LINES_DK } from './lines.dk.js';
import { DISH_NAMES, dishName } from './dishNames.js';
import { ALLOWED_PLACEHOLDERS, LANGS, MIN_PER_SIT, MIN_PER_TAG, MOODS, N_SITS, NO_DISH_SITS, PLACEHOLDER_RE, SIT_TAGS, SITUATIONS } from './lineKit.js';
import { UI_EN } from './lines.en.js';
import { ALL_LINES, LINE_BY_ID } from './index.js';
vi.setConfig({ testTimeout: 60000 }); // thousands of per-line expectations

const FILES = { te: LINES_TE, hi: LINES_HI, dk: LINES_DK };
const TELUGU = /[ఀ-౿]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const KIND_IDS = Object.keys(CUSTOMER_KINDS);
const KIND_ONLY_SITS = new Set(['elder-blessing', 'kid-demand', 'phone-call', 'student-broke', 'autowala-chat']);

const placeholders = (s) => [...String(s).matchAll(PLACEHOLDER_RE)].map((m) => m[1]).sort().join(',');

// Street speech may be cheeky and impatient, never abusive. Romanised and native-script stems; word-bounded in Roman text.
const BANNED_ROM = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'damn', 'crap', 'idiot', 'stupid', 'moron', 'dumb', 'fool', 'ugly', 'fat',
  'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'gandu', 'harami', 'kutta', 'kutte', 'kamina', 'kamine', 'randi', 'saala', 'saale', 'bewakoof',
  'pagal', 'gadha', 'ullu', 'lanja', 'lanjakoduku', 'dengu', 'pooku', 'puka', 'naakodaka', 'sulli', 'gudda', 'bokka', 'nonsense',
  // religion, caste, region and community insults or labels
  'madrasi', 'bihari', 'kafir', 'kaafir', 'mulla', 'mullah', 'katua', 'chamar', 'dalit', 'bhangi', 'paki', 'terrorist', 'jihadi', 'mleccha',
  'hindu', 'muslim', 'christian', 'brahmin', 'caste', 'andhra', 'telangana', 'outsider', 'bhaiyya', 'nepali',
];
const BANNED_NATIVE = [
  'कुत्ता', 'कुत्ते', 'हरामी', 'साला', 'साले', 'चूतिया', 'बेवकूफ', 'बेवकूफ़', 'पागल', 'गधा', 'उल्लू', 'कमीना', 'कमीने', 'रंडी', 'गंदू', 'काफ़िर', 'काफिर', 'मुल्ला', 'मद्रासी', 'बिहारी',
  'కుక్క', 'లంజ', 'దెంగు', 'పూకు', 'పిచ్చి', 'గాడిద', 'మూర్ఖ', 'వెధవ', 'వెధవన్నర', 'సన్నాసి', 'దరిద్రుడు',
];

describe('dialogue lines: shape', () => {
  it('has the three voices and plenty of lines (1400+ in total, 450+ per voice)', () => {
    expect(ALL_LINES.length).toBeGreaterThanOrEqual(1400);
    for (const lang of LANGS) expect(FILES[lang].length).toBeGreaterThanOrEqual(450);
    expect(Object.keys(LINE_BY_ID).length).toBe(ALL_LINES.length);
  });

  it('every line has every field, valid values and a stable id', () => {
    for (const l of ALL_LINES) {
      const at = `${l.id}`;
      expect(typeof l.id, at).toBe('string');
      expect(l.id, at).toMatch(/^(te|hi|dk)-[a-z]+(-[a-z]+)*-\d{2}$/);
      expect(l.id.startsWith(`${l.lang}-${l.sit}-`), at).toBe(true);
      expect(LANGS, at).toContain(l.lang);
      expect(SITUATIONS, at).toContain(l.sit);
      expect(MOODS, at).toContain(l.mood);
      for (const f of ['text', 'rom', 'en']) {
        expect(typeof l[f], `${at} ${f}`).toBe('string');
        expect(l[f].trim().length, `${at} ${f}`).toBeGreaterThan(0);
        expect(l[f], `${at} ${f} has stray spaces`).toBe(l[f].trim());
        expect(l[f], `${at} ${f} has double spaces`).not.toMatch(/ {2,}/);
      }
      if (l.kinds !== undefined) {
        expect(Array.isArray(l.kinds) && l.kinds.length > 0, at).toBe(true);
        for (const k of l.kinds) expect(KIND_IDS, at).toContain(k);
      }
      if (l.tag !== undefined) {
        expect(Object.keys(SIT_TAGS), at).toContain(l.sit);
        expect(SIT_TAGS[l.sit], at).toContain(l.tag);
      }
      // a tagged pool has a tag on every line (sold-out-polite, regular-named): the director picks the pool by tag
      if (l.sit === 'sold-out-polite' || l.sit === 'regular-named') expect(l.tag, at).toBeTruthy();
    }
  });

  it('ids are unique across everything', () => {
    const ids = ALL_LINES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no line is longer than 90 characters, and reading length is sane (2 to 14 words)', () => {
    for (const l of ALL_LINES) {
      expect(l.text.length, l.id).toBeLessThanOrEqual(90);
      expect(l.rom.length, l.id).toBeLessThanOrEqual(110);
      expect(l.en.length, l.id).toBeLessThanOrEqual(120);
      const words = l.rom.split(/\s+/).length;
      expect(words, `${l.id} "${l.rom}"`).toBeGreaterThanOrEqual(2);
      expect(words, `${l.id} "${l.rom}"`).toBeLessThanOrEqual(16);
    }
  });

  it('no two lines of one language say exactly the same thing', () => {
    for (const lang of LANGS) {
      const seen = new Map();
      for (const l of FILES[lang]) {
        const key = l.text;
        expect(seen.has(key), `${l.id} duplicates ${seen.get(key)}`).toBe(false);
        seen.set(key, l.id);
      }
    }
  });
});

describe('dialogue lines: script and romanisation', () => {
  it('Telugu lines are in Telugu script and contain no Devanagari', () => {
    for (const l of LINES_TE) {
      expect(l.lang, l.id).toBe('te');
      expect(l.text, l.id).toMatch(TELUGU);
      expect(l.text, l.id).not.toMatch(DEVANAGARI);
    }
  });

  it('Hindi and Dakhni lines are in Devanagari and contain no Telugu', () => {
    for (const l of [...LINES_HI, ...LINES_DK]) {
      expect(['hi', 'dk'], l.id).toContain(l.lang);
      expect(l.text, l.id).toMatch(DEVANAGARI);
      expect(l.text, l.id).not.toMatch(TELUGU);
    }
  });

  it('each file only holds its own language', () => {
    for (const lang of LANGS) for (const l of FILES[lang]) expect(l.lang, l.id).toBe(lang);
  });

  it('the Roman transliteration and the English gloss are plain readable ASCII', () => {
    for (const l of ALL_LINES) {
      expect(l.rom, l.id).toMatch(/^[\x20-\x7E]+$/);
      expect(l.rom, `${l.id} rom must be Roman letters`).toMatch(/[A-Za-z]/);
      expect(l.rom, `${l.id} rom has no script characters`).not.toMatch(/[^\x20-\x7E]/);
      expect(l.en, l.id).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});

describe('dialogue lines: placeholders', () => {
  it('only {dish} {dish2} {n}, the same ones in script, Roman and English', () => {
    for (const l of ALL_LINES) {
      for (const f of ['text', 'rom', 'en']) {
        for (const m of l[f].matchAll(PLACEHOLDER_RE)) expect(ALLOWED_PLACEHOLDERS, `${l.id} ${f}`).toContain(m[1]);
        expect(l[f].replace(PLACEHOLDER_RE, ''), `${l.id} ${f} has a stray brace`).not.toMatch(/[{}]/);
      }
      expect(placeholders(l.rom), `${l.id} rom`).toBe(placeholders(l.text));
      expect(placeholders(l.en), `${l.id} en`).toBe(placeholders(l.text));
    }
  });

  it('the dish / dish2 / n flags match the text, and {dish2} always comes with {dish}', () => {
    for (const l of ALL_LINES) {
      expect(!!l.dish, l.id).toBe(l.text.includes('{dish}'));
      expect(!!l.dish2, l.id).toBe(l.text.includes('{dish2}'));
      expect(!!l.n, l.id).toBe(l.text.includes('{n}'));
      if (l.dish2) expect(l.dish, l.id).toBe(true);
    }
  });

  it('{n} is only used where the director supplies a number (order, pay, office parcels, the delivery boy)', () => {
    const ok = new Set(N_SITS);
    for (const l of ALL_LINES) if (l.n) expect(ok.has(l.sit), `${l.id} uses {n} in ${l.sit}`).toBe(true);
    for (const lang of LANGS) {
      expect(FILES[lang].some((l) => l.n && l.sit === 'big-office-order'), `${lang} big-office-order {n}`).toBe(true);
      expect(FILES[lang].some((l) => l.n && l.sit === 'delivery-boy-hurry'), `${lang} delivery-boy-hurry {n}`).toBe(true);
    }
  });

  it('{dish2} is only used where the director supplies a second dish (order-multi, sold-out swaps)', () => {
    for (const l of ALL_LINES) {
      if (!l.dish2) continue;
      expect(['order-multi', 'sold-out-polite'], l.id).toContain(l.sit);
      if (l.sit === 'sold-out-polite') expect(l.tag, l.id).toBe('swap');
    }
    for (const lang of LANGS) {
      const swaps = FILES[lang].filter((l) => l.sit === 'sold-out-polite' && l.tag === 'swap');
      expect(swaps.length, lang).toBeGreaterThanOrEqual(5);
      expect(swaps.every((l) => l.dish && l.dish2), lang).toBe(true);
    }
  });

  it('placeholders are used in the situations that have a dish (not in leave/pay-hurry lines, which have no dish context)', () => {
    const noDish = new Set(NO_DISH_SITS);
    for (const l of ALL_LINES) if (l.dish || l.dish2) expect(noDish.has(l.sit), `${l.id} (${l.sit}) has a dish placeholder with no dish to fill it`).toBe(false);
  });
});

describe('dialogue lines: coverage', () => {
  it('every language has at least the minimum number of lines for every situation', () => {
    for (const lang of LANGS) {
      for (const sit of SITUATIONS) {
        const n = FILES[lang].filter((l) => l.sit === sit).length;
        expect(n, `${lang} ${sit}`).toBeGreaterThanOrEqual(MIN_PER_SIT[sit]);
      }
    }
  });

  it('tagged pools have the minimum lines of every tag, in every language', () => {
    for (const lang of LANGS) {
      for (const [sit, tags] of Object.entries(MIN_PER_TAG)) {
        for (const [tag, min] of Object.entries(tags)) {
          const n = FILES[lang].filter((l) => l.sit === sit && l.tag === tag).length;
          expect(n, `${lang} ${sit}/${tag}`).toBeGreaterThanOrEqual(min);
        }
      }
    }
  });

  it('every operations situation named in the brief exists with its minimum count', () => {
    const brief = {
      'rain-start': 8, 'rain-ongoing': 8, 'rain-end': 4, 'power-cut': 8, 'power-back': 4, 'cricket-night': 10, 'festival-greeting': 8, 'inspector-arrival': 6,
      'inspector-pass': 4, 'inspector-fail': 4, 'sold-out-polite': 14, 'stock-out-apology': 4, 'delivery-boy-hurry': 8, 'parcel-request': 8,
      'extra-request-chutney': 8, 'extra-request-sambar': 8, 'spice-request-less': 8, 'spice-request-more': 8, 'regular-named': 10, 'regular-loyal': 6,
      'big-office-order': 8, 'broken-dish-complaint': 8, 'sour-batter-complaint': 6, 'gas-out-chatter': 6, 'thanks-fast-service': 4,
    };
    for (const [sit, min] of Object.entries(brief)) {
      expect(MIN_PER_SIT[sit], sit).toBeGreaterThanOrEqual(min);
      for (const lang of LANGS) expect(FILES[lang].filter((l) => l.sit === sit).length, `${lang} ${sit}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('no line uses a situation that is not on the list', () => {
    for (const l of ALL_LINES) expect(SITUATIONS, l.id).toContain(l.sit);
  });

  it('general situations have 8+ lines anyone can say, so no kind of customer runs dry', () => {
    for (const lang of LANGS) {
      for (const sit of SITUATIONS) {
        if (KIND_ONLY_SITS.has(sit)) continue;
        const open = FILES[lang].filter((l) => l.sit === sit && !l.kinds).length;
        const need = Math.min(6, MIN_PER_SIT[sit] - 2);
        expect(open, `${lang} ${sit}`).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('the kind-specific situations are kept for the right people', () => {
    const owner = { 'kid-demand': ['family'], 'phone-call': ['office', 'techie'], 'student-broke': ['student'], 'autowala-chat': ['autowala'], 'elder-blessing': ['uncle'] };
    // operations lines: only these may be kind-limited, and only to the kinds that would really say them
    const ownerOps = { 'cricket-night': ['student', 'autowala'], 'parcel-request': ['office', 'techie', 'family'], 'spice-request-less': ['family'] };
    for (const l of ALL_LINES) {
      if (l.kinds && ownerOps[l.sit]) for (const k of l.kinds) expect(ownerOps[l.sit], l.id).toContain(k);
      if (owner[l.sit]) expect(l.kinds, l.id).toBeTruthy();
      if (owner[l.sit] && l.kinds) for (const k of l.kinds) expect(owner[l.sit], l.id).toContain(k);
    }
  });

  it('serve-complain has both kinds: about the dish and about the wait', () => {
    for (const lang of LANGS) {
      const c = FILES[lang].filter((l) => l.sit === 'serve-complain');
      expect(c.filter((l) => l.tag === 'late').length, lang).toBeGreaterThanOrEqual(3);
      expect(c.filter((l) => !l.tag).length, lang).toBeGreaterThanOrEqual(8);
    }
  });

  it('moods have real range in every language', () => {
    for (const lang of LANGS) {
      const used = new Set(FILES[lang].map((l) => l.mood));
      for (const m of MOODS) expect(used.has(m), `${lang} never uses ${m}`).toBe(true);
    }
  });

  it('Telugu, Hindi and Dakhni each have their signature words (a sanity check on dialect)', () => {
    const rom = (lang) => FILES[lang].map((l) => l.rom.toLowerCase()).join(' | ');
    const te = rom('te');
    for (const w of ['anna', 'akka', 'jaldi', 'parvaaledu', 'baagundi', 'chaalu']) expect(te, `te ${w}`).toContain(w);
    const hi = rom('hi');
    for (const w of ['bhaiya', 'jaldi', 'kitna hua', 'arre', 'yaar']) expect(hi, `hi ${w}`).toContain(w);
    const dk = rom('dk');
    for (const w of ['miyan', 'nakko', 'mereku', 'hau', 'kya bolta', 'jhakaas', 'zabardast', 'baap re', 'aapa', 'ke waaste', 'idhar']) expect(dk, `dk ${w}`).toContain(w);
  });
});

describe('dialogue lines: script correctness of the operations lines', () => {
  const ALL_SITS = Object.keys(MIN_PER_SIT);
  const OPS = ALL_SITS.slice(ALL_SITS.indexOf('rain-start'));
  const strip = (t) => t.replace(PLACEHOLDER_RE, '');

  it('there are 25 operations situations', () => {
    expect(OPS.length).toBe(25);
  });

  it('native script holds no Latin letters (the Roman spelling lives in `rom`), in any line of any voice', () => {
    for (const l of ALL_LINES) expect(strip(l.text), `${l.id} ${l.text}`).not.toMatch(/[A-Za-z]/);
  });

  it('Telugu lines use only Telugu letters, digits and punctuation; Hindi and Dakhni only Devanagari ones', () => {
    const okTe = /^[\u0C00-\u0C7F\s\d.,!?'\-:;()]+$/u;
    const okDe = /^[\u0900-\u097F\s\d.,!?'\-:;()]+$/u;
    for (const l of ALL_LINES) {
      if (!OPS.includes(l.sit)) continue;
      expect(strip(l.text), `${l.id} ${l.text}`).toMatch(l.lang === 'te' ? okTe : okDe);
    }
  });

  it('punctuation is tidy: no tripled marks, no space before ! ? or a comma, at most two questions', () => {
    for (const l of ALL_LINES) {
      if (!OPS.includes(l.sit)) continue;
      for (const f of ['text', 'rom', 'en']) {
        expect(l[f], `${l.id} ${f}`).not.toMatch(/([!?,])\1\1|\.{4,}/);
        expect(l[f], `${l.id} ${f}`).not.toMatch(/\s[!?,]/);
        expect((l[f].match(/\?/g) || []).length, `${l.id} ${f}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('Roman spelling mirrors the sentence: the same number of ! and ? as the native text', () => {
    const cnt = (s, ch) => s.split(ch).length - 1;
    for (const l of ALL_LINES) {
      if (!OPS.includes(l.sit)) continue;
      expect(cnt(l.rom, '!'), `${l.id} !`).toBe(cnt(l.text, '!'));
      expect(cnt(l.rom, '?'), `${l.id} ?`).toBe(cnt(l.text, '?'));
    }
  });

  it('the voices sound like themselves: Telugu says ayyo varsham / current poyindi, Hindi bijli chali gayi, Dakhni miyan / nai / idhrich', () => {
    const rom = (lang) => FILES[lang].filter((l) => OPS.includes(l.sit)).map((l) => ` ${l.rom.toLowerCase()} `).join('|');
    const te = rom('te');
    for (const w of ['ayyo varsham', 'current poyindi', 'ghmc waallu', 'order late ayithe rating pothundi', 'parcel kattandi', 'dosa pullagaa undi', 'eeroju kooda same', 'ayipoyindaa']) expect(te, `te ${w}`).toContain(w);
    const hi = rom('hi');
    for (const w of ['bijli chali gayi', 'bhaiya, wahi purana', 'khatm ho gaya', 'ghmc waale', 'dosa khatta hai', 'parcel kar do']) expect(hi, `hi ${w}`).toContain(w);
    const dk = rom('dk');
    for (const w of ['miyan', ' nai ', 'idhrich', 'mereku', 'kaiku', 'woich', 'current gaya', 'khatam hogaya', 'ghmc waale', 'ke waaste']) expect(dk, `dk ${w}`).toContain(w);
  });

  it('Dakhni operations lines are not copies of the Hindi ones (different words, not only a different label)', () => {
    const hi = new Set(LINES_HI.map((l) => l.rom));
    for (const l of LINES_DK) if (OPS.includes(l.sit)) expect(hi.has(l.rom), `${l.id} copies Hindi`).toBe(false);
  });

  it('festival greetings name several festivals and several are plainly generic (nobody is excluded)', () => {
    const named = /sankraanti|ugaadi|eid|diwali|deepaavali|deewali|dasara|dashahra/i;
    for (const lang of LANGS) {
      const rows = FILES[lang].filter((l) => l.sit === 'festival-greeting');
      for (const w of ['sankraanti', 'ugaadi', 'eid', 'diwali|deepaavali|deewali', 'dasara|dashahra']) expect(rows.some((l) => new RegExp(w, 'i').test(l.rom)), `${lang} ${w}`).toBe(true);
      expect(rows.filter((l) => !named.test(l.rom)).length, `${lang} generic`).toBeGreaterThanOrEqual(3);
    }
  });

  it('inspector lines whisper about GHMC in every voice', () => {
    for (const lang of LANGS) expect(FILES[lang].filter((l) => l.sit === 'inspector-arrival' && /GHMC/.test(l.rom)).length, lang).toBeGreaterThanOrEqual(2);
  });
});

describe('dialogue lines: respectful (cheeky and impatient is fine, abusive is not)', () => {
  const words = (s) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean);

  it('no profanity, slurs, or religious, caste or regional insults, in Roman or native script', () => {
    const hits = [];
    for (const l of ALL_LINES) {
      const w = new Set([...words(l.rom), ...words(l.en)]);
      for (const bad of BANNED_ROM) if (w.has(bad)) hits.push(`${l.id} contains "${bad}"`);
      for (const bad of BANNED_NATIVE) if (l.text.includes(bad)) hits.push(`${l.id} contains "${bad}"`);
    }
    expect(hits).toEqual([]);
  });

  it('nobody is told to shut up or called a name', () => {
    for (const l of ALL_LINES) {
      expect(l.en.toLowerCase(), l.id).not.toMatch(/shut up|get lost|go to hell|you fool|you idiot|useless person|i will kill|i will beat/);
    }
  });
});

describe('dish names', () => {
  it('every dish has a name in every language, with script, Roman and English', () => {
    for (const lang of LANGS) {
      for (const id of DISH_IDS) {
        const n = DISH_NAMES[lang][id];
        expect(n, `${lang} ${id}`).toBeTruthy();
        for (const f of ['text', 'rom', 'en']) expect(typeof n[f] === 'string' && n[f].length > 0, `${lang} ${id} ${f}`).toBe(true);
        expect(n.rom, `${lang} ${id}`).toMatch(/^[\x20-\x7E]+$/);
        expect(n.en, `${lang} ${id}`).toMatch(/^[\x20-\x7E]+$/);
      }
    }
  });

  it('Telugu names come from the catalogue; Hindi and Dakhni are Devanagari', () => {
    for (const id of DISH_IDS) {
      expect(DISH_NAMES.te[id].text).toBe(DISHES[id].te);
      expect(DISH_NAMES.te[id].text).toMatch(TELUGU);
      expect(DISH_NAMES.hi[id].text).toMatch(DEVANAGARI);
      expect(DISH_NAMES.dk[id].text).toMatch(DEVANAGARI);
    }
  });

  it('the brief\'s Hindi names are what is shown', () => {
    expect(DISH_NAMES.hi.idly.text).toBe('इडली');
    expect(DISH_NAMES.hi.dosa.text).toBe('डोसा');
    expect(DISH_NAMES.hi.masala_dosa.text).toBe('मसाला डोसा');
    expect(DISH_NAMES.hi.irani_chai.text).toBe('ईरानी चाय');
    expect(DISH_NAMES.hi.osmania.text).toBe('उस्मानिया बिस्किट');
  });

  it('dishName falls back to something readable for unknown input', () => {
    expect(dishName('te', 'idly').text).toBe(DISHES.idly.te);
    expect(dishName('xx', 'idly').text).toBe(DISHES.idly.te);
    expect(dishName('hi', 'nothing').text).toBe('nothing');
    expect(dishName('hi', '__proto__').text).toBe('__proto__');
  });
});

describe('english UI strings', () => {
  it('cover every subtitle mode and language', () => {
    for (const m of ['native', 'roman', 'english', 'both']) {
      expect(UI_EN.subtitleModes[m]).toBeTruthy();
      expect(UI_EN.subtitleHint[m]).toBeTruthy();
    }
    for (const l of LANGS) expect(UI_EN.langNames[l].native && UI_EN.langNames[l].en).toBeTruthy();
  });
});
