// The control panel's action row. Reads ONLY session.options + session.view, dispatches via session.dispatch.
//   buildActionSpec(session)  pure: what the row should offer right now (Hustle rules, docs/HUSTLE_PLAN.md 3.7)
//   shortcutAction(spec, e)   pure: which action a Space / Enter key press fires (only primaries that advertise a kbd)
//   useActionSpec(session, { keys })  spec + a debounced `fire(action)` + the Space / Enter shortcut (keys: false = no listener)
//   <ActionBar spec fire session />  presentational: secondary buttons, the one big primary button, wide rows, the hint
import { useEffect, useMemo, useRef } from 'react';
import { Avatar } from '@/components/art/index.js';
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { sfx } from '@/lib/sfx.js';
import Icon from './ui/Icon.jsx';
import { hasOpenSheet } from './ui/Sheet.jsx';
import { watchingLine } from './turn/resign.js';
import { snatchBannerText, snatchInfo } from './snatch.js';
import '@/styles/controlpanel.css';

const TRAFFIC_FINE = 25000;

/** "Auto" / "Metro" / "MMTS" for the transport stop a ride starts from. Pure; exported for testing. */
export function rideVehicle(tile) {
  const n = `${tile?.name || ''} ${tile?.short || ''}`.toLowerCase();
  if (n.includes('auto')) return 'Auto';
  if (n.includes('metro')) return 'Metro';
  if (n.includes('mmts')) return 'MMTS';
  return 'ride';
}

/** "Take the Metro to MMTS Express for ₹35,000". Pure; exported for testing. */
export function rideLabel(ride, fromPos) {
  const from = TILES[ride?.from ?? fromPos];
  const to = TILES[ride?.to];
  const v = rideVehicle(from);
  const where = to?.name || 'the next stop';
  const fare = formatINR(ride?.fare ?? 0);
  return v === 'ride' ? `Ride to ${where} for ${fare}` : `Take the ${v} to ${where} for ${fare}`;
}

