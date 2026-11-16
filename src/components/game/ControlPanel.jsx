// The centre of the board: a calm, dark play-mat inside the ring of tiles.
//   tabs      Play | Manage | Trade as small segmented pills (wide layout; phones keep Manage / Trade in the dock)
//   ribbon    the city event (EventBanner), slim, above the die
//   hero      the big die (+ the Odds toggle), one plain status line ("Your turn - roll!" / "Ravi is playing...") and the slim decision timer
//   pane      Play = the quiet activity log + a chip for the tile being played | Manage = my districts | Trade
//   bottom    the action row (Roll / Buy / Pass / Pay / Use chai / Wait it out / Ride / End turn)
// Players and their cash live in the pods around the board (PlayerPods), not here.
// Contract: <ControlPanel session onOpenTile={(tileId) => void} onOpenTrade={() => void} actions? docked? />
//   actions  { spec, fire } from useActionSpec (GameView owns the one keyboard shortcut); omitted = computed here
//   docked   phone layout: the actions and the Manage / Trade tabs live in the bottom dock, the panel keeps die + status + log
// The landing-odds toggle beside the die is the shared preference from ./oddsPref.js (the Board paints the overlay).
// The root fills its parent and is a size container, so everything scales with cqmin.
import { useEffect, useId, useRef, useState } from 'react';
import { PASS_START, TILES, isBuyable } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { wordsOf } from '@/lib/mapWords.js';
import Dice, { dieValue } from './Dice.jsx';
import EventBanner from './EventBanner.jsx';
import ActionBar, { PanelButton, rideVehicle, useActionSpec } from './ActionBar.jsx';
import { LogList } from './LogPanel.jsx';
import MyProperties from './MyProperties.jsx';
import { oddsSupported, useOddsPref } from './oddsPref.js';
import { snatchInfo } from './snatch.js';
import Icon from './ui/Icon.jsx';
import SceneStage from './SceneStage.jsx';
import { sceneOf } from './sceneModel.js';
import { activePlayer, previewRentSafe, tileAccent, useStateLike } from './ui/helpers.js';
import { hintLine } from './ui/hudModel.js';
import { TimerBar } from './turn/TurnTimer.jsx';
import { tradeStatus } from './ui/tradeModel.js';
import { cosmeticsOf } from './turn/room.js';
import PowerTray from './power/PowerTray.jsx';
import '@/styles/controlpanel.css';
import '@/styles/cpPremium.css';

export const TABS = [
  { id: 'buy', label: 'Play', icon: 'dice' },
  { id: 'manage', label: 'Manage', icon: 'home' },
  { id: 'trade', label: 'Trade', icon: 'swap' },
];

const MUNICIPAL_BASE = 40000;
const MUNICIPAL_PER_LEVEL = 10000;

/** Upgrade levels a player owns in total (for Municipal Charges). */
function levelsOwned(state, playerId) {
  let n = 0;
  for (let i = 0; i < (state.owners?.length || 0); i++) if (state.owners[i] === playerId) n += Number(state.levels?.[i]) || 0;
  return n;
}

/**
 * What the "landed on" line says about the tile `player` stands on. Pure; exported for testing.
 * `state` is an engine-state-like object (owners / levels / mortgaged as the board shows them); `tiles` defaults to the board.
 * -> { tile, color, tone: 'free'|'mine'|'rent'|'plain'|'warn', detail }
 */
