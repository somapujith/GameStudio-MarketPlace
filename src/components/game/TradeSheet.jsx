// Trading. One default export that renders three states from the session:
//   composer  (opened from the control panel's Trade tab)      -> { type:'TRADE_OFFER', to, give, get }
//   waiting   (my offer is outstanding: view.trade.from === me) -> { type:'TRADE_CANCEL' }
//   incoming  (an offer awaits MY answer: view.trade.to === me) -> TRADE_ACCEPT / TRADE_REJECT (+ countdown ring)
// `give` is what the proposer hands over, `get` what the proposer receives (engine convention).
//
// Props: { session, open, onClose, deadline? }
//   deadline  optional epoch ms (server clock, `clock.deadline` of the room) when the answer auto-plays. Drives the
//             countdown ring; without it the ring counts a local 30 s from when the offer appeared.
import '@/styles/sheets.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TILES } from '@shared/board.js';
import { compactINR, formatINR } from '@shared/format.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import Pill from './ui/Pill.jsx';
import PlayerToken from './ui/PlayerToken.jsx';
import TileChip from './ui/TileChip.jsx';
import {
  COLLECTIONS, SET_BONUS_MULT, collectionOf, completedGroups as completedGroupsBase, isBuyableTile, mortgageOf, upgradeCostOf,
  useHeld, useReducedMotion,
} from './ui/helpers.js';

const OFFER_SECONDS = 30;
const X = '×';

/* ------------------------------------------------------------------ pure helpers (exported for tests) */

/** Net-worth value of one side: cash + district prices (mortgaged: price minus its loan) + half the upgrades paid. */
export function sideValue(state, side) {
  let v = Number(side?.cash) || 0;
  for (const t of side?.tiles || []) {
    const tile = TILES[t];
    if (!tile) continue;
    v += state.mortgaged?.[t] ? (tile.price || 0) - mortgageOf(tile) : tile.price || 0;
    v += Math.round((state.levels?.[t] || 0) * upgradeCostOf(tile) * 0.5);
  }
  return v;
}

/** What I give vs what I get -> { key, label, tone, hint }. */
export function fairness(giving, getting) {
  if (giving + getting === 0) return { key: 'empty', label: 'Add something to trade', tone: 'neutral', hint: '' };
  if (giving === 0) return { key: 'greedy', label: 'Greedy', tone: 'warn', hint: 'You give nothing. Expect a no.' };
  const r = getting / giving;
  if (r < 0.85) return { key: 'generous', label: 'Generous', tone: 'blue', hint: 'You give more than you get.' };
  if (r <= 1.2) return { key: 'fair', label: 'Looks fair', tone: 'good', hint: 'Values are close.' };
  return { key: 'greedy', label: 'Greedy', tone: 'warn', hint: 'You ask for much more than you give.' };
}

/** Collections that `playerId` would own completely after receiving `receive` tiles and handing over `hand` tiles. */
export const completedGroups = completedGroupsBase;

/** Seconds left until `deadline` (epoch ms), never negative. */
export const secondsLeft = (deadline, now = Date.now()) => Math.max(0, Math.ceil((deadline - now) / 1000));

/** Every owned district can be traded (upgrades travel with it); an engine may still lock some via options.trade.locked. */
const isLocked = (state, o, tileId) => Array.isArray(o?.trade?.locked) && o.trade.locked.includes(tileId);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const nameOf = (p) => (p ? p.name : 'Someone');
const priceTag = (id) => <small className="hg-trade-price">{compactINR(TILES[id].price)}</small>;

/** Tiles grouped by collection, in board order: [{ coll, ids }]. */
function byCollection(ids) {
  const rows = [];
  for (const c of COLLECTIONS) {
    const mine = c.tiles.filter((t) => ids.includes(t));
    if (mine.length) rows.push({ coll: c, ids: mine });
  }
  const loose = ids.filter((t) => !collectionOf(TILES[t]));
  if (loose.length) rows.push({ coll: { id: 'other', name: 'Other', color: '#94a3b8', tiles: loose }, ids: loose });
  return rows;
}

