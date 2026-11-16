import { useState } from 'react';
import Seat, { EmptySeat } from '@/components/online/Seat.jsx';
import { joinedLabel, pieceOf, seatColor } from '@/components/online/lobbyModel.js';
import { sameId } from '@/components/online/gameHelpers.js';
import { SEAT_W, ringAspect, ringSlots, seatHeight } from '@/components/online/seatLayout.js';
import '@/styles/lobby-seats.css';

const INTRO_STAGGER_MS = 45; // the seats that are there when the page opens settle in one after another

/**
 * "Around the table": the lobby's seats card (header + joined count, the table with one Seat per player and an
 * EmptySeat for each open seat). >= 480px wide the seats sit around an oval table, narrower they are a 2-column grid.
 *
 * Props (all supplied by pages/Lobby.jsx):
 *  seats        [{ key, player, leaving }]  from useRoster(players)
 *  players      room.players (current, without leaving seats), used for the stable seat colour index
 *  room         the room snapshot ({ hostId, ... })
 *  user         the signed-in user ({ id, isGuest, ... })
 *  game         the game manifest (for seatColor)
 *  pieces       manifest pieces, choices = pieceChoices(...) (length > 0 means pieces are on), myPiece = my optimistic piece id
 *  joined, maxPlayers, emptySeats, full   seat counts
 *  isHost, open  I am the host / the socket is connected
 *  onKick(player)  host asked to remove a player (the lobby shows the confirm dialog)
 *  onInvite()      an empty seat was tapped (the lobby scrolls to the invite panel)
 */
export default function SeatsCard({ seats, players, room, user, game, pieces, choices, myPiece, joined, maxPlayers, emptySeats, full, isHost, open, onKick, onInvite }) {
  // Seats that are already here on first paint get a staggered intro; anyone who arrives later gets the join pop right away.
  const [intro] = useState(() => new Set(seats.map((s) => s.key)));
  // Slots stay put while a leaving seat fades (it holds its place); only the empty seats make room for it.
  const empties = Math.max(0, joined + emptySeats - seats.length);
  const n = Math.max(2, seats.length + empties);
  const slots = ringSlots(n);
  const slotOf = (i, key) => ({ ...slots[i], delay: key != null && intro.has(key) ? i * INTRO_STAGGER_MS : 0 });
  const height = seatHeight(n);

  return (
    <section className="lt sr-o-seats" aria-label="Players" data-tour="lobby-seats">
      <header className="lt__head">
        <h2 className="lt__title">Around the table</h2>
        <span className={`lt__count${full ? ' is-full' : ''}`} aria-live="polite">
          {joinedLabel(joined, maxPlayers)}
        </span>
      </header>
      <div className="lt__table" data-n={n} style={{ '--lt-aspect': ringAspect(n), '--lt-w': `${SEAT_W}px`, '--lt-h': `${height}px` }}>
        <div className="lt__felt" aria-hidden="true">
          <span className="lt__tally">
            <b className="lt__tally-n" key={joined}>
              {joined}
            </b>
            <span className="lt__tally-max">{` / ${maxPlayers}`}</span>
          </span>
          <span className="lt__label">Your table</span>
        </div>
        <ul className="lt__seats">
          {seats.map(({ key, player: p, leaving }, idx) => {
            const me = sameId(p.id, user.id);
            const i = players.findIndex((q) => sameId(q.id, p.id));
            return (
              <Seat
                key={key}
                player={p}
                piece={pieceOf(me ? { ...p, piece: myPiece } : p, pieces)}
                piecesOn={choices.length > 0}
                color={seatColor(game, i < 0 ? 0 : i)}
                isMe={me}
                isHost={sameId(p.id, room.hostId)}
                canRemove={isHost && !me && open && !leaving}
                leaving={leaving}
                friendable={!user.isGuest}
                slot={slotOf(idx, key)}
                onRemove={() => onKick(p)}
              />
            );
          })}
          {Array.from({ length: empties }, (_, e) => (
            <EmptySeat key={`empty-${e}`} onInvite={onInvite} slot={slotOf(seats.length + e, null)} />
          ))}
        </ul>
      </div>
    </section>
  );
}
