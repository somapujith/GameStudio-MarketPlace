// What each HUD piece shows, as a VIEW of the snapshot: pure selectors (snapshot -> a small plain object) for `useSnapView` (hud/snapStore.js).
//
// A view is compared with the previous one and the piece re-renders only when it differs, so a view must change exactly when the PIXELS would: a value is
// rounded to the resolution it is printed with (a distance to the 10 m formatDistance prints, an ETA to its minute, a countdown to its second, a bar to a
// pixel or two) and the raw float that ticks every 100 ms never reaches the component. That is what makes the HUD cost proportional to what visibly changes.
// Everything is pure and unit-tested (views.test.js): each rounding is proven to leave the printed text unchanged.
import { careerView, formatClock, formatDistance, fuelTone, normalizeTrip, rageView, rulesView, speedFx, weatherView } from './hudLogic.js';
import { alertList, moreBadge } from './layoutLogic.js';

const finite = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Round to a step: `step(0.337, 0.01)` -> 0.34 (a bar, an opacity: one or two pixels of resolution is invisible). */
export const step = (v, s) => Math.round(finite(v) / s) * s;

/**
 * A representative of the metres `formatDistance` prints the same way: formatDistance(distanceBucket(m)) === formatDistance(m) for every m (quirks included:
 * 995..999 m print "1000 m", 9950..9999 m print "10.0 km"), and the bucket of a bucket is itself. views.test.js sweeps 0..60 km to prove it.
 */
export function distanceBucket(m) {
  if (m == null) return m;
  const label = formatDistance(m);
  const metres = /^(\d+) m$/.exec(label);
  if (metres) return Number(metres[1]) >= 1000 ? 995 : Number(metres[1]);
  if (label === '10.0 km') return 9950;
  return Number(/^(\d+(?:\.\d)?) km$/.exec(label)[1]) * 1000;
}
/** The seconds `formatEta` distinguishes: under 45 s is "< 1 min", else the rounded minute. */
export function etaBucket(s) {
  if (s == null) return s;
  const v = Math.max(0, finite(s));
  return v < 45 ? 0 : Math.round(v / 60) * 60;
}

/** The seconds a countdown prints (and tones by): ceil, because formatCountdown ceils and the tone thresholds are whole seconds. */
export const countdownBucket = (s) => (s == null ? s : Math.max(0, Math.ceil(finite(s))));

/** normalizeTrip with every ticking number rounded to what is printed. null without a trip. */
export function tripViewOf(trip, route) {
  const t = normalizeTrip(trip, route);
  if (!t) return null;
  return {
    ...t,
    distance: distanceBucket(t.distance),
    eta: etaBucket(t.eta),
    timeLeft: countdownBucket(t.timeLeft),
    timeFrac: null, // the bars print `mood`, not the time fraction
    mood: t.mood == null ? null : step(t.mood, 0.005),
    turn: t.turn ? { ...t.turn, distance: t.turn.distance == null ? null : distanceBucket(t.turn.distance) } : null,
  };
}

/** rulesView with the distances rounded to what the chips print (the camera's `over` flag and the signal's `secs` are exact already). null without `rules`. */
export function rulesViewOf(rules, kmh) {
  const v = rulesView(rules, kmh);
  if (!v) return null;
  return {
    ...v,
    signal: v.signal ? { ...v.signal, dist: distanceBucket(v.signal.dist) } : null,
    camera: v.camera ? { ...v.camera, dist: distanceBucket(v.camera.dist) } : null,
    checkpoint: v.checkpoint ? { ...v.checkpoint, dist: distanceBucket(v.checkpoint.dist) } : null,
    heat: step(v.heat, 0.05),
  };
}

/** The raw `rage` the meter prints (it shapes it itself): heat / escape / caught rounded to a pixel of the bars. null while the chase is off. */
export function rageViewOf(rage) {
  const v = rageView(rage);
  if (!v) return null;
  return { active: true, heat: step(v.heat, 0.01), escape: step(v.escape, 0.01), caughtIn: step(v.caught, 0.01), chasers: v.chasers };
}

