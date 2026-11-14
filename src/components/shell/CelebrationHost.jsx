import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { buzz } from '@/lib/haptics.js';
import { appCelebrations, checkLevelUp } from './celebrationQueue.js';
import { useAccount, useReducedMotion } from './hooks.js';
import { CoinIcon, Icon } from './icons.jsx';
import { playSfx } from './sound.js';
import { isGameRoute } from './theme.js';
import '@/styles/x-shell.css';

/*
 * Renders the head of the app-wide celebration queue (see celebrate.js for the API). Mount once, inside the
 * router. Also watches the signed-in user's level and celebrates a rise (never on a running game screen).
 */

const EXIT_MS = 240;
const LEVELS_KEY = 'hub.levels.v1';
const SOUND = { level: 'win', coins: 'coin', purchase: 'buy', badge: 'cheer' };
const ICON = { level: 'bolt', badge: 'medal', purchase: 'sparkle' };
const SHOWER = { level: 18, coins: 14 };

const rand = (a, b) => a + Math.random() * (b - a);

function makeCoins(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: Math.round(rand(-46, 46)), // vw-ish spread from centre
    dx: Math.round(rand(-60, 60)),
    rot: Math.round(rand(-300, 300)),
    delay: Math.round(rand(0, 380)),
    dur: Math.round(rand(900, 1500)),
    size: Math.round(rand(14, 24)),
  }));
}

function readLevels() {
  try {
    const v = JSON.parse(localStorage.getItem(LEVELS_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeLevels(map) {
  try {
    localStorage.setItem(LEVELS_KEY, JSON.stringify(map));
  } catch {
    /* private mode: celebrate again next time, harmless */
  }
}

/** Celebrates a level rise of the signed-in user (guests included), never over a game screen. */
function useLevelWatch() {
  const { user } = useAccount();
  const { pathname } = useLocation();
  const inGame = isGameRoute(pathname);
  const uid = user?.id;
  const level = Number(user?.level);

  useEffect(() => {
    if (inGame || uid === undefined || uid === null || !Number.isFinite(level)) return;
    const r = checkLevelUp(readLevels(), uid, level);
    writeLevels(r.seen);
    if (r.up) {
      const gained = r.to - r.from;
      appCelebrations.push({
        kind: 'level',
        title: `Level ${r.to}!`,
        text: gained > 1 ? `Up ${gained} levels. Keep playing to climb the ranks.` : 'You levelled up. Keep playing to climb the ranks.',
        icon: 'bolt',
      });
    }
  }, [inGame, uid, level]);
}

export default function CelebrationHost() {
  useLevelWatch();
  const reduced = useReducedMotion();
  const [item, setItem] = useState(() => appCelebrations.current());
  const [leaving, setLeaving] = useState(false);
  const [announce, setAnnounce] = useState('');
  const exitTimer = useRef(null);

  useEffect(() => appCelebrations.subscribe((head) => {
    clearTimeout(exitTimer.current);
    setLeaving(false);
    setItem(head);
  }), []);

  const close = useCallback(() => {
    if (!item) return;
    const id = item.id;
    if (reduced) {
      appCelebrations.dismiss(id);
      return;
    }
    setLeaving(true);
    clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => appCelebrations.dismiss(id), EXIT_MS);
  }, [item, reduced]);

  // enter: sound, haptics, announcement, auto-dismiss
  useEffect(() => {
    if (!item) return undefined;
    playSfx(SOUND[item.kind] || 'cheer');
    if (item.kind === 'level') buzz('win');
    else if (item.kind === 'coins') buzz('earn');
    setAnnounce(`${item.title}${item.text ? `. ${item.text}` : ''}`);
    const t = setTimeout(close, item.duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, close]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  const coins = useMemo(() => (item && !reduced && SHOWER[item.kind] ? makeCoins(SHOWER[item.kind]) : []), [item, reduced]);

  return (
    <>
      <div className="hub-sr" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      {item && (
        <div className={`xs-cel xs-cel--${item.kind}${leaving ? ' is-leaving' : ''}${reduced ? ' is-reduced' : ''}`} onClick={close} data-nosfx>
          {coins.length > 0 && (
            <div className="xs-cel__shower" aria-hidden="true">
              {coins.map((c) => (
                <i
                  key={c.id}
                  className="xs-cel__coin"
                  style={{ '--x': `${c.x}vw`, '--dx': `${c.dx}px`, '--rot': `${c.rot}deg`, '--delay': `${c.delay}ms`, '--dur': `${c.dur}ms` }}
                >
                  <CoinIcon size={c.size} />
                </i>
              ))}
            </div>
          )}
          <div className="xs-cel__card" key={item.id} aria-hidden="true">
            <span className="xs-cel__rays" />
            <span className="xs-cel__medal">
              {item.kind === 'coins' && !item.icon ? <CoinIcon size={40} /> : <Icon name={item.icon || ICON[item.kind] || 'sparkle'} size={38} strokeWidth={2.2} />}
            </span>
            <b className="xs-cel__title">{item.title}</b>
            {item.text && <span className="xs-cel__text">{item.text}</span>}
            <span className="xs-cel__hint">Tap to close</span>
          </div>
          <button type="button" className="hub-sr" onClick={close} data-nosfx>
            Close
          </button>
        </div>
      )}
    </>
  );
}
