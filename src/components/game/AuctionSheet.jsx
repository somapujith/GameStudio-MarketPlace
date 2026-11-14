// Sealed-bid auction of a district (phase 'auction', pending.type 'auction'). Three ways in (auction_start.reason):
//   'bazaar'        the Bazaar Auction square drew a random unowned district (the lander bids like everyone)
//   'decline'       City Takeover: the lander passed on buying it
//   'unaffordable'  City Takeover: the lander could not afford it
// Everyone still in the game places one sealed bid or passes. Opens by itself; a bidder closes it only by bidding or
// passing. "Has bid" ticks come from the redacted `pending.bids` keys (amounts stay secret).
import '@/styles/sheets.css';
import { useEffect, useState } from 'react';
import { TileIcon } from '@/components/art/index.js';
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import PlayerToken from './ui/PlayerToken.jsx';
import { collectionOf, levelNameOf, rentLadder, tileAccent, useHeld } from './ui/helpers.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1000 = (v) => Math.round(v / 1000) * 1000;
const STEP = 5000;

/** One id per auction: the same tile can be auctioned again later, and must not inherit the old "I passed". */
export const auctionInstance = (view, auction) =>
  auction ? `${auction.tile}:${view.round}:${view.turnCount ?? view.turn}:${auction.reason || 'a'}` : null;

/** Why this auction is running: the engine's `pending.reason`, else inferred from the lander. */
export function auctionReason(view, auction) {
  if (!auction) return null;
  if (auction.reason) return auction.reason;
  const lander = view?.players?.[view.turn];
  const landed = lander ? TILES[lander.pos] : null;
  if (landed?.type === 'auction' && landed.id !== auction.tile) return 'bazaar';
  const tile = TILES[auction.tile];
  if (lander && tile && (lander.cash ?? 0) < (tile.price ?? 0)) return 'unaffordable';
  return 'decline';
}

export const AUCTION_LABELS = {
  bazaar: { kicker: 'Bazaar Auction', line: () => 'The bazaar put this district under the hammer. Everyone bids, the lander too.' },
  decline: { kicker: 'City Takeover', line: (who) => `${who} passed on it, so the city auctions it off.` },
  unaffordable: { kicker: 'City Takeover', line: (who) => `${who} could not afford it, so the city auctions it off.` },
};

