import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { BRAND } from '@/platform/brand.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useReducedMotion } from '@/components/shell/hooks.js';
import { getGamesLive } from '@/lib/api.js';
import { useLoad } from '@/components/shell/home/useLoad.js';
import { openTablesById } from '@/components/shell/home/homeModel.js';
import { useLive } from './store/live.js';
import { categoryLabel, featured, liveList } from './catalog.js';
import { GameCover } from './GameArt.jsx';
import { playersLabel, themeVars } from './gameTheme.js';

const INTERVAL_MS = 7000;
const SWIPE_PX = 50;
const PARALLAX_PX = 12;

const fetchLive = (opts) => getGamesLive(opts);

function Slide({ game, active, index, total, tables = 0 }) {
  const live = game.status === 'live';
  const players = playersLabel(game.players);
  const feats = Array.isArray(game.features) ? game.features.slice(0, 3) : [];
  let k = 0;
  const step = () => ({ '--k': k++ });
  return (
    <article
      className={`sh-spot__slide ${active ? 'is-active' : ''}`}
      style={themeVars(game)}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}: ${game.name}`}
      aria-hidden={active ? undefined : true}
      inert={!active}
    >
      <div className="sh-spot__art">
        <GameCover game={game} className="sh-spot__cover" />
      </div>
      <div className="sh-spot__body">
        <p className="st-eyebrow sh-spot__eyebrow" style={step()}>
          {live ? 'Featured' : 'Coming soon'}
          {game.category ? ` · ${categoryLabel(game.category)}` : ''}
        </p>
        <h2 className="sh-spot__title" style={step()}>
          {game.name}
        </h2>
        {game.tagline && (
          <p className="sh-spot__tag" style={step()}>
            {game.tagline}
          </p>
        )}
        {game.description && (
          <p className="sh-spot__desc" style={step()}>
            {game.description}
          </p>
        )}
        <ul className="sh-spot__facts" aria-label="Game details" style={step()}>
          {live && tables > 0 && (
            <li className="sh-fact sh-fact--live">
              <i className="st-live" aria-hidden="true" />
              {tables} table{tables === 1 ? '' : 's'} open now
            </li>
          )}
          {players && (
            <li className="sh-fact">
              <HubIcon name="users" size={14} /> {players}
            </li>
          )}
          {game.duration && (
            <li className="sh-fact">
              <HubIcon name="clock" size={14} /> {game.duration}
            </li>
          )}
          {feats.map((f) => (
            <li key={f} className="sh-fact sh-fact--feat">
              {f}
            </li>
          ))}
        </ul>
        <div className="sh-spot__cta" style={step()}>
          {live ? (
            <Link to={paths.game(game.id)} className="hub-btn hub-btn--accent hub-btn--lg">
              <HubIcon name="play" size={18} /> Play now
            </Link>
          ) : (
            <Link to={paths.game(game.id)} className="hub-btn hub-btn--accent hub-btn--lg">
              <HubIcon name="bell" size={18} /> Get notified
            </Link>
          )}
          {live && (
            <Link to={paths.game(game.id)} className="hub-btn hub-btn--soft hub-btn--lg sh-spot__more">
              See details
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Spotlight hero (`/`): a big signage-style banner for the featured game with its live table count, a Play button
 * and a "See details" link. With several live games it crossfades between them (auto-advance pauses on hover,
 * focus, touch, a hidden tab, the pause button and reduced motion). The art drifts a few px with the pointer.
 */
export default function Hero() {
  const reduced = useReducedMotion();
  const shared = useLive();
  // Standalone (outside Home's provider) the hero asks for the counts itself.
  const own = useLoad('games-live', fetchLive, { enabled: !shared, pollMs: 30_000 });
  const counts = shared ? shared.gamesLive : own;
  const tables = shared?.perGame ?? (counts.status === 'ok' ? openTablesById(counts.data?.games) : {});
  const slides = useMemo(() => {
    const out = [];
    const f = featured();
    if (f) out.push(f);
    liveList().forEach((g) => {
      if (!out.some((x) => x.id === g.id)) out.push(g);
    });
    return out;
  }, []);
  const total = slides.length;
  const many = total > 1;

  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const touchX = useRef(null);
  const stage = useRef(null);
  const raf = useRef(0);

  const running = many && !reduced && !held && !paused && !tabHidden;

  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(() => setIndex((n) => (n + 1) % total), INTERVAL_MS);
    return () => clearTimeout(t);
  }, [running, index, total]);

  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const go = useCallback((n) => setIndex(((n % total) + total) % total), [total]);

  const drift = (e) => {
    if (reduced || e.pointerType !== 'mouse') return;
    const box = stage.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const x = ((e.clientX - box.left) / box.width - 0.5) * 2;
    const y = ((e.clientY - box.top) / box.height - 0.5) * 2;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = stage.current?.querySelector('.is-active .sh-spot__art');
      if (el) el.style.transform = `translate3d(${(-x * PARALLAX_PX).toFixed(1)}px, ${(-y * PARALLAX_PX * 0.6).toFixed(1)}px, 0)`;
    });
  };
  const settle = () => {
    cancelAnimationFrame(raf.current);
    stage.current?.querySelectorAll('.sh-spot__art').forEach((el) => {
      el.style.transform = '';
    });
  };

  if (!total) {
    return (
      <section className="sh-spot sh-spot--empty" aria-label="Featured game">
        <h2 className="sh-spot__title">{BRAND.name}</h2>
        <p className="sh-spot__tag">{BRAND.tagline}</p>
      </section>
    );
  }

  return (
    <section
      className="sh-spot"
      aria-roledescription={many ? 'carousel' : undefined}
      aria-label="Featured games"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHeld(true)}
      onPointerMove={drift}
      onPointerLeave={() => {
        setHeld(false);
        settle();
      }}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false);
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const x0 = touchX.current;
        touchX.current = null;
        const x1 = e.changedTouches[0]?.clientX;
        if (!many || x0 == null || x1 == null || Math.abs(x1 - x0) < SWIPE_PX) return;
        go(index + (x1 < x0 ? 1 : -1));
      }}
    >
      <div className="sh-spot__stage" ref={stage} aria-live={running ? 'off' : 'polite'}>
        {slides.map((g, i) => (
          <Slide key={g.id} game={g} index={i} total={total} active={i === index} tables={tables[g.id] || 0} />
        ))}
      </div>

      {many && (
        <div className="sh-spot__nav">
          <div className="sh-dots" role="group" aria-label="Choose a featured game">
            {slides.map((g, i) => (
              <button
                key={g.id}
                type="button"
                className={`sh-dot ${i === index ? 'is-on' : ''}`}
                aria-label={`Show ${g.name}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => go(i)}
              >
                <i key={i === index ? `on-${index}` : 'off'} data-run={running ? 'true' : 'false'} />
              </button>
            ))}
          </div>
          {!reduced && (
            <button
              type="button"
              className="sh-dotpause"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              aria-label={paused ? 'Resume rotation' : 'Pause rotation'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false" fill="currentColor">
                {paused ? <path d="M3 1.8v10.4L12 7z" /> : <path d="M3 1.5h2.6v11H3zM8.4 1.5H11v11H8.4z" />}
              </svg>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
