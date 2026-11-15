// Trading. One default export that renders three states from the session:
//   composer  (opened from the control panel's Trade tab)      -> { type:'TRADE_OFFER', to, give, get }
//   waiting   (my offer is outstanding: view.trade.from === me) -> { type:'TRADE_CANCEL' } (+ countdown ring)
//   incoming  (an offer awaits MY answer: view.trade.to === me) -> TRADE_ACCEPT / TRADE_REJECT (+ countdown ring)
// `give` is what the proposer hands over, `get` what the proposer receives (engine convention). Districts travel with
// their upgrades and mortgages; only districts and cash can be traded (shared/engine.js tradeProblem).
//
// Props: { session, open, onClose, deadline? }
//   deadline  optional epoch ms (server clock, `clock.deadline` of the room) when the answer auto-plays. Drives the
//             countdown ring; without it the ring counts a local TRADE_MS from when the offer appeared.
// Pure helpers (values, set impact, validation) live in ui/tradeModel.js; styles in styles/trade.css.
import '@/styles/sheets.css';
import '@/styles/trade.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TILES } from '@shared/board.js';
import { compactINR, formatINR } from '@shared/format.js';
import { TRADE_MS } from '@shared/timing.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import Pill from './ui/Pill.jsx';
import AvatarToken from './ui/AvatarToken.jsx';
import { artPart } from './ui/PlayerToken.jsx';
import { LevelPips, SetDots } from './ui/TileChip.jsx';
import { bandTones, mixHex } from './PropertySheet.jsx';
import { cosmeticsOf, isConnected } from './turn/room.js';
import {
  SET_BONUS_MULT, collectionOf, completedGroups as completedGroupsBase, isBuyableTile, levelNameOf, tileAccent,
  useHeld, useReducedMotion, worthParts,
} from './ui/helpers.js';
import {
  CASH_CHIPS, CASH_STEP, balanceSplit, byCollection, cashAfter, clampCash, deedFacts, fairness, fullSets, impactRows,
  offerProblem, parseCash, partnerHints, setImpact, sideBrief, sideParts, sideValue, tileHint,
} from './ui/tradeModel.js';

const OFFER_SECONDS = Math.round(TRADE_MS / 1000); // the server auto-rejects an unanswered offer after this
const X = '×';
const IN_NUM = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/* ------------------------------------------------------------------ pure helpers (exported for tests) */

export { fairness, sideValue };

/** Collections that `playerId` would own completely after receiving `receive` tiles and handing over `hand` tiles. */
export const completedGroups = completedGroupsBase;

/** Seconds left until `deadline` (epoch ms), never negative. */
export const secondsLeft = (deadline, now = Date.now()) => Math.max(0, Math.ceil((deadline - now) / 1000));

/** Every owned district can be traded (upgrades travel with it); an engine may still lock some via options.trade.locked. */
const isLocked = (o, tileId) => Array.isArray(o?.trade?.locked) && o.trade.locked.includes(tileId);
const nameOf = (p) => (p ? p.name : 'Someone');
const collName = (g) => collectionOf(g)?.name || g;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ------------------------------------------------------------------ deed cards */

const HINTS = {
  completes: { label: 'Completes set', icon: 'spark', tone: 'good' },
  breaks: { label: 'Breaks set', icon: 'warn', tone: 'warn' },
  theirs: { label: 'Completes theirs', icon: 'warn', tone: 'warn' },
  theirsBroken: { label: 'Breaks theirs', icon: 'info', tone: 'info' },
};

/** The spoken form of a set badge. */
function hintSay(h, themName) {
  const g = collName(h.group);
  switch (h.kind) {
    case 'completes': return `completes your ${g} set`;
    case 'breaks': return `breaks your ${g} set`;
    case 'theirs': return `completes ${g} for ${themName}`;
    default: return `breaks ${themName}'s ${g} set`;
  }
}

