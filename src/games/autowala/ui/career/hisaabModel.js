// What the Hisaab and the job widget show, as plain data (hisaabModel.test.js). No React in here.

const N = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** Income lines: always fares, then tips and bonuses when there were any. */
export function incomeRows(h) {
  const rows = [{ id: 'fares', en: 'Fares', te: 'కిరాయి', amount: N(h?.fares) }];
  if (N(h?.tips) > 0) rows.push({ id: 'tips', en: 'Tips', te: 'బక్షీస్', amount: N(h.tips) });
  if (N(h?.bonus) > 0) rows.push({ id: 'bonus', en: 'Bonuses', te: 'బోనస్', amount: N(h.bonus) });
  return rows;
}

/** Expense lines: rent (or EMI) and CNG always, the rest only when they cost something. */
export function expenseRows(h) {
  const e = h?.expenses || {};
  const emi = !!h?.emi || !!h?.rent?.owned;
  const rows = [
    { id: 'cng', en: 'CNG', te: 'గ్యాస్', amount: N(e.cng), always: true },
    { id: 'rent', en: emi ? 'Auto EMI' : 'Auto rent', te: emi ? 'కిస్తీ' : 'ఆటో అద్దె', amount: N(e.rent), always: !emi },
    { id: 'repair', en: 'Repairs', te: 'రిపేరు', amount: N(e.repair) },
    { id: 'fines', en: 'Fines', te: 'చలాన్', amount: N(e.fine) + N(e.challan) },
    { id: 'chai', en: 'Chai', te: 'ఛాయ్', amount: N(e.chai) },
    { id: 'other', en: 'Other', te: 'ఇతరాలు', amount: N(e.other) },
  ];
  return rows.filter((r) => r.always || r.amount > 0);
}

/** One line for the bottom of the day. */
export function verdict(h) {
  const net = N(h?.net);
  const rides = N(h?.rides);
  if (rides === 0) return { id: 'idle', en: 'No rides today. The meter stayed cold.', te: 'ఈరోజు రైడ్లు లేవు' };
  if (net < 0) return { id: 'loss', en: 'Rent ate the day. Tomorrow will be better.', te: 'ఈరోజు నష్టం, రేపు చూద్దాం' };
  if (net < 250) return { id: 'thin', en: 'Thin day: the rent was covered, barely.', te: 'తక్కువ లాభం' };
  if (net < 700) return { id: 'fair', en: 'Decent day. Chai and a smile.', te: 'మంచి రోజు' };
  return { id: 'great', en: 'Mast kamai! A day to remember.', te: 'బాగా సంపాదించారు!' };
}

/** Bars for the last days: heights 0..1 against the best net in view; `loss` bars hang below. */
export function sparkBars(days) {
  const list = Array.isArray(days) ? days.slice(-7) : [];
  const top = Math.max(1, ...list.map((d) => Math.abs(N(d?.net))));
  return list.map((d) => ({ day: N(d?.day), net: N(d?.net), h: Math.min(1, Math.abs(N(d?.net)) / top), loss: N(d?.net) < 0 }));
}

const tone = (f) => (f >= 0.85 ? 'bad' : f >= 0.55 ? 'warn' : 'ok');

/** The job widget: demand, tiredness, dents, rent. `c` is snap.career. Returns null when there is none. */
export function widgetModel(c) {
  if (!c || typeof c !== 'object') return null;
  const fatigue = Math.max(0, Math.min(1, Number(c.fatigue) || 0));
  const damage = Math.max(0, Math.min(1, Number(c.damage) || 0));
  const d = c.demand || {};
  return {
    demand: { label: d.label || '', te: d.te || '', mult: Number(d.mult) || 1, level: N(d.level), peak: !!d.peak },
    fatigue: { pct: Math.round(fatigue * 100), tone: tone(fatigue), name: c.fatigueName?.en || '', te: c.fatigueName?.te || '', show: fatigue >= 0.3 },
    chai: { price: N(c.chai?.price), cooldown: Math.ceil(Number(c.chai?.cooldown) || 0), canBuy: !!c.chai?.canBuy, urgent: fatigue >= 0.7 },
    damage: { pct: Math.round(damage * 100), tone: tone(damage * 1.2), repair: N(c.repairCost), show: damage >= 0.02 },
    rent: { owned: !!c.rent?.owned, due: N(c.rent?.due), debt: N(c.rent?.debt) },
    today: { earned: N(c.today?.earned), net: N(c.today?.net), rides: N(c.today?.rides) },
    ladder: c.ladder ? { owned: !!c.ladder.owned, pct: Math.round((Number(c.ladder.progress) || 0) * 100), canBuy: !!c.ladder.canBuy } : null,
  };
}
