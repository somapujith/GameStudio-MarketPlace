// Players around the board: every player's avatar and cash sits at a corner of the table instead of in a scoreboard list.
//   you are always bottom-left (next to START); the others follow clockwise: top-left, top-right, bottom-right.
//   5-6 players also use the two middle edges (left, right).
// Your own cash is the big, bold figure (gold, with a "Your cash" label); the others show theirs smaller.
// Each pod is a button (-> onSelect(playerId)) and its avatar carries `data-fx-player` (coins fly to / from it).
// The pods are direct grid children of .hg-table (the <ul> is `display: contents`): see the layout in game.css / pods.css.
//
// Phones get a different arrangement (`mode` picks which pods a <PlayerPods> renders):
//   portrait:  the opponents as a row / grid of cards ABOVE the board (`mode="others"`, card shapes from `cellFor`), and
//              your own pod as a full-width "wallet bar" in the bottom stack, right above the action dock (`mode="me"`)
//   landscape: the opponents stacked in a column left of the board, your wallet bar above the actions on the right
// Compact pods keep the avatar, name and cash only; chai / traffic become small badges on the avatar.
import { useEffect, useRef, useState } from 'react';
import { compactINR, formatINR } from '@shared/format.js';
import Money from './ui/Money.jsx';
import { activePlayer, useWorths } from './ui/helpers.js';
import { useLayoutMode } from './ui/viewport.js';
import { ChaiToken, PlayerAvatar, TrafficTag, OfflineTag, rowLabel } from './MoneyBar.jsx';
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

/** True when the table needs the middle edges (5+ players). */
export const usesMiddleEdges = (count) => count >= 5;

/** Shrink factor for long amounts so they never overflow the pod: "₹11,15,000" = 1, "₹1,11,50,000" = 0.8. */
export function fitFor(cash) {
  const len = formatINR(Number(cash) || 0).length;
  return len <= 10 ? 1 : len === 11 ? 0.9 : 0.8;
}

/**
 * Compact pods (phones) keep the cash at its full 16px+ size up to "₹1,11,50,000" (12 characters) and only shrink
 * beyond that. The scale factor for the figure: 1 for everything a table can realistically reach.
 */
export function fitCompact(cash) {
  const len = formatINR(Number(cash) || 0).length;
  return len <= 12 ? 1 : len === 13 ? 0.9 : 0.8;
}

/** Which pods a <PlayerPods mode> shows: 'me' (just the viewer), 'others' (everyone else; all of them for a spectator), 'all'. */
export function podsFor(slots, meId, mode = 'all') {
  if (mode === 'me') return slots.filter((x) => x.player.id === meId);
  if (mode === 'others') return slots.filter((x) => x.player.id !== meId);
  return slots;
}

/**
 * Portrait phone: the card shape of opponent `index` of `count`.
 *   1 -> [wide]; 2 -> [wide, wide]; 3 -> [narrow x3]; 4 -> 2 x 2 wide; 5 -> 3 narrow, then 2 wide.
 * 'wide' cards (avatar left, name over cash) are ~180px; 'narrow' (avatar + name over the cash) ~110px.
 */
export function cellFor(count, index) {
  if (count <= 2 || count === 4) return 'wide';
  if (count === 3) return 'narrow';
  return index < 3 ? 'narrow' : 'wide';
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

function Pod({ session, player, slot, cell, worth, isMe, isTurn, isLeader, avatar, compact, onSelect }) {
  const offline = !isConnected(session, player.id) && !player.bankrupt;
  const mood = useCashMood(player.cash);
  const title = cosmeticsOf(session, player.id).title;
  const cls = ['hg-pod', isMe && 'is-me', isTurn && 'is-turn', isLeader && !player.bankrupt && 'is-leader', player.bankrupt && 'is-out', offline && 'is-offline'].filter(Boolean).join(' ');
  const label = rowLabel({ player, worth, isMe, isTurn, isLeader, offline });
  const badges = compact && !player.bankrupt && (player.stuck || player.chai > 0);
  return (
    <li
      className={cls}
      data-slot={slot}
      data-cell={cell}
      style={{ '--pc': player.color, '--fit': fitFor(player.cash), '--fitc': fitCompact(player.cash) }}
      data-turn={isTurn ? '' : undefined}
    >
      <button type="button" className="hg-pod__btn" onClick={() => onSelect?.(player.id)} aria-label={label}>
        <span className="hg-pod__ava">
          <PlayerAvatar session={session} player={player} size={isMe && !compact ? avatar + 8 : avatar} offline={offline} turn={isTurn && !offline} leader={isLeader} mood={mood} live />
          {badges ? (
            <span className="hg-pod__badges" aria-hidden="true">
              {player.stuck ? <TrafficTag /> : null}
              <ChaiToken count={player.chai} hideEmpty />
            </span>
          ) : null}
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
                {isTurn && !offline ? <span className="hg-pod__turn">{isMe && compact ? 'Your turn' : 'Turn'}</span> : null}
                {offline && !compact ? <OfflineTag /> : null}
                {player.stuck && !compact ? <TrafficTag /> : null}
                {compact ? null : <ChaiToken count={player.chai} hideEmpty />}
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

/**
 * <PlayerPods session onSelect={(playerId) => void} mode?="all" | "others" | "me" />
 * `mode` only matters on phones (portrait / landscape render the opponents and your wallet bar separately).
 * `layout` ('wide' | 'phone' | 'land') defaults to the screen's; GameView passes its own so both agree.
 */
export default function PlayerPods({ session, onSelect, mode = 'all', layout: layoutProp }) {
  const { worths, leaderId, state } = useWorths(session);
  const active = (session.display?.phase ?? session.view?.phase) === 'over' ? null : activePlayer(session);
  const own = useLayoutMode();
  const layout = layoutProp || own;
  const compact = layout !== 'wide';
  const all = podSlots(state.players, session.me);
  const shown = compact ? podsFor(all, session.me, mode) : all;
  const others = podsFor(all, session.me, 'others');
  return (
    <ul className={`hg-pods${compact && mode === 'me' ? ' hg-pods--me' : ''}`} role="list" aria-label={compact && mode === 'me' ? 'Your wallet' : 'Players'}>
      {shown.map(({ player, slot }) => {
        const isMe = player.id === session.me;
        const at = others.findIndex((x) => x.player.id === player.id);
        const cell = !compact ? undefined : isMe ? 'wallet' : layout === 'land' ? 'side' : cellFor(others.length, at);
        return (
          <Pod
            key={player.id}
            session={session}
            player={player}
            slot={slot}
            cell={cell}
            worth={worths[player.id] ?? player.cash}
            isMe={isMe}
            isTurn={!!active && active.id === player.id && !player.bankrupt}
            isLeader={leaderId === player.id}
            avatar={!compact ? 42 : cell === 'wallet' ? 44 : 36}
            compact={compact}
            onSelect={onSelect}
          />
        );
      })}
    </ul>
  );
}
