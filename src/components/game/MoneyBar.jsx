// The scoreboard: one row per player with a turn arrow on whoever is playing, the decision ring around the avatar,
// cash, net worth, chai token, traffic and presence ("Reconnecting") tags, the equipped frame and title.
// Click a row -> onSelect(playerId). Each avatar carries `data-fx-player` (coins fly to / from it, bubbles point at it).
//   wide:     a vertical list in the side column
//   compact:  a horizontally scrollable strip of chips under the board (phones); the active chip scrolls into view
// What is SHOWN (cash, chai, stuck) comes from the presenter's display; presence comes from the room.
import { useEffect, useRef } from 'react';
import { Avatar } from '@/components/art/index.js';
import { formatINR, compactINR } from '@shared/format.js';
import Icon from './ui/Icon.jsx';
import Money from './ui/Money.jsx';
import { activePlayer, useWorths } from './ui/helpers.js';
import { TimerRing } from './turn/TurnTimer.jsx';
import { AvatarFrame, TitleChip, cosmeticsOf, isConnected, tableSummary } from './turn/room.js';

/** Chai glass + "Chai": the player holds a chai token (max 1). Dimmed (or hidden with `hideEmpty`) at 0. */
export function ChaiToken({ count, hideEmpty = false, className = '' }) {
  const n = Number(count) || 0;
  if (n <= 0 && hideEmpty) return null;
  const label = n > 0 ? `Chai token${n > 1 ? `s: ${n}` : ''}: halves the next big rent, or skips traffic` : 'No chai token';
  return (
    <span className={`hg-chai${n > 0 ? ' is-on' : ''} ${className}`.trim()} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M5 8h11l-1.3 10.2a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8z" fill="currentColor" />
        <path d="M16 10h1.6a2.4 2.4 0 0 1 0 4.8H15.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8.5 2.8c-.8 1 .8 1.6 0 2.8M12 2.8c-.8 1 .8 1.6 0 2.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span aria-hidden="true">{n > 1 ? `Chai x${n}` : 'Chai'}</span>
    </span>
  );
}

/** "Traffic" tag: the player is stuck in the Traffic Jam. */
export function TrafficTag({ className = '' }) {
  return (
    <span className={`hg-traffic ${className}`.trim()} role="img" aria-label="Stuck in traffic" title="Stuck in traffic">
      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" focusable="false">
        <rect x="7" y="2" width="10" height="20" rx="3" fill="currentColor" />
        <circle cx="12" cy="7" r="2" fill="#fff" />
        <circle cx="12" cy="12" r="2" fill="#fff" opacity=".55" />
        <circle cx="12" cy="17" r="2" fill="#fff" opacity=".55" />
      </svg>
      <span aria-hidden="true">Traffic</span>
    </span>
  );
}

/** "Reconnecting" tag for a player whose connection dropped (room presence). */
export function OfflineTag({ className = '' }) {
  return (
    <span className={`hg-offline ${className}`.trim()} role="img" aria-label="Reconnecting" title="Reconnecting – auto-played if they stay away">
      <i aria-hidden="true" />
      <span aria-hidden="true">Reconnecting</span>
    </span>
  );
}

/** A little board pawn (white base, coloured head): the player's colour swatch. */
export function PawnDot({ color, size = 24 }) {
  return (
    <span className="hg-pawndot" style={{ '--pc': color, width: size, height: size }} aria-hidden="true">
      <i />
    </span>
  );
}

/* ---- legacy (Snatch / Trap were removed by the Hustle rules). Kept so older imports keep rendering. ---- */
/** @deprecated Hustle has no snatch window. Always null. */
export const snatchWindow = () => null;
/** @deprecated */
export const liveSnatches = (session, player) => {
  const v = session?.view?.players?.find((x) => x.id === player.id);
  return Number.isFinite(v?.snatches) ? v.snatches : player.snatches;
};
/** @deprecated Renders the old token count only if a (pre-Hustle) state still carries one. */
export function SnatchTokens({ count, className = '' }) {
  if (!Number.isFinite(count)) return null;
  return <span className={`hg-snatch${count > 0 ? '' : ' is-zero'} ${className}`} role="img" aria-label={`Snatch tokens: ${count}`}><span aria-hidden="true">x{count}</span></span>;
}
/** @deprecated */
export const TrapReady = () => null;

