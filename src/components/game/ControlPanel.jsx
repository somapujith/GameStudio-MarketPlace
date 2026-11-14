// The control panel that sits in the CENTRE of the board:
//   top row   the player whose turn it is (avatar with the decision ring, name, cash, chai / traffic) + the die
//   timer     a slim bar while the decision clock runs (session.clock)
//   tabs      Play (alert log + the tile being played) | Manage (my properties) | Trade
//   bottom    the action row (Roll / Buy / Put up for auction / Pay / Use chai / Wait it out / Ride / End turn)
// Contract: <ControlPanel session onOpenTile={(tileId) => void} onOpenTrade={() => void} actions? docked? />
//   actions  { spec, fire } from useActionSpec (GameView owns the one keyboard shortcut); omitted = computed here
//   docked   phone layout: the actions and the Manage / Trade tabs live in the bottom dock, the panel keeps the Play pane
// The landing-odds toggle beside the die is the shared preference from ./oddsPref.js (the Board paints the overlay).
// The root fills its parent and is a size container, so everything scales with cqmin.
import { useEffect, useId, useRef, useState } from 'react';
import { PASS_START, TILES, isBuyable } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { Avatar } from '@/components/art/index.js';
import Dice, { LuckyBadge, dieValue } from './Dice.jsx';
import EventBanner from './EventBanner.jsx';
import ActionBar, { PanelButton, rideVehicle, useActionSpec } from './ActionBar.jsx';
import { LogList } from './LogPanel.jsx';
import MyProperties from './MyProperties.jsx';
import { ChaiToken, TrafficTag } from './MoneyBar.jsx';
import { oddsSupported, useOddsPref } from './oddsPref.js';
import Icon from './ui/Icon.jsx';
import { activePlayer, previewRentSafe, tileAccent, useStateLike } from './ui/helpers.js';
import { TimerBar, TimerRing } from './turn/TurnTimer.jsx';
import { cosmeticsOf } from './turn/room.js';
import { roundBadgeInfo } from './turn/RoundBadge.jsx';
import '@/styles/controlpanel.css';

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
        ? out('warn', `Stuck in traffic · pay ${formatINR(cfg.trafficFine ?? 25000)}, use chai or wait a turn`)
        : out('plain', 'Traffic Jam · land here and you are stuck');
    case 'chai':
      return out('good', (player.chai || 0) >= (cfg.chaiCap ?? 1) ? 'Chai Adda · you already hold a chai' : 'Chai Adda · free chai token');
    case 'municipal': {
      const base = tile.charge ?? tile.amount ?? MUNICIPAL_BASE;
      const per = tile.perLevel ?? MUNICIPAL_PER_LEVEL;
      const lv = levelsOwned(state, player.id);
      return out('plain', `Pay ${formatINR(base + per * lv)}${lv ? ` (${formatINR(base)} + ${formatINR(per)} x ${lv} upgrades)` : ''}`);
    }
    case 'auction':
      return out('plain', 'Bazaar Auction · a free district goes under the hammer');
    case 'card':
    case 'kismet':
      return out('plain', `Draw a ${tile.deck === 'drama' ? 'City Drama' : tile.deck === 'luck' ? 'Nawabi Luck' : tile.short || tile.name} card`);
    case 'tax':
      return out('plain', `Pay ${formatINR(tile.taxFlat ?? tile.price ?? 0)}`);
    case 'start':
      return out('good', `Collect ${formatINR(cfg.passStart ?? PASS_START)} when you pass`);
    default:
      return out('plain', 'A breather. Nothing happens.');
  }
}

