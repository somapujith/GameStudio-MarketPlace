// OWNER: quests agent. Small pure helpers for the quest UI (tested in questUi.test.js).
import { fmtClock } from '../../gameplay/quest-math.js';

export const DIFF_LABEL = ['', 'EASY', 'MEDIUM', 'HARD'];
export const DIFF_TE = ['', 'సులభం', 'మధ్యస్థం', 'కష్టం'];
export const KIND_LABEL = {
  delivery: 'Delivery', escort: 'Escort', timed: 'Against the clock', tour: 'Tour', race: 'Race', stunt: 'Stunts', careful: 'Careful driving', collect: 'Collect', tutorial: 'Tutorial',
};

/** "2:05" for a clock, or "No limit". */
export const limitText = (s) => (s ? fmtClock(s) : 'No limit');

/** The clock bar tone: calm / warn / urgent from the seconds left (and the total, for short clocks). */
export function clockTone(left, total) {
  if (left == null) return 'calm';
  const frac = total ? left / total : 1;
  if (left <= 10 || frac <= 0.15) return 'urgent';
  if (left <= 25 || frac <= 0.3) return 'warn';
  return 'calm';
}

/** Width in percent of a bar from a value 0..1. */
export const pct = (v) => `${Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)}%`;

/** Progress to the next rank, 0..1 (1 at the top rank). */
export function rankProgress(rank, rep) {
  if (!rank || rank.next == null) return 1;
  return Math.max(0, Math.min(1, (rep - rank.floor) / (rank.next - rank.floor)));
}

/** Short reason text for a failed mission (the result card). */
const WHY = {
  time: 'You ran out of time.',
  crash: 'You crashed.',
  meter: 'It went cold.',
  rival: 'The rival crossed the line first.',
  lost: 'The baraat got away from you.',
  overtake: 'You overtook the baraat.',
  train: 'The train pulled in first.',
  abandoned: 'You abandoned the mission.',
  skipped: 'Tutorial skipped.',
};
export const whyFailed = (reason) => WHY[reason] || (String(reason || '').startsWith('hit:') ? `You hit a ${String(reason).slice(4)}.` : 'Mission failed.');

/** Which of the offers is selected, falling back to the first usable one. */
export function pickSelected(offers, id) {
  if (!offers?.length) return null;
  return offers.find((o) => o.id === id) || offers.find((o) => !o.locked && !o.unavailable) || offers[0];
}

/** Why an offer cannot be accepted right now, or '' when it can. */
export function blockedReason(offer, { canAccept = true, rank = null } = {}) {
  if (!offer) return 'No job selected';
  if (offer.unavailable) return 'Not available right now';
  if (offer.locked) return `Needs ${offer.minRep} reputation`;
  if (offer.doneToday) return 'Done today. Back tomorrow';
  if (!canAccept) return 'Finish your current job first';
  return '';
}
