import { useEffect, useRef, useState } from 'react';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { fmtNum } from '@/components/shell/ui.jsx';
import { useProfile } from '@/components/shell/stores.js';
import { useAccount, useReducedMotion } from '@/components/shell/hooks.js';
import { paths } from '@/platform/paths.js';
import TransitionLink from './TransitionLink.jsx';

const COUNT_MS = 750;
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * Animated number: rolls from the shown value to `value` (no roll on first render or under reduced motion).
 * Returns `[shown, dir]` where dir is 1 while counting up, -1 while counting down, 0 at rest.
 */
export function useCountUp(value, reduced) {
  const target = Math.round(Number(value) || 0);
  const [shown, setShown] = useState(target);
  const [dir, setDir] = useState(0);
  const from = useRef(target);
  const raf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    const start = from.current;
    if (reduced || start === target || typeof requestAnimationFrame !== 'function') {
      from.current = target;
      setShown(target);
      setDir(0);
      return undefined;
    }
    setDir(target > start ? 1 : -1);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / COUNT_MS);
      const v = Math.round(start + (target - start) * easeOut(k));
      from.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else setDir(0);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, reduced]);

  return [shown, dir];
}

/**
 * Soft-currency balance (server value for a session, else the on-device profile). Links to the shop.
 * `data-coins-chip` marks it as the landing spot for flying reward coins (H-HOME's daily reward).
 * A small dot shows while today's daily reward is unclaimed (`user.daily.canClaim`, sessions only).
 */
export default function CoinsChip() {
  const [profile] = useProfile();
  const { user } = useAccount();
  const reduced = useReducedMotion();
  const serverCoins = Number(user?.coins);
  const coins = user && Number.isFinite(serverCoins) ? serverCoins : profile.coins;
  const [shown, dir] = useCountUp(coins, reduced);
  const canClaim = !!user?.daily?.canClaim;
  // A visitor has no coins yet: signing in is what starts the account. (After the hooks: their count must not change.)
  if (!user) return null;

  return (
    <TransitionLink
      to={paths.shop()}
      className={`hub-coins xs-coins${dir > 0 ? ' is-up' : dir < 0 ? ' is-down' : ''}`}
      data-coins-chip=""
      title="Your coins: open the shop"
      aria-label={`${fmtNum(coins)} coins. Open the shop${canClaim ? '. Daily reward ready' : ''}`}
    >
      <CoinIcon size={18} className="xs-coins__icon" />
      <b aria-hidden="true">{fmtNum(shown)}</b>
      {canClaim && <i className="xs-coins__dot" aria-hidden="true" />}
    </TransitionLink>
  );
}
