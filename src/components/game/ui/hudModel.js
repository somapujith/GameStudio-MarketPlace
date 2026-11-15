// Pure helpers for the desktop / tablet HUD (player pods, the net-worth race in the top bar, the centre's hint line).
// Nothing here touches React or the DOM; hudModel.test.js covers it.
import { compactINR, formatINR } from '@shared/format.js';
import { SET_GROUPS, ordinal } from './helpers.js';
import { compactTarget, targetFraction } from '../turn/target.js';

/**
 * A player's empire: one entry per collection, in board order.
 *   -> [{ id, name, color, total, owned, full, mortgaged }]
 * `owned` counts the player's districts in the collection (mortgaged ones included, `mortgaged` says how many of those).
 */
export function empireOf(owners, mortgaged, playerId, groups = SET_GROUPS) {
  return groups.map((g) => {
    let owned = 0;
    let loan = 0;
    for (const t of g.tiles) {
      if (owners?.[t] !== playerId) continue;
      owned += 1;
      if (mortgaged?.[t]) loan += 1;
    }
    return { id: g.id, name: g.name, color: g.color, total: g.tiles.length, owned, full: owned > 0 && owned === g.tiles.length, mortgaged: loan };
  });
}

/** "4 districts, 1 complete collection" (screen readers; '' when the player owns nothing). */
export function empireWords(rows) {
  const tiles = rows.reduce((n, r) => n + r.owned, 0);
  if (!tiles) return '';
  const sets = rows.filter((r) => r.full).length;
  return `${tiles} ${tiles === 1 ? 'district' : 'districts'}${sets ? `, ${sets} complete ${sets === 1 ? 'collection' : 'collections'}` : ''}`;
}

/**
 * Standings by net worth among the players still in. Ties share a rank (1, 1, 3).
 *   -> { [playerId]: rank }   (players who are out are left out)
 */
export function ranksOf(players, worths) {
  const alive = (Array.isArray(players) ? players : []).filter((p) => !p.bankrupt);
  const sorted = [...alive].sort((a, b) => (worths?.[b.id] ?? 0) - (worths?.[a.id] ?? 0));
  const out = {};
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    out[p.id] = prev && (worths?.[prev.id] ?? 0) === (worths?.[p.id] ?? 0) ? out[prev.id] : i + 1;
  });
  return out;
}

/**
 * The net-worth race track. Everybody still in sits on a line from 0 to the win target (no target: to a little past the leader).
 *   -> { hasTarget, target, label, flag, runners: [{ id, name, color, worth, frac, isMe, rank, lane, lead }], sr } | null (fewer than 1 runner)
 * `runners` is drawn back to front (the leader last, so the leader sits on top). `lane` 0 | 1 | 2 nudges dots that would overlap.
 */
export function raceModel({ players, worths, target = null, me = null, leaderId = null }) {
  const alive = (Array.isArray(players) ? players : []).filter((p) => !p.bankrupt);
  if (!alive.length) return null;
  const ranks = ranksOf(alive, worths);
  const top = Math.max(...alive.map((p) => Number(worths?.[p.id]) || 0));
  const hasTarget = Number(target) > 0;
  const span = hasTarget ? Number(target) : Math.max(top * 1.15, 1000000);
  const runners = alive
    .map((p) => {
      const worth = Number(worths?.[p.id]) || 0;
      const frac = hasTarget ? targetFraction(worth, span) : Math.max(0, Math.min(1, worth / span));
      return { id: p.id, name: p.name, color: p.color, worth, frac, isMe: p.id === me, rank: ranks[p.id], lane: 0, lead: p.id === leaderId };
    })
    .sort((a, b) => a.frac - b.frac || b.rank - a.rank);
  // dots that would sit on top of each other step up / down a lane
  for (let i = 1; i < runners.length; i++) {
    if (runners[i].frac - runners[i - 1].frac < 0.03) runners[i].lane = (runners[i - 1].lane + 1) % 3;
  }
  const standings = [...runners].reverse().map((r) => `${r.isMe ? 'You' : r.name} ${compactINR(r.worth)}`).join(', ');
  return {
    hasTarget,
    target: hasTarget ? span : null,
    label: hasTarget ? compactTarget(span) : '',
    flag: hasTarget ? `Finish line: ${formatINR(span)}` : '',
    runners,
    sr: `Net worth race${hasTarget ? ` to ${compactTarget(span)}` : ''}: ${standings}`,
  };
}

/** The leader's share of the win target, 0..1 (0 when there is no target). */
export function leaderFraction(players, worths, target) {
  if (!(Number(target) > 0)) return 0;
  let best = 0;
  for (const p of Array.isArray(players) ? players : []) {
    if (p.bankrupt) continue;
    best = Math.max(best, targetFraction(worths?.[p.id], target));
  }
  return best;
}

/** "1st" / "2nd" ... for a rank badge. */
export const rankLabel = (rank) => ordinal(rank);

/**
 * The plain-words line under the turn caption in the centre of the board: what is happening / what to do next.
 * `spec` is the action spec (ActionBar.buildActionSpec). -> string ('' = nothing to add; the caption and the action row say enough)
 */
export function hintLine(session, spec, activeName = '') {
  const phase = session?.display?.phase ?? session?.view?.phase;
  if (phase === 'over' || session?.result) return 'The game is over. See the final standings';
  const kind = spec?.kind;
  const who = activeName || 'the other player';
  switch (kind) {
    case 'roll':
      return spec.primary?.label === 'Roll again' ? 'You rolled a six, so you get another move' : 'Roll the die to move around the city';
    case 'buy': {
      const label = spec.primary?.label || 'Buy this district';
      const sec = spec.secondaries?.find((s) => s.key === 'skip');
      const pass = sec ? (sec.label === 'Skip' ? 'skip it' : 'put it up for auction') : 'pass';
      return `${label} for ${spec.primary?.amount || 'its price'}, or ${pass}`;
    }
    case 'skip':
      return `${spec.primary?.sub || 'Not enough cash to buy it'}. ${spec.primary?.label || 'Pass'} to move on`;
    case 'end':
      return spec.upgrades > 0 ? 'Upgrade a district in Manage, or end your turn' : 'Nothing left to do. End your turn when you are ready';
    case 'traffic':
      return ''; // the action row already carries its own traffic hint
    case 'out':
      return 'You can keep watching the game from here';
    default:
      break;
  }
  if (spec?.waitFor || kind === 'status') {
    const p = session?.view?.pending;
    if (phase === 'buy' || p?.type === 'buy') return `Waiting for ${who} to decide`;
    if (phase === 'roll') return `Waiting for ${who} to roll`;
    if (phase === 'auction') return 'Everyone places a sealed bid';
    if (phase === 'debt') return `${who} has to raise cash`;
    if (phase === 'snatch') return 'Snatch buttons are live. Be quick';
    if (session?.view?.trade) return 'A trade offer is waiting for an answer';
    return spec?.waitFor ? `Waiting for ${who}` : '';
  }
  return '';
}
