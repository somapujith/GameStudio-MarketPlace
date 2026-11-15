// Pure helpers behind the landing-decision popup (DecisionCard.jsx). No React in here.
//   decisionOf(session, spec)     the optional decision I am being offered after landing, or null
//                                 kind 'ride'    on a transport stop (Auto Stand / Metro / MMTS): ride to the next stop, or stay
//                                 kind 'traffic' stuck in the Traffic Jam: pay the fine, use chai, or wait it out
//   isCardShown(decision, hidden) a decision shows until Esc / the scrim hides it (the decision itself stays pending)
//   decisionKeyAction(e, ctx)     what a key press does inside the card: 'dismiss' (Esc) | 'primary' (Enter) | null
//   routeLabel / cashAfter / fareReason   the small strings the card prints
// Engine rules (docs/GAME_RULES.md): a ride offer (`state.ride`) lasts the turn; RIDE pays the fare, moves to the next stop and has no
// further effect there (passing START pays the salary); "Stay here" is END_TURN (or, after a six, simply rolling again).
// Stuck: phase 'roll' + `stuck`: PAY_TRAFFIC (fine), USE_CHAI, or ROLL = wait it out (no move, the turn ends). A free jam (fine 0) lets
// the player out by itself, so nothing is ever offered then.
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { wordsOf } from '@/lib/mapWords.js';

const DEFAULT_FINE = 25000;
const DEFAULT_SALARY = 200000;

/** Colours of the card's header band per theme, with an ink that reads on both ends at AA (checked in the tests). */
export const THEMES = {
  auto: { from: '#ffc83d', to: '#ff9f1c', ink: '#2b1a00', pill: '#ffe39a' },
  metro: { from: '#5a4fcf', to: '#3b2fa0', ink: '#ffffff', pill: '#cfc9ff' },
  mmts: { from: '#12806a', to: '#0b5c48', ink: '#ffffff', pill: '#b5f0dc' },
  traffic: { from: '#cc3a3a', to: '#a82323', ink: '#ffffff', pill: '#ffd0d0' },
};

/** 'auto' | 'metro' | 'mmts' for a transport stop. */
export function vehicleOf(tile) {
  const k = tile?.art;
  if (k === 'auto' || k === 'metro' || k === 'mmts') return k;
  const n = `${tile?.name || ''} ${tile?.short || ''}`.toLowerCase();
  if (n.includes('auto')) return 'auto';
  if (n.includes('metro')) return 'metro';
  return 'mmts';
}

/** What the vehicle is called in a sentence: "Metro", "MMTS", "auto". */
const NOUN = { auto: 'auto', metro: 'Metro', mmts: 'MMTS' };
const VERB = { auto: 'Take the', metro: 'Ride the', mmts: 'Ride the' };

/** "Take the auto to X" / "Ride the Metro to X" on the default map; "Ride to X" where the stops are not autos and trains. */
export const rideSentence = (vehicle, toName) => (wordsOf().isDefault ? `${VERB[vehicle]} ${NOUN[vehicle]} to ${toName}` : `Ride to ${toName}`);

/** "Metro Interchange → MMTS Express". */
export function routeLabel(from, to) {
  return `${from?.name || 'here'} → ${to?.name || 'the next stop'}`;
}

/** Cash I would have left after paying `amount` (never below 0). */
export const cashAfter = (cash, amount) => Math.max(0, (Number(cash) || 0) - (Number(amount) || 0));

/** Why a fare / fine cannot be paid, in the engine's own words plus how much is missing; '' when I can pay. */
export function fareReason(cash, amount, kind = 'fare') {
  const c = Number(cash) || 0;
  const a = Number(amount) || 0;
  if (c >= a) return '';
  const lead = kind === 'fare' ? `The fare is ${formatINR(a)}` : `Getting out costs ${formatINR(a)}`;
  return `${lead}. You need ${formatINR(a - c)} more.`;
}

const playersOf = (session) => session?.view?.players ?? [];
const meOf = (session) => playersOf(session).find((p) => p.id === session?.me) || null;

/** A stable key of one decision: Esc hides THIS decision, the next one (another stop, another turn) shows again. */
function keyOf(kind, view, at) {
  return `${kind}:${at}:${view?.turnCount ?? ''}:${view?.round ?? ''}`;
}

