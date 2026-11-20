import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { buzz } from '@/lib/haptics.js';
import Modal from '@/components/shell/Modal.jsx';
import { CoinIcon, Icon } from '@/components/shell/icons.jsx';
import { fmtNum } from '@/components/shell/ui.jsx';
import { useAccount, useDaily, useReducedMotion } from '@/components/shell/hooks.js';
import { playSfx } from '@/components/shell/sound.js';
import CoinFlight, { centerOf } from '@/components/shell/home/CoinFlight.jsx';
import { GainPop, StreakBadge, Track } from '@/components/shell/home/DailyReward.jsx';
import { dailyView, istDayKey } from '@/components/shell/home/homeModel.js';
import { useCountUp } from '@/components/shell/home/useCountUp.js';
import {
  DAILY_POPUP_AUTOCLOSE_MS,
  DAILY_POPUP_DELAY_MS,
  DAILY_POPUP_RECHECK_MS,
  anotherLayerOpen,
  markPopupDismissed,
  popupDismissed,
  popupEligibility,
  popupRouteAllowed,
  popupShouldArm,
  popupSubline,
} from './dailyPopupModel.js';
import '@/styles/hubhome.css'; // .hh2-daily__* / .hh2-daypip__* (the card's track and chips)
import '@/styles/x-home.css'; // .xh-claim / .xh-gain / .xh-flight (the claim moment)
import '@/styles/daily-popup.css';

/**
 * The popup's content: the card's streak chip and 7-day track, a big Claim button, "Later", the balance, and a
 * polite live region for the result. Presentational (all state comes in as props) so it renders on the server.
 * The dialog chrome (role=dialog, aria-modal, focus trap, Esc, backdrop, close X, title) is the shared Modal.
 */