/** Work out what the row should show. Pure; exported for testing. */
export function buildActionSpec(session) {
  const { options: o = {}, view, busy, me } = session;
  const upgrades = o.upgrade?.length || 0;
  const mine = view.players.find((p) => p.id === me);
  const turnP = view.players[view.turn];
  const myTurn = turnP?.id === me;
  const pend = view.pending;
  const spec = { kind: 'status', primary: null, secondaries: [], upgrades, label: '', sr: '', chai: mine?.chai || 0 };

  if (session.result || view.phase === 'over') {
    return { ...spec, label: 'Game over', sr: 'Game over', upgrades: 0 };
  }
  if (mine?.bankrupt) {
    // resigned or bankrupt: a calm line instead of an action (the back button still leaves the table)
    const label = watchingLine(session);
    return { ...spec, kind: 'out', label, sub: 'Use the back arrow to leave', sr: `${label}. You are out of the game and can watch the rest of it`, upgrades: 0 };
  }
  if (session.resigning) {
    return { ...spec, label: 'Resigning…', sr: 'Resigning from the game', upgrades: 0 };
  }
  // The Snatch window is real time and read from the latest state: it wins over `busy` (the presenter may still be playing
  // the purchase). The button itself is the pop-up's (SnatchPopup); the row just says what is going on.
  const sn = snatchInfo(session);
  if (sn) {
    const label = sn.pressed ? 'Snatch locked in…' : sn.canPress ? 'Snatch it now!' : 'Snatch window open…';
    return { ...spec, label, sr: `${label} ${snatchBannerText(sn)}`, upgrades: 0 };
  }
  if (busy) {
    return { ...spec, kind: 'busy', label: '', sr: 'Please wait', upgrades: 0 };
  }
  if (view.phase === 'auction') {
    return { ...spec, label: o.bid ? 'Place your sealed bid' : 'Auction in progress…', sr: 'Auction in progress', upgrades: 0 };
  }

  // a ride offer stays open for the turn (until END_TURN / ROLL): a full-width row under the primary
  const ride = o.ride && Number.isInteger(o.ride.to) ? o.ride : null;
  const rideRow = ride
    ? { key: 'ride', wide: true, icon: 'swap', label: rideLabel(ride, mine?.pos), sub: 'Skip ahead to the next stop', action: { type: 'RIDE' } }
    : null;

  if (o.buy || (o.skipBuy && pend?.type === 'buy')) {
    const tile = TILES[pend?.tile];
    const auction = view.cfg?.auctionOnDecline !== false;
    const skipLabel = auction ? 'Put up for auction' : 'Skip';
    const price = pend?.price ?? tile?.price ?? 0;
    if (o.buy) {
      spec.kind = 'buy';
      spec.primary = {
        key: 'buy', tone: 'green', label: `Buy ${tile?.short ?? tile?.name ?? 'district'}`, amount: formatINR(price), action: { type: 'BUY' },
      };
      if (o.skipBuy) {
        spec.secondaries.push({
          key: 'skip', wide: auction, icon: auction ? 'bank' : undefined, label: skipLabel,
          sub: auction ? 'Everyone bids, sealed' : undefined, action: { type: 'SKIP_BUY' },
        });
      }
      spec.sr = `Buy ${tile?.name ?? 'this district'} for ${formatINR(price)}, or ${auction ? 'put it up for auction' : 'skip'}`;
    } else {
      const short = Math.max(0, price - (mine?.cash ?? 0));
      spec.kind = 'skip';
      spec.primary = { key: 'skip', tone: 'dark', label: skipLabel, sub: `Need ${formatINR(short)} more to buy`, action: { type: 'SKIP_BUY' } };
      spec.sr = `You cannot afford ${tile?.name ?? 'this district'}. ${skipLabel}.`;
    }
  } else if (o.roll) {
    const again = !!view.extraRoll;
    const stuck = !again && (!!mine?.stuck || !!o.payTraffic || !!o.useChai);
    if (stuck) {
      // Traffic Jam: pay the fine, spend chai, or wait it out (ROLL = no move, the turn ends). Never on Space.
      spec.kind = 'traffic';
      const fine = Number(o.payTraffic) > 0 ? Number(o.payTraffic) : (view.cfg?.trafficFine ?? TRAFFIC_FINE);
      const chai = o.useChai ? { key: 'chai', tone: 'green', icon: 'spark', label: 'Use chai', sub: 'Free, then roll', action: { type: 'USE_CHAI' } } : null;
      const pay = o.payTraffic ? { key: 'pay', tone: 'gold', icon: 'coin', label: `Pay ${formatINR(fine)}`, sub: 'Then roll', action: { type: 'PAY_TRAFFIC' } } : null;
      const wait = { key: 'wait', tone: 'dark', icon: 'hourglass', label: 'Wait it out', sub: 'No move this turn', action: { type: 'ROLL' } };
      const choices = [chai, pay, wait].filter(Boolean);
      spec.primary = choices[0];
      spec.secondaries.push(...choices.slice(1));
      spec.hint = { key: 'traffic', icon: 'warn', text: 'Stuck in Traffic Jam: pay the fine, use chai, or wait a turn', short: 'Stuck in traffic' };
      spec.sr = `You are stuck in traffic. ${[chai && 'Use your chai', pay && `pay ${formatINR(fine)}`, 'or wait it out'].filter(Boolean).join(', ')}.`;
    } else {
      spec.kind = 'roll';
      spec.primary = { key: 'roll', tone: 'gold', icon: 'dice', label: again ? 'Roll again' : 'Roll', kbd: 'Space', action: { type: 'ROLL' } };
      if (o.endTurn) spec.secondaries.push({ key: 'end', label: 'End turn', action: { type: 'END_TURN' } });
      spec.sr = again ? 'Six! Roll again' : 'Your turn. Roll the die';
    }
    if (rideRow) spec.secondaries.push(rideRow);
  } else if (o.endTurn) {
    spec.kind = 'end';
    spec.primary = { key: 'end', tone: 'blue', icon: 'check', label: 'End turn', kbd: 'Space', action: { type: 'END_TURN' } };
    if (rideRow) spec.secondaries.push(rideRow);
    spec.sr = rideRow ? `End your turn, or ${rideRow.label}` : upgrades ? 'End your turn, or upgrade a property' : 'End your turn';
  } else if (view.phase === 'debt') {
    const debtor = view.players.find((p) => p.id === view.debt?.player);
    spec.label = debtor && debtor.id !== me ? `${debtor.name} is settling a debt` : 'Settle your debt';
    spec.sr = spec.label;
    spec.upgrades = 0;
  } else if (view.trade) {
    spec.label = 'Trade offer pending';
    spec.sr = 'A trade offer is waiting for an answer';
    spec.upgrades = 0;
  } else if (!myTurn) {
    spec.label = `Waiting for ${turnP?.name ?? 'others'}`;
    spec.waitFor = turnP;
    spec.sr = spec.label;
    spec.upgrades = 0;
  } else {
    spec.kind = 'busy';
    spec.sr = 'Please wait';
    spec.upgrades = 0;
  }
  return spec;
}

