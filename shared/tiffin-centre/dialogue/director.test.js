// Tiffin Centre dialogue: the director, on synthetic states (rules, thresholds, priorities) and replayed through the REAL engine.
import { describe, it, expect, vi } from 'vitest';
import {
  createGame, applyAction, chooseAutoAction, isOver, TICK_MS, CUSTOMER_KINDS,
} from '../index.js';
import {
  createDialogueDirector, formatSubtitle, fillTemplate, ttlFor, MIN_GAP, MAX_ACTIVE, DISH_NAMES, dishName, LINE_BY_ID, linesFor,
} from './index.js';

vi.setConfig({ testTimeout: 120000 });

// ---------------------------------------------------------------------------------------------------------------------
// helpers

const customer = (o = {}) => ({
  id: 1, name: 'Ravi anna', kind: 'student', look: 'bag', spot: 0, st: 'waiting', order: ['dosa'], got: [], arrivedAt: 0,
  patience: 30, patienceMax: 30, eatLeft: 0, payLeft: 0, total: 40, tip: 0, outcome: null, qs: [], leftAt: null, ...o,
});
const mkState = (tick, customers, o = {}) => ({
  v: 1, status: 'playing', level: 1, pace: 'normal', tick, shiftTicks: 150, seed: 'syn',
  cfg: { tutorial: false, spots: 4, noPatience: false, noPayExpiry: false, hour: [6, 9] }, customers, ...o,
});
const arrive = (id) => ({ type: 'customer-arrive', customer: id, spot: 0 });

const activeAt = (list, t) => list.filter((u) => u.at <= t && t < u.at + Math.max(1, Math.ceil(u.ttlMs / TICK_MS))).length;

function checkRules(utterances, label) {
  const ids = new Set();
  const lastBy = new Map();
  const usedBy = new Map();
  for (const u of utterances) {
    expect(ids.has(u.id), `${label}: duplicate utterance id ${u.id}`).toBe(false);
    ids.add(u.id);
    expect(LINE_BY_ID[u.lineId], `${label}: unknown line ${u.lineId}`).toBeTruthy();
    expect(u.lang).toBe(LINE_BY_ID[u.lineId].lang);
    expect(u.ttlMs).toBeGreaterThanOrEqual(1100);
    expect(u.ttlMs).toBeLessThanOrEqual(5500);
    expect(u.ttlMs).toBe(ttlFor(u.text));
    expect(u.text, `${label}: unfilled placeholder in ${u.lineId}`).not.toMatch(/[{}]/);
    expect(u.rom).not.toMatch(/[{}]/);
    expect(u.en).not.toMatch(/[{}]/);
    expect(u.text.length).toBeGreaterThan(0);
    const k = `${label}:${u.customer}`;
    if (lastBy.has(k)) expect(u.at - lastBy.get(k), `${label}: customer ${u.customer} spoke twice within ${MIN_GAP} ticks`).toBeGreaterThanOrEqual(MIN_GAP);
    lastBy.set(k, u.at);
    const set = usedBy.get(k) || new Set();
    expect(set.has(u.lineId), `${label}: customer ${u.customer} repeated ${u.lineId}`).toBe(false);
    set.add(u.lineId);
    usedBy.set(k, set);
  }
  const ticks = new Set(utterances.map((u) => u.at));
  for (const t of ticks) {
    for (let x = t; x < t + 6; x++) expect(activeAt(utterances, x), `${label}: ${activeAt(utterances, x)} utterances active at tick ${x}`).toBeLessThanOrEqual(MAX_ACTIVE);
  }
}

/**
 * Play a real shift through the engine with the greedy bot, feeding the director after every action and every tick.
 * `every`: the bot acts only on ticks divisible by it (a slow or distracted player makes customers angry and walk off unpaid).
 */
function replay({ level, seed, every = 2, players = 1, lang = 'auto', mode }) {
  const ps = Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  let s = createGame({ players: ps, settings: { level, pace: 'normal' }, seed });
  const d = createDialogueDirector({ lang, seed, subtitles: mode });
  const spoken = [];
  const evTypes = {};
  const feed = (r) => {
    for (const e of r.events) evTypes[e.type] = (evTypes[e.type] || 0) + 1;
    for (const u of d.update(r.state, r.events)) spoken.push(u);
    return r.state;
  };
  let guard = 0;
  while (!isOver(s) && guard++ < 4000) {
    if (s.tick % every === 0) {
      for (const p of ps) {
        const a = chooseAutoAction(s, p.id);
        if (!a) continue;
        const r = applyAction(s, a);
        if (r.error) continue;
        s = feed(r);
      }
    }
    s = feed(applyAction(s, { type: 'tick' }));
  }
  return { spoken, evTypes, state: s, director: d };
}

// ---------------------------------------------------------------------------------------------------------------------

describe('fillTemplate and formatSubtitle', () => {
  const line = { text: 'ఒక {dish}, ఒక {dish2}, {n}', rom: 'oka {dish}, oka {dish2}, {n}', en: 'one {dish} and {dish2}, {n}' };

  it('fills dish names (objects or strings) and numbers in all three fields', () => {
    const out = fillTemplate(line, { dish: DISH_NAMES.te.idly, dish2: dishName('te', 'dosa'), n: 3 });
    expect(out.text).toBe('ఒక ఇడ్లీ, ఒక దోశ, 3');
    expect(out.rom).toBe('oka idly, oka dosa, 3');
    expect(out.en).toBe('one idly and dosa, 3');
    expect(fillTemplate(line, { dish: 'x', dish2: 'y', n: '7' }).en).toBe('one x and y, 7');
  });

  it('keeps a capital when the dish opens the sentence, and says "an idly"', () => {
    const idly = DISH_NAMES.hi.idly;
    const out = fillTemplate({ text: '{dish} है क्या?', rom: '{dish} hai kya?', en: 'Do you have {dish}?' }, { dish: idly });
    expect(out.rom).toBe('Idli hai kya?');
    expect(out.en).toBe('Do you have idly?');
    expect(fillTemplate({ text: 'x', rom: 'x', en: 'A {dish} for me' }, { dish: idly }).en).toBe('An idly for me');
    expect(fillTemplate({ text: 'x', rom: 'x', en: 'a {dish} for me' }, { dish: DISH_NAMES.hi.dosa }).en).toBe('a dosa for me');
  });

  it('never throws and leaves no braces on odd input', () => {
    expect(fillTemplate(null, null)).toEqual({ text: '', rom: '', en: '' });
    expect(fillTemplate(line, {}).text).not.toMatch(/[{}]/);
    expect(fillTemplate({ text: 'a  {dish}  b', rom: 'a', en: 'a' }, { dish: 'z' }).text).toBe('a z b');
  });

  it('formats the four subtitle modes', () => {
    const u = { text: 'అన్నా!', rom: 'Anna!', en: 'Hey anna!' };
    expect(formatSubtitle(u, 'native')).toBe('అన్నా!');
    expect(formatSubtitle(u, 'roman')).toBe('Anna!');
    expect(formatSubtitle(u, 'english')).toBe('Hey anna!');
    expect(formatSubtitle(u, 'both')).toBe('అన్నా!\nHey anna!');
    expect(formatSubtitle(u)).toBe('అన్నా!');
    expect(formatSubtitle(u, 'nonsense')).toBe('అన్నా!');
    expect(formatSubtitle(null, 'both')).toBe('');
  });

  it('reading time is 1100 ms + 85 ms per character, capped at 5500', () => {
    expect(ttlFor('')).toBe(1100);
    expect(ttlFor('abcd')).toBe(1100 + 4 * 85);
    expect(ttlFor('x'.repeat(200))).toBe(5500);
  });
});

describe('language assignment', () => {
  const state = (kind, n) => mkState(5, Array.from({ length: n }, (_, i) => customer({ id: i + 1, kind, name: 'Customer', arrivedAt: 5 })));

  it('fixed languages are respected', () => {
    for (const lang of ['te', 'hi', 'dk']) {
      const d = createDialogueDirector({ lang, seed: 9 });
      d.update(state('student', 20), []);
      for (let i = 1; i <= 20; i++) expect(d.languageOf(i)).toBe(lang);
    }
  });

  it('auto follows te 45 / hi 25 / dk 30 overall, with kind biases', () => {
    const count = (kind, n = 600) => {
      const d = createDialogueDirector({ lang: 'auto', seed: 'weights' });
      d.update(state(kind, n), []);
      const c = { te: 0, hi: 0, dk: 0 };
      for (let i = 1; i <= n; i++) c[d.languageOf(i)] += 1;
      return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / n]));
    };
    const all = { te: 0, hi: 0, dk: 0 };
    for (const k of Object.keys(CUSTOMER_KINDS)) for (const [l, v] of Object.entries(count(k, 300))) all[l] += v * CUSTOMER_KINDS[k].weight;
    const wsum = Object.values(CUSTOMER_KINDS).reduce((a, k) => a + k.weight, 0);
    expect(all.te / wsum).toBeGreaterThan(0.33);
    expect(all.te / wsum).toBeLessThan(0.52);
    expect(all.hi / wsum).toBeGreaterThan(0.2);
    expect(all.dk / wsum).toBeGreaterThan(0.2);
    const auto = count('autowala');
    expect(auto.dk).toBeGreaterThan(0.55);
    const techie = count('techie');
    expect(techie.hi).toBeGreaterThan(techie.te);
    expect(techie.hi + techie.te).toBeGreaterThan(0.8);
    const office = count('office');
    expect(office.hi + office.te).toBeGreaterThan(0.75);
    const uncle = count('uncle');
    expect(uncle.te + uncle.dk).toBeGreaterThan(0.85);
  });

  it('a customer keeps one language, and it only depends on seed and id', () => {
    const a = createDialogueDirector({ lang: 'auto', seed: 's1' });
    const b = createDialogueDirector({ lang: 'auto', seed: 's1' });
    const c = createDialogueDirector({ lang: 'auto', seed: 's2' });
    const st = state('student', 40);
    a.update(st, []); b.update(st, []); c.update(st, []);
    let diff = 0;
    for (let i = 1; i <= 40; i++) {
      expect(a.languageOf(i)).toBe(b.languageOf(i));
      if (a.languageOf(i) !== c.languageOf(i)) diff += 1;
    }
    expect(diff).toBeGreaterThan(0);
  });
});

