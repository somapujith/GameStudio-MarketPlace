import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getLiveEvents } from '@/lib/api.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useApiReady } from '@/platform/home/useApi.js';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { EVENTS_REFRESH_MS, eventStripAllowed, liveEventChips, nextChipEnd } from './engagementModel.js';
import '@/styles/engagement.css';

/** Presentational (renders on the server): the strip with one chip per live event, or nothing. */
export function LiveEventView({ chips }) {
  if (!chips || !chips.length) return null;
  return (
    <aside className="jg-events" aria-label="Live events">
      <div className="jg-events__inner">
        <span className="jg-events__tag" aria-hidden="true">
          Live now
        </span>
        {chips.map((c) =>
          c.to ? (
            <Link key={c.id} to={c.to} className={`jg-event jg-event--${c.kind}`} title={c.name}>
              <span>
                <HubIcon name="spark" size={14} strokeWidth={2.4} /> {c.label}
              </span>
              <span>
                <span className="sr-only">: open the shop</span>
                <HubIcon name="arrowR" size={14} strokeWidth={2.4} />
              </span>
            </Link>
          ) : (
            <span key={c.id} className={`jg-event jg-event--${c.kind}`} title={c.name}>
              <span>
                <CoinIcon size={15} /> {c.label}
              </span>
            </span>
          ),
        )}
      </div>
    </aside>
  );
}

/**
 * The live-event strip under the top bar ("2× coins till Sun 11 pm", "Limited items till Tue 9 pm" -> the shop), on hub
 * pages (not the viewport-fit leaderboard, game screens or the lobby). GET /api/events/live on mount, then every
 * 5 minutes while the tab is visible (and on coming back after that long); a chip drops the moment its event ends.
 */
export default function LiveEventBar() {
  const { pathname } = useLocation();
  const ready = useApiReady();
  const [data, setData] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const last = useRef(0);

  const load = useCallback(async () => {
    last.current = Date.now();
    try {
      setData(await getLiveEvents({ timeout: 10_000 }));
    } catch {
      /* offline / no Worker: keep what we had */
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    load();
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (Date.now() - last.current >= EVENTS_REFRESH_MS - 1000) load();
      else setNow(Date.now());
    };
    const t = setInterval(tick, EVENTS_REFRESH_MS);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ready, load]);

  const chips = liveEventChips(data, now);
  const end = nextChipEnd(chips, now);
  useEffect(() => {
    if (end == null || end - now > 2 ** 31 - 1) return undefined;
    const t = setTimeout(() => setNow(Date.now()), end - now + 50);
    return () => clearTimeout(t);
  }, [end, now]);

  if (!eventStripAllowed(pathname)) return null;
  return <LiveEventView chips={chips} />;
}
