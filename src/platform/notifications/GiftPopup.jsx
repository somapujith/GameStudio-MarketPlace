import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cosmeticById } from '@shared/cosmetics.js';
import { achievementById } from '@shared/achievements.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { buzz } from '@/lib/haptics.js';
import Modal from '@/components/shell/Modal.jsx';
import { CoinIcon, Icon } from '@/components/shell/icons.jsx';
import { useAccount, useReducedMotion } from '@/components/shell/hooks.js';
import { playSfx } from '@/components/shell/sound.js';
import CoinFlight, { centerOf } from '@/components/shell/home/CoinFlight.jsx';
import { GainPop } from '@/components/shell/home/DailyReward.jsx';
import { Preview } from '@/platform/home/Ava.jsx';
import { anotherLayerOpen, popupRouteAllowed } from '@/platform/home/dailyPopupModel.js';
import { BRAND } from '@/platform/brand.js';
import { useNotifications } from './useNotifications.jsx';
import {
  GIFT_POPUP_AUTOCLOSE_MS,
  GIFT_POPUP_DELAY_MS,
  GIFT_POPUP_RECHECK_MS,
  collectAnnouncement,
  collectLabel,
  giftContext,
  giftFrom,
  giftHeadline,
  giftRewards,
  giftTotals,
  giftsToPop,
  growStack,
} from './notificationsModel.js';
import '@/styles/x-home.css'; // .xh-claim / .xh-gain / .xh-flight (the shared claim moment)
import '@/styles/notifications.css';
import '@/styles/engagement.css'; // .gp-art--badge / .gp-tag (achievement, season and referral gifts)

const TEAM = `${BRAND.name} team`;
const fmt = (n) => Number(n).toLocaleString('en-IN');

/** Gifts waved away (closed without collecting) this page session, per account: they wait in the inbox instead. */
const waved = new Map(); // uid -> Set<id>
const wavedFor = (uid) => {
  if (!waved.has(uid)) waved.set(uid, new Set());
  return waved.get(uid);
};

/**
 * The art for one gift: an unlocked achievement's badge (its catalogue icon on a medal), else the item itself when we
 * know it (shop renderer), else a coin pile, an XP star or a parcel.
 */
export function GiftArt({ gift, avatar }) {
  const d = gift?.data || {};
  if (gift?.kind === 'achievement') {
    const ach = achievementById(d.achievementId);
    return (
      <span className="gp-art gp-art--badge is-new">
        <HubIcon name={ach?.icon || 'medal'} size={30} strokeWidth={2.2} />
      </span>
    );
  }
  const item = d.itemId ? cosmeticById(d.itemId) : null;
  if (item) {
    return (
      <span className="gp-art gp-art--item" data-rarity={item.rarity}>
        <Preview item={item} size={56} avatar={avatar} />
      </span>
    );
  }
  if (d.coins) {
    return (
      <span className="gp-art gp-art--coins">
        <CoinIcon size={34} />
      </span>
    );
  }
  if (d.xp) {
    return (
      <span className="gp-art gp-art--xp">
        <Icon name="star" size={30} />
      </span>
    );
  }
  return (
    <span className="gp-art">
      <Icon name="gift" size={30} />
    </span>
  );
}

