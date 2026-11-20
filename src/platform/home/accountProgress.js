// One source of truth for level / XP / coins on account screens (profile header, badges, shop).
// Signed in (guests too): the SERVER's `user.level` is the level, the same number the top bar shows. The XP bar is
// drawn inside that level's span, so a stale or derived level can never disagree with the chip. Visitors (no session)
// fall back to the on-device profile and derive the level from its XP.
import { useMemo } from 'react';
import { levelInfo, progressOf, useProfile } from '@/components/shell/stores.js';
import { useAccount } from '@/components/shell/hooks.js';

/** XP a level costs to leave (the server's curve: level L -> L+1 = 100 + (L - 1) * 50). */
export const xpToLeave = (level) => 100 + (Math.max(1, Math.floor(level)) - 1) * 50;

/** Total XP at which a level begins. */
export function xpAtLevel(level) {
  let sum = 0;
  for (let l = 1; l < Math.max(1, Math.floor(level)); l += 1) sum += xpToLeave(l);
  return sum;
}

/** `{ xp, coins, level, into, need, pct, source: 'server'|'device' }`. Pure. */
export function accountProgress(user, profile) {
  const base = progressOf(user, profile);
  const serverLevel = Math.floor(Number(user?.level));
  if (!user || !Number.isFinite(serverLevel) || serverLevel < 1) {
    const li = base.info;
    return { xp: base.xp, coins: base.coins, level: li.level, into: li.into, need: li.need, pct: pctOfSpan(li.into, li.need), source: user ? 'server' : 'device' };
  }
  const need = xpToLeave(serverLevel);
  const into = Math.max(0, Math.min(need, base.xp - xpAtLevel(serverLevel)));
  // when the XP and the server level agree this equals levelInfo(xp); when they do not, the level still wins
  const derived = levelInfo(base.xp);
  const same = derived.level === serverLevel;
  return {
    xp: base.xp,
    coins: base.coins,
    level: serverLevel,
    into: same ? derived.into : into,
    need: same ? derived.need : need,
    pct: pctOfSpan(same ? derived.into : into, same ? derived.need : need),
    source: 'server',
  };
}

function pctOfSpan(into, need) {
  return need > 0 ? Math.max(0, Math.min(100, (into / need) * 100)) : 0;
}

/** Hook form: same numbers for whoever is looking at the screen. */
export function useAccountProgress() {
  const [profile] = useProfile();
  const { user } = useAccount();
  return useMemo(() => accountProgress(user, profile), [user, profile]);
}
