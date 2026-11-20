// Seat roster with a short "leaving" phase, so a seat that empties fades out instead of vanishing (pure, unit-tested).
import { useEffect, useState } from 'react';

export const LEAVE_MS = 260;

const key = (p) => String(p && p.id);

/**
 * `prev` = [{ key, player, leaving }], `players` = the room's list now.
 * Everyone in `players` is live; someone who was in `prev` and is gone stays in their old position, marked `leaving`.
 */
export function mergeRoster(prev, players) {
  const list = Array.isArray(players) ? players.filter(Boolean) : [];
  const ids = new Set(list.map(key));
  const next = list.map((player) => ({ key: key(player), player, leaving: false }));
  (Array.isArray(prev) ? prev : []).forEach((e, i) => {
    if (ids.has(e.key)) return;
    next.splice(Math.min(i, next.length), 0, { ...e, leaving: true });
  });
  return next;
}

/** Drop the entries that finished leaving. */
export const pruneRoster = (entries) => entries.filter((e) => !e.leaving);

/** Roster entries for a list of players: a seat that empties stays in the list for LEAVE_MS with `leaving: true`. */
export function useRoster(players) {
  const [entries, setEntries] = useState(() => mergeRoster([], players));
  const [seen, setSeen] = useState(players);
  if (players !== seen) {
    // derive during render: no frame where the departed seat is already gone but its ghost is not there yet
    setSeen(players);
    setEntries(mergeRoster(entries, players));
  }
  const leaving = entries.some((e) => e.leaving);
  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(() => setEntries(pruneRoster), LEAVE_MS + 40);
    return () => clearTimeout(t);
  }, [leaving, entries]);
  return entries;
}