/** One gift in the stack: art, what it is for (badge / season placing / referral), title, body and the reward chips. */
function GiftRow({ gift, avatar }) {
  const item = gift.data?.itemId ? cosmeticById(gift.data.itemId) : null;
  const rewards = giftRewards(gift, item?.name || '');
  const ctx = giftContext(gift);
  return (
    <li className={`gp-gift${gift.kind === 'achievement' ? ' gp-gift--badge' : ''}`}>
      <GiftArt gift={gift} avatar={avatar} />
      <div className="gp-gift__text">
        {ctx && (
          <span className={`gp-tag gp-tag--${ctx.kind}`}>
            {ctx.kind === 'achievement' ? <Icon name="medal" size={13} /> : ctx.kind === 'season' ? <Icon name="trophy" size={13} /> : <Icon name="users" size={13} />}
            {ctx.label}
          </span>
        )}
        <b className="gp-gift__title">{gift.title}</b>
        {gift.body && <p className="gp-gift__body">{gift.body}</p>}
        {rewards.length > 0 && (
          <ul className="gp-rewards" aria-label="Rewards">
            {rewards.map((r) => (
              <li key={r.kind} className={`gp-reward gp-reward--${r.kind}`}>
                {r.kind === 'coins' && <CoinIcon size={14} />}
                {r.kind === 'xp' && <Icon name="star" size={13} />}
                {r.kind === 'item' && (item && item.kind !== 'title' ? <span className="gp-reward__art" aria-hidden="true"><Preview item={item} size={18} avatar={avatar} /></span> : <Icon name="sparkle" size={13} />)}
                <span>{r.label}</span>
                {r.kind === 'item' && item && <small>{item.kind === 'dice' ? 'dice skin' : item.kind}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * The popup's content, presentational (renders on the server): who it is from, the stacked gifts, one big Collect
 * button that turns into Done, and a polite live region. The dialog chrome is the shared Modal.
 */
export function GiftCard({ gifts = [], avatar, collected = false, gain = null, reduced = false, live = '', collectRef, onCollect, onDone }) {
  const totals = giftTotals(gifts);
  const from = gifts.length ? giftFrom(gifts[0], TEAM) : TEAM;
  const several = gifts.length > 1;
  const badges = gifts.length > 0 && gifts.every((g) => g.kind === 'achievement');
  return (
    <div className="gp" data-collected={collected ? '' : undefined}>
      <div className="gp-head">
        <span className={`gp-ribbon${collected ? '' : ' is-ready'}`} aria-hidden="true">
          <Icon name={badges ? 'medal' : 'gift'} size={28} />
        </span>
        <p className="gp-from">
          <span>From</span> <b>{from}</b>
        </p>
        {several && (
          <span className="gp-count" aria-hidden="true">
            ×{gifts.length}
          </span>
        )}
      </div>

      <div className={`gp-stack${several ? ' gp-stack--many' : ''}`}>
        <ul className="gp-list" aria-label={several ? `${gifts.length} gifts` : 'Your gift'}>
          {gifts.map((g) => (
            <GiftRow key={g.id} gift={g} avatar={avatar} />
          ))}
        </ul>
      </div>

      {several && (totals.coins > 0 || totals.xp > 0) && (
        <p className="gp-total">
          In all:
          {totals.coins > 0 && (
            <b>
              <CoinIcon size={15} /> {fmt(totals.coins)}
            </b>
          )}
          {totals.xp > 0 && <b>+{fmt(totals.xp)} XP</b>}
          {totals.items > 0 && <b>{totals.items === 1 ? '1 item' : `${totals.items} items`}</b>}
        </p>
      )}

      <div className="gp-action">
        <button
          ref={collectRef}
          type="button"
          data-autofocus
          className={`hub-btn hub-btn--lg hub-btn--block gp-collect ${collected ? 'hub-btn--primary' : 'hub-btn--accent xh-claim'}`}
          onClick={collected ? onDone : onCollect}
        >
          {collected ? (
            <>
              <Icon name="check" size={20} /> Done
            </>
          ) : (
            <>
              {totals.coins > 0 ? <CoinIcon size={22} /> : <Icon name="gift" size={20} />} {collectLabel(totals)}
            </>
          )}
        </button>
        {gain && <GainPop key={gain.id} amount={gain.amount} reduced={reduced} />}
      </div>
      <p className="gp-note">{collected ? 'Added to your account. Find them any time in your notifications.' : 'Already in your account. Collect to clear them from your inbox.'}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

/**
 * Celebrates unread gifts from the team, all at once in one stacked popup. Mounted in AppShell (so never on a game
 * screen or in the lobby, which render outside the shell); waits on the hub, waits while any other dialog, sheet,
 * the tour or the inbox is open, and tells AppShell while it is up (`onActiveChange`) so the daily reward popup is
 * held back until it closes. "Collect" marks the gifts read (POST /api/notifications/read { ids }).
 */
export default function GiftPopup({ onActiveChange }) {
  const { pathname } = useLocation();
  const { user, auth } = useAccount();
  const { enabled, items, markRead } = useNotifications();
  const reduced = useReducedMotion();
  const uid = user?.id != null ? String(user.id) : '';
  const [phase, setPhase] = useState('idle'); // idle | open | done | closed
  const [stack, setStack] = useState([]);
  const [gain, setGain] = useState(null);
  const [flight, setFlight] = useState(null);
  const [live, setLive] = useState('');
  const [skipV, setSkipV] = useState(0); // bumps when a stack is waved away
  const collectRef = useRef(null);
  const timers = useRef([]);
  const alive = useRef(true);
  const activeRef = useRef(onActiveChange);
  activeRef.current = onActiveChange;

  const pending = useMemo(() => (uid ? giftsToPop(items, wavedFor(uid)) : []), [items, uid, skipV]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const allowed = popupRouteAllowed(pathname);
  const up = phase === 'open' || phase === 'done';

  useEffect(() => {
    alive.current = true;
    const list = timers.current;
    return () => {
      alive.current = false;
      list.forEach(clearTimeout);
      activeRef.current?.(false);
    };
  }, []);
  useEffect(() => {
    activeRef.current?.(up);
  }, [up]);

  // ---- when to appear: unread gifts, on a hub page, nothing else on screen ----
  const armed = enabled && allowed && !up && pending.length > 0;
  useEffect(() => {
    if (!armed) return undefined;
    let t = 0;
    const attempt = () => {
      if (!alive.current || !pendingRef.current.length) return;
      if (anotherLayerOpen(typeof document !== 'undefined' ? document : null)) {
        t = setTimeout(attempt, GIFT_POPUP_RECHECK_MS);
        return;
      }
      activeRef.current?.(true); // same render as the open: the daily popup is held back from this commit on
      setStack(pendingRef.current);
      setGain(null);
      setLive('');
      setPhase('open');
    };
    t = setTimeout(attempt, GIFT_POPUP_DELAY_MS);
    return () => clearTimeout(t);
  }, [armed]);

  // gifts that land while it is open join the stack (not a second popup)
  useEffect(() => {
    if (phase === 'open' && pending.length) setStack((s) => growStack(s, pending));
  }, [phase, pending]);

  const close = useCallback(() => {
    if (phase === 'open' && uid) {
      // waved away without collecting: not again this session; they stay unread in the inbox
      const set = wavedFor(uid);
      stack.forEach((g) => set.add(g.id));
      setSkipV((v) => v + 1);
    }
    if (phase === 'open' || phase === 'done') setPhase('closed');
  }, [phase, uid, stack]);

  // the route left the hub (browser back into a game) while it was up
  useEffect(() => {
    if (up && !allowed) close();
  }, [up, allowed, close]);

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  const onCollect = () => {
    if (phase !== 'open' || !stack.length) return;
    const totals = giftTotals(stack);
    const origin = centerOf(collectRef.current);
    setPhase('done');
    markRead(stack.map((g) => g.id));
    auth?.refresh?.(); // the coin chip and owned items settle on the server's numbers
    const id = Date.now();
    if (totals.coins > 0) setGain({ id, amount: totals.coins });
    playSfx('coin');
    buzz('earn');
    setLive(collectAnnouncement(totals));
    if (!reduced && origin && totals.coins > 0) {
      let chip = null;
      try {
        chip = document.querySelector('[data-coins-chip]');
      } catch {
        chip = null;
      }
      const to = centerOf(chip);
      setFlight({ id, from: origin, to, el: to ? chip : null });
      later(() => alive.current && setFlight((f) => (f && f.id === id ? null : f)), 3000);
    }
    later(() => alive.current && setPhase((p) => (p === 'done' ? 'closed' : p)), GIFT_POPUP_AUTOCLOSE_MS);
  };

  if (phase === 'idle') return null;
  const count = stack.length;
  return (
    <>
      <Modal open={up} onClose={close} title={giftHeadline(count, stack)} className="hub-sheet gp-panel">
        <GiftCard
          gifts={stack}
          avatar={user?.avatar}
          collected={phase === 'done'}
          gain={gain}
          reduced={reduced}
          live={live}
          collectRef={collectRef}
          onCollect={onCollect}
          onDone={close}
        />
      </Modal>
      {flight && <CoinFlight key={flight.id} from={flight.from} to={flight.to} targetEl={flight.el} onDone={() => setFlight(null)} />}
    </>
  );
}