export function landedInfo(state, player, me, sum = 4, tiles = TILES) {
  const tile = tiles[player?.pos];
  if (!tile) return null;
  const { color } = tileAccent(tile);
  const out = (tone, detail) => ({ tile, color, tone, detail });
  const cfg = state.cfg || {};

  if (tile.type === 'property' || (isBuyable(tile) && tile.type !== 'transport')) {
    const ownerId = state.owners?.[tile.id];
    const owner = ownerId != null ? state.players.find((p) => p.id === ownerId) : null;
    if (!owner) return out('free', `For sale ${formatINR(tile.price)}`);
    const mine = ownerId === me;
    const who = mine ? 'Yours' : `Owned by ${owner.name}`;
    if (state.mortgaged?.[tile.id]) return out(mine ? 'mine' : 'plain', `${who} · mortgaged, no rent`);
    return out(mine ? 'mine' : 'rent', `${who} · rent ${formatINR(previewRentSafe(state, tile.id, sum))}`);
  }
  switch (tile.type) {
    case 'transport': {
      const v = rideVehicle(tile);
      const fare = tile.fare ?? tile.price;
      return out('plain', fare ? `${v === 'ride' ? 'Ride' : `Take the ${v}`} to the next stop for ${formatINR(fare)}` : 'Ride to the next stop');
    }
    case 'traffic':
      return player.stuck
        ? out('warn', `Stuck in traffic · pay ${formatINR(cfg.trafficFine ?? 25000)}, use ${wordsOf().chai} or wait a turn`)
        : out('plain', `${wordsOf().trafficCorner} · land here and you are stuck`);
    case 'chai':
      return out('good', (player.chai || 0) >= (cfg.chaiCap ?? 1) ? `${wordsOf().chaiCorner} · you already hold a ${wordsOf().isDefault ? 'chai' : wordsOf().chaiToken}` : `${wordsOf().chaiCorner} · free ${wordsOf().chaiToken}`);
    case 'municipal': {
      const base = tile.charge ?? tile.amount ?? MUNICIPAL_BASE;
      const per = tile.perLevel ?? MUNICIPAL_PER_LEVEL;
      const lv = levelsOwned(state, player.id);
      return out('plain', `Pay ${formatINR(base + per * lv)}${lv ? ` (${formatINR(base)} + ${formatINR(per)} x ${lv} upgrades)` : ''}`);
    }
    case 'auction':
      return out('plain', `${wordsOf().auctionTile} · a free district goes under the hammer`);
    case 'card':
    case 'kismet':
      return out('plain', `Draw a ${tile.deck === 'drama' ? wordsOf().drama : tile.deck === 'luck' ? wordsOf().luck : tile.short || tile.name} card`);
    case 'tax':
      return out('plain', `Pay ${formatINR(tile.taxFlat ?? tile.price ?? 0)}`);
    case 'start':
      return out('good', `Collect ${formatINR(cfg.passStart ?? PASS_START)} when you pass`);
    default:
      return out('plain', 'A breather. Nothing happens.');
  }
}

/**
 * The one plain line under the die. Pure; exported for testing.
 *   my turn       "Your turn — roll!" (a six: "Six! Roll again"), "Stuck in traffic — your move", "Your turn — buy it?", ...
 *   someone else  "Ravi is playing…"
 *   game over     "Final"
 * `spec` is the action spec (ActionBar.buildActionSpec); it is only read for what I am being asked to do.
 * -> { tone: 'mine' | 'other' | 'final' | 'idle', text, name }
 */
export function statusLine(session, spec = null) {
  const phase = session?.display?.phase ?? session?.view?.phase;
  if (phase === 'over' || session?.result) return { tone: 'final', text: 'Final', name: '' };
  const player = activePlayer(session);
  if (!player) return { tone: 'idle', text: 'Waiting for players…', name: '' };

  const me = session?.me;
  const isMe = player.id === me;
  const name = isMe ? 'You' : player.name;
  if (player.bankrupt) return { tone: 'other', text: `${name} ${isMe ? 'are' : 'is'} out of the game`, name };

  // the Snatch window is read from the latest state (real time), whatever the animated display still shows
  const sn = snatchInfo(session);
  if (sn) return { tone: sn.canPress ? 'mine' : 'other', text: sn.canPress ? 'Snatch it now!' : 'Snatch window open…', name };

  if (phase === 'auction') {
    return { tone: 'other', text: session?.options?.bid ? 'Auction — place your bid' : 'Auction in progress…', name };
  }
  if (phase === 'debt') {
    const debtor = session?.view?.players?.find((p) => p.id === session?.view?.debt?.player);
    if (debtor && debtor.id === me) return { tone: 'mine', text: 'Settle your debt', name: 'You' };
    return { tone: 'other', text: `${debtor?.name ?? name} is settling a debt…`, name: debtor?.name ?? name };
  }
  if (!isMe) return { tone: 'other', text: `${name} is playing…`, name };
  if (session?.rolling) return { tone: 'mine', text: 'Rolling…', name };

  switch (spec?.kind) {
    case 'roll': return { tone: 'mine', text: spec.primary?.label === 'Roll again' ? 'Six! Roll again' : 'Your turn — roll!', name };
    case 'traffic': return { tone: 'mine', text: 'Stuck in traffic — your move', name };
    case 'buy': return { tone: 'mine', text: 'Your turn — buy it?', name };
    case 'skip': return { tone: 'mine', text: 'Your turn — can’t afford it', name };
    case 'end': return { tone: 'mine', text: 'Your turn — end it when ready', name };
    default: return { tone: 'mine', text: 'You are playing…', name };
  }
}