/* ------------------------------------------------------------------ small views */

function Who({ player, you }) {
  if (!player) return null;
  return (
    <span className="hg-trade-who" style={{ '--pc': player.color }}>
      <PlayerToken player={player} size={24} />
      <b>{you ? 'You' : player.name}</b>
    </span>
  );
}

/** Read-only side of an offer, chips grouped by collection. */
function SideView({ title, side, state, tone }) {
  const tiles = side?.tiles || [];
  return (
    <div className={`hg-trade-side is-${tone}`}>
      <h4>{title}</h4>
      {side?.cash > 0 ? <p className="hg-trade-cash"><Icon name="coin" size={14} /> {formatINR(side.cash)}</p> : null}
      {tiles.length ? (
        byCollection(tiles).map(({ coll, ids }) => (
          <div key={coll.id} className="hg-trade-coll" style={{ '--sc': coll.color }}>
            <span className="hg-trade-collname"><i />{coll.name}</span>
            <div className="hg-chips">
              {ids.map((t) => (
                <TileChip key={t} tileId={t} mortgaged={!!state.mortgaged?.[t]} level={state.levels?.[t] || 0} extra={priceTag(t)} />
              ))}
            </div>
          </div>
        ))
      ) : (
        side?.cash > 0 ? null : <p className="hg-empty">Nothing</p>
      )}
      <p className="hg-trade-val">Worth {formatINR(sideValue(state, side))}</p>
    </div>
  );
}

function CashStepper({ label, value, max, onChange }) {
  const set = (v) => onChange(clamp(v, 0, max));
  return (
    <div className="hg-cashstep">
      <span className="hg-cashstep-label">{label}</span>
      <div className="hg-cashstep-row">
        <Button variant="dark" size="sm" aria-label={`${label}: minus 50,000`} disabled={value <= 0} onClick={() => set(value - 50000)}>{'−'}50k</Button>
        <Button variant="dark" size="sm" aria-label={`${label}: minus 10,000`} disabled={value <= 0} onClick={() => set(value - 10000)}>{'−'}10k</Button>
        <output className="hg-cashstep-val" aria-live="polite">{formatINR(value)}</output>
        <Button variant="dark" size="sm" aria-label={`${label}: plus 10,000`} disabled={value >= max} onClick={() => set(value + 10000)}>+10k</Button>
        <Button variant="dark" size="sm" aria-label={`${label}: plus 50,000`} disabled={value >= max} onClick={() => set(value + 50000)}>+50k</Button>
      </div>
    </div>
  );
}

