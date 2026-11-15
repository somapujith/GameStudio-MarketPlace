import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { claimDailyReward, errorMessage } from '@/lib/api.js';
import { buzz } from '@/lib/haptics.js';
import { paths } from '@/platform/paths.js';
import { CoinIcon, Icon } from '../icons.jsx';
import { fmtNum } from '../ui.jsx';
import { useReducedMotion } from '../hooks.js';
import { playSfx } from '../sound.js';
import { useToast } from '../Toast.jsx';
import CoinFlight, { centerOf } from './CoinFlight.jsx';
import { dailyView, fmtCountdown, istDayKey, msUntilIstMidnight, previewDays } from './homeModel.js';
import { useCountUp } from './useCountUp.js';

const CELEBRATE_MS = 2600;

function Track({ days, label = '7-day streak' }) {
  return (
    <ol className="hh2-daily__days" aria-label={label}>
      {days.map((d) => (
        <li key={d.n} className={`hh2-daypip ${d.done ? 'is-done' : ''} ${d.current ? 'is-current' : ''} ${d.n === 7 ? 'is-big' : ''}`}>
          <span className="hh2-daypip__dot">
            {d.done ? <Icon name="check" size={14} strokeWidth={3.2} /> : d.n === 7 ? <Icon name="gift" size={14} /> : <CoinIcon size={14} />}
          </span>
          <span className="hh2-daypip__label">{d.coins}</span>
          <span className="sr-only">
            Day {d.n}, {d.coins} coins, {d.done ? 'claimed' : d.current ? 'ready to claim' : 'upcoming'}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Head({ sub, streak, ready }) {
  return (
    <div className="hh2-daily__head">
      <span className={`hh2-daily__gift ${ready ? 'xh-gift--ready' : ''}`} aria-hidden="true">
        <Icon name="gift" size={26} />
      </span>
      <div className="hh2-daily__titles">
        <span className="st-eyebrow">Streak</span>
        <h2 id="hh2-daily-h" className="st-head__title">
          Daily reward
        </h2>
        <p className="hh2-daily__sub">{sub}</p>
      </div>
      {streak != null && (
        <span className="hh2-daily__streak" title="Day streak">
          <Icon name="flame" size={18} />
          <b>{streak}</b>
          <small>day{streak === 1 ? '' : 's'}</small>
        </span>
      )}
    </div>
  );
}

/** "+250" that rolls up from 0 and floats off. */
function GainPop({ amount, reduced }) {
  const [t, setT] = useState(0);
  useEffect(() => setT(amount), [amount]);
  const v = useCountUp(t, { ms: 750, instant: reduced });
  return (
    <span className={`xh-gain ${reduced ? 'is-still' : ''}`} aria-hidden="true">
      +{fmtNum(v)}
    </span>
  );
}

/**
 * Daily reward, backed by the server: `user.daily` + `POST /api/me/daily` (IST calendar days, 7-day track 150..400).
 * Signed-out visitors get a sign-in / guest prompt over a preview of the track. The claim moment: coin sound,
 * an 'earn' buzz, a shower of coins that flies into the top bar's `[data-coins-chip]` (or bursts upward), and a
 * count-up. Reduced motion keeps the sound, the toast and the numbers, and drops the shower.
 */
export default function DailyReward() {
  const auth = useAuth() || {};
  const { user, loading, refresh } = auth;
  const reduced = useReducedMotion();
  const toast = useToast();
  const btn = useRef(null);
  const timers = useRef([]);
  const alive = useRef(true);

  const [local, setLocal] = useState(null); // `daily` from the claim answer until /api/me catches up
  const [localCoins, setLocalCoins] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gain, setGain] = useState(null); // { id, amount }
  const [flight, setFlight] = useState(null); // { id, from, to, el }
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    alive.current = true;
    const list = timers.current;
    return () => {
      alive.current = false;
      list.forEach(clearTimeout);
    };
  }, []);

  const serverDaily = user?.daily;
  const dailyKey = JSON.stringify(serverDaily ?? null);
  useEffect(() => setLocal(null), [dailyKey]);
  const serverCoins = Number(user?.coins);
  useEffect(() => setLocalCoins(null), [serverCoins]);

  const daily = local ?? serverDaily;
  const view = dailyView(daily, now);
  const day = istDayKey(now);

  // Tick the countdown while claimed; when the IST day rolls over, ask the server for the new state.
  useEffect(() => {
    if (!user || !view.claimed) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [user, view.claimed]);
  const lastDay = useRef(day);
  useEffect(() => {
    if (lastDay.current === day) return;
    lastDay.current = day;
    setLocal(null);
    Promise.resolve(refresh?.()).catch(() => {});
  }, [day, refresh]);

  const coins = localCoins ?? (Number.isFinite(serverCoins) ? serverCoins : null);
  const shownCoins = useCountUp(coins ?? 0, { ms: 900, delay: 500, instant: reduced || !gain });

  const later = (fn, ms) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const celebrate = (amount, origin) => {
    playSfx('coin');
    buzz('earn');
    const id = Date.now();
    setGain({ id, amount });
    later(() => alive.current && setGain((g) => (g && g.id === id ? null : g)), CELEBRATE_MS);
    if (reduced || !origin) return;
    let chip = null;
    try {
      chip = document.querySelector('[data-coins-chip]');
    } catch {
      chip = null;
    }
    const to = centerOf(chip);
    setFlight({ id, from: origin, to, el: to ? chip : null });
    later(() => alive.current && setFlight((f) => (f && f.id === id ? null : f)), CELEBRATE_MS + 400);
  };

  const claim = async () => {
    if (busy || view.claimed) return;
    setBusy(true);
    const origin = centerOf(btn.current);
    try {
      const r = await claimDailyReward();
      if (!alive.current) return;
      const reward = Number(r?.reward) > 0 ? Number(r.reward) : view.todaysCoins;
      const streak = Number(r?.streak) > 0 ? Number(r.streak) : view.nextStreak;
      setLocal(r?.daily && typeof r.daily === 'object' ? r.daily : { ...(daily || {}), streak, lastClaim: istDayKey(), canClaim: false });
      if (Number.isFinite(Number(r?.coins))) setLocalCoins(Number(r.coins));
      setNow(Date.now());
      celebrate(reward, origin);
      toast(`+${fmtNum(reward)} coins · ${streak}-day streak`, { tone: 'gold', icon: 'gift' });
    } catch (e) {
      if (!alive.current) return;
      if (e?.status === 409) {
        setLocal({ ...(daily || {}), lastClaim: istDayKey(), canClaim: false });
        toast('Already claimed today. Your next reward unlocks at midnight.', { tone: 'info' });
      } else if (e?.status === 401) {
        toast('Your session ended. Sign in again to collect coins.', { tone: 'bad' });
      } else {
        toast(errorMessage(e, 'Could not claim right now. Try again.'), { tone: 'bad' });
      }
    } finally {
      Promise.resolve(refresh?.()).catch(() => {});
      if (alive.current) setBusy(false);
    }
  };

  // ---- signed out / booting --------------------------------------------------------------
  if (loading || !user) {
    return (
      <section data-tour="home-daily" className="hub-panel hh2-daily xh-daily is-out" aria-labelledby="hh2-daily-h" aria-busy={loading || undefined}>
        <div className="hh2-daily__glow" aria-hidden="true" />
        <Head sub={loading ? 'Checking your streak…' : 'Sign in or play as guest to collect daily coins.'} streak={null} />
        <Track days={previewDays()} label="Daily rewards, days 1 to 7" />
        <div className="hh2-daily__action">
          {loading ? (
            <span className="hub-skel xh-skel-btn" aria-hidden="true" />
          ) : (
            <Link to={paths.login(paths.hub())} className="hub-btn hub-btn--lg hub-btn--block hub-btn--primary">
              <Icon name="login" size={20} /> Sign in or play as guest
            </Link>
          )}
        </div>
      </section>
    );
  }

  // ---- signed in (guests included) -------------------------------------------------------
  const left = msUntilIstMidnight(now);
  const pos = view.days.find((d) => d.current)?.n;
  const sub = view.claimed
    ? `Claimed. Next reward in ${fmtCountdown(left)}.`
    : view.lost
      ? 'Streak lost. Start a new one today.'
      : view.streak === 0
        ? 'Your coins are waiting. Come back daily to grow them.'
        : `Day ${pos} of 7. Keep the streak alive.`;

  return (
    <section data-tour="home-daily" className={`hub-panel hh2-daily xh-daily ${view.claimed ? 'is-claimed' : 'is-ready'}`} aria-labelledby="hh2-daily-h">
      <div className="hh2-daily__glow" aria-hidden="true" />
      <Head sub={sub} streak={view.claimed ? view.streak : view.lost ? 0 : view.streak} ready={!view.claimed} />
      <Track days={view.days} />

      <div className="hh2-daily__action">
        <button
          ref={btn}
          type="button"
          className={`hub-btn hub-btn--lg hub-btn--block ${view.claimed ? 'hub-btn--soft' : 'hub-btn--accent xh-claim'}`}
          disabled={view.claimed || busy}
          aria-busy={busy || undefined}
          onClick={claim}
        >
          {view.claimed ? (
            <>
              <Icon name="check" size={20} /> Claimed · back in {fmtCountdown(left)}
            </>
          ) : busy ? (
            <>
              <CoinIcon size={22} /> Collecting…
            </>
          ) : (
            <>
              <CoinIcon size={22} /> Claim +{fmtNum(view.todaysCoins)}
            </>
          )}
        </button>
        {gain && <GainPop key={gain.id} amount={gain.amount} reduced={reduced} />}
      </div>

      {coins != null && (
        <p className="xh-daily__bal">
          <CoinIcon size={16} /> Balance <b className={gain ? 'is-rolling' : ''}>{fmtNum(shownCoins)}</b>
        </p>
      )}

      {flight && <CoinFlight key={flight.id} from={flight.from} to={flight.to} targetEl={flight.el} onDone={() => setFlight(null)} />}
    </section>
  );
}
