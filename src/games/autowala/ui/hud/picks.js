// Which part of the HUD snapshot each overlay piece reads (AutowalaGame.jsx feeds every piece through `<Slice pick=...>`, see hud/snapStore.js).
// A pick returns a small object of primitives and identity-stable parts of the snapshot (unchanged parts keep their identity, game/snapshot.js), so the
// default `shallowEqual` says "nothing this piece shows changed" and React does not render it. Pure and unit-tested (picks.test.js).
import { countdownBucket, step } from './views.js';

const NO_MENU = Object.freeze({ menu: null });

/** The quest part with its ticking numbers rounded to what the cards print (the clock to its second, a meter to a percent): it changes about once a second, not 10 times. */
export function bucketQuest(q) {
  if (!q || !q.active) return q ?? null;
  const a = q.active;
  return { ...q, active: { ...a, timeLeft: countdownBucket(a.timeLeft), ...(a.meter ? { meter: { ...a.meter, value: step(a.meter.value, 0.01) } } : {}) } };
}

/** The big map and anything that only needs to know whether a menu is open. */
export const pickMenu = (s) => (s.menu ? { menu: s.menu } : NO_MENU);

/** The mission card, tutorial card and result card (and the job board / quest log menus, which read the same part). */
export const pickQuest = (s) => ({ menu: s.menu || null, quest: bucketQuest(s.quest) }); // compare it deeply (Slice equal=same): the rounded part is a new object each time

/** The floating radio widget (desktop) and its station. */
export const pickRadio = (s) => ({ menu: s.menu || null, radio: s.radio ?? null });

/** The end-of-day book: only while it is open does it read the career part and the wallet. */
export const pickHisaab = (s) => (s.menu === 'hisaab' ? { menu: s.menu, career: s.career ?? null, wallet: s.wallet } : NO_MENU);

/** The garage: its phase and the wallet always, the dent level only while it is open. */
export const pickWorkshop = (s) => ({ menu: s.menu || null, workshopPhase: s.workshopPhase || 'closed', wallet: s.wallet, career: s.menu === 'workshop' ? s.career ?? null : null });

/** The start / pause / summary screens show live numbers (clock, wallet, trip, quest) while they are open and nothing else. */
export const pickMenus = (s) => (s.menu ? s : NO_MENU);

/** The fare question and the ride chips under the trip panel: the question, and only the FACTS of the trip the chips print (not its ticking distance). */
export const pickFare = (s) => ({
  menu: s.menu || null,
  fareChoice: s.fareChoice ?? null,
  trip: s.trip ? { terms: s.trip.terms ?? null, modifiers: s.trip.modifiers ?? null, urgent: s.trip.urgent ?? null, shared: s.trip.shared ?? null } : null,
});

export const SLICES = { menu: pickMenu, quest: pickQuest, radio: pickRadio, hisaab: pickHisaab, workshop: pickWorkshop, menus: pickMenus, fare: pickFare };
