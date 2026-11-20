// The bidding screen (phase 'auction', pending.type 'auction'): a phone bottom sheet / desktop modal, one component tree.
//   header   the district as a mini deed (collection colour band, business art, price, base rent, minimum bid), the reason
//            in plain words and a countdown ring over cfg.auctionSeconds
//   strip    every eligible player with a status: thinking / Bid in / Not bidding (a pass reads "Bid in" while sealed)
//   me       amount + steppers + slider + quick chips + advice + Place bid / Pass; after sending: a locked card
//   others   observers and non-eligible players: the strip, the ring and "Bidding is private"
//   reveal   on `auction_end` (the presenter's `session.auctionResult`, held for ANIM_MS.auctionEnd): bid cards flip lowest to
//            highest, the winner slams in last. The sheet stays open for it although the phase has already moved on.
// Two reasons (auction_start.reason): 'bazaar' and 'snatch' (only the snatchers bid).
// Pure logic and wording live in auction/auctionModel.js.
import '@/styles/sheets.css';
import '@/styles/auction.css';
import { useEffect, useRef, useState } from 'react';
import { TileIcon } from '@/components/art/index.js';
import LocationScene from '@/components/art/LocationScene.jsx';
import { buzz } from '@/lib/haptics.js';
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import { bandTones, bestInk } from './PropertySheet.jsx';
import { collectionOf, rentLadder, tileAccent, useHeld, useReducedMotion } from './ui/helpers.js';
import AuctionRing from './auction/AuctionRing.jsx';
import BidderStrip from './auction/BidderStrip.jsx';
import BidControls, { BidActions } from './auction/BidControls.jsx';
import RevealStage from './auction/RevealStage.jsx';
import {
  AUCTION_KICKERS, kickerOf, REVEAL_MS, auctionInstance, auctionReason, auctionRole, bidderRows, bidInIds, eligibleIds, observerReason, privacyLine,
  reasonLine, resultKey, setImpact, waitingLine,
} from './auction/auctionModel.js';

export { auctionInstance, auctionReason };

/** Kept for callers of the old sheet: the kicker + line per reason. */
export const AUCTION_LABELS = Object.fromEntries(
  Object.keys(AUCTION_KICKERS).map((k) => [k, { kicker: AUCTION_KICKERS[k], line: (who) => reasonLine(k, who) }]),
);

const SEND_TIMEOUT_MS = 6000;