/** One owner's districts, grouped by collection, each chip a toggle. */
function TilePicker({ owner, ownerIsMe, state, options, selected, onToggle }) {
  const ids = TILES.filter((t) => state.owners?.[t.id] === owner.id && isBuyableTile(t)).map((t) => t.id);
  const anyLocked = ids.some((id) => isLocked(state, options, id));
  return (
    <div className="hg-picker">
      <div className="hg-picker-head"><Who player={owner} you={ownerIsMe} /><small>{ownerIsMe ? 'your districts' : 'their districts'}</small></div>
      {ids.length === 0 ? (
        <p className="hg-empty">{ownerIsMe ? 'You own no districts yet.' : `${nameOf(owner)} owns no districts yet.`}</p>
      ) : (
        byCollection(ids).map(({ coll, ids: row }) => {
          const total = coll.tiles.length;
          const have = coll.tiles.filter((t) => state.owners?.[t] === owner.id).length;
          return (
            <div key={coll.id} className="hg-trade-coll" style={{ '--sc': coll.color }}>
              <span className="hg-trade-collname"><i />{coll.name}<small>{have}/{total}</small></span>
              <div className="hg-chips">
                {row.map((id) => {
                  const blocked = isLocked(state, options, id);
                  return (
                    <TileChip
                      key={id}
                      tileId={id}
                      level={state.levels?.[id] || 0}
                      mortgaged={!!state.mortgaged?.[id]}
                      selected={selected.includes(id)}
                      disabled={blocked}
                      onClick={() => onToggle(id)}
                      extra={blocked ? <Icon name="lock" size={12} /> : priceTag(id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })
      )}
      {anyLocked ? <p className="hg-hint"><Icon name="lock" size={12} /> Locked districts cannot be traded right now.</p> : null}
    </div>
  );
}

/** Countdown ring. With `deadline` it follows the server clock; otherwise it counts `seconds` from `resetKey`. */
export function Countdown({ deadline = null, seconds = OFFER_SECONDS, resetKey }) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const start = useRef({ key: null, at: 0, total: seconds });
  const key = deadline ? `d${deadline}` : `l${resetKey}`;
  if (start.current.key !== key) {
    const t = Date.now();
    start.current = { key, at: t, total: deadline ? Math.max(1, Math.round((deadline - t) / 1000)) : seconds };
  }
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [key]);
  const end = deadline || start.current.at + seconds * 1000;
  const left = secondsLeft(end, now);
  const total = Math.max(1, start.current.total);
  const R = 18;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, left / total);
  return (
    <span className={`hg-ring${left <= 8 ? ' is-low' : ''}`} role="timer" aria-label={`${left} seconds left to answer`}>
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
        <circle cx="22" cy="22" r={R} className="hg-ring-bg" />
        <circle
          cx="22" cy="22" r={R} className="hg-ring-fg hg-ring-fg--live"
          strokeDasharray={C}
          style={{ strokeDashoffset: C * (1 - frac), animation: 'none', transition: reduced ? 'none' : 'stroke-dashoffset 250ms linear' }}
        />
      </svg>
      <b>{left}</b>
    </span>
  );
}

function SetHints({ mine, theirs, theirName }) {
  return (
    <>
      {mine.map((g) => (
        <p key={`m${g}`} className="hg-trade-set is-mine">
          <Icon name="spark" size={14} /> <span>Completes <b>{collectionOf(g)?.name || g}</b>! First businesses there pay {X}{SET_BONUS_MULT}.</span>
        </p>
      ))}
      {theirs.map((g) => (
        <p key={`t${g}`} className="hg-trade-set is-theirs">
          <Icon name="warn" size={14} /> <span>Completes <b>{collectionOf(g)?.name || g}</b> for {theirName}.</span>
        </p>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ composer + waiting */

function ComposerSheet({ session, open, onClose }) {
  const view = session.view;
  const me = session.me;
  const o = session.options || {};
  const myP = view.players.find((p) => p.id === me);
  const others = view.players.filter((p) => p.id !== me && !p.bankrupt);
  const trade = view.trade && view.trade.from === me ? view.trade : null;
  const waiting = !!trade;
  const lastTrade = useRef(null);
  if (trade) lastTrade.current = trade;
  const modeRef = useRef('compose'); // keep the same content while the sheet animates out
  if (waiting) modeRef.current = 'wait';
  else if (open) modeRef.current = 'compose';
  const showWait = modeRef.current === 'wait' && !!lastTrade.current;
  const tradeShown = trade || lastTrade.current;

  const [to, setTo] = useState(null);
  const [giveCash, setGiveCash] = useState(0);
  const [getCash, setGetCash] = useState(0);
  const [giveTiles, setGiveTiles] = useState([]);
  const [getTiles, setGetTiles] = useState([]);
  const wasOpen = useRef(false);

  /* fresh composer every time it opens */
  useEffect(() => {
    if (open && !wasOpen.current && !waiting) {
      setTo(others[0]?.id ?? null);
      setGiveCash(0); setGetCash(0); setGiveTiles([]); setGetTiles([]);
    }
    wasOpen.current = open;
  }, [open, waiting, others]);

  const toId = to != null && others.some((p) => p.id === to) ? to : others[0]?.id ?? null; // first paint: default partner
  const partner = view.players.find((p) => p.id === (trade ? trade.to : toId)) || null;
  const waitPartner = tradeShown ? view.players.find((p) => p.id === tradeShown.to) || null : null;

  const pick = (id) => { setTo(id); setGetCash(0); setGetTiles([]); };
  const toggle = (list, set) => (id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const give = { cash: giveCash, tiles: giveTiles };
  const get = { cash: getCash, tiles: getTiles };
  const giving = sideValue(view, give);
  const getting = sideValue(view, get);
  const fair = fairness(giving, getting);
  const myDone = partner ? completedGroups(view.owners, me, getTiles, giveTiles) : [];
  const theirDone = partner ? completedGroups(view.owners, partner.id, giveTiles, getTiles) : [];
  const valid = !!partner && giving + getting > 0 && giveCash <= (myP?.cash || 0) && getCash <= (partner?.cash || 0);

  const send = () => {
    if (!valid) return;
    session.dispatch({ type: 'TRADE_OFFER', to: partner.id, give: { cash: giveCash, tiles: giveTiles }, get: { cash: getCash, tiles: getTiles } });
    onClose?.();
  };

  return (
    <Sheet
      open={open || waiting}
      onClose={onClose}
      dismissible={!waiting}
      title={showWait ? 'Trade offer sent' : 'Propose a trade'}
      className="hg-trade"
      desktop="modal"
      footer={showWait ? (
        <div className="hg-trade-actions">
          <Button variant="rose" size="lg" disabled={session.busy} onClick={() => session.dispatch({ type: 'TRADE_CANCEL' })}>Cancel offer</Button>
        </div>
      ) : (
        <div className="hg-trade-actions">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="gold" size="lg" disabled={!valid || session.busy} onClick={send}>Send offer</Button>
        </div>
      )}
    >
      {showWait && waitPartner ? (
        <div className="hg-trade-wait" role="status">
          <p className="hg-trade-waiting">
            Waiting for {waitPartner.name}<span className="hg-dots" aria-hidden="true"><i /><i /><i /></span>
          </p>
          <div className="hg-trade-cols">
            <SideView title="You give" side={tradeShown.give} state={view} tone="give" />
            <SideView title="You get" side={tradeShown.get} state={view} tone="get" />
          </div>
          <p className="hg-hint">Nobody can move until the offer is answered or cancelled.</p>
        </div>
      ) : (
        <>
          <h3 className="hg-h3">Trade with</h3>
          <div className="hg-partners" role="radiogroup" aria-label="Trade partner">
            {others.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={toId === p.id}
                className={`hg-partner${toId === p.id ? ' is-on' : ''}`}
                style={{ '--pc': p.color }}
                onClick={() => pick(p.id)}
              >
                <PlayerToken player={p} size={36} />
                <b>{p.name}</b>
                <small>{compactINR(p.cash)}</small>
              </button>
            ))}
          </div>

          {partner ? (
            <>
              <div className="hg-trade-cols">
                <section className="hg-trade-panel is-give" aria-label="You give">
                  <h3 className="hg-h3">You give</h3>
                  <TilePicker owner={myP} ownerIsMe state={view} options={o} selected={giveTiles} onToggle={toggle(giveTiles, setGiveTiles)} />
                  <CashStepper label="Cash you give" value={giveCash} max={myP?.cash || 0} onChange={setGiveCash} />
                </section>

                <section className="hg-trade-panel is-get" aria-label="You get">
                  <h3 className="hg-h3">You get</h3>
                  <TilePicker owner={partner} state={view} options={o} selected={getTiles} onToggle={toggle(getTiles, setGetTiles)} />
                  <CashStepper label={`Cash from ${partner.name}`} value={getCash} max={partner.cash || 0} onChange={setGetCash} />
                </section>
              </div>

              <section className={`hg-fair is-${fair.key}`} aria-label="Fairness" role="status">
                <div className="hg-fair-nums">
                  <span>You give <b>{formatINR(giving)}</b></span>
                  <Pill tone={fair.tone}>{fair.label}</Pill>
                  <span>You get <b>{formatINR(getting)}</b></span>
                </div>
                {fair.hint ? <p className="hg-hint">{fair.hint} Values count like net worth.</p> : null}
                <SetHints mine={myDone} theirs={theirDone} theirName={partner.name} />
              </section>
            </>
          ) : (
            <p className="hg-empty">No other active players to trade with.</p>
          )}
          {o.trade && !o.trade.canOffer ? <p className="hg-hint is-warn">You can only offer a trade on your own turn, before rolling or after.</p> : null}
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ incoming offer */

function IncomingSheet({ session, deadline }) {
  const view = session.view;
  const me = session.me;
  const o = session.options || {};
  const offer = view.trade && view.trade.to === me ? view.trade : null;
  const [latched, setLatched] = useState(false);

  useEffect(() => {
    if (!offer) setLatched(false);
    else if (o.tradeOffer) setLatched(true);
  }, [offer, o.tradeOffer]);

  const open = !!offer && (!!o.tradeOffer || latched);
  const heldOffer = useHeld(offer);
  const from = heldOffer ? view.players.find((p) => p.id === heldOffer.from) : null;
  const sig = heldOffer ? heldOffer.id : null;
  const iGet = heldOffer?.give; // proposer gives -> I receive
  const iGive = heldOffer?.get;
  const getting = heldOffer ? sideValue(view, iGet) : 0;
  const giving = heldOffer ? sideValue(view, iGive) : 0;
  const fair = useMemo(() => fairness(giving, getting), [giving, getting]);
  const label = fair.key === 'fair' ? 'Looks fair' : fair.key === 'generous' ? 'In their favour' : fair.key === 'greedy' ? 'In your favour' : fair.label;
  const myDone = heldOffer ? completedGroups(view.owners, me, iGet?.tiles || [], iGive?.tiles || []) : [];
  const theirDone = heldOffer && from ? completedGroups(view.owners, from.id, iGive?.tiles || [], iGet?.tiles || []) : [];
  const timed = !!deadline || session.mode === 'online';

  return (
    <Sheet
      open={open}
      dismissible={false}
      onClose={() => {}}
      ariaLabel={from ? `${from.name} offers you a trade` : 'Trade offer'}
      className="hg-trade hg-trade--incoming"
      desktop="modal"
      header={heldOffer && from ? (
        <div className="hg-trade-band" data-drag="">
          <PlayerToken player={from} size={48} />
          <div>
            <p className="hg-kicker">Trade offer</p>
            <h2>{from.name} wants to trade</h2>
          </div>
          {timed ? <Countdown deadline={deadline} resetKey={sig} /> : null}
        </div>
      ) : null}
      footer={(
        <div className="hg-trade-actions">
          <Button variant="dark" size="lg" disabled={session.busy} onClick={() => session.dispatch({ type: 'TRADE_REJECT' })}>Reject</Button>
          <Button variant="green" size="lg" disabled={session.busy} onClick={() => session.dispatch({ type: 'TRADE_ACCEPT' })}>Accept</Button>
        </div>
      )}
    >
      {heldOffer ? (
        <>
          <div className="hg-trade-cols">
            <SideView title="You get" side={iGet} state={view} tone="get" />
            <SideView title="You give" side={iGive} state={view} tone="give" />
          </div>
          <section className={`hg-fair is-${fair.key}`} role="status" aria-label="Fairness">
            <div className="hg-fair-nums">
              <span>You get <b>{formatINR(getting)}</b></span>
              <Pill tone={fair.tone}>{label}</Pill>
              <span>You give <b>{formatINR(giving)}</b></span>
            </div>
            <SetHints mine={myDone} theirs={theirDone} theirName={nameOf(from)} />
            {timed ? <p className="hg-hint">No answer before the ring runs out and the offer is rejected.</p> : null}
          </section>
        </>
      ) : null}
    </Sheet>
  );
}

export default function TradeSheet({ session, open, onClose, deadline = null }) {
  return (
    <>
      <ComposerSheet session={session} open={open} onClose={onClose} />
      <IncomingSheet session={session} deadline={Number.isFinite(deadline) && deadline > 0 ? deadline : null} />
    </>
  );
}