describe('triggers on synthetic states', () => {
  it('arrival: greet (usually) then the real order, naming the customer\'s dishes in their language', () => {
    let greets = 0;
    let orders = 0;
    for (let id = 1; id <= 30; id++) {
      const d = createDialogueDirector({ lang: 'auto', seed: 'arr' });
      const out = [];
      const c = customer({ id, kind: 'office', order: ['masala_dosa', 'irani_chai'], arrivedAt: 0 });
      out.push(...d.update(mkState(0, [c]), [arrive(id)]));
      for (let t = 1; t <= 9; t++) out.push(...d.update(mkState(t, [{ ...c, patience: 30 - t }]), t === 0 ? [arrive(id)] : []));
      const order = out.find((u) => u.sit === 'order-multi');
      expect(order, `customer ${id} never ordered`).toBeTruthy();
      orders += 1;
      const lang = d.languageOf(id);
      expect(order.lang).toBe(lang);
      const line = LINE_BY_ID[order.lineId];
      expect(line.dish && line.dish2).toBe(true);
      expect(order.text).toContain(dishName(lang, 'masala_dosa').text);
      expect(order.text).toContain(dishName(lang, 'irani_chai').text);
      const g = out.find((u) => u.sit === 'greet' || u.sit === 'regular-greet' || u.sit === 'festival');
      if (g) {
        greets += 1;
        expect(g.at).toBeLessThan(order.at);
        expect(order.at - g.at).toBeGreaterThanOrEqual(MIN_GAP);
      }
    }
    expect(orders).toBe(30);
    expect(greets).toBeGreaterThan(12);
  });

  it('a single dish is named; a repeated dish uses a count', () => {
    const d1 = createDialogueDirector({ lang: 'hi', seed: 1 });
    const o1 = d1.update(mkState(0, [customer({ order: ['idly'] })]), [arrive(1)]).concat(
      [1, 2, 3, 4].flatMap((t) => d1.update(mkState(t, [customer({ order: ['idly'] })]), [])),
    ).find((u) => u.sit === 'order');
    expect(o1).toBeTruthy();
    expect(o1.text).toContain('इडली');
    const d2 = createDialogueDirector({ lang: 'hi', seed: 1 });
    const c2 = customer({ order: ['idly', 'idly'] });
    const o2 = [0, 1, 2, 3, 4, 5].flatMap((t) => d2.update(mkState(t, [c2]), t === 0 ? [arrive(1)] : [])).find((u) => u.sit === 'order');
    expect(o2).toBeTruthy();
    expect(o2.text).toContain('2');
    expect(o2.text).toContain('इडली');
  });

  it('patience at 60% / 35% / 15% brings polite, then hurrying, then angry lines', () => {
    const d = createDialogueDirector({ lang: 'te', seed: 'pat' });
    const out = [];
    const base = customer({ patienceMax: 40, arrivedAt: 0 });
    out.push(...d.update(mkState(0, [{ ...base, patience: 40 }]), [arrive(1)]));
    for (let t = 1; t <= 38; t++) out.push(...d.update(mkState(t, [{ ...base, patience: 40 - t }]), []));
    const sits = out.map((u) => u.sit);
    const iPolite = sits.indexOf('waiting-polite');
    const iHurry = sits.indexOf('waiting-hurry');
    const iAngry = sits.indexOf('waiting-angry');
    expect(iPolite).toBeGreaterThanOrEqual(0);
    expect(iHurry).toBeGreaterThan(iPolite);
    expect(iAngry).toBeGreaterThan(iHurry);
    // at the right moments: frac <= .6 -> patience <= 24, <= .35 -> <= 14, <= .15 -> <= 6
    expect(out[iPolite].at).toBeGreaterThanOrEqual(16);
    expect(out[iHurry].at).toBeGreaterThanOrEqual(26);
    expect(out[iAngry].at).toBeGreaterThanOrEqual(34);
    expect(out.find((u) => u.sit === 'waiting-angry').mood).toMatch(/angry|impatient/);
    checkRules(out, 'patience');
  });

  it('frozen tutorial patience never produces waiting lines', () => {
    const d = createDialogueDirector({ lang: 'hi', seed: 1 });
    const out = [];
    for (let t = 0; t < 30; t++) out.push(...d.update(mkState(t, [customer({ patience: 3 })], { cfg: { tutorial: true, noPatience: true, hour: [7, 8] } }), t === 0 ? [arrive(1)] : []));
    expect(out.some((u) => u.sit.startsWith('waiting-'))).toBe(false);
  });

  it('serving: thanks or praise for a good dish, complaints for a mediocre one or a long wait', () => {
    const run = (qs, patience, id) => {
      const d = createDialogueDirector({ lang: 'te', seed: 'serve' });
      const before = customer({ id, patience });
      d.update(mkState(10, [before]), []);
      const after = customer({ id, patience: Math.min(30, patience + 8), got: ['dosa'], qs: [qs], st: 'eating', eatLeft: 4 });
      return d.update(mkState(11, [after]), [{ type: 'serve', customer: id, dish: 'dosa', by: 'p1' }, { type: 'eating', customer: id }]);
    };
    const kinds = { ok: new Set(), perfect: new Set(), late: new Set() };
    for (let id = 1; id <= 60; id++) {
      for (const u of run('ok', 28, id)) if (u.sit.startsWith('serve')) kinds.ok.add(u.sit);
      for (const u of run('perfect', 28, id)) if (u.sit.startsWith('serve')) kinds.perfect.add(u.sit);
      for (const u of run('good', 4, id)) if (u.sit.startsWith('serve')) kinds.late.add(u.sit);
    }
    expect(kinds.ok.has('serve-complain')).toBe(true);
    expect(kinds.ok.has('serve-thanks') || kinds.ok.has('serve-praise')).toBe(true);
    expect(kinds.perfect.has('serve-complain')).toBe(false);
    expect(kinds.perfect.has('serve-praise')).toBe(true);
    expect(kinds.perfect.has('serve-thanks')).toBe(true);
    expect(kinds.late.has('serve-complain')).toBe(true);
    // lateness complaints are about the wait
    let late = 0;
    for (let id = 1; id <= 60; id++) for (const u of run('good', 4, id)) if (u.sit === 'serve-complain') { expect(LINE_BY_ID[u.lineId].tag).toBe('late'); late += 1; }
    expect(late).toBeGreaterThan(5);
  });

  it('eating brings a compliment or small talk, only while they are eating', () => {
    const sits = new Set();
    for (let id = 1; id <= 40; id++) {
      const d = createDialogueDirector({ lang: 'hi', seed: 'eat' });
      const c = customer({ id, st: 'eating', got: ['dosa'], qs: ['good'], eatLeft: 4 });
      d.update(mkState(5, [{ ...c, st: 'waiting', got: [] }]), []);
      for (const u of d.update(mkState(6, [c]), [{ type: 'eating', customer: id }])) sits.add(u.sit);
      for (const u of d.update(mkState(7, [c]), [])) sits.add(u.sit);
    }
    expect(sits.has('eating-compliment')).toBe(true);
    expect(sits.has('eating-chat')).toBe(true);
    const d = createDialogueDirector({ lang: 'hi', seed: 'eat' });
    const out = d.update(mkState(8, [customer({ st: 'paying', payLeft: 9, got: ['dosa'] })]), [{ type: 'eating', customer: 1 }]);
    expect(out.length).toBe(0);
  });

  it('pay-ready, pay-warning and collect', () => {
    const sits = new Set();
    const farewell = new Set();
    for (let id = 1; id <= 60; id++) {
      const d = createDialogueDirector({ lang: 'auto', seed: 'pay' });
      const paying = customer({ id, kind: id % 5 === 0 ? 'uncle' : 'office', st: 'paying', payLeft: 9, total: 90, got: ['dosa'], qs: ['good'], tip: 6 });
      d.update(mkState(20, [{ ...paying, st: 'eating' }]), []);
      for (const u of d.update(mkState(21, [paying]), [{ type: 'pay-ready', customer: id }])) sits.add(u.sit);
      for (const u of d.update(mkState(25, [{ ...paying, payLeft: 3 }]), [{ type: 'pay-warning', customer: id }])) sits.add(u.sit);
      const gone = { ...paying, st: 'left', outcome: 'paid', leftAt: 26 };
      for (const u of d.update(mkState(26, [gone]), [{ type: 'collect', customer: id, amount: 90, tip: 6, by: 'p1', combo: 1 }])) {
        farewell.add(u.sit);
        expect(u.final).toBe(true);
      }
      for (const u of d.update(mkState(29, [gone]), [])) { farewell.add(u.sit); expect(u.final).toBe(true); }
    }
    expect(sits.has('pay-ready')).toBe(true);
    expect(sits.has('pay-hurry')).toBe(true);
    expect([...sits].every((s) => ['pay-ready', 'pay-haggle', 'apology', 'pay-hurry'].includes(s))).toBe(true);
    expect(farewell.has('pay-change-keep')).toBe(true);
    expect(farewell.has('elder-blessing')).toBe(true);
  });

  it('pay-ready lines with {n} get the bill', () => {
    let seen = false;
    for (let id = 1; id <= 80 && !seen; id++) {
      const d = createDialogueDirector({ lang: 'hi', seed: 'bill' });
      const c = customer({ id, st: 'paying', payLeft: 9, total: 130 });
      for (const u of d.update(mkState(5, [c]), [{ type: 'pay-ready', customer: id }])) if (LINE_BY_ID[u.lineId].n) { seen = true; expect(u.text).toContain('130'); }
    }
    expect(seen).toBe(true);
  });

  it('angry and unpaid departures, and turned-away visitors', () => {
    const d = createDialogueDirector({ lang: 'dk', seed: 'leave' });
    const a = customer({ id: 1, st: 'left', outcome: 'angry', leftAt: 40, patience: 0 });
    const outA = d.update(mkState(40, [a]), [{ type: 'customer-angry', customer: 1 }]);
    expect(outA.length).toBe(1);
    expect(outA[0].sit).toBe('angry-leave');
    expect(outA[0].final).toBe(true);
    expect(outA[0].lang).toBe('dk');
    const u = customer({ id: 2, st: 'left', outcome: 'unpaid', leftAt: 41 });
    const outU = d.update(mkState(41, [a, u]), [{ type: 'customer-unpaid', customer: 2, owed: 40 }]);
    expect(outU.map((x) => x.sit)).toEqual(['unpaid-leave']);
    const outT = d.update(mkState(45, []), [{ type: 'customer-turned-away', customer: 9 }]);
    expect(outT.length).toBe(1);
    expect(outT[0].sit).toBe('turned-away');
    expect(outT[0].customer).toBe(9);
  });

  it('priority: anger and payment beat serving, which beats ordering; only two at a time', () => {
    const d = createDialogueDirector({ lang: 'hi', seed: 'prio' });
    const c1 = customer({ id: 1, arrivedAt: 50, order: ['dosa'] });
    const c2 = customer({ id: 2, st: 'left', outcome: 'angry', leftAt: 50 });
    const c3 = customer({ id: 3, st: 'eating', got: ['idly'], qs: ['good'], eatLeft: 4, order: ['idly'], arrivedAt: 40 });
    const out = d.update(mkState(50, [c1, c2, c3]), [
      arrive(1), { type: 'customer-angry', customer: 2 }, { type: 'serve', customer: 3, dish: 'idly', by: 'p1' },
    ]);
    expect(out.length).toBe(2);
    expect(out[0].sit).toBe('angry-leave');
    expect(out[1].sit.startsWith('serve')).toBe(true);
    expect(out.some((u) => u.customer === 1)).toBe(false);
    // later, when a slot frees up, the new arrival gets to speak
    const later = [];
    for (let t = 51; t <= 60; t++) later.push(...d.update(mkState(t, [c1, c3]), []));
    expect(later.some((u) => u.customer === 1)).toBe(true);
  });

  it('a long combo makes somebody cheer the cook', () => {
    let cheered = false;
    for (let s = 1; s <= 10 && !cheered; s++) {
      const d = createDialogueDirector({ lang: 'te', seed: `cmb${s}` });
      const cs = [customer({ id: 1, arrivedAt: 0 }), customer({ id: 2, arrivedAt: 0 })];
      d.update(mkState(0, cs), [arrive(1), arrive(2)]);
      const out = d.update(mkState(20, cs), [{ type: 'combo', combo: 3 }]);
      cheered = out.some((u) => u.sit === 'combo-praise');
    }
    expect(cheered).toBe(true);
    const d = createDialogueDirector({ lang: 'te', seed: 'cmb' });
    expect(d.update(mkState(20, [customer()]), [{ type: 'combo', combo: 2 }]).some((u) => u.sit === 'combo-praise')).toBe(false);
  });

  it('daypart flavour and idle chatter happen on a calm stall (and not in the tutorial)', () => {
    const d = createDialogueDirector({ lang: 'te', seed: 'calm' });
    const out = [];
    const cs = [1, 2, 3].map((id) => customer({ id, kind: id === 2 ? 'family' : 'office', arrivedAt: 0, patience: 1e6, patienceMax: 1e6 }));
    d.update(mkState(0, cs), cs.map((c) => arrive(c.id)));
    for (let t = 1; t <= 120; t++) out.push(...d.update(mkState(t, cs), []));
    const sits = new Set(out.map((u) => u.sit));
    expect(['morning', 'noon', 'evening', 'night'].some((s) => sits.has(s))).toBe(true);
    expect(out.length).toBeGreaterThan(4);
    checkRules(out, 'calm');
    for (const u of out.filter((x) => x.sit === 'kid-demand')) expect(u.customer).toBe(2);
    for (const u of out.filter((x) => x.sit === 'phone-call')) expect([1, 3]).toContain(u.customer);
  });

  it('at the festival level the festival lines appear', () => {
    const sits = new Set();
    for (let s = 1; s <= 12; s++) {
      const d = createDialogueDirector({ lang: 'hi', seed: `fest${s}` });
      const cs = [1, 2, 3, 4].map((id) => customer({ id, kind: 'student', arrivedAt: 0, patience: 1e6, patienceMax: 1e6 }));
      d.update(mkState(0, cs, { level: 12 }), cs.map((c) => arrive(c.id)));
      for (let t = 1; t <= 200; t++) for (const u of d.update(mkState(t, cs, { level: 12 }), [])) sits.add(u.sit);
    }
    expect(sits.has('festival')).toBe(true);
  });
});