/** `on`, but it stays true for `ms` after it goes false (a result takes a beat to arrive after the auction closes). */
function useLinger(on, ms) {
  const [lingering, setLingering] = useState(!!on);
  useEffect(() => {
    if (on) {
      setLingering(true);
      return undefined;
    }
    const t = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on || lingering;
}

export default function AuctionSheet({ session }) {
  const { view, me } = session;
  const pend = view?.pending;
  const auction = view?.phase === 'auction' && pend?.type === 'auction' ? pend : null;
  const result = session.auctionResult || null;
  const reduced = useReducedMotion();
  const instance = auctionInstance(view || {}, auction);

  // ---- my local state per auction: the amount, and the bid I just sent (before the server confirms it)
  const [st, setSt] = useState({ key: null, amount: null, sent: null, err: '' });
  const cur = st.key === instance ? st : { key: instance, amount: null, sent: null, err: '' };
  const update = (patch) => setSt({ ...cur, ...patch, key: instance });
  useEffect(() => {
    if (!auction) setSt({ key: null, amount: null, sent: null, err: '' });
  }, [auction]);

  // the sheet opens once the presenter has finished announcing the auction (busy -> idle), then stays for it
  const [ready, setReady] = useState(null);
  const readyNow = !!auction && (!session.busy || !!session.options?.bid);
  if (readyNow && ready !== instance) setReady(instance);
  const live = useLinger(!!auction && ready === instance, 700);

  const heldAuction = useHeld(auction);
  const heldInstance = useHeld(instance);
  const heldResult = useHeld(result);
  const [dismissed, setDismissed] = useState(null);
  const [hiddenKey, setHiddenKey] = useState(null); // an observer may close the panel; the reveal still opens

  const players = view?.players || [];
  const sentNow = cur.sent !== null;
  const roleNow = heldAuction ? auctionRole({ pending: heldAuction, players, me, sent: sentNow }) : 'observer';
  const observer = roleNow === 'observer';

  const rkey = resultKey(result);
  const showReveal = !!result && dismissed !== rkey;
  const showBidding = !showReveal && live && !!heldAuction && !(observer && hiddenKey === heldInstance);
  const open = showReveal || showBidding;
  const dismissible = showReveal || observer;
  // while the sheet slides away it keeps showing what it showed (a reveal must not flash the bidding form on the way out)
  const modeRef = useRef('bid');
  if (open) modeRef.current = showReveal ? 'reveal' : 'bid';
  const revealMode = open ? showReveal : modeRef.current === 'reveal' && !!heldResult;

  // a bid I sent that the server never confirmed (rejected, or lost): unlock after a while
  const confirmed = !!auction && bidInIds(auction).includes(me);
  useEffect(() => {
    if (!auction || cur.sent === null || confirmed) return undefined;
    const t = setTimeout(() => setSt((s) => (s.sent === null ? s : { ...s, sent: null, err: 'Your bid did not go through. Try again.' })), SEND_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [auction, cur.sent, confirmed]);

  // ---- what to draw
  const shown = revealMode ? heldResult : heldAuction;
  const tile = shown && TILES[shown.tile] ? TILES[shown.tile] : null;
  const reason = revealMode ? heldResult?.reason || 'open' : auctionReason(view, heldAuction) || 'open';
  const snatch = reason === 'snatch' || !!heldAuction?.snatch;
  const mine = players.find((p) => p.id === me);
  const cash = Number(mine?.cash) || 0;
  const min = Number(heldAuction?.minBid ?? session.options?.bid?.min) || 0;
  const price = tile?.price ?? min * 2;
  const cfg = view?.cfg || {};
  const rows = heldAuction ? bidderRows({ players, pending: heldAuction, me, sent: sentNow }) : [];
  const role = roleNow;
  const lander = snatch ? players.find((p) => p.id === (heldAuction?.buyer ?? heldResult?.buyer)) : players[view?.turn];
  const who = lander ? (lander.id === me ? 'You' : lander.name) : snatch ? 'The buyer' : 'The lander';
  const { color } = tile ? tileAccent(tile) : { color: '#3b2d8f' };
  const tones = bandTones(color);
  const coll = tile ? collectionOf(tile) : null;
  const baseRent = tile ? rentLadder(tile, cfg)[0] || 0 : 0;
  const amount = Math.min(Math.max(cur.amount ?? min, min), Math.max(min, cash));
  const myRecorded = heldAuction && heldAuction.bids ? heldAuction.bids[me] : undefined;
  const myAmount = cur.sent !== null ? cur.sent : myRecorded || 0;
  const impact = tile && role === 'bidder' ? setImpact({ tileId: tile.id, owners: view?.owners, me, players }) : null;
  const winner = revealMode && heldResult && heldResult.winner != null ? players.find((p) => p.id === heldResult.winner) : null;
  const kicker = kickerOf(reason);
  const poor = role === 'observer' && !!heldAuction && observerReason({ pending: heldAuction, me, cash, min }) === 'poor';
  // who could bid in the auction that just ended (so the "Passed" row never lists players who were out of it)
  const revealOnly = revealMode && heldAuction && heldResult && heldAuction.tile === heldResult.tile ? eligibleIds(heldAuction, players) : null;

  const send = (value) => {
    buzz('tap');
    session.dispatch({ type: 'BID', amount: value });
    update({ sent: value, err: '' });
  };
  const close = () => {
    if (showReveal) setDismissed(rkey);
    else if (observer) setHiddenKey(heldInstance);
  };

  const header = tile ? (
    <div
      className={`hga-band${dismissible ? ' has-x' : ''}`}
      data-drag=""
      style={{ '--band': color, '--ink': tones.ink, '--b1': tones.from, '--b2': tones.to, '--pill': tones.pill }}
    >
      <span className="hga-ico"><TileIcon tile={tile} size={42} /></span>
      <div className="hga-titles">
        <p className="hga-kicker">{kicker}{coll ? <> &middot; {coll.name}</> : null}</p>
        <h2>{tile.name}</h2>
      </div>
      {revealMode ? (
        winner ? (
          <span className="hga-flag" style={{ '--pc': winner.color, '--flag-ink': bestInk(winner.color), '--at': '700ms' }} aria-label={`${winner.name} owns it now`}><Icon name="flag" size={22} /></span>
        ) : null
      ) : (
        <AuctionRing clock={session.clock} cfg={cfg} windowMs={heldAuction?.ms} on={showBidding} />
      )}
    </div>
  ) : null;

  const stage = tile ? (
    <div className={`hga-stage${winner ? ' is-sold' : ''}`} style={{ '--band': color, ...(winner ? { '--win': winner.color } : null) }}>
      <LocationScene key={tile.id} tile={tile} level={0} animated={false} />
      <div className="hga-facts">
        <span><i>Price</i><b>{formatINR(price)}</b></span>
        <span><i>Base rent</i><b>{formatINR(baseRent)}</b></span>
        {revealMode ? (
          <span className="is-min"><i>{winner ? 'Sold for' : 'Result'}</i><b>{winner ? formatINR(heldResult?.amount) : 'Unsold'}</b></span>
        ) : (
          <span className="is-min"><i>Minimum bid</i><b>{formatINR(min)}</b></span>
        )}
      </div>
    </div>
  ) : null;

  let body = null;
  if (tile && revealMode && heldResult) {
    body = (
      <>
        <RevealStage key={rkey} end={heldResult} players={players} me={me} tileName={tile.name} ms={heldResult.ms || REVEAL_MS} reduced={reduced} only={revealOnly} />
        <div className="hga-close">
          <Button variant="dark" size="md" onClick={close}>Close</Button>
          <small>Tap the cards to skip</small>
        </div>
      </>
    );
  } else if (tile && heldAuction) {
    body = (
      <>
        <p className={`hga-why is-${reason}`}>
          <Icon name={reason === 'bazaar' ? 'ticket' : 'info'} size={16} />
          <span>{reasonLine(reason, who)}</span>
        </p>
        <BidderStrip rows={rows} players={players} me={me} />
        {role === 'bidder' ? (
          <BidControls
            min={min}
            cash={cash}
            price={price}
            value={amount}
            onValue={(v) => update({ amount: v })}
            impact={impact}
            error={cur.err}
          />
        ) : role === 'locked' ? (
          <div className="hga-locked" role="status">
            <div className="hga-lockcard">
              <Icon name="lock" size={24} />
              <div>
                <b>{myAmount > 0 ? <>Your bid is in &middot; {formatINR(myAmount)} <em>(sealed)</em></> : 'You passed'}</b>
                <small>No way to change it. Bids open together.</small>
              </div>
            </div>
            <p className="hga-wait">{waitingLine(rows, me)}</p>
          </div>
        ) : (
          <p className="hga-private" role="status">
            <Icon name="lock" size={18} />
            <span>{privacyLine('observer', { snatch, tileName: tile.name, poor, min })}</span>
          </p>
        )}
        {role === 'locked' ? <p className="hga-fine">{privacyLine(role)}</p> : null}
      </>
    );
  }

  return (
    <Sheet
      open={open && !!tile}
      onClose={close}
      dismissible={dismissible}
      ariaLabel={tile ? `${kicker} for ${tile.name}` : 'Auction'}
      className="hg-auction hga"
      desktop="modal"
      header={header}
      footer={!revealMode && role === 'bidder' && showBidding ? (
        <BidActions min={min} cash={cash} value={amount} onBid={send} onPass={() => send(0)} busy={!!session.busy} />
      ) : null}
    >
      {tile ? (
        <>
          {stage}
          {body}
        </>
      ) : null}
    </Sheet>
  );
}
