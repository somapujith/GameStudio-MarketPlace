// Players under the board, as in a simple two-player table: each player is an avatar (with the decision timer on the one
// who is playing), their piece beside it, a name with a presence mark, and one line "cash (net worth)". A "Your turn" pill
// sits under the avatar of whoever is playing. 1-2 players side by side, 3-4 in a two-column grid, 5-6 in a compact
// three-column grid; the others in turn order, you last (bottom right, next to your thumb).
// Every avatar carries `data-fx-player` (coins fly to it), a tap opens the player sheet.
import { useEffect, useRef, useState } from 'react';
import { compactINR, formatINR } from '@shared/format.js';
import Money from '../ui/Money.jsx';
import { activePlayer, useMedia, useWorths } from '../ui/helpers.js';
import { PlayerAvatar, ChaiToken, TrafficTag, rowLabel } from '../MoneyBar.jsx';
import { PieceToken } from '../Pawn.jsx';
import { bestInk } from '../PropertySheet.jsx';
import { roomPlayer } from '../turn/room.js';
import SignalBars, { SignalPill } from '../ui/SignalBars.jsx';
import { pillText, signalOf, signalWords } from '../ui/signalModel.js';
import { useNetStats } from '@/lib/netStats.js';
import { podTarget, targetOf } from '../turn/target.js';
import { cashChars, cellSpans, gridFor, orderPlayers } from './phoneModel.js';

const AVATAR = { roomy: 46, row: 40, compact: 32 };
const PIECE = { roomy: 34, row: 30, compact: 26 };
// short screens (iPhone SE and smaller): everything a little tighter so the board keeps its size
const AVATAR_SHORT = { roomy: 40, row: 36, compact: 30 };
const PIECE_SHORT = { roomy: 30, row: 26, compact: 24 };

/** 'up' | 'down' for a second after the player's cash changes (drives the avatar's reaction), else ''. */
function useCashMood(cash) {
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

function Cell({ session, player, span, density, short, worth, isMe, isTurn, isLeader, target, local, onSelect }) {
  // Presence is the connection-strength indicator (ui/SignalBars): bars beside the name, the "Offline" / "Reconnecting…"
  // pill in the slot under the avatar (where the turn pill sits; a player who is away is not "on turn" anyway).
  const sig = player.bankrupt ? { kind: 'none' } : signalOf(roomPlayer(session, player.id), { isMe, local });
  const pill = pillText(sig);
  const offline = sig.kind === 'offline' && !player.bankrupt;
  const mood = useCashMood(player.cash);
  const goal = podTarget({ worth, target, isMe, isLeader, bankrupt: player.bankrupt });
  const out = !!player.bankrupt;
  const size = (short ? AVATAR_SHORT : AVATAR)[density];
  const pieceSize = (short ? PIECE_SHORT : PIECE)[density];
  const label = [rowLabel({ player, worth, isMe, isTurn, isLeader, offline: false }), signalWords(sig), goal?.sr].filter(Boolean).join(', ');
  const cls = ['pp', `pp--${density}`, isMe && 'is-me', isTurn && 'is-turn', isLeader && !out && 'is-leader', out && 'is-out', offline && 'is-offline', goal && 'has-goal', goal?.hot && 'is-hot']
    .filter(Boolean).join(' ');
  return (
    <li
      className={cls}
      style={{ '--pc': player.color, '--span': span, '--chars': cashChars(player.cash), '--pill-ink': bestInk(player.color), '--idw': `${size + 8}px` }}
      data-turn={isTurn ? '' : undefined}
      data-span={span}
    >
      <button type="button" className="pp__btn" onClick={() => onSelect?.(player.id)} aria-label={label}>
        <span className="pp__id">
          <span className="pp__row">
            <span className="pp__ava">
              <PlayerAvatar session={session} player={player} size={size} offline={offline} turn={isTurn && !offline} leader={isLeader} mood={mood} live />
            </span>
            <span className="pp__piece"><PieceToken piece={player.piece} color={player.color} size={pieceSize} /></span>
            {!out && (player.stuck || player.chai > 0) ? (
              <span className="pp__badges" aria-hidden="true">
                {player.stuck ? <TrafficTag /> : null}
                <ChaiToken count={player.chai} hideEmpty />
              </span>
            ) : null}
          </span>
          <span className="pp__slot">
            {pill ? <SignalPill kind={sig.kind} /> : isTurn && !offline && !out ? <span className="pp__turn" aria-hidden="true">{isMe && (density === 'roomy' || span === 6) ? 'Your turn' : 'Turn'}</span> : null}
          </span>
        </span>
        <span className="pp__name">
          <SignalBars {...sig} size="sm" pill={false} className="pp__sig" />
          <b title={player.name}>{player.name}</b>
        </span>
        {out ? (
          <span className="pp__out">{isMe && session.resigned ? 'Resigned' : 'Bankrupt'}</span>
        ) : (
          <span className="pp__cash" title={`Net worth ${formatINR(worth)}`}>
            <Money value={player.cash} flash className="pp__amt" />
            <small className="pp__worth">({compactINR(worth)})</small>
          </span>
        )}
        {goal ? (
          <span className={`pp__goal${goal.hot ? ' is-hot' : ''}${goal.lead ? ' is-lead' : ''}`} style={{ '--tp': goal.frac.toFixed(3) }} aria-hidden="true" data-pct={goal.pct}>
            <i />
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** <PhonePlayers session onSelect={(playerId) => void} /> */
export default function PhonePlayers({ session, onSelect }) {
  const { worths, leaderId, state } = useWorths(session);
  const target = targetOf(session.display?.cfg || session.view?.cfg);
  const active = (session.display?.phase ?? session.view?.phase) === 'over' ? null : activePlayer(session);
  const short = useMedia('(max-height: 700px)');
  const local = useNetStats(); // your own measured connection (live), for your own cell
  const list = orderPlayers(state.players, session.me);
  const grid = gridFor(list.length);
  const spans = cellSpans(list.length);
  return (
    <ul className="pp-list" role="list" aria-label="Players" data-n={list.length} data-density={grid.density} data-cols={grid.cols}>
      {list.map((player, i) => (
        <Cell
          key={player.id}
          session={session}
          player={player}
          span={spans[i]}
          density={grid.density}
          short={short}
          worth={worths[player.id] ?? player.cash}
          isMe={player.id === session.me}
          isTurn={!!active && active.id === player.id && !player.bankrupt}
          isLeader={leaderId === player.id}
          target={target}
          local={local}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