describe('robustness', () => {
  it('never throws and returns an array on odd input', () => {
    const d = createDialogueDirector({ lang: 'nonsense', seed: undefined, subtitles: 'wat' });
    const junk = [undefined, null, 0, 1, NaN, 'x', [], {}, { customers: 'no' }, { customers: [null, 3, 'a', {}, { id: 'x' }] }, () => 1];
    for (const s of junk) for (const e of [undefined, null, 'x', [null, 1, {}, { type: 'serve' }, { type: 'collect', customer: 'z' }], {}]) {
      expect(Array.isArray(d.update(s, e))).toBe(true);
    }
    const weird = mkState(3, [customer({ order: null, got: 5, qs: 'x', patienceMax: 0, patience: 'a' }), customer({ id: 2, kind: 'alien', name: 42 })]);
    expect(Array.isArray(d.update(weird, [arrive(1), arrive(2), { type: 'serve', customer: 1 }, { type: 'pay-ready', customer: 2 }]))).toBe(true);
    expect(Array.isArray(d.update(mkState(NaN, [customer()]), [arrive(1)]))).toBe(true);
    expect(d.languageOf('whatever')).toMatch(/^(te|hi|dk)$/);
    expect(d.subtitles).toBe('native');
  });

  it('a second update at the same tick with no events adds nothing new for a customer who just spoke', () => {
    const d = createDialogueDirector({ lang: 'hi', seed: 7 });
    const st = mkState(4, [customer({ arrivedAt: 4 })]);
    const first = d.update(st, [arrive(1)]);
    const again = d.update(st, []);
    expect(first.length).toBeGreaterThan(0);
    expect(again).toEqual([]);
  });

  it('reset() forgets the past: a restarted game may say the same first line again', () => {
    const d = createDialogueDirector({ lang: 'hi', seed: 7 });
    const run = () => {
      const out = [];
      out.push(...d.update(mkState(0, [customer({ arrivedAt: 0 })]), [arrive(1)]));
      for (let t = 1; t < 8; t++) out.push(...d.update(mkState(t, [customer({ arrivedAt: 0 })]), []));
      return out.map((u) => u.lineId);
    };
    const a = run();
    d.reset();
    const b = run();
    expect(b).toEqual(a);
  });

  it('a new game (time or seed goes back) starts a fresh memory by itself', () => {
    const d = createDialogueDirector({ lang: 'hi', seed: 7 });
    const run = (seed) => {
      const out = [];
      out.push(...d.update(mkState(0, [customer({ arrivedAt: 0 })], { seed }), [arrive(1)]));
      for (let t = 1; t < 8; t++) out.push(...d.update(mkState(t, [customer({ arrivedAt: 0 })], { seed }), []));
      return out.map((u) => u.lineId);
    };
    const a = run('g1');
    const b = run('g1');
    expect(b).toEqual(a);
  });

  it('subtitle helpers on the director follow its mode', () => {
    const d = createDialogueDirector({ lang: 'te', seed: 1, subtitles: 'both' });
    expect(d.subtitles).toBe('both');
    const u = { text: 'అ', rom: 'a', en: 'A' };
    expect(d.format(u)).toBe('అ\nA');
    expect(d.setSubtitles('roman')).toBe('roman');
    expect(d.format(u)).toBe('a');
    expect(d.setSubtitles('bogus')).toBe('roman');
  });
});