export function DailyPopupCard({ view, busy = false, gain = null, coins = null, shownCoins = 0, reduced = false, live = '', error = '', claimRef, onClaim, onDone, onLater }) {
  const claimed = !!view?.claimed;
  const days = view?.days || [];
  return (
    <div className="dp" data-claimed={claimed ? '' : undefined}>
      <div className="dp-head">
        <span className={`hh2-daily__gift ${claimed ? '' : 'xh-gift--ready'}`} aria-hidden="true">
          <Icon name="gift" size={26} />
        </span>
        <p className="dp-sub">{popupSubline(view)}</p>
        <StreakBadge streak={claimed ? view.streak : view.lost ? 0 : view.streak} />
      </div>

      <Track days={days} />

      <div className="dp-action">
        <button
          ref={claimRef}
          type="button"
          data-autofocus
          className={`hub-btn hub-btn--lg hub-btn--block dp-claim ${claimed ? 'hub-btn--primary' : 'hub-btn--accent xh-claim'}`}
          aria-disabled={busy || undefined} // not `disabled`: a disabled button drops focus out of the trap
          aria-busy={busy || undefined}
          onClick={claimed ? onDone : onClaim}
        >
          {claimed ? (
            <>
              <Icon name="check" size={20} /> Done
            </>
          ) : busy ? (
            <>
              <CoinIcon size={22} /> Collecting…
            </>
          ) : (
            <>
              <CoinIcon size={22} /> Claim +{fmtNum(view?.todaysCoins)}
            </>
          )}
        </button>
        {gain && <GainPop key={gain.id} amount={gain.amount} reduced={reduced} />}
      </div>

      {!claimed && (
        <button type="button" className="hub-btn hub-btn--soft hub-btn--block dp-later" onClick={onLater}>
          Later
        </button>
      )}

      {coins != null && (
        <p className="dp-bal">
          <CoinIcon size={16} /> Balance <b className={gain ? 'is-rolling' : ''}>{fmtNum(shownCoins)}</b>
        </p>
      )}
      {error && (
        <p className="dp-err" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

/**
 * Greets a signed-in member with today's reward a few seconds after the app loads (see dailyPopupModel.js for the
 * rules: members only, only when claimable, hub routes only, never over another dialog, once per session and day).
 * Mounted once in AppShell. Claiming goes through `useDaily().claim()`, the same path as the Home card.
 */
export default function DailyRewardPopup() {
  const { pathname } = useLocation();
  const { user, loading } = useAccount();
  const { claim } = useDaily();
  const reduced = useReducedMotion();
  const uid = user?.id != null ? String(user.id) : null;

  // phase is tied to the account: a different login starts from 'idle'
  const [state, setState] = useState({ uid: null, phase: 'idle', daily: null });
  const phase = state.uid === uid ? state.phase : 'idle';
  const [local, setLocal] = useState(null); // `daily` from the claim answer
  const [localCoins, setLocalCoins] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gain, setGain] = useState(null);
  const [flight, setFlight] = useState(null);
  const [live, setLive] = useState('');
  const [error, setError] = useState('');
  const claimRef = useRef(null);
  const timers = useRef([]);
  const alive = useRef(true);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    alive.current = true;
    const list = timers.current;
    return () => {
      alive.current = false;
      list.forEach(clearTimeout);
    };
  }, []);

  // ---- when to appear ------------------------------------------------------------------------
  const armed = !loading && uid != null && popupShouldArm({ user, pathname, dismissed: uid ? popupDismissed(uid) : true });
  useEffect(() => {
    if (phase !== 'idle' || !armed) return undefined;
    let t = 0;
    const attempt = () => {
      const u = userRef.current;
      // state may have moved on during the wait (claimed on the Home card, signed out): decide again
      if (!popupEligibility(u).eligible || popupDismissed(String(u.id))) return;
      if (anotherLayerOpen(typeof document !== 'undefined' ? document : null)) {
        t = setTimeout(attempt, DAILY_POPUP_RECHECK_MS);
        return;
      }
      setLocal(null);
      setLocalCoins(null);
      setGain(null);
      setLive('');
      setError('');
      setState({ uid: String(u.id), phase: 'open', daily: u.daily });
    };
    t = setTimeout(attempt, DAILY_POPUP_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase, armed, uid]);

  // ---- closing -------------------------------------------------------------------------------
  const close = useCallback(() => {
    if (uid) markPopupDismissed(uid);
    setState((s) => (s.phase === 'open' ? { ...s, phase: 'closed' } : s));
  }, [uid]);
  // browser back out of the hub (into a game) while it is open
  useEffect(() => {
    if (phase === 'open' && !popupRouteAllowed(pathname)) close();
  }, [phase, pathname, close]);

  // ---- the claim (same path as the Home card: useDaily().claim -> POST /api/me/daily, then refresh) ----
  const shownDaily = local ?? state.daily;
  const view = dailyView(shownDaily, Date.now());
  const serverCoins = Number(user?.coins);
  const coins = localCoins ?? (Number.isFinite(serverCoins) ? serverCoins : null);
  const shownCoins = useCountUp(coins ?? 0, { ms: 900, delay: 500, instant: reduced || !gain });

  const later = (fn, ms) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const onClaim = async () => {
    if (busy || view.claimed) return;
    setBusy(true);
    setError('');
    const origin = centerOf(claimRef.current);
    const r = await claim();
    if (!alive.current) return;
    setBusy(false);
    if (r?.ok) {
      const reward = Number(r.coins) > 0 ? Number(r.coins) : view.todaysCoins;
      const streak = Number(r.streak) > 0 ? Number(r.streak) : view.nextStreak;
      setLocal(r.daily && typeof r.daily === 'object' ? r.daily : { ...(shownDaily || {}), streak, lastClaim: istDayKey(), canClaim: false });
      if (Number.isFinite(r.balance)) setLocalCoins(r.balance);
      const id = Date.now();
      setGain({ id, amount: reward });
      playSfx('coin');
      buzz('earn');
      setLive(`${fmtNum(reward)} coins claimed. ${streak} day streak.${Number.isFinite(r.balance) ? ` Balance ${fmtNum(r.balance)}.` : ''}`);
      if (!reduced && origin) {
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
      later(() => alive.current && close(), DAILY_POPUP_AUTOCLOSE_MS);
    } else if (r?.already) {
      setLocal({ ...(shownDaily || {}), lastClaim: istDayKey(), canClaim: false });
      setLive('Already claimed today. Your next reward unlocks at midnight.');
    } else if (!r?.busy) {
      const msg = r?.error || 'Could not claim right now. Try again.';
      setError(msg);
      setLive(msg);
    }
  };

  if (phase === 'idle') return null;
  return (
    <>
      <Modal open={phase === 'open'} onClose={close} title="Daily reward" className="hub-sheet dp-panel">
        <DailyPopupCard
          view={view}
          busy={busy}
          gain={gain}
          coins={coins}
          shownCoins={shownCoins}
          reduced={reduced}
          live={live}
          error={error}
          claimRef={claimRef}
          onClaim={onClaim}
          onDone={close}
          onLater={close}
        />
      </Modal>
      {flight && <CoinFlight key={flight.id} from={flight.from} to={flight.to} targetEl={flight.el} onDone={() => setFlight(null)} />}
    </>
  );
}