/** The avatar with frame, decision ring and presence dot; the fx anchor for this player. */
function PlayerAvatar({ session, player, size = 34, offline }) {
  const cos = cosmeticsOf(session, player.id);
  return (
    <span className="hg-mb-ava" data-fx-player={player.id}>
      <TimerRing session={session} playerId={player.id} size={size + 8}>
        <AvatarFrame frame={cos.frame} size={size}>
          <span className="hg-mb-avatar" style={{ width: size, height: size }}>
            <Avatar preset={player.avatar} size={size - 4} />
          </span>
        </AvatarFrame>
      </TimerRing>
      {offline ? <i className="hg-mb-offdot" aria-hidden="true" /> : null}
    </span>
  );
}

function rowLabel({ player, worth, isMe, isTurn, isLeader, offline }) {
  return [
    `${player.name}${isMe ? ' (you)' : ''}`,
    player.bankrupt ? 'bankrupt' : `${formatINR(player.cash)} cash, ${formatINR(worth)} net worth`,
    isLeader ? 'leading' : '',
    isTurn ? 'current turn' : '',
    player.stuck && !player.bankrupt ? 'stuck in traffic' : '',
    player.chai > 0 && !player.bankrupt ? 'holds a chai token' : '',
    offline ? 'reconnecting' : '',
  ].filter(Boolean).join(', ');
}

function Row({ session, player, worth, isMe, isTurn, isLeader, onSelect }) {
  const offline = !isConnected(session, player.id) && !player.bankrupt;
  const title = cosmeticsOf(session, player.id).title;
  const cls = `hg-mb-row${isTurn ? ' is-turn' : ''}${isMe ? ' is-me' : ''}${player.bankrupt ? ' is-out' : ''}${offline ? ' is-offline' : ''}`;
  return (
    <li className={cls} style={{ '--pc': player.color }}>
      <button type="button" className="hg-mb-btn" onClick={() => onSelect?.(player.id)} aria-label={rowLabel({ player, worth, isMe, isTurn, isLeader, offline })}>
        <svg className="hg-mb-arrow" viewBox="0 0 12 16" width="12" height="16" aria-hidden="true" focusable="false">
          <path d="M1.5 1.2L10.5 8l-9 6.8z" />
        </svg>
        <PlayerAvatar session={session} player={player} offline={offline} />
        <span className="hg-mb-who">
          <span className="hg-mb-name">
            {isLeader ? <Icon name="crown" size={14} className="hg-mb-crown" /> : null}
            <b title={player.name}>{player.name}</b>
            {isMe ? <small className="hg-mb-you">YOU</small> : null}
          </span>
          {title ? <span className="hg-mb-title"><TitleChip title={title} size="sm" /></span> : null}
          <span className="hg-mb-sub">
            {player.bankrupt ? (
              <span className="hg-mb-tag is-bad">Bankrupt</span>
            ) : (
              <>
                {offline ? <OfflineTag /> : null}
                {player.stuck ? <TrafficTag /> : null}
                {isTurn && !offline ? <span className="hg-mb-tag is-turn">Turn</span> : null}
                <span className="hg-mb-worth" title={`Net worth ${formatINR(worth)}`}>Worth {compactINR(worth)}</span>
              </>
            )}
          </span>
        </span>
        <span className="hg-mb-end">
          {player.bankrupt ? <span className="hg-mb-cash">&mdash;</span> : <Money value={player.cash} flash className="hg-mb-cash" />}
          {player.bankrupt ? null : <ChaiToken count={player.chai} hideEmpty />}
        </span>
      </button>
    </li>
  );
}

