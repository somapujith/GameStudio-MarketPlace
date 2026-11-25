// Small talk during a ride: one or two optional questions ("Radio on?", "Take the shortcut?") that nudge the passenger's mood.
// They never block driving: a question times out by itself. Pure data + pure effect functions (unit-tested).
const R = (en, te) => ({ en, te });

export const TALK = {
  firstAfter: [14, 26], // seconds into the ride before the first question (lo, hi), picked with a roll
  gap: [38, 70],
  max: 2, // per ride
  seconds: 7, // a question stays open this long
  minLeft: 30, // never ask a passenger who has less than this many seconds left on an urgent ride
};

/**
 * id, the question (en/te), who asks (kinds, empty = anyone), `when` (flags needed), the options. Each option has a `fx(kind)`:
 * { mood, grace (metres of route allowance), tipMul (multiplies this ride's tip) } and a reply line.
 */
export const TALKS = [
  {
    id: 'radio',
    ask: R('Radio on?', 'రేడియో పెట్టనా?'),
    options: [
      { id: 'on', label: R('Radio on', 'పెట్టు'), fx: { student: 0.07, tourist: 0.04, regular: 0.03, women: 0.01, elder: -0.04, rusher: -0.03 }, reply: R('Nice song!', 'మంచి పాట!') },
      { id: 'off', label: R('Keep it quiet', 'వద్దులే'), fx: { elder: 0.04, rusher: 0.02, women: 0.02, student: -0.03, tourist: 0, regular: 0 }, reply: R('Good, peaceful.', 'బాగుంది, ప్రశాంతంగా.') },
    ],
  },
  {
    id: 'shortcut',
    ask: R('Take the shortcut?', 'షార్ట్‌కట్‌లో వెళ్దామా?'),
    options: [
      { id: 'yes', label: R('Yes, shortcut', 'సరే, షార్ట్‌కట్'), fx: { rusher: 0.06, student: 0.04, regular: 0.03, tourist: -0.02, elder: -0.03, women: -0.03 }, grace: 150, reply: R('Okay, your call.', 'సరే, నీ ఇష్టం.') },
      { id: 'no', label: R('Stay on the main road', 'మెయిన్ రోడ్డే'), fx: { elder: 0.04, women: 0.04, tourist: 0.03, regular: 0, student: -0.01, rusher: -0.05 }, reply: R('Yes, the main road is safe.', 'అవును, మెయిన్ రోడ్డే సేఫ్.') },
    ],
  },
  {
    id: 'cricket',
    ask: R('Did you see the match?', 'మ్యాచ్ చూశారా?'),
    options: [
      { id: 'talk', label: R('Talk cricket', 'క్రికెట్ మాట్లాడు'), fx: { regular: 0.05, student: 0.06, rusher: 0.01, tourist: 0.03, elder: 0.02, women: 0.01 }, tipMul: 1.15, reply: R('Ha! What a finish!', 'హా! ఎంత మంచి ఫినిష్!') },
      { id: 'skip', label: R('Just drive', 'డ్రైవింగ్ మాత్రమే'), fx: { regular: 0, student: -0.02, rusher: 0.03, tourist: 0, elder: 0.01, women: 0.01 }, reply: R('Hmm, okay.', 'హ్మ్, సరే.') },
    ],
  },
  {
    id: 'pace',
    ask: R('In a hurry, or take it easy?', 'తొందరా, లేక నెమ్మదిగానా?'),
    kinds: ['elder', 'women', 'tourist', 'regular'],
    options: [
      { id: 'slow', label: R('Easy does it', 'నెమ్మదిగా'), fx: { elder: 0.07, women: 0.05, tourist: 0.03, regular: 0.01, student: 0, rusher: -0.04 }, reply: R('Thank you, baba.', 'థాంక్స్ బాబూ.') },
      { id: 'fast', label: R('Make it quick', 'వేగంగా'), fx: { elder: -0.05, women: -0.03, tourist: 0.03, regular: 0.02, student: 0.05, rusher: 0.05 }, reply: R('Ha, that is the spirit!', 'హా, అదే కావాలి!') },
    ],
  },
];

/** The effect of picking option `optId` of talk `talkId` for a customer `kind`: { mood, grace, tipMul, reply, label } or null. */
export function talkEffect(talkId, optId, kind) {
  const t = TALKS.find((x) => x.id === talkId);
  const o = t?.options.find((x) => x.id === optId);
  if (!o) return null;
  return { mood: o.fx[kind] ?? 0, grace: o.grace || 0, tipMul: o.tipMul || 1, reply: o.reply, label: o.label, ask: t.ask };
}

/** Which question to ask now, or null. `used`: ids already asked on this ride; `urgentSoon`: no chatting while the clock is tight. */
export function pickTalk(kind, used, n = 0, { urgentSoon = false } = {}) {
  if (urgentSoon) return null;
  const pool = TALKS.filter((t) => !used.includes(t.id) && (!t.kinds || t.kinds.includes(kind)));
  if (!pool.length) return null;
  return pool[Math.abs(Math.floor(n)) % pool.length];
}

/** Seconds until the next question: `roll` 0..1, `first` true for the first one of a ride. */
export function nextTalkIn(first, roll) {
  const [lo, hi] = first ? TALK.firstAfter : TALK.gap;
  return lo + (hi - lo) * clampRoll(roll);
}
const clampRoll = (r) => Math.max(0, Math.min(1, Number.isFinite(r) ? r : 0.5));