describe('replay through the real engine', () => {
  const runs = [
    { level: 1, seed: 'tc-1', every: 2 },
    { level: 6, seed: 'tc-6', every: 2, players: 2 },
    { level: 12, seed: 'tc-12', every: 3 },
  ];
  const results = runs.map((r) => ({ r, out: replay(r) }));

  it('speech is plentiful and varied across the three levels', () => {
    const all = results.flatMap((x) => x.out.spoken);
    expect(all.length).toBeGreaterThan(150);
    const sits = new Set(all.map((u) => u.sit));
    for (const s of ['greet', 'order', 'serve-thanks', 'pay-ready']) expect(sits.has(s), `no ${s} line spoken`).toBe(true);
    expect([...sits].length).toBeGreaterThanOrEqual(12);
    const langs = new Set(all.map((u) => u.lang));
    expect(langs.size).toBe(3);
    expect(new Set(all.map((u) => u.lineId)).size).toBeGreaterThan(120);
    expect(new Set(all.map((u) => u.mood)).size).toBeGreaterThanOrEqual(7);
    for (const lang of ['te', 'hi', 'dk']) expect(all.filter((u) => u.lang === lang).length).toBeGreaterThan(20);
  });

  it('every game obeys the rules: no repeats, 3-tick gap per customer, at most two at once, filled templates', () => {
    for (const { r, out } of results) checkRules(out.spoken, `level ${r.level}`);
  });

  it('ordering lines name what the customer really ordered, in the customer\'s language', () => {
    for (const { r } of results) {
      let s = createGame({ players: [{ id: 'p1' }], settings: { level: r.level, pace: 'normal' }, seed: r.seed });
      const d = createDialogueDirector({ lang: 'auto', seed: r.seed });
      const orderOf = new Map();
      let checked = 0;
      for (let i = 0; i < 400 && !isOver(s); i++) {
        const res = applyAction(s, { type: 'tick' });
        s = res.state;
        for (const c of s.customers) if (!orderOf.has(c.id)) orderOf.set(c.id, c.order.slice());
        for (const u of d.update(s, res.events)) {
          if (u.sit !== 'order' && u.sit !== 'order-multi') continue;
          const dishes = orderOf.get(u.customer);
          expect(dishes, `order line for unknown customer ${u.customer}`).toBeTruthy();
          expect(u.text).toContain(dishName(u.lang, dishes[0]).text);
          checked += 1;
        }
      }
      expect(checked, `level ${r.level}`).toBeGreaterThan(4);
    }
  });

  it('a slow player triggers angry and unpaid departures, and the director voices them', () => {
    const lazy = replay({ level: 6, seed: 'lazy', every: 7 });
    expect((lazy.evTypes['customer-angry'] || 0) + (lazy.evTypes['customer-unpaid'] || 0)).toBeGreaterThan(2);
    checkRules(lazy.spoken, 'lazy');
    const sits = new Set(lazy.spoken.map((u) => u.sit));
    expect(sits.has('waiting-angry') || sits.has('angry-leave') || sits.has('unpaid-leave')).toBe(true);
    expect(sits.has('waiting-hurry') || sits.has('waiting-polite')).toBe(true);
    if (lazy.evTypes['customer-angry']) expect(lazy.spoken.some((u) => u.sit === 'angry-leave')).toBe(true);
  });

  it('is deterministic: the same seed and game give the same speech; another seed gives different speech', () => {
    const a = replay({ level: 4, seed: 'det', every: 2 });
    const b = replay({ level: 4, seed: 'det', every: 2 });
    const c = replay({ level: 4, seed: 'other', every: 2 });
    expect(JSON.stringify(b.spoken)).toBe(JSON.stringify(a.spoken));
    expect(JSON.stringify(c.spoken)).not.toBe(JSON.stringify(a.spoken));
    expect(a.spoken.length).toBeGreaterThan(20);
  });

  it('a fixed language is spoken throughout; mixed switches inside a customer', () => {
    for (const lang of ['te', 'hi', 'dk']) {
      const r = replay({ level: 2, seed: `fix-${lang}`, every: 2, lang });
      expect(r.spoken.length).toBeGreaterThan(10);
      expect(new Set(r.spoken.map((u) => u.lang))).toEqual(new Set([lang]));
      checkRules(r.spoken, lang);
    }
    const mixed = replay({ level: 6, seed: 'mix', every: 2, lang: 'mixed' });
    checkRules(mixed.spoken, 'mixed');
    const by = new Map();
    for (const u of mixed.spoken) by.set(u.customer, (by.get(u.customer) || new Set()).add(u.lang));
    expect([...by.values()].some((s) => s.size > 1)).toBe(true);
  });

  it('kind-specific lines only come from the right customers', () => {
    const owner = { 'kid-demand': ['family'], 'phone-call': ['office', 'techie'], 'student-broke': ['student'], 'autowala-chat': ['autowala'], 'elder-blessing': ['uncle'] };
    for (const { r } of results) {
      let s = createGame({ players: [{ id: 'p1' }], settings: { level: r.level, pace: 'normal' }, seed: r.seed });
      const d = createDialogueDirector({ lang: 'auto', seed: r.seed });
      const kindOf = new Map();
      for (let i = 0; i < 300 && !isOver(s); i++) {
        const res = applyAction(s, { type: 'tick' });
        s = res.state;
        for (const c of s.customers) kindOf.set(c.id, c.kind);
        for (const u of d.update(s, res.events)) if (owner[u.sit] && kindOf.has(u.customer)) expect(owner[u.sit], `${u.sit} by ${kindOf.get(u.customer)}`).toContain(kindOf.get(u.customer));
      }
    }
  });

  it('linesFor exposes the pools', () => {
    expect(linesFor('te', 'greet').length).toBeGreaterThanOrEqual(14);
    expect(linesFor('xx', 'greet')).toEqual([]);
    expect(linesFor('te', 'nothing')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// the operations layer (docs/TIFFIN_CENTRE_PLAN.md section 3b): events, requests, regulars, complaints

const OPS_SITS = [
  'rain-start', 'rain-ongoing', 'rain-end', 'power-cut', 'power-back', 'cricket-night', 'festival-greeting', 'inspector-arrival', 'inspector-pass', 'inspector-fail',
  'sold-out-polite', 'stock-out-apology', 'delivery-boy-hurry', 'parcel-request', 'extra-request-chutney', 'extra-request-sambar', 'spice-request-less',
  'spice-request-more', 'regular-named', 'regular-loyal', 'big-office-order', 'broken-dish-complaint', 'sour-batter-complaint', 'gas-out-chatter', 'thanks-fast-service',
];

/** A calm stall: `n` customers who have ordered and are waiting (patience never runs out). */
function calm(n = 3, o = {}) {
  return Array.from({ length: n }, (_, i) => customer({ id: i + 1, kind: ['office', 'student', 'family', 'autowala', 'uncle'][i % 5], arrivedAt: 0, patience: 1e6, patienceMax: 1e6, ...o }));
}
/** Run the director over an unchanging stall up to tick `ticks`; `at` maps a tick to the events of that tick; `st(t)` adds state fields (events, gas ...). */
function run(d, cs, ticks, at = {}, st = () => ({}), from = 1) {
  const out = [];
  if (from === 1) d.update(mkState(0, cs, st(0)), cs.map((c) => arrive(c.id)));
  for (let t = from; t <= ticks; t++) out.push(...d.update(mkState(t, cs, st(t)), at[t] || []));
  return out;
}
const sitsOf = (list) => list.map((u) => u.sit);
const only = (list, sit) => list.filter((u) => u.sit === sit);
const warm = (d, cs, ticks = 14) => run(d, cs, ticks); // orders and greetings out of the way

describe('operations: rain, power, cricket, festival', () => {
  it('rain: a couple of people say ayyo varsham when it starts, chat while it lasts (7+ ticks apart), and sigh when it ends', () => {
    for (let s = 1; s <= 5; s++) {
      const d = createDialogueDirector({ lang: 'te', seed: `rain${s}` });
      const cs = calm(4);
      warm(d, cs);
      const rain = (t) => (t >= 15 && t < 60 ? { events: [{ id: 'rain', until: 60 }] } : {});
      const out = run(d, cs, 70, { 15: [{ type: 'event-start', id: 'rain', until: 60 }], 60: [{ type: 'event-end', id: 'rain' }] }, rain, 15);
      const start = only(out, 'rain-start');
      expect(start.length, `seed ${s}`).toBeGreaterThanOrEqual(1);
      expect(start.length).toBeLessThanOrEqual(2);
      for (const u of start) expect(u.at).toBeLessThanOrEqual(25);
      const ongoing = only(out, 'rain-ongoing');
      expect(ongoing.length, `seed ${s}`).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < ongoing.length; i++) expect(ongoing[i].at - ongoing[i - 1].at, 'rain-ongoing cooldown').toBeGreaterThanOrEqual(7);
      for (const u of ongoing) { expect(u.at).toBeGreaterThanOrEqual(15); expect(u.at).toBeLessThan(62); }
      expect(only(out, 'rain-end').length, `seed ${s}`).toBe(1);
      expect(only(out, 'rain-end')[0].at).toBeGreaterThanOrEqual(60);
      // no rain talk when it does not rain
      expect(only(run(createDialogueDirector({ lang: 'te', seed: `rain${s}` }), calm(4), 50), 'rain-ongoing').length).toBe(0);
      checkRules(out, `rain ${s}`);
    }
  });

  it('power cut: two lines when the lights go, some while it lasts (9+ ticks apart), a cheer when the power is back', () => {
    for (let s = 1; s <= 5; s++) {
      const d = createDialogueDirector({ lang: 'auto', seed: `pw${s}` });
      const cs = calm(4);
      warm(d, cs);
      const pw = (t) => (t >= 15 && t < 55 ? { events: [{ id: 'power', until: 55 }] } : {});
      const out = run(d, cs, 66, { 15: [{ type: 'event-start', id: 'power', until: 55 }], 55: [{ type: 'event-end', id: 'power' }] }, pw, 15);
      const cut = only(out, 'power-cut');
      expect(cut.length, `seed ${s}`).toBeGreaterThanOrEqual(2);
      const ambientOnly = cut.filter((u) => u.at > 26);
      for (let i = 1; i < ambientOnly.length; i++) expect(ambientOnly[i].at - ambientOnly[i - 1].at).toBeGreaterThanOrEqual(9);
      expect(only(out, 'power-back').length, `seed ${s}`).toBeGreaterThanOrEqual(1);
      for (const u of only(out, 'power-back')) expect(u.at).toBeGreaterThanOrEqual(55);
      checkRules(out, `power ${s}`);
    }
  });

  it('cricket and festival nights get their own talk (cooldowns 6 and 8 ticks), only while the event runs', () => {
    for (const [id, sit, cd] of [['cricket', 'cricket-night', 6], ['festival', 'festival-greeting', 8]]) {
      const d = createDialogueDirector({ lang: 'hi', seed: `ev-${id}` });
      const cs = calm(5);
      warm(d, cs);
      const on = (t) => (t >= 15 && t < 70 ? { events: [{ id, until: 70 }] } : {});
      const out = run(d, cs, 90, { 15: [{ type: 'event-start', id, until: 70 }] }, on, 15);
      const list = only(out, sit);
      expect(list.length, id).toBeGreaterThanOrEqual(4);
      for (const u of list) { expect(u.at).toBeGreaterThanOrEqual(15); expect(u.at).toBeLessThanOrEqual(76); }
      const ambient = list.filter((u) => u.at > 30);
      for (let i = 1; i < ambient.length; i++) expect(ambient[i].at - ambient[i - 1].at, `${id} cooldown`).toBeGreaterThanOrEqual(cd);
      checkRules(out, id);
    }
  });

  it('customers who arrive in the rain, a cricket night, a festival or a power cut greet in its words some of the time', () => {
    for (const [id, sit] of [['rain', 'rain-ongoing'], ['cricket', 'cricket-night'], ['festival', 'festival-greeting'], ['power', 'power-cut']]) {
      let hits = 0;
      for (let i = 1; i <= 60; i++) {
        const d = createDialogueDirector({ lang: 'te', seed: `arr-${id}` });
        const c = customer({ id: i, arrivedAt: 20 });
        const out = d.update(mkState(20, [c], { events: [{ id, until: 90 }] }), [arrive(i)]);
        if (out.some((u) => u.sit === sit)) hits += 1;
      }
      expect(hits, id).toBeGreaterThan(5);
      expect(hits, id).toBeLessThan(40);
    }
  });

  it('nothing from the events layer is said in the training shift', () => {
    const d = createDialogueDirector({ lang: 'te', seed: 'tut-ops' });
    const cs = calm(3);
    const tut = () => ({ cfg: { tutorial: true, noPatience: true, hour: [7, 8] }, events: [{ id: 'rain', until: 99 }], gas: { u: 0, sw: 0 } });
    const out = run(d, cs, 40, { 5: [{ type: 'event-start', id: 'rain', until: 99 }, { type: 'gas-out' }, { type: 'stock-out', item: 'sambar' }] }, tut);
    expect(out.filter((u) => ['rain-start', 'rain-ongoing', 'gas-out-chatter', 'stock-out-apology'].includes(u.sit)).length).toBe(0);
  });

  it('with nobody at the stall the line is owed for a few ticks and said by the first customer who is free; later it is dropped', () => {
    const d = createDialogueDirector({ lang: 'te', seed: 'owed' });
    expect(d.update(mkState(5, []), [{ type: 'event-start', id: 'rain', until: 50 }])).toEqual([]);
    const c = customer({ id: 1, arrivedAt: 6 });
    const out = [];
    out.push(...d.update(mkState(6, [c]), [arrive(1)]));
    for (let t = 7; t <= 16; t++) out.push(...d.update(mkState(t, [{ ...c, patience: 30 }]), []));
    expect(sitsOf(out)).toContain('rain-start');
    const late = createDialogueDirector({ lang: 'te', seed: 'owed' });
    late.update(mkState(5, []), [{ type: 'event-start', id: 'rain', until: 50 }]);
    const c2 = customer({ id: 1, arrivedAt: 40 });
    const out2 = [...late.update(mkState(40, [c2]), [arrive(1)]), ...[41, 42, 43, 44, 45, 46].flatMap((t) => late.update(mkState(t, [c2]), []))];
    expect(sitsOf(out2)).not.toContain('rain-start');
  });
});

describe('operations: the inspector', () => {
  it('whispers about GHMC when the notice comes, then reacts to the verdict (pass / fail)', () => {
    for (const pass of [true, false]) {
      const sit = pass ? 'inspector-pass' : 'inspector-fail';
      for (let s = 1; s <= 4; s++) {
        const d = createDialogueDirector({ lang: 'te', seed: `insp${s}${pass}` });
        const cs = calm(4);
        warm(d, cs);
        const on = (t) => (t >= 15 && t < 29 ? { events: [{ id: 'inspector', until: 29 }] } : {});
        const out = run(d, cs, 45, {
          15: [{ type: 'event-start', id: 'inspector', until: 29 }],
          29: [pass ? { type: 'inspector', pass: true, bonus: 90, fine: 0, why: [] } : { type: 'inspector', pass: false, bonus: 0, fine: 68, why: ['untended'] }, { type: 'event-end', id: 'inspector' }],
        }, on, 15);
        const arrival = only(out, 'inspector-arrival');
        expect(arrival.length, `seed ${s}`).toBeGreaterThanOrEqual(2);
        expect(arrival.length).toBeLessThanOrEqual(3);
        for (const u of arrival) { expect(u.at).toBeGreaterThanOrEqual(15); expect(u.at).toBeLessThan(29); }
        const verdict = only(out, sit);
        expect(verdict.length, `${sit} seed ${s}`).toBeGreaterThanOrEqual(1);
        expect(verdict.length).toBeLessThanOrEqual(2);
        for (const u of verdict) expect(u.at).toBeGreaterThanOrEqual(29);
        expect(only(out, pass ? 'inspector-fail' : 'inspector-pass').length).toBe(0);
        checkRules(out, `inspector ${s}`);
      }
    }
  });
});

describe('operations: sold out, stock out, gas', () => {
  it('a dish swapped at the door: the customer names what is gone and what they take instead, in their language', () => {
    for (let id = 1; id <= 40; id++) {
      const d = createDialogueDirector({ lang: 'auto', seed: 'sold' });
      const c = customer({ id, arrivedAt: 0, order: ['dosa'] });
      const out = [...d.update(mkState(0, [c]), [arrive(id), { type: 'sold-out', customer: id, dish: 'idly', swap: 'dosa', left: false }])];
      for (let t = 1; t <= 12; t++) out.push(...d.update(mkState(t, [c]), []));
      const u = only(out, 'sold-out-polite')[0];
      expect(u, `customer ${id}`).toBeTruthy();
      expect(LINE_BY_ID[u.lineId].tag).toBe('swap');
      expect(u.lang).toBe(d.languageOf(id));
      expect(u.text).toContain(dishName(u.lang, 'idly').text);
      expect(u.text).toContain(dishName(u.lang, 'dosa').text);
      // the order is spoken first (it already names the new dish), then the "it is finished" line
      const order = out.find((x) => x.sit === 'order');
      expect(order.at).toBeLessThanOrEqual(u.at);
    }
  });

  it('a dropped dish and a polite leave use their own pools; a customer who never got a seat still speaks', () => {
    const d = createDialogueDirector({ lang: 'dk', seed: 'sold2' });
    const c = customer({ id: 1, arrivedAt: 0, order: ['dosa'] });
    const first = d.update(mkState(0, [c]), [arrive(1), { type: 'sold-out', customer: 1, dish: 'vada', swap: null, left: false }]);
    const rest = Array.from({ length: 12 }, (_, i) => d.update(mkState(i + 1, [c]), [])).flat();
    const drop = [...first, ...rest].find((u) => u.sit === 'sold-out-polite');
    expect(drop).toBeTruthy();
    expect(LINE_BY_ID[drop.lineId].tag).toBe('drop');

    const d2 = createDialogueDirector({ lang: 'dk', seed: 'sold3' });
    const gone = customer({ id: 2, st: 'left', outcome: 'soldout', leftAt: 20 });
    const leave = d2.update(mkState(20, [gone]), [{ type: 'sold-out', customer: 2, dish: 'dosa', swap: null, left: true }]);
    expect(leave.length).toBe(1);
    expect(leave[0].sit).toBe('sold-out-polite');
    expect(leave[0].final).toBe(true);
    expect(LINE_BY_ID[leave[0].lineId].tag).toBe('leave');

    const d3 = createDialogueDirector({ lang: 'te', seed: 'sold4' });
    const ghost = d3.update(mkState(21, []), [{ type: 'sold-out', customer: 55, dish: 'idly', swap: null, left: true }]);
    expect(ghost.length).toBe(1);
    expect(ghost[0].customer).toBe(55);
    expect(ghost[0].lang).toBe('te');
    expect(ghost[0].text).toMatch(/[ఀ-౿]/);
  });

  it('stock-out: one customer consoles the cook, and not again for 20 ticks', () => {
    const d = createDialogueDirector({ lang: 'hi', seed: 'stock' });
    const cs = calm(4);
    warm(d, cs);
    const out = run(d, cs, 60, { 15: [{ type: 'stock-out', item: 'sambar' }], 20: [{ type: 'stock-out', item: 'batter_dosa' }], 40: [{ type: 'stock-out', item: 'oil' }] }, () => ({}), 15);
    const list = only(out, 'stock-out-apology');
    expect(list.length).toBe(2);
    expect(list[0].at).toBeGreaterThanOrEqual(15);
    expect(list[1].at).toBeGreaterThanOrEqual(40);
    expect(list[1].at - list[0].at).toBeGreaterThanOrEqual(20);
  });

  it('gas-out: talk when the cylinder dies and while it is being changed (8+ ticks apart), then silence', () => {
    for (let s = 1; s <= 4; s++) {
      const d = createDialogueDirector({ lang: 'dk', seed: `gas${s}` });
      const cs = calm(4);
      warm(d, cs);
      const gas = (t) => ({ gas: t >= 15 && t < 55 ? { u: 0, sw: t >= 45 ? 6 : 0 } : { u: 600, sw: 0 } });
      const out = run(d, cs, 80, { 15: [{ type: 'gas-out' }], 45: [{ type: 'gas-swap', phase: 'start', ticks: 6, cost: 90, by: 'p1' }] }, gas, 15);
      const list = only(out, 'gas-out-chatter');
      expect(list.length, `seed ${s}`).toBeGreaterThanOrEqual(2);
      const ambient = list.filter((u) => u.at > 28 && u.at < 45);
      for (let i = 1; i < ambient.length; i++) expect(ambient[i].at - ambient[i - 1].at).toBeGreaterThanOrEqual(8);
      for (const u of list) expect(u.at).toBeLessThan(68);
      checkRules(out, `gas ${s}`);
    }
  });
});

describe('operations: what a customer asks for', () => {
  const said = (cust, lang = 'te', seed = 'req') => {
    const d = createDialogueDirector({ lang, seed });
    const out = [...d.update(mkState(0, [cust]), [arrive(cust.id)])];
    for (let t = 1; t <= 24; t++) out.push(...d.update(mkState(t, [cust]), []));
    return out;
  };
  const patient = { patience: 1e6, patienceMax: 1e6 };

  it('parcel, extra chutney or sambar and spice are asked for right after the order, in that order', () => {
    const c = customer({ id: 1, arrivedAt: 0, parcel: true, extra: 'chutney', spice: 'more', ...patient });
    for (const lang of ['te', 'hi', 'dk']) {
      const out = said(c, lang);
      const sits = sitsOf(out);
      const order = sits.indexOf('order');
      expect(order, lang).toBeGreaterThanOrEqual(0);
      expect(sits.slice(order + 1, order + 4), lang).toEqual(['parcel-request', 'extra-request-chutney', 'spice-request-more']);
      checkRules(out, `req ${lang}`);
    }
    expect(sitsOf(said(customer({ id: 2, arrivedAt: 0, extra: 'sambar', ...patient })))).toContain('extra-request-sambar');
    expect(sitsOf(said(customer({ id: 3, arrivedAt: 0, extra: 'coconut_chutney', ...patient })))).toContain('extra-request-chutney');
    expect(sitsOf(said(customer({ id: 4, arrivedAt: 0, spice: 'less', ...patient })))).toContain('spice-request-less');
    expect(sitsOf(said(customer({ id: 5, arrivedAt: 0, ...patient }))).some((s) => /request/.test(s))).toBe(false);
  });

  it('the parcel-order event of the engine does not make a customer ask twice', () => {
    const c = customer({ id: 1, arrivedAt: 0, parcel: true, ...patient });
    const d = createDialogueDirector({ lang: 'hi', seed: 'twice' });
    const out = [...d.update(mkState(0, [c]), [arrive(1), { type: 'parcel-order', customer: 1, n: 1 }])];
    for (let t = 1; t <= 24; t++) out.push(...d.update(mkState(t, [c]), t === 3 ? [{ type: 'parcel-order', customer: 1, n: 1 }] : []));
    expect(only(out, 'parcel-request').length).toBe(1);
  });

  it('an office parcel order opens with the big order line (with the number of parcels) before the customer orders', () => {
    const order = ['idly', 'dosa', 'dosa', 'vada', 'idly', 'poori'];
    for (const lang of ['te', 'hi', 'dk']) {
      const c = customer({ id: 1, arrivedAt: 0, big: true, parcel: true, kind: 'office', order, ...patient });
      const sits = sitsOf(said(c, lang, `big${lang}`));
      expect(sits[0], lang).toBe('big-office-order');
      expect(sits.indexOf('order-multi'), lang).toBeGreaterThan(0);
      expect(sits.includes('parcel-request'), 'a big order does not ask for a plain parcel as well').toBe(false);
    }
    let withN = 0;
    for (let i = 1; i <= 50; i++) {
      const c = customer({ id: i, arrivedAt: 0, big: true, parcel: true, kind: 'office', order });
      const d = createDialogueDirector({ lang: 'hi', seed: 'bign' });
      const u = d.update(mkState(0, [c]), [arrive(i)])[0];
      if (LINE_BY_ID[u.lineId].n) { withN += 1; expect(u.text).toContain('6'); }
    }
    expect(withN).toBeGreaterThan(3);
  });

  it('the delivery boy is Hindi or Dakhni (Telugu rarely) and hurries in his own words as his patience drains', () => {
    const langs = { te: 0, hi: 0, dk: 0 };
    for (let id = 1; id <= 200; id++) {
      const d = createDialogueDirector({ lang: 'auto', seed: 'dlv' });
      d.update(mkState(0, [customer({ id, name: 'Delivery boy', kind: 'autowala', delivery: true, parcel: true, arrivedAt: 0 })]), [arrive(id)]);
      langs[d.languageOf(id)] += 1;
    }
    expect(langs.te).toBeLessThan(40);
    expect(langs.hi + langs.dk).toBeGreaterThan(160);
    expect(langs.hi).toBeGreaterThan(50);
    expect(langs.dk).toBeGreaterThan(50);
    const d = createDialogueDirector({ lang: 'hi', seed: 'dlv2' });
    const base = customer({ id: 1, name: 'Delivery boy', kind: 'autowala', delivery: true, parcel: true, order: ['idly', 'dosa', 'vada', 'poori', 'osmania'], arrivedAt: 0, patienceMax: 48 });
    const out = [...d.update(mkState(0, [{ ...base, patience: 48 }]), [arrive(1), { type: 'parcel-order', customer: 1, n: 5, delivery: true }])];
    for (let t = 1; t <= 44; t++) out.push(...d.update(mkState(t, [{ ...base, patience: 48 - t }]), []));
    expect(only(out, 'delivery-boy-hurry').length).toBeGreaterThanOrEqual(3);
    expect(out[0].sit).toBe('delivery-boy-hurry');
    expect(sitsOf(out)).not.toContain('waiting-hurry');
    expect(sitsOf(out)).not.toContain('waiting-polite');
    expect(sitsOf(out)).toContain('waiting-angry');
    checkRules(out, 'delivery');
  });
});

describe('operations: regulars', () => {
  const visit = (d, id, rid, loyal, t0, kind = 'uncle') => {
    const c = customer({ id, name: 'Murthy garu', kind, regular: true, rid, loyal, arrivedAt: t0, order: ['dosa'], patience: 1e6, patienceMax: 1e6 });
    const out = [...d.update(mkState(t0, [c], { regs: [[loyal, 0]] }), [arrive(id)])];
    for (let t = t0 + 1; t <= t0 + 12; t++) out.push(...d.update(mkState(t, [c], { regs: [[loyal, 0]] }), []));
    return out;
  };

  it('a regular speaks the same language on every visit (by rid), however the customer ids change', () => {
    let differs = 0;
    for (let s = 1; s <= 30; s++) {
      const d = createDialogueDirector({ lang: 'auto', seed: `reg${s}` });
      visit(d, 10, 1, 0, 0);
      visit(d, 25, 1, 1, 50);
      visit(d, 40, 1, 2, 100);
      const l = d.languageOf(10);
      expect(d.languageOf(25), `seed ${s}`).toBe(l);
      expect(d.languageOf(40), `seed ${s}`).toBe(l);
      visit(d, 11, 2, 0, 5);
      if (d.languageOf(11) !== l) differs += 1;
    }
    expect(differs).toBeGreaterThan(5); // different regulars are different people
  });

  it('a regular is greeted by name (the low or the high loyalty pool) and never repeats a line across visits', () => {
    for (const lang of ['te', 'hi', 'dk']) {
      const d = createDialogueDirector({ lang, seed: 'regvisits' });
      const all = [];
      let named = 0;
      for (let v = 0; v < 6; v++) {
        const loyal = v < 2 ? 0 : 3;
        const out = visit(d, 100 + v, 0, loyal, v * 40);
        const g = out.find((u) => u.sit === 'regular-named');
        if (g) {
          named += 1;
          expect(LINE_BY_ID[g.lineId].tag, `${lang} visit ${v}`).toBe(loyal >= 2 ? 'high' : 'low');
        }
        all.push(...out);
      }
      expect(named, lang).toBeGreaterThanOrEqual(4);
      const ids = all.map((u) => u.lineId);
      expect(new Set(ids).size, `${lang} repeated a line across visits`).toBe(ids.length);
    }
  });

  it('a loyal regular who tipped leaves a tip-and-blessing line; a new face does not', () => {
    let loyalSaid = 0;
    let newSaid = 0;
    for (let i = 1; i <= 50; i++) {
      const mk = (loyal) => customer({ id: i, kind: 'office', regular: true, rid: 0, loyal, st: 'paying', payLeft: 9, total: 60, tip: 8, got: ['dosa'], qs: ['good'], arrivedAt: 0 });
      const dd = createDialogueDirector({ lang: 'te', seed: 'loy' });
      dd.update(mkState(5, [{ ...mk(3), st: 'eating' }]), []);
      for (const u of dd.update(mkState(6, [{ ...mk(3), st: 'left', outcome: 'paid', leftAt: 6 }]), [{ type: 'collect', customer: i, amount: 60, tip: 8, by: 'p1', combo: 1 }])) {
        if (u.sit === 'regular-loyal') { loyalSaid += 1; expect(u.final).toBe(true); }
      }
      const d2 = createDialogueDirector({ lang: 'te', seed: 'loy' });
      d2.update(mkState(5, [{ ...mk(0), st: 'eating' }]), []);
      for (const u of d2.update(mkState(6, [{ ...mk(0), st: 'left', outcome: 'paid', leftAt: 6 }]), [{ type: 'collect', customer: i, amount: 60, tip: 8, by: 'p1', combo: 1 }])) {
        if (u.sit === 'regular-loyal') newSaid += 1;
      }
    }
    expect(loyalSaid).toBeGreaterThan(15);
    expect(newSaid).toBe(0);
  });

  it('where the game has real regulars, strangers do not pretend to be regulars', () => {
    let pseudo = 0;
    let pseudoNoRegs = 0;
    for (let i = 1; i <= 120; i++) {
      const c = customer({ id: i, arrivedAt: 0 });
      const withRegs = createDialogueDirector({ lang: 'te', seed: 'pseudo' });
      for (const u of withRegs.update(mkState(0, [c], { regs: [[0, 10]] }), [arrive(i)])) if (u.sit === 'regular-greet') pseudo += 1;
      const without = createDialogueDirector({ lang: 'te', seed: 'pseudo' });
      for (const u of without.update(mkState(0, [c]), [arrive(i)])) if (u.sit === 'regular-greet') pseudoNoRegs += 1;
    }
    expect(pseudo).toBe(0);
    expect(pseudoNoRegs).toBeGreaterThan(0);
  });
});

describe('operations: complaints and thanks when serving', () => {
  const serveRun = (seed, qs, { patience = 28, e = {}, state = {}, id = 1 } = {}) => {
    const d = createDialogueDirector({ lang: 'te', seed });
    const before = customer({ id, patience });
    d.update(mkState(10, [before], state), []);
    const after = customer({ id, patience: Math.min(30, patience + 8), got: ['dosa'], qs: [qs], st: 'eating', eatLeft: 4 });
    return d.update(mkState(11, [after], state), [{ type: 'serve', customer: id, dish: 'dosa', by: 'p1', ...e }, { type: 'eating', customer: id }]);
  };

  it('a torn dish (q: broken) is complained about, in the line pool for torn and stuck dosas', () => {
    let n = 0;
    for (let id = 1; id <= 60; id++) {
      const out = serveRun('brk', 'broken', { e: { q: 'broken' }, id });
      const u = out.find((x) => x.sit.startsWith('serve') || x.sit.endsWith('complaint') || x.sit.startsWith('thanks'));
      if (u.sit === 'broken-dish-complaint') n += 1;
      expect(u.sit === 'broken-dish-complaint' || u.sit === 'serve-thanks' || u.sit === 'serve-praise', `${u.sit}`).toBe(true);
    }
    expect(n).toBeGreaterThan(45); // about 90%
  });

  it('sour batter on the shelf (state.fresh below 30) draws the sour complaint; fresh batter does not', () => {
    let sour = 0;
    let fresh = 0;
    for (let id = 1; id <= 60; id++) {
      if (serveRun('sour', 'ok', { state: { fresh: { batter_dosa: 22 } }, id }).some((u) => u.sit === 'sour-batter-complaint')) sour += 1;
      if (serveRun('sour', 'ok', { state: { fresh: { batter_dosa: 80 } }, id }).some((u) => u.sit === 'sour-batter-complaint')) fresh += 1;
    }
    expect(sour).toBeGreaterThan(30);
    expect(fresh).toBe(0);
    // sour batter of another dish: no complaint about this one
    for (let id = 1; id <= 40; id++) expect(serveRun('sour2', 'ok', { state: { fresh: { batter_idly: 5 } }, id }).some((u) => u.sit === 'sour-batter-complaint')).toBe(false);
  });

  it('a very quick serve is sometimes thanked for its speed (never a mediocre dish or a slow one), at most once per 10 ticks', () => {
    let thanks = 0;
    for (let id = 1; id <= 80; id++) if (serveRun('fast', 'good', { patience: 30, id }).some((u) => u.sit === 'thanks-fast-service')) thanks += 1;
    expect(thanks).toBeGreaterThan(5);
    expect(thanks).toBeLessThan(40);
    for (let id = 1; id <= 60; id++) {
      expect(serveRun('fast', 'ok', { patience: 30, id }).some((u) => u.sit === 'thanks-fast-service')).toBe(false);
      expect(serveRun('fast', 'good', { patience: 6, id }).some((u) => u.sit === 'thanks-fast-service')).toBe(false);
    }
    const d = createDialogueDirector({ lang: 'hi', seed: 'cd' });
    const cs = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => customer({ id, patience: 30, arrivedAt: 0 }));
    d.update(mkState(10, cs), []);
    const out = [];
    for (let t = 11; t < 19; t++) {
      const c = cs[t - 11];
      out.push(...d.update(mkState(t, [{ ...c, got: ['dosa'], qs: ['good'], st: 'eating', eatLeft: 4 }]), [{ type: 'serve', customer: c.id, dish: 'dosa', by: 'p1' }]));
    }
    const fast = out.filter((u) => u.sit === 'thanks-fast-service');
    for (let i = 1; i < fast.length; i++) expect(fast[i].at - fast[i - 1].at).toBeGreaterThanOrEqual(10);
  });

  it('serve complaints keep working: ok dishes still draw the old complaints', () => {
    let quality = 0;
    for (let id = 1; id <= 60; id++) if (serveRun('old', 'ok', { id }).some((u) => u.sit === 'serve-complain')) quality += 1;
    expect(quality).toBeGreaterThan(25);
  });
});

describe('operations: determinism, rate limits, robustness', () => {
  it('the same events give the same speech; another seed gives different speech', () => {
    const go = (seed) => {
      const d = createDialogueDirector({ lang: 'auto', seed });
      const cs = calm(5);
      warm(d, cs);
      const on = (t) => (t >= 15 && t < 60 ? { events: [{ id: 'rain', until: 60 }, { id: 'cricket', until: 60 }] } : {});
      return run(d, cs, 70, { 15: [{ type: 'event-start', id: 'rain', until: 60 }, { type: 'event-start', id: 'cricket', until: 60 }, { type: 'stock-out', item: 'sambar' }] }, on, 15);
    };
    expect(JSON.stringify(go('x1'))).toBe(JSON.stringify(go('x1')));
    expect(JSON.stringify(go('x1'))).not.toBe(JSON.stringify(go('x2')));
  });

  it('a pile of events at once never breaks the rules: gaps, two on screen, no repeats, filled templates', () => {
    const d = createDialogueDirector({ lang: 'mixed', seed: 'pile' });
    const cs = calm(5);
    warm(d, cs);
    const on = () => ({ events: [{ id: 'rain', until: 99 }, { id: 'power', until: 99 }, { id: 'cricket', until: 99 }, { id: 'festival', until: 99 }], gas: { u: 0, sw: 0 } });
    const burst = [
      { type: 'event-start', id: 'rain', until: 99 }, { type: 'event-start', id: 'power', until: 99 }, { type: 'event-start', id: 'cricket', until: 99 },
      { type: 'event-start', id: 'festival', until: 99 }, { type: 'event-start', id: 'inspector', until: 29 }, { type: 'gas-out' }, { type: 'stock-out', item: 'oil' },
      { type: 'inspector', pass: false }, { type: 'event-end', id: 'power' }, { type: 'event-end', id: 'rain' },
    ];
    const out = run(d, cs, 120, { 15: burst }, on, 15);
    expect(out.length).toBeGreaterThan(10);
    checkRules(out, 'pile');
  });

  it('odd events never throw', () => {
    const d = createDialogueDirector({ lang: 'auto', seed: 'odd' });
    const junk = [
      { type: 'event-start' }, { type: 'event-start', id: 5 }, { type: 'event-end', id: null }, { type: 'inspector' }, { type: 'sold-out' }, { type: 'sold-out', customer: 'x', dish: 4 },
      { type: 'sold-out', customer: 1, dish: 'dosa', swap: 'dosa', left: false }, { type: 'sold-out', customer: 1, dish: 'nothing', swap: 'idly' }, { type: 'stock-out' }, { type: 'gas-swap' },
      { type: 'parcel-order' }, { type: 'parcel-order', customer: 999 }, { type: 'extra', customer: 'z' },
    ];
    const cs = calm(2, { extra: 7, spice: {}, big: 'yes', delivery: 0, regular: 'maybe', rid: 'a', loyal: 'x', parcel: [] });
    for (let t = 0; t < 6; t++) expect(Array.isArray(d.update(mkState(t, cs, { events: [null, 3, { id: 'rain' }], gas: 'no', fresh: [] }), junk))).toBe(true);
    expect(Array.isArray(d.update(mkState(7, cs, { events: 'rain', regs: 5, gas: { u: 'x', sw: NaN }, fresh: { batter_dosa: 'x' } }), junk))).toBe(true);
  });
});

describe('replay of the operations layer through the real engine', () => {
  /** Like `replay`, but also remembers what each customer was (kind, rid, delivery ...), and can make the cook sloppy (tawa never wiped: torn dosas). */
  function replay2({ level, seed, every = 2, players = 1, lang = 'auto', sloppy = false }) {
    const ps = Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
    let s = createGame({ players: ps, settings: { level, pace: 'normal' }, seed });
    const d = createDialogueDirector({ lang, seed });
    const spoken = [];
    const who = new Map();
    const feed = (state, events) => {
      for (const c of state.customers) if (!who.has(c.id)) who.set(c.id, { kind: c.kind, rid: c.rid, regular: c.regular, delivery: c.delivery, big: c.big, parcel: c.parcel, extra: c.extra, spice: c.spice });
      for (const u of d.update(state, events)) spoken.push(u);
      return state;
    };
    let guard = 0;
    while (!isOver(s) && guard++ < 4000) {
      if (s.tick % every === 0) {
        for (const p of ps) {
          const a = chooseAutoAction(s, p.id);
          if (!a || (sloppy && a.type === 'tend')) continue;
          const r = applyAction(s, a);
          if (r.error) continue;
          s = r.state;
          if (sloppy && a.type === 'cook' && s.stations[a.station].kind === 'tawa') s = { ...s, stations: { ...s.stations, [a.station]: { ...s.stations[a.station], gunk: 75, heat: 52 } } };
          feed(s, r.events);
        }
      }
      const r = applyAction(s, { type: 'tick' });
      s = feed(r.state, r.events);
    }
    return { spoken, who, state: s, director: d };
  }

  const bySeeds = (level, n, extra = {}, prefix = 'rt') => Array.from({ length: n }, (_, i) => replay2({ level, seed: `${prefix}${level}-${i + 1}`, ...extra }));
  const fired = (runs) => {
    const c = {};
    for (const r of runs) for (const u of r.spoken) c[u.sit] = (c[u.sit] || 0) + 1;
    return c;
  };

  const L3 = bySeeds(3, 6);
  const L6 = bySeeds(6, 6, { players: 2 });
  const L12 = [...bySeeds(12, 5, { every: 1 }), ...bySeeds(12, 3, { every: 1, players: 2 })];
  const SLOPPY = [...bySeeds(6, 4, { sloppy: true }, 'bk'), ...bySeeds(3, 4, { sloppy: true }, 'bk')];

  it('level 3 (rain, requests, stock): rain talk, parcels, extras, spice and thanks all happen in a bot game', () => {
    const c = fired(L3);
    for (const s of ['rain-start', 'rain-ongoing', 'rain-end', 'parcel-request', 'extra-request-sambar', 'extra-request-chutney', 'spice-request-less', 'spice-request-more', 'thanks-fast-service']) {
      expect(c[s] || 0, `level 3 never said ${s}`).toBeGreaterThan(0);
    }
  });

  it('level 6 (inspector, regulars, office parcels, gas, sold-out): they all get voiced', () => {
    const c = fired(L6);
    for (const s of ['inspector-arrival', 'inspector-pass', 'regular-named', 'regular-loyal', 'big-office-order', 'sold-out-polite', 'stock-out-apology', 'gas-out-chatter', 'parcel-request', 'sour-batter-complaint']) {
      expect(c[s] || 0, `level 6 never said ${s}`).toBeGreaterThan(0);
    }
  });

  it('level 12 (every event): cricket, festival, power, the delivery boy and the rest are voiced', () => {
    const c = fired(L12);
    for (const s of ['rain-start', 'power-cut', 'power-back', 'cricket-night', 'festival-greeting', 'inspector-arrival', 'inspector-pass', 'delivery-boy-hurry', 'big-office-order', 'regular-named', 'sold-out-polite']) {
      expect(c[s] || 0, `level 12 never said ${s}`).toBeGreaterThan(0);
    }
  });

  it('a sloppy cook (the tawa never wiped) draws torn-dish complaints and a failed inspection is reacted to', () => {
    const c = fired(SLOPPY);
    expect(c['broken-dish-complaint'] || 0).toBeGreaterThan(0);
    expect(c['inspector-fail'] || 0).toBeGreaterThan(0);
  });

  it('every operations situation is spoken somewhere across the replays (nothing is dead)', () => {
    const c = fired([...L3, ...L6, ...L12, ...SLOPPY]);
    for (const s of OPS_SITS) expect(c[s] || 0, `${s} never fired`).toBeGreaterThan(0);
  });

  it('all the rules hold in every operations replay (gaps, two at once, no repeats, filled templates)', () => {
    for (const [i, r] of [...L3, ...L6, ...L12, ...SLOPPY].entries()) checkRules(r.spoken, `ops replay ${i}`);
  });

  it('ambient talk is rate limited in real games (no flooding, cooldowns between lines)', () => {
    const cd = { 'rain-ongoing': 7, 'cricket-night': 6, 'festival-greeting': 8, 'gas-out-chatter': 8, 'stock-out-apology': 20, 'thanks-fast-service': 10 };
    for (const r of [...L3, ...L6, ...L12]) {
      for (const [sit, gap] of Object.entries(cd)) {
        const list = r.spoken.filter((u) => u.sit === sit);
        if (sit === 'stock-out-apology' || sit === 'thanks-fast-service') for (let i = 1; i < list.length; i++) expect(list[i].at - list[i - 1].at, sit).toBeGreaterThanOrEqual(gap);
        expect(list.length, `${sit} floods`).toBeLessThanOrEqual(Math.ceil(r.state.tick / gap) + 3);
      }
    }
  });

  it('regulars keep their language in a real game, and the delivery boy speaks Hindi or Dakhni', () => {
    let checkedReg = 0;
    let delivery = 0;
    let deliveryTe = 0;
    for (const r of [...L6, ...L12]) {
      const langOfRid = new Map();
      for (const u of r.spoken) {
        const w = r.who.get(u.customer);
        if (!w) continue;
        if (w.regular && w.rid !== undefined) {
          if (langOfRid.has(w.rid)) { expect(u.lang, `regular ${w.rid} changed language`).toBe(langOfRid.get(w.rid)); checkedReg += 1; } else langOfRid.set(w.rid, u.lang);
        }
        if (w.delivery) { delivery += 1; if (u.lang === 'te') deliveryTe += 1; }
      }
    }
    expect(checkedReg).toBeGreaterThan(5);
    expect(delivery).toBeGreaterThan(3);
    expect(deliveryTe).toBeLessThanOrEqual(Math.ceil(delivery / 3));
  });

  it('request lines come from customers who really have that request', () => {
    const need = {
      'parcel-request': (w) => w.parcel, 'extra-request-chutney': (w) => /chutney/.test(w.extra || ''), 'extra-request-sambar': (w) => /sambar/.test(w.extra || ''),
      'spice-request-less': (w) => w.spice === 'less', 'spice-request-more': (w) => w.spice === 'more', 'big-office-order': (w) => w.big, 'delivery-boy-hurry': (w) => w.delivery,
      'regular-named': (w) => w.regular,
    };
    let checked = 0;
    for (const r of [...L3, ...L6, ...L12]) {
      for (const u of r.spoken) {
        if (!need[u.sit]) continue;
        const w = r.who.get(u.customer);
        expect(w, `${u.sit} by unknown customer ${u.customer}`).toBeTruthy();
        expect(need[u.sit](w), `${u.sit} by a customer without it`).toBeTruthy();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('the operations speech is deterministic in a real game', () => {
    const a = replay2({ level: 12, seed: 'det-ops', every: 1 });
    const b = replay2({ level: 12, seed: 'det-ops', every: 1 });
    expect(JSON.stringify(b.spoken)).toBe(JSON.stringify(a.spoken));
    expect(a.spoken.length).toBeGreaterThan(40);
  });

  it('fixed languages are respected by the new situations too', () => {
    for (const lang of ['te', 'hi', 'dk']) {
      const r = replay2({ level: 6, seed: `fixops-${lang}`, every: 1, lang });
      expect(new Set(r.spoken.map((u) => u.lang))).toEqual(new Set([lang]));
      expect(r.spoken.some((u) => OPS_SITS.includes(u.sit))).toBe(true);
    }
  });

  it('the training shift (level 0) has no operations talk at all', () => {
    const r = replay2({ level: 0, seed: 'tut', every: 2 });
    expect(r.spoken.filter((u) => OPS_SITS.includes(u.sit)).length).toBe(0);
  });
});
