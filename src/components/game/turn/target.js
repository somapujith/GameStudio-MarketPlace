// The net worth target ("first to ₹50L wins"): pure helpers for the top bar, the player pods and the heads-up lines.
//   session.view.cfg.targetWorth / session.display.cfg.targetWorth = rupees, or null / missing = off (old rooms).
//   When a player's net worth reaches it the engine ends the game with a `win` event, reason 'target'.
// Nothing here touches React: <TargetBar>, <TargetBadge> and useTargetWatch build on it.
import { compactINR, formatINR } from '@shared/format.js';

/** The share of the target from which a bar turns gold and pulses. */
export const TARGET_HOT = 0.8;
/** Heads-up steps, in percent of the target: "Sana is at 80% ..." then "... at 95% ...". */
export const TARGET_STEPS = Object.freeze([80, 95]);

/** "₹50L", "₹75L", "₹1Cr": a target the way hosts pick it (compactINR alone would say ₹100L). */
export function compactTarget(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n >= 10000000) return `₹${String(Math.round(n / 1000000) / 10)}Cr`;
  return compactINR(n);
}

/** The target in rupees from the table settings, or null when the rule is off / unknown. */
export function targetOf(cfg) {
  const v = Number(cfg?.targetWorth);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** How far `worth` is towards `target`: 0..1 (0 when there is no target or the worth is negative / unknown). */
export function targetFraction(worth, target) {
  const t = Number(target);
  const w = Number(worth);
  if (!(t > 0) || !Number.isFinite(w) || w <= 0) return 0;
  return Math.min(1, w / t);
}

/** Whole percent, rounded DOWN so a bar at 79.9% never says 80% (and nobody is "at 100%" before the game ends). */
export const targetPct = (worth, target) => Math.floor(targetFraction(worth, target) * 100 + 1e-9);

/** The highest heads-up step (80 / 95) a percentage has reached, or 0. */
export function targetStep(pct) {
  let step = 0;
  for (const s of TARGET_STEPS) if (pct >= s) step = s;
  return step;
}

/** True when `worth` is hot (>= 80% of the target). */
export const isHot = (worth, target) => targetFraction(worth, target) >= TARGET_HOT;

/** True when any live player is hot: the top bar and every bar get the gold tint. */
export function anyoneHot(players, worths, target) {
  if (!target) return false;
  return (Array.isArray(players) ? players : []).some((p) => !p.bankrupt && isHot(worths?.[p.id], target));
}

/**
 * The top-bar chip. -> { text: 'First to ₹50L', short: '₹50L', sr } | null (rule off).
 * `short` is what a very narrow bar shows after a target icon.
 */
export function targetBadge(cfg) {
  const target = targetOf(cfg);
  if (!target) return null;
  return {
    target,
    text: `First to ${compactTarget(target)}`,
    short: compactTarget(target),
    sr: `First player to reach a net worth of ${formatINR(target)} wins`,
  };
}

/** One sentence for the rules and the menu. */
export const targetRuleText = (target) =>
  `Net worth target: the first player to reach ${formatINR(target)} in net worth wins straight away, even before the last round.`;

/** "First to ₹50L" for a summary line, or '' when off. */
export const targetSummary = (cfg) => {
  const t = targetOf(cfg);
  return t ? `First to ${compactTarget(t)}` : '';
};

/**
 * What a pod shows for one player. -> null when the rule is off or the player is out.
 *   { frac, pct, hot, text, sr, lead, label }
 * `text` = the figure line ("Worth ₹12.6L of ₹50L" for you, "25%" for the others), `sr` = spoken part of the pod label.
 */
export function podTarget({ worth, target, isMe = false, isLeader = false, bankrupt = false }) {
  if (!target || bankrupt) return null;
  const frac = targetFraction(worth, target);
  const pct = targetPct(worth, target);
  const hot = frac >= TARGET_HOT;
  return {
    frac,
    pct,
    hot,
    lead: !!isLeader,
    label: isMe ? `Worth ${compactINR(worth)} of ${compactTarget(target)}` : `${compactINR(worth)} of ${compactTarget(target)}`,
    text: `${pct}%`,
    sr: `${pct}% of the ${compactTarget(target)} net worth target`,
  };
}

/**
 * Heads-up bookkeeping, one call per look at the table.
 *   prev      { [playerId]: highestStepAnnounced } from the last call, or null on the FIRST look (it only seeds: a game that
 *             is reloaded or reconnected never replays what was already announced, and a finished game says nothing)
 *   players   [{ id, name, bankrupt }]   worths { [id]: rupees }   target rupees
 * -> { seen, alerts: [{ id, name, step, pct }] }   `seen` is the next `prev`.
 * Each player gets each step at most once; a jump over both steps announces only the higher one; a player who is out is skipped.
 */
export function targetAlerts(prev, players, worths, target) {
  const seen = { ...(prev || {}) };
  const alerts = [];
  if (!target) return { seen, alerts };
  for (const p of Array.isArray(players) ? players : []) {
    if (!p || p.bankrupt) continue;
    const pct = targetPct(worths?.[p.id], target);
    const step = targetStep(pct);
    if (step > (seen[p.id] || 0)) {
      seen[p.id] = step;
      if (prev) alerts.push({ id: p.id, name: p.name, step, pct });
    }
  }
  return { seen, alerts };
}

/** "Sana is at 90% of the ₹50L target" / "You are at 90% of the ₹50L target". */
export function alertText({ name, isMe, pct }, target) {
  return `${isMe ? 'You are' : `${name || 'Someone'} is`} at ${pct}% of the ${compactTarget(target)} target`;
}

/**
 * The log entry for an alert. `after` = the id of the newest log line when it fired (so the line stays where it happened
 * while the presenter keeps adding lines after it), see mergeLogNotes.
 */
export function alertNote(alert, target, me, after = null) {
  const isMe = alert.id === me;
  return {
    id: `target:${alert.id}:${alert.step}`,
    note: true,
    text: alertText({ ...alert, isMe }, target),
    tone: isMe ? 'good' : alert.step >= 95 ? 'warn' : 'info',
    icon: '🎯',
    after,
  };
}

/**
 * `log` with the heads-up notes placed right after the line they followed. Pure.
 * A note whose anchor has scrolled out of the (capped) log is dropped; a note with no anchor goes first.
 */
export function mergeLogNotes(log, notes) {
  const base = Array.isArray(log) ? log : [];
  if (!Array.isArray(notes) || notes.length === 0) return base;
  const out = base.slice();
  for (const n of notes) {
    let at = 0;
    if (n.after != null) {
      const i = out.findIndex((e) => e.id === n.after);
      if (i < 0) continue;
      at = i + 1;
    }
    while (at < out.length && out[at].note) at += 1; // several notes after one line keep their order
    out.splice(at, 0, n);
  }
  return out;
}
