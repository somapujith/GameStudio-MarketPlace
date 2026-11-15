// Players under the board, as plain as a two-player board game: no boxes, no borders. Each player is a COLUMN on the dark
// table: the avatar (the decision timer is an arc around the one who is playing) with their piece token on its OUTER side
// (white-rimmed disc; left column: token left of the avatar, right column: token right of it), under it a name row (the
// connection bars, then the name), under that one line "cash (net worth)" (cash white, net worth green; you: gold cash), or a
// red "Forfeit" / "Bankrupt" for a player who is out. A small "Your turn" / "Turn" pill hangs under the avatar of whoever
// is playing; a very thin line under the money shows how far the net worth is towards the target (only when the table has one).
// 1-2 players side by side, 3-4 in a two-column grid, 5-6 in a compact three-column grid; the others in turn order, you last
// (bottom right, next to your thumb). Every avatar carries `data-fx-player` (coins fly to it), a tap opens the player sheet.
import { useEffect, useRef, useState } from 'react';
import { compactINR, formatINR } from '@shared/format.js';
import Money from '../ui/Money.jsx';
import { activePlayer, useMedia, useWorths } from '../ui/helpers.js';
import { PlayerAvatar, ChaiToken, TrafficTag, rowLabel } from '../MoneyBar.jsx';
import { PieceToken } from '../Pawn.jsx';
import { bestInk } from '../PropertySheet.jsx';
import { roomPlayer } from '../turn/room.js';
import SignalBars, { SignalPill } from '../ui/SignalBars.jsx';
import SnatchChip from '../ui/SnatchChip.jsx';
import { snatchChipsOn, snatchCount } from '../snatch.js';
import { pillText, signalOf, signalWords } from '../ui/signalModel.js';
import { useNetStats } from '@/lib/netStats.js';
import { podTarget, targetOf } from '../turn/target.js';
import { cashChars, cellSides, cellSpans, gridFor, orderPlayers, outWord, playerSizes, resignedOf } from './phoneModel.js';

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

function Cell({ session, player, span, side, density, sizes, avaH, worth, isMe, isTurn, isLeader, target, local, snatchOn, onSelect }) {
  // Presence is the connection-strength indicator (ui/SignalBars): bars beside the name, the "Offline" / "Reconnecting…"
  // pill in the slot under the avatar (where the turn pill sits; a player who is away is not "on turn" anyway).
  const sig = player.bankrupt ? { kind: 'none' } : signalOf(roomPlayer(session, player.id), { isMe, local });
  const pill = pillText(sig);
  const offline = sig.kind === 'offline' && !player.bankrupt;
  const mood = useCashMood(player.cash);
  const goal = podTarget({ worth, target, isMe, isLeader, bankrupt: player.bankrupt });
  const out = !!player.bankrupt;
  const forfeit = out && resignedOf(session, player, isMe);
  const size = isMe ? sizes.me : sizes.avatar;
  const tokens = snatchOn && !player.bankrupt ? snatchCount(player) : null; // Snatch buttons: a bolt chip on the piece token
  const worthText = `(${compactINR(worth)})`;
  const label = [
    out ? `${player.name}${isMe ? ' (you)' : ''}, ${forfeit ? 'forfeited' : 'bankrupt'}` : rowLabel({ player, worth, isMe, isTurn, isLeader, offline: false }),
    signalWords(sig), goal?.sr, tokens !== null ? `${tokens} Snatch ${tokens === 1 ? 'button' : 'buttons'}` : '',
  ].filter(Boolean).join(', ');
  const cls = ['pp', `pp--${density}`, `pp--${side}`, tokens !== null && 'has-sn', isMe && 'is-me', isTurn && 'is-turn', isLeader && !out && 'is-leader', out && 'is-out', offline && 'is-offline', goal && 'has-goal', goal?.hot && 'is-hot']
    .filter(Boolean).join(' ');
  // The avatar is the anchor of the column: a left cell hangs its token on the avatar's left, the others on its right; the
  // empty track on the other side keeps the avatar (and the name and money under it) centred in the column. Chai / traffic
  // badges live in that empty track.
  const tokenEl = (
    <span className="pp__piece">
      <span className="pp__disc"><PieceToken piece={player.piece} color="#ffffff" size={sizes.piece} base={false} className="pp__glyph" /></span>
      {tokens !== null ? <SnatchChip count={tokens} className="pp__sn" /> : null}
    </span>
  );
  const avaEl = (
    <span className="pp__ava">
      <PlayerAvatar session={session} player={player} size={size} offline={offline} turn={isTurn && !offline} leader={isLeader} mood={mood} live />
    </span>
  );
  const badgeEl = !out && (player.stuck || player.chai > 0) ? (
    <span className="pp__badges" aria-hidden="true">
      {player.stuck ? <TrafficTag /> : null}
      <ChaiToken count={player.chai} hideEmpty />
    </span>
  ) : null;
  return (
    <li
      className={cls}
      style={{
        '--pc': player.color, '--span': span, '--ava': `${size}px`, '--ava-h': `${avaH}px`, '--chars': cashChars(player.cash), '--wchars': worthText.length, '--pill-ink': bestInk(player.color),
      }}
      data-turn={isTurn ? '' : undefined}
      data-span={span}
      data-side={side}
    >
      <button type="button" className="pp__btn" onClick={() => onSelect?.(player.id)} aria-label={label}>
        <span className="pp__id">
          {side === 'left' ? <>{tokenEl}{avaEl}{badgeEl}</> : <>{badgeEl}{avaEl}{tokenEl}</>}
          <span className="pp__slot">
            {pill ? <SignalPill kind={sig.kind} /> : isTurn && !offline && !out ? <span className="pp__turn" aria-hidden="true">{isMe && (density === 'roomy' || span === 6) ? 'Your turn' : 'Turn'}</span> : null}
          </span>
        </span>
        <span className="pp__name">
          <SignalBars {...sig} size="sm" pill={false} className="pp__sig" />
          <b title={player.name}>{player.name}</b>
        </span>
        {out ? (
          <span className="pp__out">{outWord(forfeit)}</span>
        ) : (
          <span className="pp__cash" title={`Net worth ${formatINR(worth)}`}>
            <Money value={player.cash} flash className="pp__amt" />
            <small className="pp__worth">{worthText}</small>
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
  const snatchOn = snatchChipsOn(session); // draw the Snatch chips at all?
  const list = orderPlayers(state.players, session.me);
  const grid = gridFor(list.length);
  const spans = cellSpans(list.length);
  const sides = cellSides(list.length);
  const sizes = playerSizes(grid.density, short);
  // The avatar row of the row you are in is as tall as your (bigger) avatar in every column, so the names and money line up
  // across it; the other rows only need the plain avatar size.
  const meRow = Math.floor(list.findIndex((p) => p.id === session.me) / grid.cols);
  const rowStyle = { '--pw': `${sizes.piece}px` };
  return (
    <ul className="pp-list" role="list" aria-label="Players" data-n={list.length} data-density={grid.density} data-cols={grid.cols} style={rowStyle}>
      {list.map((player, i) => (
        <Cell
          key={player.id}
          session={session}
          player={player}
          span={spans[i]}
          side={sides[i]}
          density={grid.density}
          sizes={sizes}
          avaH={Math.floor(i / grid.cols) === meRow ? sizes.me : sizes.avatar}
          worth={worths[player.id] ?? player.cash}
          isMe={player.id === session.me}
          isTurn={!!active && active.id === player.id && !player.bankrupt}
          isLeader={leaderId === player.id}
          target={target}
          local={local}
          snatchOn={snatchOn}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
