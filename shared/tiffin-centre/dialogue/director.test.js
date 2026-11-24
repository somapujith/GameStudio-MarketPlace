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