/** Tab strip: small segmented pills; arrow keys / Home / End move between tabs (roving tabindex). */
function Tabs({ tab, onTab, badges, ids }) {
  const refs = useRef({});
  const onKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onTab(TABS[next].id);
    refs.current[TABS[next].id]?.focus();
  };
  const at = Math.max(0, TABS.findIndex((t) => t.id === tab));
  return (
    <div className="cp-tabs" role="tablist" aria-label="Control panel" onKeyDown={onKey} style={{ '--i': at, '--n': TABS.length }}>
      <span className="cp-tabs__thumb" aria-hidden="true" />
      {TABS.map((t) => {
        const on = t.id === tab;
        const badge = badges[t.id];
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`${ids}-tab-${t.id}`}
            data-tour={t.id === 'buy' ? undefined : t.id}
            aria-selected={on}
            aria-controls={`${ids}-pane`}
            tabIndex={on ? 0 : -1}
            className={`cp-tab${on ? ' is-on' : ''}`}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.icon} size={14} />
            <span className="cp-tab__label">{t.label}</span>
            {badge ? <span className="cp-badge" aria-label={badge.label}>{badge.text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Play tab: the quiet activity log, then a compact chip for the tile the current player stands on (opens its sheet). */
function BuyPane({ session, landed, buying, onOpenTile }) {
  return (
    <div className="cp-buy">
      <SceneStage session={session} />
      <div className="city-story-log"><LogList log={session.log || []} variant="center" /></div>
      {landed ? (
        <button
          key={landed.tile.id}
          type="button"
          className={`cp-landed is-${landed.tone}${buying ? ' is-buying' : ''}`}
          style={{ '--tc': landed.color }}
          onClick={() => onOpenTile?.(landed.tile.id)}
          aria-label={`${landed.tile.name}. ${landed.detail}. Open details`}
        >
          <i className="cp-landed__chip" aria-hidden="true" />
          <span className="cp-landed__txt">
            <b>{landed.tile.name}</b>
            <small>{landed.detail}</small>
          </span>
          <Icon name="info" size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** Trade tab: what trading is, the pending-offer banner, and the entry to the trade sheet. */
export function TradePane({ session, onOpenTrade }) {
  const { view, me } = session;
  const t = view.trade;
  const { can: canOffer, reason } = tradeStatus(session);
  const nameOf = (id) => (id === me ? 'You' : view.players.find((p) => p.id === id)?.name || 'Someone');

  let banner = null;
  if (t) {
    if (t.to === me) banner = { tone: 'in', text: `${nameOf(t.from)} ${t.replaces ? 'changed the offer to you' : 'offered you a trade'}. Answer it to carry on.` };
    else if (t.from === me) banner = { tone: 'out', text: `Waiting for ${nameOf(t.to)} to answer your offer…` };
    else banner = { tone: 'info', text: `${nameOf(t.from)} and ${nameOf(t.to)} are making a deal.` };
  }
  const why = canOffer || t ? '' : reason; // always the exact reason: whose turn, which step, an animation is not one

  return (
    <div className="cp-trade">
      {banner ? <p className={`cp-banner is-${banner.tone}`} role="status">{banner.text}</p> : null}
      <p>Swap districts and cash with another player. Districts keep their upgrades. The other side can accept, reject or change the offer.</p>
      <PanelButton tone="dark" size="lg" className="cp-trade__go" disabled={!canOffer} onClick={onOpenTrade}>
        <Icon name="swap" size={20} />
        Propose a trade
      </PanelButton>
      {why ? <small className="cp-trade__why">{why}</small> : null}
    </div>
  );
}

/** Badges for the Manage / Trade entries (tabs here, buttons in the phone dock). */
export function panelBadges(spec, session) {
  return {
    manage: spec.upgrades > 0 ? { text: spec.upgrades, label: `${spec.upgrades} can be upgraded` } : null,
    trade: session.view?.trade ? { text: '!', label: 'A trade offer is open' } : null,
  };
}

/** The line under the die. Remounts (and so re-enters) whenever its words change. */
function Status({ session, spec, player }) {
  const s = statusLine(session, spec);
  return (
    <p key={s.text} className={`cp-status is-${s.tone}`}>
      {player && s.tone !== 'final' && s.tone !== 'idle' ? <i className="cp-status__dot" aria-hidden="true" /> : null}
      <span className="cp-status__txt">{s.text}</span>
    </p>
  );
}

/** The small "what to do" line under the caption, in plain words. Remounts (and so fades in) whenever its words change. */
function Todo({ session, spec, player }) {
  const text = hintLine(session, spec, player && player.id !== session?.me ? player.name : '');
  if (!text) return null;
  return <p key={text} className="cp-todo">{text}</p>;
}

/** The faint glow of the turn player's colour in the middle of the mat; a new colour cross-fades in over the old one. */
function MatGlow({ color }) {
  const [layers, setLayers] = useState(() => [{ id: 0, color }]);
  const seq = useRef(0);
  useEffect(() => {
    setLayers((ls) => (ls[ls.length - 1].color === color ? ls : [...ls.slice(-1), { id: ++seq.current, color }]));
  }, [color]);
  useEffect(() => {
    if (layers.length < 2) return undefined;
    const t = setTimeout(() => setLayers((ls) => ls.slice(-1)), 900);
    return () => clearTimeout(t);
  }, [layers]);
  return layers.map((l, i) => (
    <i key={l.id} className={`cp-glow${i < layers.length - 1 ? ' is-out' : ''}`} style={{ '--pc': l.color }} />
  ));
}

function OddsToggle() {
  const [oddsOn, setOddsOn] = useOddsPref();
  if (!oddsSupported()) return null;
  return (
    <button
      type="button"
      className={`cp-odds${oddsOn ? ' is-on' : ''}`}
      aria-pressed={oddsOn}
      title="Show where your next roll is likely to land"
      onClick={() => setOddsOn((on) => !on)}
    >
      Odds
    </button>
  );
}

export default function ControlPanel({ session, onOpenTile, onOpenTrade, actions = null, docked = false, reopen = null }) {
  const ids = useId();
  const own = useActionSpec(session, { keys: !actions });
  const { spec, fire } = actions || own;
  const state = useStateLike(session);
  const [tab, setTab] = useState('buy');
  const [paneEl, setPaneEl] = useState(null); // where the power-card detail panel opens (renders nothing when the rule is off)

  /* a fresh decision (buy / roll / traffic) pulls the Play tab forward; transient `busy` states never count */
  const stableKind = useRef(spec.kind);
  useEffect(() => {
    if (spec.kind === 'busy') return;
    if (spec.kind !== stableKind.current && (spec.kind === 'buy' || spec.kind === 'roll' || spec.kind === 'traffic')) setTab('buy');
    stableKind.current = spec.kind;
  }, [spec.kind]);

  const player = activePlayer(session);
  const landed = player && !player.bankrupt ? landedInfo(state, player, session.me, dieValue(session)) : null;
  const shownTab = docked ? 'buy' : tab;
  const diceSkin = player ? cosmeticsOf(session, player.id).dice : undefined;
  const pc = player?.color || '#55d6c2';

  return (
    <section className={`cp${docked ? ' cp--docked' : ''}`} aria-label="Game controls">
      <div className="cp__in" data-kind={spec.kind} data-tab={shownTab} data-scene={sceneOf(session)?.kind} style={{ '--pc': pc }}>
        <div className="cp-mat" aria-hidden="true"><MatGlow color={pc} /></div>

        {docked ? null : <Tabs tab={tab} onTab={setTab} badges={panelBadges(spec, session)} ids={ids} />}
        <EventBanner session={session} />

        <div className="cp-stage">
          <div className="cp-hero">
            <div className="cp-hero__die">
              <PowerTray session={session} placement="panel" panelHost={paneEl} />
              <Dice session={session} skin={diceSkin} />
              <OddsToggle />
            </div>
            <div className="cp-hero__txt">
              <Status session={session} spec={spec} player={player} />
              {docked ? null : <Todo session={session} spec={spec} player={player} />}
              {docked ? null : <TimerBar session={session} className="cp-timer" />}
            </div>
          </div>

          <div
            className="cp-pane"
            role={docked ? undefined : 'tabpanel'}
            id={`${ids}-pane`}
            ref={setPaneEl}
            aria-labelledby={docked ? undefined : `${ids}-tab-${shownTab}`}
          >
            {shownTab === 'buy' ? <BuyPane session={session} landed={landed} buying={spec.kind === 'buy'} onOpenTile={onOpenTile} /> : null}
            {shownTab === 'manage' ? <div className="cp-scroll"><MyProperties session={session} onOpenTile={onOpenTile} /></div> : null}
            {shownTab === 'trade' ? <div className="cp-scroll"><TradePane session={session} onOpenTrade={onOpenTrade} /></div> : null}
          </div>
        </div>

        {docked ? null : <ActionBar spec={spec} fire={fire} session={session} reopen={reopen} />}
      </div>
    </section>
  );
}