const isTyping = (t) => {
  if (!t) return false;
  if (typeof document !== 'undefined' && (t === document.body || t === document.documentElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A'
    || t.isContentEditable || t.getAttribute?.('role') === 'button';
};

/**
 * The action a key press should fire through the Space / Enter shortcut, or null. Pure; exported for testing.
 * Only a primary that advertises a `kbd` qualifies (Roll, End turn): Buy, auction and the traffic choices must be a deliberate click.
 */
export function shortcutAction(spec, e, sheetOpen = false) {
  if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key !== ' ' && e.key !== 'Enter') return null;
  if (sheetOpen || isTyping(e.target)) return null;
  return spec?.primary?.kbd ? spec.primary.action : null;
}

/** The spec for this session, a debounced dispatcher, and (unless `keys: false`) the Space / Enter shortcut. */
export function useActionSpec(session, { keys = true } = {}) {
  const spec = useMemo(
    () => buildActionSpec(session),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.options, session.view, session.busy, session.me, session.result, session.resigning, session.resigned],
  );
  const specRef = useRef(spec);
  const dispatchRef = useRef(session.dispatch);
  specRef.current = spec;
  dispatchRef.current = session.dispatch;
  const lastFire = useRef(0);

  /* Space / Enter (not while a sheet is open, or when focus is on something interactive) */
  useEffect(() => {
    if (!keys) return undefined;
    const onKey = (e) => {
      const action = shortcutAction(specRef.current, e, hasOpenSheet());
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const now = performance.now();
      if (now - lastFire.current < 350) return;
      lastFire.current = now;
      dispatchRef.current?.(action);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [keys]);

  const fire = (action) => () => {
    const now = performance.now();
    if (now - lastFire.current < 250) return;
    lastFire.current = now;
    session.dispatch(action);
  };

  return { spec, fire };
}

/**
 * Panel button with the click sound. tone: gold | green | blue | red | dark | paper; size: sm | md | lg.
 * Plain <button>, styled by controlpanel.css (`.cp-btn`).
 */
export function PanelButton({ tone = 'paper', size = 'md', className = '', onClick, sound = 'click', type = 'button', children, ...rest }) {
  const handle = (e) => {
    if (sound) {
      try { sfx.play(sound); } catch { /* sound is optional */ }
    }
    onClick?.(e);
  };
  return (
    <button type={type} className={`cp-btn cp-btn--${tone} cp-btn--${size} ${className}`.trim()} onClick={handle} {...rest}>
      {children}
    </button>
  );
}

const SOUND = { RIDE: 'ride', USE_CHAI: 'chai', PAY_TRAFFIC: 'pay' };
const soundOf = (action) => SOUND[action?.type] || 'click';
const Glyph = ({ name, size }) => <Icon name={name} size={size} />;

export default function ActionBar({ spec, fire, className = '' }) {
  const { primary } = spec;
  const secondaries = spec.secondaries.filter((sec) => !sec.wide);
  const wide = spec.secondaries.filter((sec) => sec.wide);
  return (
    <div
      className={`cp-actions ${className}`.trim()}
      data-kind={spec.kind}
      data-sec={secondaries.length}
      data-wide={wide.length || spec.hint ? 1 : undefined}
      role="group"
      aria-label="Actions"
    >
      <p className="cp-sr" role="status" aria-live="polite">{spec.sr}</p>

      {spec.hint ? (
        <p className={`cp-hint is-${spec.hint.key}`}>
          <Glyph name={spec.hint.icon} size={14} />
          <span className="cp-hint__txt">{spec.hint.text}</span>
        </p>
      ) : null}

      {secondaries.length > 0 ? (
        <div className="cp-actions__sec">
          {secondaries.map((sec) => (
            <PanelButton
              key={sec.key}
              tone={sec.tone && sec.tone !== 'dark' ? sec.tone : 'paper'}
              className={`cp-sec is-${sec.key}`}
              sound={soundOf(sec.action)}
              onClick={fire(sec.action)}
              aria-label={sec.sub ? `${sec.label}. ${sec.sub}` : sec.amount ? `${sec.label} ${sec.amount}` : sec.label}
            >
              <span className="cp-btn__label">{sec.icon ? <Glyph name={sec.icon} size={16} /> : null}{sec.label}</span>
              {sec.amount ? <span className="cp-btn__amount is-small">{sec.amount}</span> : null}
              {sec.sub ? <span className="cp-btn__sub">{sec.sub}</span> : null}
            </PanelButton>
          ))}
        </div>
      ) : null}

      {primary ? (
        <PanelButton
          tone={primary.tone}
          size="lg"
          className={`cp-primary is-${primary.key}`}
          sound={soundOf(primary.action)}
          onClick={fire(primary.action)}
          title={primary.sub ? `${primary.label}. ${primary.sub}` : primary.label}
          aria-label={primary.amount ? `${primary.label} for ${primary.amount}` : primary.sub ? `${primary.label}. ${primary.sub}` : primary.label}
        >
          <span className="cp-btn__main">
            {primary.icon ? <Glyph name={primary.icon} size={22} /> : null}
            <span className="cp-btn__label">{primary.label}</span>
            {primary.amount ? <span className="cp-btn__amount">{primary.amount}</span> : null}
          </span>
          {primary.sub ? <span className="cp-btn__sub">{primary.sub}</span> : null}
          {primary.kbd ? <kbd className="cp-kbd" aria-hidden="true">{primary.kbd}</kbd> : null}
        </PanelButton>
      ) : (
        <PanelButton tone="dark" size="lg" className={`cp-primary is-wait is-${spec.kind}`} disabled sound={null}>
          {spec.kind === 'busy' ? (
            <span className="cp-dots" aria-hidden="true"><i /><i /><i /></span>
          ) : (
            <>
              <span className="cp-btn__main">
                {spec.waitFor ? (
                  <span className="cp-btn__mini" style={{ '--pc': spec.waitFor.color }}><Avatar preset={spec.waitFor.avatar} size={24} /></span>
                ) : null}
                <span className="cp-btn__label">{spec.label}</span>
                {spec.waitFor ? <span className="cp-dots is-quiet" aria-hidden="true"><i /><i /><i /></span> : null}
              </span>
              {spec.sub ? <span className="cp-btn__sub">{spec.sub}</span> : null}
            </>
          )}
        </PanelButton>
      )}

      {wide.map((sec) => (
        <PanelButton
          key={sec.key}
          tone="paper"
          size="sm"
          className={`cp-wide is-${sec.key}`}
          sound={soundOf(sec.action)}
          onClick={fire(sec.action)}
          title={sec.sub ? `${sec.label}: ${sec.sub}` : sec.label}
          aria-label={sec.sub ? `${sec.label}. ${sec.sub}` : sec.label}
        >
          <span className="cp-btn__label">{sec.icon ? <Glyph name={sec.icon} size={16} /> : null}{sec.label}</span>
          {sec.sub ? <span className="cp-wide__sub">{sec.sub}</span> : null}
        </PanelButton>
      ))}
    </div>
  );
}