function Chip({ session, player, worth, isMe, isTurn, isLeader, onSelect }) {
  const offline = !isConnected(session, player.id) && !player.bankrupt;
  const cls = `hg-chip${isTurn ? ' is-turn' : ''}${isMe ? ' is-me' : ''}${player.bankrupt ? ' is-out' : ''}${offline ? ' is-offline' : ''}`;
  return (
    <li className={cls} style={{ '--pc': player.color }} data-turn={isTurn ? '' : undefined}>
      <button type="button" className="hg-chip__btn" onClick={() => onSelect?.(player.id)} aria-label={rowLabel({ player, worth, isMe, isTurn, isLeader, offline })}>
        <PlayerAvatar session={session} player={player} size={22} offline={offline} />
        <span className="hg-chip__txt">
          <span className="hg-chip__name">
            {isLeader ? <Icon name="crown" size={12} className="hg-mb-crown" /> : null}
            <b title={isMe ? undefined : player.name}>{isMe ? 'You' : player.name}</b>
          </span>
          {player.bankrupt ? (
            <span className="hg-chip__cash is-out">Out</span>
          ) : (
            <span className="hg-chip__cash">{compactINR(player.cash)}</span>
          )}
          {offline ? (
            <span className="hg-chip__tags"><OfflineTag /></span>
          ) : !player.bankrupt && (player.stuck || player.chai > 0) ? (
            <span className="hg-chip__tags">
              {player.stuck ? <TrafficTag /> : null}
              <ChaiToken count={player.chai} hideEmpty />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/**
 * <MoneyBar session onSelect={(playerId) => void} onOpenStats={() => void} compact />
 * `compact` = the phone strip (horizontal, scrollable).
 */
export default function MoneyBar({ session, onSelect, onOpenStats, compact = false }) {
  const { worths, leaderId, state } = useWorths(session);
  const active = (session.display?.phase ?? session.view?.phase) === 'over' ? null : activePlayer(session);
  const cfg = session.display?.cfg || session.view?.cfg;
  const summary = tableSummary(cfg);
  const listRef = useRef(null);
  const activeId = active?.id ?? null;

  /* phones: keep the player on turn in view inside the strip (horizontal scroll only, never the page) */
  useEffect(() => {
    if (!compact || activeId == null) return;
    const list = listRef.current;
    const el = list?.querySelector('[data-turn]');
    if (!list || !el) return;
    const target = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2; // the list is position: relative
    try { list.scrollTo({ left: Math.max(0, target), behavior: 'smooth' }); } catch { list.scrollLeft = Math.max(0, target); }
  }, [compact, activeId]);

  const props = (p) => ({
    session,
    player: p,
    worth: worths[p.id] ?? p.cash,
    isMe: p.id === session.me,
    isTurn: !!active && active.id === p.id && !p.bankrupt,
    isLeader: leaderId === p.id,
    onSelect,
  });

  if (compact) {
    return (
      <section className="hg-strip" aria-label="Players">
        <ul ref={listRef} className="hg-strip__list">
          {state.players.map((p) => <Chip key={p.id} {...props(p)} />)}
          {onOpenStats ? (
            <li className="hg-chip is-stats">
              <button type="button" className="hg-chip__btn" onClick={onOpenStats} aria-label="View stats">
                <Icon name="list" size={18} />
                <span className="hg-chip__name"><b>Stats</b></span>
              </button>
            </li>
          ) : null}
        </ul>
      </section>
    );
  }

  return (
    <section className="hg-mb" aria-label="Scoreboard">
      <header className="hg-mb-head">
        <h2>Scoreboard</h2>
        <p className="hg-mb-sum" aria-label={summary}>
          {summary.split(' · ').map((part) => <span key={part} className="hg-mb-chip" aria-hidden="true">{part}</span>)}
        </p>
      </header>
      <ul className="hg-mb-list">
        {state.players.map((p) => <Row key={p.id} {...props(p)} />)}
      </ul>
      {onOpenStats ? (
        <button type="button" className="hg-mb-stats" onClick={onOpenStats}>
          <Icon name="list" size={16} />
          View stats
        </button>
      ) : null}
    </section>
  );
}