// ---- selectors: snapshot -> view (module-level, so a piece's subscription is stable) ---------------------------------------------------------------
export const selShell = (s) => ({ menu: s.menu || null, tripOn: !!s.trip, fareOn: !!s.fareChoice });
export const selWallet = (s) => ({ wallet: s.wallet, rating: s.rating, rides: s.rides });
export const selClock = (s) => ({ hour: s.hour, day: s.day }); // the publisher already floors the hour to the minute
export const selWeather = (s) => weatherView(s.weather);
export const selWaiting = (s) => s.waitingCount ?? null;
export const selTrip = (s) => tripViewOf(s.trip, s.route);
export const selRules = (s) => rulesViewOf(s.rules, s.kmh);
export const selCareer = (s) => careerView(s.career);
export const selPrompt = (s) => s.prompt ?? null;
export const selDrift = (s) => ({ drifting: !!s.drifting, charge: step(s.driftCharge, 0.02) });

/** The running mission's label and countdown for the alert lane ('' when none). */
export const missionOf = (s) => {
  const a = s.quest && s.quest.active;
  return a ? { title: a.title || 'Mission', left: a.timeLeft == null ? null : countdownBucket(a.timeLeft) } : null;
};
export const selMission = (s) => missionOf(s);

/** The alert lane: which chips (at most `cap`), their data and the mission. One selector per cap, built once. */
export function alertsSelector(cap) {
  return (s) => {
    const m = missionOf(s);
    const list = alertList(rulesView(s.rules, s.kmh), rageView(s.rage), m ? m.title : '', cap); // the exact numbers decide WHICH chips; the chips print rounded ones
    return { kinds: list.map((a) => a.kind), urgent: list.map((a) => a.urgent), rules: rulesViewOf(s.rules, s.kmh), rage: rageViewOf(s.rage), mission: m };
  };
}

/** How many alert chips the lane shows (the shell only needs the count, for the `data-aw-alerts` attribute): a number, so the shell re-renders when it changes. */
export const alertCountSelector = (cap) => (s) => {
  if (cap <= 0) return 0;
  const m = missionOf(s);
  return alertList(rulesView(s.rules, s.kmh), rageView(s.rage), m ? m.title : '', cap).length;
};
export const selRage = (s) => rageViewOf(s.rage);
/** The dot on the More button. */
export const selBadge = (s) => moreBadge({ career: careerView(s.career), quest: s.quest, rules: rulesView(s.rules, s.kmh) });

/** The gauge cluster: everything but the speed itself (the speed is written straight into the DOM, see Speedometer.jsx). */
export const selGauge = (s) => ({ fuel: s.fuel, fuelLitres: s.fuelLitres, charge: step(s.driftCharge, 0.02), boosting: !!s.boosting, drifting: !!s.drifting, sign: (rulesView(s.rules, s.kmh) || {}).sign ?? null });

/** The full-screen speed effects, rounded to a percent of opacity. */
export function selFx(s) {
  const fx = speedFx(s.kmh, s.boosting);
  const rage = rageView(s.rage);
  return { vignette: step(fx.vignette, 0.01), lines: step(fx.lines, 0.01), boosting: !!s.boosting, fuelPulse: fuelTone(s.fuel).pulse, rage: !!rage, rageHeat: rage ? step(rage.heat, 0.02) : 0 };
}

/** The More sheet's content (only while it is open, see Compact.jsx): the parts of the snapshot its sections print. */
export const selMore = (s) => ({
  rating: s.rating, rides: s.rides, quest: s.quest?.active ? { ...s.quest.active, timeLeft: countdownBucket(s.quest.active.timeLeft) } : null,
  career: careerView(s.career), weather: weatherView(s.weather), rules: rulesViewOf(s.rules, s.kmh), radio: s.radio ?? null,
});
export const EMPTY_MORE = Object.freeze({ rating: 0, rides: 0, quest: null, career: null, weather: null, rules: null, radio: null });

/** A clock label for tests and the pause screen. */
export const clockLabel = (s) => formatClock(s.hour).label;