export default function AuctionSheet({ session }) {
  const { options, view, me } = session;
  const pend = view?.pending;
  const auction = view?.phase === 'auction' && pend?.type === 'auction' ? pend : null;
  const bidOpt = options?.bid || null;
  const instance = auctionInstance(view, auction);

  const [st, setSt] = useState({ key: null, amount: null, sent: null });
  const cur = st.key === instance ? st : { key: instance, amount: null, sent: null };
  const update = (patch) => setSt({ ...cur, ...patch, key: instance });
  useEffect(() => {
    if (!auction) setSt({ key: null, amount: null, sent: null });
  }, [auction]);

  const bids = auction?.bids || {};
  const hasBid = (id) => Object.prototype.hasOwnProperty.call(bids, id);
  const myRecorded = auction && hasBid(me) ? bids[me] : undefined;
  const waiting = !!auction && (myRecorded !== undefined || cur.sent !== null);
  const open = !!auction && (!!bidOpt || waiting);

  const heldTile = useHeld(auction ? auction.tile : null);
  const heldMin = useHeld(bidOpt?.min ?? auction?.minBid ?? null);
  const mineP = view?.players?.find((p) => p.id === me);
  const heldMax = useHeld(bidOpt?.max ?? mineP?.cash ?? null);
  const heldReason = useHeld(auctionReason(view, auction)) || 'decline';

  const tile = heldTile != null ? TILES[heldTile] : null;
  const min = heldMin ?? 0;
  const max = heldMax ?? 0;
  const canBid = max >= min && max > 0;
  const value = clamp(cur.amount ?? min, min, Math.max(min, max));
  const sentAmount = cur.sent !== null ? cur.sent : myRecorded;
  const price = tile?.price ?? min * 2;

  const set = (v) => update({ amount: clamp(round1000(v) || v, min, Math.max(min, max)) });
  const send = (amount) => {
    session.dispatch({ type: 'BID', amount });
    update({ sent: amount });
  };

  const chips = [
    { key: 'min', label: 'Min', apply: () => min, on: value === min },
    { key: 'p10', label: '+10%', apply: () => value + Math.max(1000, round1000(price * 0.1)) },
    { key: 'p25', label: '+25%', apply: () => value + Math.max(1000, round1000(price * 0.25)) },
  ];

  const { color, ink } = tile ? tileAccent(tile) : { color: '#3b2d8f', ink: '#fff' };
  const coll = tile ? collectionOf(tile) : null;
  const bidders = (view?.players || []).filter((p) => !p.bankrupt);
  const others = bidders.filter((p) => p.id !== me);
  const lander = view?.players?.[view?.turn];
  const landerName = lander ? (lander.id === me ? 'You' : lander.name) : 'The lander';
  const label = AUCTION_LABELS[heldReason] || AUCTION_LABELS.decline;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const bidCount = bidders.filter((p) => hasBid(p.id)).length;

  const ticks = (
    <ul className="hg-auction-others" aria-label="Who has bid">
      {others.map((p) => {
        const done = hasBid(p.id);
        return (
          <li key={p.id} className={done ? 'is-done' : ''} style={{ '--pc': p.color }}>
            <PlayerToken player={p} size={28} />
            <span className="hg-auction-oname">{p.name}</span>
            <span className="hg-auction-ostate">
              {done ? <><Icon name="check" size={16} /><small>has bid</small></> : <><Icon name="hourglass" size={16} /><small>thinking</small></>}
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Sheet
      open={open}
      onClose={() => {}}
      dismissible={false}
      ariaLabel={tile ? `${label.kicker} for ${tile.name}` : 'Auction'}
      className="hg-auction"
      desktop="modal"
      header={tile ? (
        <div className="hg-prop-band hg-auction-band" data-drag="" style={{ '--band': color, '--ink': ink }}>
          <span className="hg-prop-icon"><TileIcon tile={tile} size={44} /></span>
          <div className="hg-prop-titles">
            <p className="hg-kicker">{label.kicker} &middot; sealed bids</p>
            <h2>{tile.name}</h2>
          </div>
          <span className="hg-prop-type">{coll ? coll.name : 'District'} &middot; {formatINR(price)}</span>
        </div>
      ) : null}
    >
      {tile ? (
        <>
          <p className={`hg-auction-why is-${heldReason}`}>
            <Icon name={heldReason === 'bazaar' ? 'ticket' : 'info'} size={16} />
            <span>{label.line(landerName)}</span>
          </p>
          {waiting ? (
            <div className="hg-auction-wait" role="status">
              <div className="hg-auction-sealed">
                <Icon name="lock" size={22} />
                <div>
                  <b>{sentAmount > 0 ? `Sealed bid: ${formatINR(sentAmount)}` : 'You passed'}</b>
                  <small>Bids stay secret until everyone has chosen.</small>
                </div>
              </div>
              <p className="hg-auction-waiting">
                Waiting for others ({bidCount}/{bidders.length})<span className="hg-dots" aria-hidden="true"><i /><i /><i /></span>
              </p>
              {ticks}
            </div>
          ) : (
            <div className="hg-auction-form">
              <div className="hg-auction-facts">
                <div><span>Minimum bid</span><b>{formatINR(min)}</b></div>
                <div><span>Your cash</span><b className="is-gold">{formatINR(max)}</b></div>
                <div><span>Base rent</span><b>{formatINR(rentLadder(tile)[0] || 0)}</b><small>{levelNameOf(tile, 0)}</small></div>
              </div>

              {canBid ? (
                <>
                  <div className="hg-auction-amount" aria-live="polite">
                    <span>Your sealed bid</span>
                    <output>{formatINR(value)}</output>
                  </div>

                  <div className="hg-bidrow" role="group" aria-label="Adjust bid">
                    <Button variant="dark" onClick={() => set(value - STEP)} aria-label={`Decrease by ${formatINR(STEP)}`} disabled={value <= min}>&minus;5k</Button>
                    <input
                      className="hg-range"
                      type="range"
                      min={min}
                      max={max}
                      step={1000}
                      value={value}
                      onChange={(e) => update({ amount: Number(e.target.value) })}
                      aria-label="Bid amount"
                      style={{ '--pct': `${pct}%` }}
                    />
                    <Button variant="dark" onClick={() => set(value + STEP)} aria-label={`Increase by ${formatINR(STEP)}`} disabled={value >= max}>+5k</Button>
                  </div>

                  <div className="hg-bidchips" role="group" aria-label="Quick bids">
                    {chips.map((c) => {
                      const next = clamp(c.apply(), min, max);
                      return (
                        <button
                          key={c.key}
                          type="button"
                          className={`hg-bidchip${c.on ? ' is-on' : ''}`}
                          disabled={c.key !== 'min' && value >= max}
                          onClick={() => update({ amount: next })}
                        >
                          <span>{c.label}</span>
                          <b>{formatINR(next)}</b>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="hg-hint is-warn hg-auction-poor">
                  <Icon name="info" size={16} /> You cannot afford the minimum bid of {formatINR(min)}.
                </p>
              )}

              {others.length ? ticks : null}

              <div className="hg-auction-actions">
                <Button variant="dark" size="lg" disabled={session.busy} onClick={() => send(0)}>Pass</Button>
                <Button variant="gold" size="lg" disabled={!canBid || session.busy} onClick={() => send(value)}>
                  Place bid{canBid ? <> &middot; {formatINR(value)}</> : null}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </Sheet>
  );
}