function rideDecision(session, spec) {
  const view = session.view;
  const o = session.options || {};
  const me = meOf(session);
  if (!me) return null;
  // `options.ride` only exists while I can afford the fare; the offer itself stays in the state, so I can still say why not
  const offer = o.ride && Number.isInteger(o.ride.to)
    ? { to: o.ride.to, fare: o.ride.fare, from: view.ride?.from ?? me.pos }
    : (view.ride && view.ride.player === session.me && view.phase === 'manage' && Number.isInteger(view.ride.to) ? view.ride : null);
  if (!offer) return null;
  const from = TILES[offer.from ?? me.pos];
  const to = TILES[offer.to];
  if (!from || !to || from.type !== 'transport') return null;
  const vehicle = vehicleOf(from);
  const fare = Number(offer.fare ?? from.fare) || 0;
  const cash = Number(me.cash) || 0;
  const canAfford = !!o.ride && cash >= fare;
  const sixer = !!view.extraRoll; // a six: I roll again after this, so "stay" cannot end the turn
  const upgrades = Number(spec?.upgrades) || 0;
  // staying ends the turn, unless I rolled a six or could still upgrade a district first (then it only closes the card)
  const stayEnds = !sixer && !upgrades && !!o.endTurn;
  const salary = to.id < from.id && (view.cfg?.passStart ?? DEFAULT_SALARY) > 0 ? (view.cfg?.passStart ?? DEFAULT_SALARY) : 0;
  const arrive = `You arrive at ${to.name}, where nothing else happens`;
  const after = sixer ? ', then roll again.' : ', then finish your turn.';
  const hint = salary ? `${arrive}, but you pass START and collect ${formatINR(salary)}${after}` : `${arrive}${after}`;
  const note = stayEnds ? 'You keep your cash and end your turn.'
    : sixer ? 'You keep your cash and roll again.'
      : 'You keep your cash. Manage your districts, then end your turn.';
  return {
    kind: 'ride',
    key: keyOf('ride', view, from.id),
    vehicle,
    theme: THEMES[vehicle],
    from: { id: from.id, name: from.name, short: from.short || from.name },
    to: { id: to.id, name: to.name, short: to.short || to.name },
    fare,
    cash,
    left: cashAfter(cash, fare),
    canAfford,
    reason: canAfford ? '' : fareReason(cash, fare, 'fare'),
    kicker: 'Transport stop',
    title: `You landed on ${from.name}`,
    body: `${rideSentence(vehicle, to.name)} for ${formatINR(fare)}?`,
    route: routeLabel(from, to),
    hint,
    salary,
    primary: { key: 'ride', label: `Ride · ${formatINR(fare)}`, action: { type: 'RIDE' }, disabled: !canAfford, reason: canAfford ? '' : fareReason(cash, fare, 'fare') },
    stay: { key: 'stay', label: 'Stay here', action: stayEnds ? { type: 'END_TURN' } : null, note },
    reopen: { label: 'Ride or stay?', icon: 'swap' },
    sr: `You landed on ${from.name}. ${rideSentence(vehicle, to.name)} for ${formatINR(fare)}, or stay here.`,
  };
}

function trafficDecision(session) {
  const view = session.view;
  const o = session.options || {};
  const me = meOf(session);
  if (!me) return null;
  const fine = Number(o.payTraffic) > 0 ? Number(o.payTraffic) : Number(view.cfg?.trafficFine ?? DEFAULT_FINE);
  if (!(fine > 0) && !o.useChai) return null; // a free jam lets me out by itself: nothing to decide
  const cash = Number(me.cash) || 0;
  const canPay = !!o.payTraffic;
  const hasChai = !!o.useChai && (me.chai || 0) > 0;
  const choices = [];
  if (hasChai) {
    choices.push({ key: 'chai', label: wordsOf().isDefault ? 'Use chai' : 'Use token', sub: 'Free, then you roll', icon: 'chai', tone: 'green', action: { type: 'USE_CHAI' }, disabled: false, reason: '' });
  }
  if (fine > 0) {
    choices.push({
      key: 'pay', label: `Pay ${formatINR(fine)} fine`, sub: canPay ? `Then you roll · ${formatINR(cashAfter(cash, fine))} left` : 'Not enough cash',
      icon: 'coin', tone: 'gold', action: { type: 'PAY_TRAFFIC' }, disabled: !canPay, reason: canPay ? '' : fareReason(cash, fine, 'fine'),
    });
  }
  choices.push({ key: 'wait', label: 'Wait it out', sub: 'You’ll roll again next turn', icon: 'hourglass', tone: 'dark', action: { type: 'ROLL' }, disabled: false, reason: '' });
  const first = choices.find((c) => !c.disabled && c.key !== 'wait') || choices[choices.length - 1];
  return {
    kind: 'traffic',
    key: keyOf('traffic', view, me.pos),
    vehicle: 'traffic',
    theme: THEMES.traffic,
    fine,
    cash,
    chai: me.chai || 0,
    choices,
    primary: first,
    kicker: wordsOf().trafficCorner,
    title: `Stuck in ${wordsOf().trafficCorner}`,
    body: `Pay the fine to get moving, spend a ${wordsOf().isDefault ? 'chai' : wordsOf().chaiToken}, or sit this turn out.`,
    reopen: { label: 'Traffic choices', icon: 'warn' },
    sr: `You are stuck in traffic. ${choices.map((c) => c.label).join(', ')}.`,
  };
}

/**
 * The optional landing decision I am being offered right now, or null. `spec` is ActionBar's action spec: a decision only exists
 * when it is MY turn, nothing is animating (`spec.kind` is not 'busy') and no Snatch window, auction, debt or trade is up.
 */
export function decisionOf(session, spec) {
  if (!session?.view || !spec) return null;
  const view = session.view;
  const turnP = view.players?.[view.turn];
  if (!turnP || turnP.id !== session.me || turnP.bankrupt) return null;
  if (spec.kind === 'traffic') return trafficDecision(session);
  if (spec.kind === 'end' || spec.kind === 'roll') return rideDecision(session, spec);
  return null;
}

/** Does the card show? It does for a pending decision unless the player hid exactly this one (`hidden` = its key). */
export const isCardShown = (decision, hidden) => !!decision && hidden !== decision.key;

/**
 * A key press inside the card. Esc hides the card (the decision stays pending); Enter anywhere that is not itself a button
 * presses the primary choice. `isButton`: the event target is a button / link (the browser clicks it on Enter by itself).
 */
export function decisionKeyAction(e, { isButton = false, canPrimary = true } = {}) {
  if (!e || e.defaultPrevented) return null;
  if (e.key === 'Escape') return 'dismiss';
  if (e.key === 'Enter' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isButton && canPrimary) return 'primary';
  return null;
}

/** True while a decision card is on screen: the Space / Enter shortcut of the action row must not fire behind it. */
export const decisionCardOpen = () => typeof document !== 'undefined' && !!document.querySelector('[data-decision-card]');

/** The pill that brings a hidden card back: { label, icon } or null (no decision, or the card is showing). */
export function reopenOf(decision, hidden) {
  if (!decision || hidden !== decision.key) return null;
  return decision.reopen;
}
