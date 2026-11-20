// A player's avatar as a game token: a gradient rim in the player's colour with a glossy highlight, the decision
// timer drawn as an arc just OUTSIDE the rim (so it never covers the face), a ripple while it is their turn, a
// floating crown for the leader, a presence dot, and a one-shot reaction when their cash goes up or down.
// A bought avatar frame (cosmetics) replaces the rim. The wrapper footprint is `size + 8` px (room for the timer arc).
//   <AvatarToken session player size turn leader mood offline live frame />
import { Avatar } from '@/components/art/index.js';
import { darken, lighten } from '@/components/art/palette.js';
import { AvatarFrame } from '../turn/room.js';
import { useClock } from '../turn/clock.js';
import Icon from './Icon.jsx';
import '@/styles/avatarToken.css';

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const safeColor = (c) => (typeof c === 'string' && HEX.test(c) ? c : '#8aa09b');

/** A small stable number from an id, used to stagger idle blinks: "p1" and "p2" never blink together. */
export function blinkDelay(id) {
  let h = 0;
  for (const ch of String(id ?? '')) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return -((h % 54) / 10); // 0 .. -5.3 s (negative: the cycle is already under way)
}

function Rim({ id, color }) {
  const hi = lighten(color, 0.5);
  const lo = darken(color, 0.38);
  return (
    <svg className="avt__rim" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}g`} x1="12%" y1="6%" x2="88%" y2="94%">
          <stop offset="0" stopColor={hi} />
          <stop offset=".5" stopColor={color} />
          <stop offset="1" stopColor={lo} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46.5" fill="none" stroke={`url(#${id}g)`} strokeWidth="7" />
      <circle cx="50" cy="50" r="42.6" fill="none" stroke="rgba(8,14,22,.55)" strokeWidth="1.6" />
      <circle cx="50" cy="50" r="49.6" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth=".8" />
      <path d="M17 31A38 38 0 0 1 36 13" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}

/** The timer arc around the token while the clock waits for this player. */
function TimerArc({ session, playerId, size }) {
  const info = useClock(session);
  const on = !!info && info.waitingFor.includes(String(playerId));
  if (!on) return null;
  const warn = info.warn && String(playerId) === String(session.me);
  const box = size + 8;
  const r = size / 2 + 2.6;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`avt__timer${warn ? ' is-warn' : ''}`} viewBox={`0 0 ${box} ${box}`} width={box} height={box} aria-hidden="true" focusable="false">
      <circle className="avt__timer-track" cx={box / 2} cy={box / 2} r={r} />
      <circle
        className="avt__timer-run"
        cx={box / 2}
        cy={box / 2}
        r={r}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - info.frac)}
        transform={`rotate(-90 ${box / 2} ${box / 2})`}
      />
    </svg>
  );
}

export default function AvatarToken({ session, player, size = 44, turn = false, leader = false, mood = '', offline = false, live = false, frame }) {
  const color = safeColor(player?.color);
  const uid = `avt${String(player?.id ?? '').replace(/[^a-zA-Z0-9]/g, '')}${size}`;
  const face = (px) => <Avatar preset={player?.avatar} size={px} className={live ? 'av-live' : undefined} />;
  const cls = ['avt', turn && 'is-turn', leader && 'is-leader', offline && 'is-offline', player?.bankrupt && 'is-out', mood && `is-${mood}`, live && 'is-live']
    .filter(Boolean)
    .join(' ');
  const crown = Math.max(12, Math.round(size * 0.38));
  return (
    <span className={cls} style={{ '--pc': color, '--sz': `${size}px`, '--av-delay': `${blinkDelay(player?.id)}s` }} data-mood={mood || undefined}>
      {turn ? <><i className="avt__ripple" aria-hidden="true" /><i className="avt__ripple avt__ripple--2" aria-hidden="true" /></> : null}
      <span className="avt__core">
        {frame ? (
          <AvatarFrame frame={frame} size={size}>
            {(inner) => <span className="avt__face avt__face--framed">{face(inner)}</span>}
          </AvatarFrame>
        ) : (
          <>
            <span className="avt__face">{face(Math.round(size * 0.86))}</span>
            <Rim id={uid} color={color} />
          </>
        )}
        <i className="avt__flash" aria-hidden="true" />
      </span>
      <TimerArc session={session} playerId={player?.id} size={size} />
      {leader && !player?.bankrupt ? <Icon name="crown" size={crown} className="avt__crown" /> : null}
      {offline ? <i className="avt__dot" aria-hidden="true" /> : null}
    </span>
  );
}
