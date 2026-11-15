// Players around the board: every player's avatar and cash sits at a corner of the table instead of in a scoreboard list.
//   you are always bottom-left (next to START); the others follow clockwise: top-left, top-right, bottom-right.
//   5-6 players also use the two middle edges (left, right).
// Your own cash is the big, bold figure (gold, with a "Your cash" label); the others show theirs smaller.
// Each pod is a button (-> onSelect(playerId)) and its avatar carries `data-fx-player` (coins fly to / from it).
// The pods are direct grid children of .hg-table (the <ul> is `display: contents`): see the layout in game.css / pods.css.
import { useEffect, useRef, useState } from 'react';
import { compactINR, formatINR } from '@shared/format.js';
import Money from './ui/Money.jsx';
import { activePlayer, useMedia, useWorths } from './ui/helpers.js';
import { ChaiToken, OfflineTag, PlayerAvatar, TrafficTag, rowLabel } from './MoneyBar.jsx';
import { TitleChip, cosmeticsOf, isConnected } from './turn/room.js';
import '../../styles/pods.css';

/** Slot names by player count, clockwise from the bottom-left corner (bl = you). */
export const POD_LAYOUTS = Object.freeze({
  1: ['bl'],
  2: ['bl', 'tr'],
  3: ['bl', 'tl', 'tr'],
  4: ['bl', 'tl', 'tr', 'br'],
  5: ['bl', 'ml', 'tl', 'tr', 'br'],
  6: ['bl', 'ml', 'tl', 'tr', 'mr', 'br'],
});

/**
 * `[{ player, slot }]`: the viewer first (so you sit bottom-left), then the other seats in turn order.
 * A spectator (not in the list) keeps the seat order.
 */
export function podSlots(players, meId) {
  const list = Array.isArray(players) ? players : [];
  const at = list.findIndex((p) => p.id === meId);
  const ordered = at > 0 ? [...list.slice(at), ...list.slice(0, at)] : list;
  const slots = POD_LAYOUTS[Math.min(6, Math.max(1, ordered.length))] || [];
  return ordered.slice(0, 6).map((player, i) => ({ player, slot: slots[i] }));
}

/** True when the table needs the middle edges (5+ players): the narrow layout then uses three columns. */
export const usesMiddleEdges = (count) => count >= 5;

/** Shrink factor for long amounts so they never overflow the pod: "₹11,15,000" = 1, "₹1,11,50,000" = 0.8. */
export function fitFor(cash) {
  const len = formatINR(Number(cash) || 0).length;
  return len <= 10 ? 1 : len === 11 ? 0.9 : 0.8;
}

/** 'up' | 'down' for a second after the player's cash changes (drives the avatar's reaction), else ''. */
export function useCashMood(cash) {
  const prev = useRef(cash);
  const [mood, setMood] = useState('');
  useEffect(() => {
    const d = (Number(cash) || 0) - (Number(prev.current) || 0);
    prev.current = cash;
    if (!d) return undefined;
    setMood(d > 0 ? 'up' : 'down');
    const t = setTimeout(() => setMood(''), 1000);
    return () => clearTimeout(t);
  }, [cash]);
  return mood;
}

function Pod({ session, player, slot, worth, isMe, isTurn, isLeader, avatar, dense, onSelect }) {
  const offline = !isConnected(session, player.id) && !player.bankrupt;
  const mood = useCashMood(player.cash);
  const title = cosmeticsOf(session, player.id).title;
  const cls = ['hg-pod', isMe && 'is-me', dense && 'is-dense', isTurn && 'is-turn', player.bankrupt && 'is-out', offline && 'is-offline'].filter(Boolean).join(' ');
  const label = rowLabel({ player, worth, isMe, isTurn, isLeader, offline });
  return (
    <li className={cls} data-slot={slot} style={{ '--pc': player.color, '--fit': fitFor(player.cash) }} data-turn={isTurn ? '' : undefined}>
      <button type="button" className="hg-pod__btn" onClick={() => onSelect?.(player.id)} aria-label={label}>
        <span className="hg-pod__ava">
          <PlayerAvatar session={session} player={player} size={isMe ? avatar + 8 : avatar} offline={offline} turn={isTurn && !offline} leader={isLeader} mood={mood} live />
        </span>
        <span className="hg-pod__who">
          <span className="hg-pod__name">
            <b title={player.name}>{player.name}</b>
            {isMe ? <small className="hg-pod__you">YOU</small> : null}
          </span>
          <span className="hg-pod__sub">
            {player.bankrupt ? (
              <span className="hg-pod__out">Bankrupt</span>
            ) : (
              <>
                {isTurn && !offline ? <span className="hg-pod__turn">Turn</span> : null}
                {offline ? <OfflineTag /> : null}
                {player.stuck ? <TrafficTag /> : null}
                <ChaiToken count={player.chai} hideEmpty />
                <span className="hg-pod__worth" title={`Net worth ${formatINR(worth)}`}>Worth {compactINR(worth)}</span>
              </>
            )}
            {title ? <span className="hg-pod__title"><TitleChip title={title} size="sm" /></span> : null}
          </span>
        </span>
        <span className="hg-pod__cash">
          {isMe && !player.bankrupt ? <small className="hg-pod__lbl">Your cash</small> : null}
          {player.bankrupt ? <span className="hg-pod__amt is-out">Out</span> : <Money value={player.cash} flash className="hg-pod__amt" />}
        </span>
      </button>
    </li>
  );
}

/** <PlayerPods session onSelect={(playerId) => void} /> */
export default function PlayerPods({ session, onSelect }) {
  const { worths, leaderId, state } = useWorths(session);
  const active = (session.display?.phase ?? session.view?.phase) === 'over' ? null : activePlayer(session);
  const phone = useMedia('(max-width: 599px)');
  const dense = phone && usesMiddleEdges(state.players.length); // three pods per row: avatars shrink, only name + cash show
  const avatar = dense ? 28 : phone ? 36 : 42;
  return (
    <ul className="hg-pods" role="list" aria-label="Players">
      {podSlots(state.players, session.me).map(({ player, slot }) => (
        <Pod
          key={player.id}
          session={session}
          player={player}
          slot={slot}
          worth={worths[player.id] ?? player.cash}
          isMe={player.id === session.me}
          isTurn={!!active && active.id === player.id && !player.bankrupt}
          isLeader={leaderId === player.id}
          avatar={avatar}
          dense={dense}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