/**
 * One district as a small title deed: collection-coloured band, the business as it stands (art + level pips), price and
 * rent, a set badge. With `onToggle` it is a toggle button (aria-pressed); without it a read-only card.
 */
function Deed({ state, id, selected = false, hint = null, onToggle = null, locked = false, themName = 'them' }) {
  const f = deedFacts(state, id);
  const { tile } = f;
  if (!tile) return null;
  const coll = collectionOf(tile);
  const { color } = tileAccent(tile);
  const tones = bandTones(color);
  const Building = artPart('BuildingArt');
  const interactive = !!onToggle;
  const levelName = levelNameOf(tile, f.level);
  const H = hint ? HINTS[hint.kind] : null;
  const showTag = !!H && (!interactive || selected || hint.kind === 'completes');
  const say = hint ? hintSay(hint, themName) : '';
  const label = `${tile.name}, ${coll?.name || 'district'}, ${levelName}${f.mortgaged ? ', mortgaged' : ''}, price ${formatINR(f.price)}${say ? `, ${say}` : ''}`;
  const Tag = interactive ? 'button' : 'div';
  const tagProps = interactive
    ? { type: 'button', onClick: () => onToggle(id), disabled: locked, 'aria-pressed': !!selected }
    : { role: 'group' };
  return (
    <Tag
      {...tagProps}
      className={`tx-deed${interactive ? ' is-btn' : ''}${selected ? ' is-on' : ''}${f.mortgaged ? ' is-mort' : ''}${showTag && hint ? ` has-${hint.kind}` : ''}`}
      style={{ '--band': color, '--ink': tones.ink, '--b1': tones.from, '--b2': tones.to }}
      title={f.mortgaged ? `${tile.name} (mortgaged)` : `${tile.name}: ${levelName}`}
      aria-label={label}
    >
      <span className="tx-deed__band">
        <b>{tile.short || tile.name}</b>
      </span>
      <span className="tx-deed__art" aria-hidden="true">
        {f.mortgaged ? <i className="tx-deed__m">M</i> : null}
        {Building ? <Building theme={coll?.theme} group={tile.group} level={f.level} color={color} size={62} slab={mixHex(color, '#241a5c', 0.5)} /> : null}
      </span>
      <span className="tx-deed__lv">
        <LevelPips level={f.level} color={color} tile={tile} />
        <small>{levelName}</small>
      </span>
      <span className="tx-deed__nums">
        <b>{compactINR(f.price)}</b>
        <small>{f.mortgaged ? 'No rent' : `Rent ${compactINR(f.rent)}`}</small>
      </span>
      {locked ? (
        <span className="tx-deed__tag is-info"><Icon name="lock" size={11} />Locked</span>
      ) : showTag ? (
        <span className={`tx-deed__tag is-${H.tone}`}><Icon name={H.icon} size={11} />{H.label}</span>
      ) : null}
      {interactive ? (
        <span className="tx-deed__tick" aria-hidden="true">{selected ? <Icon name="check" size={14} strokeWidth={3} /> : null}</span>
      ) : null}
    </Tag>
  );
}

/** Districts grouped by collection: a header (name, the owner's progress, "Full set") and a row of deed cards. */
function DeedGroups({ state, options = null, owner = null, ids, selected = [], onToggle = null, hintFor = null, themName }) {
  const owned = fullSets(state.owners, owner?.id);
  return byCollection(ids).map(({ coll, ids: row }) => {
    const total = coll.tiles.length;
    const have = coll.tiles.filter((t) => state.owners?.[t] === owner?.id).length;
    return (
      <div key={coll.id} className="tx-coll" style={{ '--sc': coll.color }}>
        <div className="tx-coll__head">
          <span className="tx-coll__name"><i />{coll.name}</span>
          {onToggle ? (
            <>
              <SetDots owned={have} total={total} color={coll.color} />
              <small>{have}/{total}</small>
              {owned.includes(coll.id) ? <span className="tx-coll__full">Full set</span> : null}
            </>
          ) : null}
        </div>
        <div className="tx-coll__grid">
          {row.map((id) => (
            <Deed
              key={id}
              state={state}
              id={id}
              selected={selected.includes(id)}
              hint={hintFor ? hintFor(id) : null}
              onToggle={onToggle}
              locked={isLocked(options, id)}
              themName={themName}
            />
          ))}
        </div>
      </div>
    );
  });
}