/** Tab strip: arrow keys / Home / End move between tabs (roving tabindex). */
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
  return (
    <div className="cp-tabs" role="tablist" aria-label="Control panel" onKeyDown={onKey}>
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
            aria-selected={on}
            aria-controls={`${ids}-pane`}
            tabIndex={on ? 0 : -1}
            className={`cp-tab${on ? ' is-on' : ''}`}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.icon} size={16} />
            <span className="cp-tab__label">{t.label}</span>
            {badge ? <span className="cp-badge" aria-label={badge.label}>{badge.text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Play tab: the scrolling alert log, then the tile the current player stands on. */
function BuyPane({ session, landed, buying, onOpenTile }) {
  return (
    <div className="cp-buy">
      <LogList log={session.log || []} variant="mono" />
      {landed ? (
        <button
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
  const canOffer = !!session.options?.trade?.canOffer;
  const t = view.trade;
  const nameOf = (id) => (id === me ? 'You' : view.players.find((p) => p.id === id)?.name || 'Someone');
  const myTurn = view.players[view.turn]?.id === me;

  let banner = null;
  if (t) {
    if (t.to === me) banner = { tone: 'in', text: `${nameOf(t.from)} offered you a trade. Answer it to carry on.` };
    else if (t.from === me) banner = { tone: 'out', text: `Waiting for ${nameOf(t.to)} to answer your offer…` };
    else banner = { tone: 'info', text: `${nameOf(t.from)} and ${nameOf(t.to)} are making a deal.` };
  }
  let why = '';
  if (!canOffer && !t) why = myTurn ? 'Settle the current purchase or bid first, then you can trade.' : 'You can propose a trade on your own turn.';

  return (
    <div className="cp-trade">
      {banner ? <p className={`cp-banner is-${banner.tone}`} role="status">{banner.text}</p> : null}
      <p>Swap districts and cash with another player. Upgrades must be sold first. The other side can accept or reject.</p>
      <PanelButton tone="dark" size="lg" className="cp-trade__go" disabled={!canOffer || session.busy} onClick={onOpenTrade}>
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

/** The turn player, big: avatar with the decision ring, name, "your turn", cash, chai and traffic state. */
function Who({ session, player, isMe, over }) {
  const round = roundBadgeInfo(session);
  return (
    <div className={`cp-who${player?.bankrupt ? ' is-out' : ''}`} style={{ '--pc': player?.color || '#8aa09b' }}>
      <TimerRing session={session} playerId={player?.id} size={46}>
        <span className="cp-token" aria-hidden="true">
          {player ? <Avatar preset={player.avatar} size={36} /> : null}
        </span>
      </TimerRing>
      <div className="cp-who__txt">
        <span className="cp-who__row">
          <b className="cp-who__name">{player ? (isMe ? 'You' : player.name) : '—'}</b>
          <span className={`cp-who__turn${isMe && !over ? ' is-mine' : ''}`}>{over ? 'Final' : isMe ? 'your turn' : 'playing'}</span>
        </span>
        <span className="cp-who__cash">{formatINR(player?.cash ?? 0)}</span>
        <span className="cp-who__tags">
          <small className="cp-who__meta">{round.text}</small>
          {player && !player.bankrupt ? <ChaiToken count={player.chai} /> : null}
          {player?.stuck && !player.bankrupt ? <TrafficTag /> : null}
          <LuckyBadge session={session} />
        </span>
      </div>
    </div>
  );
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

export default function ControlPanel({ session, onOpenTile, onOpenTrade, actions = null, docked = false }) {
  const ids = useId();
  const own = useActionSpec(session, { keys: !actions });
  const { spec, fire } = actions || own;
  const state = useStateLike(session);
  const [tab, setTab] = useState('buy');

  /* a fresh decision (buy / roll / traffic) pulls the Play tab forward; transient `busy` states never count */
  const stableKind = useRef(spec.kind);
  useEffect(() => {
    if (spec.kind === 'busy') return;
    if (spec.kind !== stableKind.current && (spec.kind === 'buy' || spec.kind === 'roll' || spec.kind === 'traffic')) setTab('buy');
    stableKind.current = spec.kind;
  }, [spec.kind]);

  const player = activePlayer(session);
  const isMe = !!player && player.id === session.me;
  const over = (session.display?.phase ?? session.view?.phase) === 'over';
  const landed = player && !player.bankrupt ? landedInfo(state, player, session.me, dieValue(session)) : null;
  const shownTab = docked ? 'buy' : tab;
  const diceSkin = player ? cosmeticsOf(session, player.id).dice : undefined;

  return (
    <section className={`cp${docked ? ' cp--docked' : ''}`} aria-label="Game controls">
      <div className="cp__in" data-kind={spec.kind} data-tab={shownTab}>
        <header className="cp-top">
          <Who session={session} player={player} isMe={isMe} over={over} />
          <div className="cp-top__dice">
            <Dice session={session} skin={diceSkin} />
            <OddsToggle />
          </div>
        </header>

        {docked ? null : <TimerBar session={session} className="cp-timer" />}
        <EventBanner session={session} />

        {docked ? null : <Tabs tab={tab} onTab={setTab} badges={panelBadges(spec, session)} ids={ids} />}

        <div
          className="cp-pane"
          role={docked ? undefined : 'tabpanel'}
          id={`${ids}-pane`}
          aria-labelledby={docked ? undefined : `${ids}-tab-${shownTab}`}
        >
          {shownTab === 'buy' ? <BuyPane session={session} landed={landed} buying={spec.kind === 'buy'} onOpenTile={onOpenTile} /> : null}
          {shownTab === 'manage' ? <div className="cp-scroll"><MyProperties session={session} onOpenTile={onOpenTile} /></div> : null}
          {shownTab === 'trade' ? <div className="cp-scroll"><TradePane session={session} onOpenTrade={onOpenTrade} /></div> : null}
        </div>

        {docked ? null : <ActionBar spec={spec} fire={fire} session={session} />}
      </div>
    </section>
  );
}