/* ------------------------------------------------------------------ cash */

/** Cash on one side: a stepper around a big field, quick chips and a slider. All of it clamps to what the payer has. */
function CashField({ label, value, max, onChange, tone }) {
  const [focus, setFocus] = useState(false);
  const set = (v) => onChange(clampCash(v, max));
  const shown = focus ? (value ? String(value) : '') : value ? IN_NUM.format(value) : '';
  const fill = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const onSlide = (e) => {
    const v = Number(e.target.value);
    onChange(v >= max - CASH_STEP / 2 ? clampCash(max, max) : clampCash(Math.round(v / CASH_STEP) * CASH_STEP, max));
  };
  return (
    <div className={`tx-cash is-${tone}`}>
      <div className="tx-cash__head">
        <span className="tx-cash__label"><Icon name="coin" size={15} />{label}</span>
        <small>{max > 0 ? `Available ${formatINR(max)}` : 'No cash available'}</small>
      </div>
      <div className="tx-cash__row">
        <Button variant="dark" className="tx-step" aria-label={`${label}: minus 10,000`} disabled={value <= 0} onClick={() => set(value - CASH_STEP)}>
          <Icon name="minus" size={18} />
        </Button>
        <div className="tx-cash__field">
          <span className="tx-cash__rs" aria-hidden="true">{'₹'}</span>
          <input
            type="text"
            inputMode="numeric"
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={label}
            placeholder="0"
            value={shown}
            onChange={(e) => set(parseCash(e.target.value))}
            onFocus={(e) => { setFocus(true); e.target.select?.(); }}
            onBlur={() => setFocus(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
          {value > 0 ? (
            <button type="button" className="tx-cash__clear" aria-label={`${label}: clear`} onClick={() => onChange(0)}>
              <Icon name="close" size={14} strokeWidth={2.6} />
            </button>
          ) : null}
        </div>
        <Button variant="dark" className="tx-step" aria-label={`${label}: plus 10,000`} disabled={value >= max} onClick={() => set(value + CASH_STEP)}>
          <Icon name="plus" size={18} />
        </Button>
      </div>
      <div className="tx-cash__chips">
        {CASH_CHIPS.map((c) => (
          <Button
            key={c.id}
            variant="dark"
            className="tx-chip"
            aria-label={`${label}: ${c.say}`}
            disabled={c.delta < 0 ? value <= 0 : value >= max}
            onClick={() => set(value + c.delta)}
          >
            {c.label}
          </Button>
        ))}
        <Button variant="dark" className="tx-chip tx-chip--max" aria-label={`${label}: all of it`} disabled={value >= max} onClick={() => set(max)}>Max</Button>
      </div>
      <input
        type="range"
        className="tx-range"
        min={0}
        max={Math.max(max, 1)}
        step="any"
        value={Math.min(value, Math.max(max, 1))}
        disabled={max <= 0}
        aria-label={`${label} slider`}
        aria-valuetext={formatINR(value)}
        style={{ '--fill': `${fill}%` }}
        onChange={onSlide}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ balance + summary */

/** A split bar: how much of the deal is "what I give" and "what I get" (left to right, or get first). Transform-only. */
function BalanceBar({ giving, getting, compact = false, getFirst = false }) {
  const s = balanceSplit(giving, getting);
  const left = getFirst ? 'get' : 'give';
  const right = getFirst ? 'give' : 'get';
  return (
    <div className={`tx-bal${compact ? ' is-compact' : ''}${s.total ? '' : ' is-empty'}`} aria-hidden="true">
      <span className="tx-bal__track">
        <i className={`tx-bal__seg is-left is-${left}`} style={{ transform: `scaleX(${s[left]})` }} />
        <i className={`tx-bal__seg is-right is-${right}`} style={{ transform: `scaleX(${s[right]})` }} />
        <i className="tx-bal__mid" />
      </span>
    </div>
  );
}

const breakdown = (parts) => {
  const out = [];
  if (parts.count) out.push(`${plural(parts.count, 'district')} ${formatINR(parts.districts)}`);
  if (parts.cash) out.push(`cash ${formatINR(parts.cash)}`);
  return out.length ? out.join(' + ') : 'nothing';
};

/** What a deal does to the collections, one sentence each. */
function ImpactLines({ impact, themName }) {
  return impactRows(impact).map((r) => {
    const g = <b>{collName(r.group)}</b>;
    let icon = 'info';
    let body;
    if (r.kind === 'complete' && r.who === 'me') {
      icon = 'spark';
      body = <>You complete {g}. First businesses there pay {X}{SET_BONUS_MULT}.</>;
    } else if (r.kind === 'complete') {
      icon = 'warn';
      body = <><b>{themName}</b> completes {g}.</>;
    } else if (r.who === 'me') {
      icon = 'warn';
      body = <>You break your {g} set and lose its {X}{SET_BONUS_MULT} bonus.</>;
    } else {
      body = <><b>{themName}</b> loses their {g} set.</>;
    }
    return (
      <p key={r.key} className={`tx-impact is-${r.tone}`}>
        <Icon name={icon} size={15} /> <span>{body}</span>
      </p>
    );
  });
}

/** The deal in numbers: both sides' values, the split bar, my cash afterwards and the set impact. Never blocks anything. */
function Summary({ state, give, get, myCash, impact, themName, verdict, getFirst = false, note = null }) {
  const giveParts = sideParts(state, give);
  const getParts = sideParts(state, get);
  const after = cashAfter(myCash, give, get);
  const delta = after - myCash;
  const col = (key, title, parts) => (
    <div className={`tx-sum__col is-${key}`}>
      <small>{title}</small>
      <b>{formatINR(parts.total)}</b>
      <span>{breakdown(parts)}</span>
    </div>
  );
  return (
    <section className={`tx-sum is-${verdict.key}`} role="status" aria-label="Fairness">
      <div className="tx-sum__top">
        <h3>The deal</h3>
        <Pill tone={verdict.tone}>{verdict.label}</Pill>
      </div>
      <BalanceBar giving={giveParts.total} getting={getParts.total} getFirst={getFirst} />
      <div className={`tx-sum__cols${getFirst ? ' is-flip' : ''}`}>
        {getFirst ? col('get', 'You get', getParts) : col('give', 'You give', giveParts)}
        {getFirst ? col('give', 'You give', giveParts) : col('get', 'You get', getParts)}
      </div>
      <p className={`tx-sum__cash${after < 0 ? ' is-short' : ''}`}>
        <span>Your cash after</span>
        <b>{formatINR(after)}</b>
        {after < 0 ? <small>short by {formatINR(-after)}</small> : delta !== 0 ? <small>{delta > 0 ? '+' : '−'}{formatINR(Math.abs(delta))}</small> : null}
      </p>
      {verdict.hint ? <p className="tx-sum__hint">{verdict.hint} Values count like net worth.</p> : null}
      <ImpactLines impact={impact} themName={themName} />
      {note}
    </section>
  );
}

/* ------------------------------------------------------------------ countdown */

/** Countdown ring. With `deadline` it follows the server clock; otherwise it counts `seconds` from `resetKey`. */
export function Countdown({ deadline = null, seconds = OFFER_SECONDS, resetKey, size = 44 }) {
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
    <span className={`hg-ring tx-ring${left <= 8 ? ' is-low' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={`${left} seconds left to answer`}>
      <svg viewBox="0 0 44 44" width={size} height={size} aria-hidden="true">
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

/* ------------------------------------------------------------------ partner picker */

function PartnerCard({ session, state, me, player, selected, onPick, registerRef, onKeyDown }) {
  const out = !!player.bankrupt;
  const { total, count } = useMemo(() => worthParts(state, player.id), [state, player.id]);
  const hints = useMemo(() => (out ? null : partnerHints(state.owners, me, player.id)), [state.owners, me, player.id, out]);
  const gets = hints?.completesMine || [];
  const wants = hints?.completesTheirs || [];
  return (
    <button
      ref={registerRef}
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={out}
      tabIndex={selected ? 0 : -1}
      className={`tx-partner${selected ? ' is-on' : ''}${out ? ' is-out' : ''}`}
      style={{ '--pc': player.color }}
      onClick={() => onPick(player.id)}
      onKeyDown={onKeyDown}
    >
      <span className="tx-partner__top">
        <AvatarToken session={session} player={player} size={40} offline={!isConnected(session, player.id)} frame={cosmeticsOf(session, player.id).frame} />
        <span className="tx-partner__id">
          <b>{player.name}</b>
          <span className="tx-partner__cash">{out ? 'Out of the game' : compactINR(player.cash)}</span>
        </span>
        <span className="tx-partner__tick" aria-hidden="true">{selected ? <Icon name="check" size={14} strokeWidth={3} /> : null}</span>
      </span>
      {out ? null : <small className="tx-partner__worth">Worth {compactINR(total)} · {plural(count, 'district')}</small>}
      {gets.length ? (
        <span className="tx-partner__tag is-good"><Icon name="spark" size={12} />Completes {gets.length > 1 ? `${gets.length} sets` : collName(gets[0])}</span>
      ) : wants.length ? (
        <span className="tx-partner__tag is-warn"><Icon name="warn" size={12} />Needs your {wants.length > 1 ? 'districts' : collName(wants[0])}</span>
      ) : null}
    </button>
  );
}

function PartnerPicker({ session, state, me, players, value, onPick }) {
  const refs = useRef({});
  const live = players.filter((p) => !p.bankrupt);
  const onKeyDown = (e, p) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step || live.length < 2) return;
    e.preventDefault();
    const i = live.findIndex((x) => x.id === p.id);
    const next = live[(i + step + live.length) % live.length];
    onPick(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div className="tx-partners" role="radiogroup" aria-label="Trade partner">
      {players.map((p) => (
        <PartnerCard
          key={p.id}
          session={session}
          state={state}
          me={me}
          player={p}
          selected={value === p.id}
          onPick={onPick}
          registerRef={(el) => { refs.current[p.id] = el; }}
          onKeyDown={(e) => onKeyDown(e, p)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ one side of the composer */

function Pane({ session, state, options, tone, title, owner, isMe, ids, selected, onToggle, hintFor, cash, themName }) {
  const picked = selected.length;
  const anyLocked = ids.some((id) => isLocked(options, id));
  return (
    <section className={`tx-pane is-${tone}`} aria-label={title}>
      <header className="tx-pane__head">
        <AvatarToken session={session} player={owner} size={32} frame={cosmeticsOf(session, owner?.id).frame} />
        <div className="tx-pane__titles">
          <h3>{title}</h3>
          <small>{isMe ? 'your districts' : 'their districts'}</small>
        </div>
        <span className={`tx-pane__count${picked ? ' is-on' : ''}`}>{picked ? `${picked} picked` : 'none picked'}</span>
      </header>
      {ids.length === 0 ? (
        <p className="tx-pane__empty">{isMe ? 'You own no districts yet.' : `${nameOf(owner)} owns no districts yet.`}</p>
      ) : (
        <DeedGroups state={state} options={options} owner={owner} ids={ids} selected={selected} onToggle={onToggle} hintFor={hintFor} themName={themName} />
      )}
      {anyLocked ? <p className="tx-pane__lock"><Icon name="lock" size={12} /> Locked districts cannot be traded right now.</p> : null}
      <CashField {...cash} tone={tone} />
    </section>
  );
}

/** The arrow between the two panes (a medallion). */
const Medallion = () => <span className="tx-swap" aria-hidden="true"><Icon name="swap" size={20} /></span>;

/* ------------------------------------------------------------------ offer band + read-only sides */

/** Top of the waiting / incoming sheets: who, what, and the countdown ring. */
function OfferBand({ session, player, kicker, children, ring }) {
  return (
    <div className="tx-band" data-drag="">
      <AvatarToken session={session} player={player} size={52} frame={cosmeticsOf(session, player?.id).frame} />
      <div className="tx-band__txt" role="status">
        <p className="tx-kicker">{kicker}</p>
        <h2>{children}</h2>
      </div>
      {ring}
    </div>
  );
}

/** Read-only side of an offer: a cash note and the deed cards grouped by collection. */
function OfferSide({ title, tone, side, state, owner, hintFor, themName }) {
  const tiles = side?.tiles || [];
  const cash = side?.cash || 0;
  return (
    <section className={`tx-side is-${tone}`} aria-label={title}>
      <header className="tx-side__head">
        <h3>{title}</h3>
        <b>Worth {formatINR(sideValue(state, side))}</b>
      </header>
      {cash > 0 ? (
        <p className="tx-note"><Icon name="coin" size={18} /><b>{formatINR(cash)}</b><small>cash</small></p>
      ) : null}
      {tiles.length ? (
        <DeedGroups state={state} owner={owner} ids={tiles} hintFor={hintFor} themName={themName} />
      ) : cash > 0 ? null : (
        <p className="tx-side__none">Nothing</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ composer + waiting */

function ComposerSheet({ session, open, onClose, deadline }) {
  const view = session.view;
  const me = session.me;
  const o = session.options || {};
  const myP = view.players.find((p) => p.id === me);
  const others = view.players.filter((p) => p.id !== me && !p.bankrupt);
  const rivals = view.players.filter((p) => p.id !== me);
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
  const impact = partner ? setImpact(view.owners, me, partner.id, giveTiles, getTiles) : null;
  const problem = offerProblem({ me: myP, partner, give, get, canOffer: o.trade ? !!o.trade.canOffer : true });
  const valid = !problem;
  const myIds = useMemo(() => TILES.filter((t) => isBuyableTile(t) && view.owners?.[t.id] === me).map((t) => t.id), [view.owners, me]);
  const theirIds = useMemo(
    () => (partner ? TILES.filter((t) => isBuyableTile(t) && view.owners?.[t.id] === partner.id).map((t) => t.id) : []),
    [view.owners, partner],
  );
  const hintFor = (side) => (id) => (partner ? tileHint(view.owners, { me, them: partner.id, give: giveTiles, get: getTiles }, id, side) : null);

  const send = () => {
    if (!valid) return;
    session.dispatch({ type: 'TRADE_OFFER', to: partner.id, give: { cash: giveCash, tiles: giveTiles }, get: { cash: getCash, tiles: getTiles } });
    onClose?.();
  };

  const timed = !!deadline || session.mode === 'online';
  const waitName = waitPartner ? waitPartner.name : 'Someone';

  let header;
  let footer;
  let body;
  if (showWait && waitPartner) {
    header = (
      <OfferBand
        session={session}
        player={waitPartner}
        kicker="Trade offer sent"
        ring={timed ? <Countdown deadline={deadline} resetKey={tradeShown.id} size={52} /> : null}
      >
        Waiting for {waitName}<span className="hg-dots" aria-hidden="true"><i /><i /><i /></span>
      </OfferBand>
    );
    footer = (
      <div className="tx-foot">
        <p className="tx-foot__line">Nobody can move until the offer is answered or cancelled.</p>
        <div className="tx-foot__btns">
          <Button variant="rose" size="lg" disabled={session.busy} onClick={() => session.dispatch({ type: 'TRADE_CANCEL' })}>Cancel offer</Button>
        </div>
      </div>
    );
    const sentGive = tradeShown.give;
    const sentGet = tradeShown.get;
    const sentImpact = setImpact(view.owners, me, waitPartner.id, sentGive?.tiles || [], sentGet?.tiles || []);
    const sentHint = (side) => (id) => tileHint(view.owners, { me, them: waitPartner.id, give: sentGive?.tiles || [], get: sentGet?.tiles || [] }, id, side);
    body = (
      <div className="tx-wait">
        <div className="tx-panes is-view">
          <OfferSide title="You give" tone="give" side={sentGive} state={view} owner={myP} hintFor={sentHint('give')} themName={waitName} />
          <Medallion />
          <OfferSide title="You get" tone="get" side={sentGet} state={view} owner={waitPartner} hintFor={sentHint('get')} themName={waitName} />
        </div>
        <Summary
          state={view}
          give={sentGive}
          get={sentGet}
          myCash={myP?.cash || 0}
          impact={sentImpact}
          themName={waitName}
          verdict={fairness(sideValue(view, sentGive), sideValue(view, sentGet))}
        />
      </div>
    );
  } else {
    header = (
      <div className="tx-head" data-drag="">
        <span className="tx-head__medal" aria-hidden="true"><Icon name="swap" size={22} /></span>
        <div>
          <h2>Propose a trade</h2>
          <p>Districts keep their upgrades and mortgages.</p>
        </div>
      </div>
    );
    footer = (
      <div className="tx-foot">
        {partner ? <BalanceBar giving={giving} getting={getting} compact /> : null}
        {problem && partner ? (
          <p className={`tx-foot__line ${problem === 'The offer is empty' ? 'is-hint' : 'is-warn'}`} role="status">
            {problem}{problem === 'The offer is empty' ? '. Pick districts or add cash.' : ''}
          </p>
        ) : partner ? (
          <p className="tx-foot__line">
            Give <b>{sideBrief(give)}</b> <span aria-hidden="true">{'·'}</span> Get <b>{sideBrief(get)}</b>
          </p>
        ) : null}
        <div className="tx-foot__btns">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="gold" size="lg" disabled={!valid || session.busy} onClick={send}>Send offer</Button>
        </div>
      </div>
    );
    body = (
      <>
        <h3 className="tx-label">Trade with</h3>
        <PartnerPicker session={session} state={view} me={me} players={rivals} value={toId} onPick={pick} />
        {partner ? (
          <>
            <div className="tx-panes">
              <Pane
                session={session}
                state={view}
                options={o}
                tone="give"
                title="You give"
                owner={myP}
                isMe
                ids={myIds}
                selected={giveTiles}
                onToggle={toggle(giveTiles, setGiveTiles)}
                hintFor={hintFor('give')}
                themName={partner.name}
                cash={{ label: 'Cash you give', value: giveCash, max: myP?.cash || 0, onChange: setGiveCash }}
              />
              <Medallion />
              <Pane
                session={session}
                state={view}
                options={o}
                tone="get"
                title="You get"
                owner={partner}
                ids={theirIds}
                selected={getTiles}
                onToggle={toggle(getTiles, setGetTiles)}
                hintFor={hintFor('get')}
                themName={partner.name}
                cash={{ label: `Cash from ${partner.name}`, value: getCash, max: partner.cash || 0, onChange: setGetCash }}
              />
            </div>
            <Summary state={view} give={give} get={get} myCash={myP?.cash || 0} impact={impact} themName={partner.name} verdict={fair} />
          </>
        ) : (
          <p className="tx-empty">No other active players to trade with.</p>
        )}
      </>
    );
  }

  return (
    <Sheet
      open={open || waiting}
      onClose={onClose}
      dismissible={!waiting}
      ariaLabel={showWait && waitPartner ? `Trade offer sent. Waiting for ${waitName}` : 'Propose a trade'}
      className={`tx-sheet ${showWait && waitPartner ? 'tx-sheet--wait' : 'tx-sheet--compose'}`}
      desktop="modal"
      header={header}
      footer={footer}
    >
      {body}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ incoming offer */

function IncomingSheet({ session, deadline }) {
  const view = session.view;
  const me = session.me;
  const o = session.options || {};
  const myP = view.players.find((p) => p.id === me);
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
  // seen from the other chair: what the proposer calls greedy is in my favour, what they call generous is in theirs
  const verdict = fair.key === 'generous' ? { ...fair, label: 'In their favour', tone: 'warn' }
    : fair.key === 'greedy' ? { ...fair, label: 'In your favour', tone: 'gold' } : fair;
  const impact = heldOffer && from ? setImpact(view.owners, me, from.id, iGive?.tiles || [], iGet?.tiles || []) : null;
  const timed = !!deadline || session.mode === 'online';
  const themName = nameOf(from);
  const hintFor = (side) => (id) => (from ? tileHint(view.owners, { me, them: from.id, give: iGive?.tiles || [], get: iGet?.tiles || [] }, id, side) : null);

  return (
    <Sheet
      open={open}
      dismissible={false}
      onClose={() => {}}
      ariaLabel={from ? `${from.name} offers you a trade` : 'Trade offer'}
      className="tx-sheet tx-sheet--incoming"
      desktop="modal"
      header={heldOffer && from ? (
        <OfferBand
          session={session}
          player={from}
          kicker="Trade offer"
          ring={timed ? <Countdown deadline={deadline} resetKey={sig} size={52} /> : null}
        >
          {from.name} wants to trade
        </OfferBand>
      ) : null}
      footer={(
        <div className="tx-foot">
          {heldOffer ? <BalanceBar giving={giving} getting={getting} compact getFirst /> : null}
          {heldOffer ? (
            <p className="tx-foot__line">
              Get <b>{sideBrief(iGet)}</b> <span aria-hidden="true">{'·'}</span> Give <b>{sideBrief(iGive)}</b>
            </p>
          ) : null}
          <div className="tx-foot__btns is-answer">
            <Button variant="dark" size="lg" disabled={session.busy} onClick={() => session.dispatch({ type: 'TRADE_REJECT' })}>Reject</Button>
            <Button variant="gold" size="lg" disabled={session.busy} onClick={() => session.dispatch({ type: 'TRADE_ACCEPT' })}>Accept</Button>
          </div>
        </div>
      )}
    >
      {heldOffer ? (
        <>
          <div className="tx-panes is-view">
            <OfferSide title="You get" tone="get" side={iGet} state={view} owner={from} hintFor={hintFor('get')} themName={themName} />
            <Medallion />
            <OfferSide title="You give" tone="give" side={iGive} state={view} owner={myP} hintFor={hintFor('give')} themName={themName} />
          </div>
          <Summary
            state={view}
            give={iGive}
            get={iGet}
            myCash={myP?.cash || 0}
            impact={impact}
            themName={themName}
            verdict={verdict}
            getFirst
            note={timed ? <p className="tx-sum__hint">No answer before the ring runs out and the offer is rejected.</p> : null}
          />
        </>
      ) : null}
    </Sheet>
  );
}

export default function TradeSheet({ session, open, onClose, deadline = null }) {
  const dl = Number.isFinite(deadline) && deadline > 0 ? deadline : null;
  return (
    <>
      <ComposerSheet session={session} open={open} onClose={onClose} deadline={dl} />
      <IncomingSheet session={session} deadline={dl} />
    </>
  );
}
