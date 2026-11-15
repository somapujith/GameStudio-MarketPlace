// Tap any square. A district opens its DEED: a diorama of the business you run there (or would open), the three
// numbers a player needs (price, rent, owner), lore with the heritage note, the title deed itself (rent ladder of the
// three themed businesses with the current one lit, full-set x1.5 on the first, city-event modifier, upgrade cost,
// mortgage line), the landing chance, the collection as three real slots, and the owner's actions from
// session.options (Upgrade to <next> / Sell <current> / Mortgage / Unmortgage), plus Buy / Skip while that purchase
// is pending. Special squares (START, transport, cards, Traffic Jam, Chai Adda, Municipal Charges, Bazaar Auction)
// show their rule on the same stage + deed paper.
// Motion is transform / opacity only (property.css, deed.css) and is switched off for reduced motion.
import { useLayoutEffect, useRef } from 'react';
import '@/styles/deed.css';
import '@/styles/sheets.css';
import '@/styles/property.css';
import { TileIcon } from '@/components/art/index.js';
import LocationScene from '@/components/art/LocationScene.jsx';
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import PlayerToken, { artPart } from './ui/PlayerToken.jsx';
import { LevelPips } from './ui/TileChip.jsx';
import {
  CHAI_CAP, CHAI_MIN_RENT, DEFAULT_CFG, MAX_LEVEL, MUNICIPAL_BASE, MUNICIPAL_PER_LEVEL, PASS_START_AMOUNT, SET_BONUS_MULT,
  TRAFFIC_FINE, canUpgradeSafe, collectionOf, deckOf, diceSum, eventModifier, fareOf, groupTiles, isBuyableTile,
  landingOddsSafe, levelNameOf, mortgageOf, motionMs, nextStop, previewRentSafe, rentLadder, scaleRent, tileAccent, tileTypeLabel,
  unmortgageOf, upgradeCostOf, useHeld, useReducedMotion, useStateLike,
} from './ui/helpers.js';

const X = '×';
export const HERITAGE_NOTE = 'A fictional venture in the precinct, not the landmark itself.';
const fmtMult = (m) => `${X}${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, '')}`;

/* ------------------------------------------------------------------ colour helpers (pure, tested) */

const FALLBACK_COLOR = '#3b2d8f';
const DARK_INK = '#14161f';
const LIGHT_INK = '#ffffff';
const NIGHT = '#0a0f1a';
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
const hexRgb = (h) => {
  const n = parseInt(String(h).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** Mix `a` toward `b` by `t` (0..1). */
export const mixHex = (a, b, t) => {
  const A = hexRgb(a);
  const B = hexRgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
};
const relLum = (hex) => {
  const [r, g, b] = hexRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #rrggbb colours (1..21). */
export function contrastRatio(a, b) {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** White or near-black, whichever reads better on `hex` (a player colour chip, for instance). */
export const bestInk = (hex) => (contrastRatio(hex, LIGHT_INK) >= contrastRatio(hex, DARK_INK) ? LIGHT_INK : DARK_INK);

/**
 * Header tones for a collection colour. White ink is used when a slightly deeper shade of the colour reaches
 * WCAG AA (4.5:1) with it, otherwise near-black ink on the colour itself; either way the whole band
 * (`from` -> `to`) stays at AA or better under the title, kicker and pill text.
 */
export function bandTones(color) {
  const c = isHex(color) ? color : FALLBACK_COLOR;
  for (let t = 0; t <= 0.18; t += 0.03) {
    const base = mixHex(c, NIGHT, t);
    if (contrastRatio(base, LIGHT_INK) >= 4.5) {
      return { ink: LIGHT_INK, from: base, to: mixHex(base, NIGHT, 0.34), pill: 'rgba(5, 8, 18, 0.32)', emboss: 'rgba(0, 0, 0, 0.38)', hl: 'rgba(255, 255, 255, 0.05)' };
    }
  }
  let base = c;
  for (let t = 0.03; t <= 0.9 && contrastRatio(base, DARK_INK) < 4.5; t += 0.03) base = mixHex(c, LIGHT_INK, t);
  return { ink: DARK_INK, from: mixHex(base, LIGHT_INK, 0.2), to: base, pill: 'rgba(255, 255, 255, 0.42)', emboss: 'rgba(255, 255, 255, 0.55)', hl: 'rgba(255, 255, 255, 0.3)' };
}

/** `c` nudged (darker for white ink, lighter for dark ink) until `ink` reads on it at AA (4.5:1). */
function readableOn(c, ink) {
  const toward = ink === LIGHT_INK ? NIGHT : LIGHT_INK;
  let out = c;
  for (let t = 0.04; t <= 0.9 && contrastRatio(out, ink) < 4.5; t += 0.04) out = mixHex(c, toward, t);
  return out;
}

/** Fill colours of an owner's slot: the chip stays AA with its ink from edge to edge. */
export function slotTones(color) {
  const c = isHex(color) ? color : FALLBACK_COLOR;
  const ink = bestInk(c);
  const base = readableOn(c, ink);
  return ink === LIGHT_INK
    ? { ink, from: base, to: mixHex(base, NIGHT, 0.28) }
    : { ink, from: mixHex(base, LIGHT_INK, 0.3), to: base };
}

/** Landing odds -> meter fill (a quarter chance fills the bar) and the label ("<1" below half a percent). */
export function oddsMeter(p) {
  if (p == null || !Number.isFinite(p)) return null;
  return {
    fill: Math.min(1, Math.max(0, p * 4)),
    pct: p > 0 && p < 0.005 ? '<1' : String(Math.round(p * 100)),
  };
}

/** Steps of a count-up from `from` to `to` (round numbers for big amounts so digits do not flicker). */
export function countSteps(from, to, n = 12) {
  const step = Math.abs(to) >= 10000 ? 1000 : 1;
  const out = [];
  for (let i = 1; i <= n; i++) {
    const k = 1 - (1 - i / n) ** 3;
    out.push(i === n ? to : Math.round((from + (to - from) * k) / step) * step);
  }
  return out;
}

/* ------------------------------------------------------------------ squares */

/** What a non-district square does: a headline rule plus an optional second sentence. */
export function squareRule(tile, { cfg = {}, state = null, me = null } = {}) {
  const passStart = cfg.passStart ?? PASS_START_AMOUNT;
  switch (tile.type) {
    case 'start':
      return { rule: `Collect ${formatINR(passStart)} every time you pass or land on START.`, note: 'Once per move. Moving backwards never pays.' };
    case 'transport': {
      const to = nextStop(tile);
      return {
        rule: `Pay ${formatINR(fareOf(tile))} to ride ahead to ${to ? to.name : 'the next stop'}.`,
        note: 'Optional, offered when you land here. Passing START on the way still pays your salary. "Meter kharab hai, saab!"',
      };
    }
    case 'card': {
      const deck = deckOf(tile);
      return { rule: `Draw a ${deck ? deck.name : 'city'} card.`, note: deck?.blurb || null };
    }
    case 'traffic': {
      const fine = cfg.trafficFine ?? TRAFFIC_FINE;
      return {
        rule: 'Stuck in traffic! Your turn ends here.',
        note: `Next turn: pay ${formatINR(fine)}, spend a chai token, or wait it out (no move that turn).`,
      };
    }
    case 'chai':
      return {
        rule: `Grab a chai token (you can hold ${cfg.chaiCap ?? CHAI_CAP}).`,
        note: `It halves your next rent of ${formatINR(CHAI_MIN_RENT)} or more by itself, or gets you out of traffic.`,
      };
    case 'municipal': {
      const mine = state?.players?.find((p) => p.id === me && !p.bankrupt);
      let levels = 0;
      if (mine) state.owners.forEach((o, i) => { if (o === me) levels += state.levels?.[i] || 0; });
      return {
        rule: `Pay ${formatINR(MUNICIPAL_BASE)} + ${formatINR(MUNICIPAL_PER_LEVEL)} per upgrade level you own.`,
        note: mine ? `You own ${levels} upgrade level${levels === 1 ? '' : 's'}: this square would cost you ${formatINR(MUNICIPAL_BASE + levels * MUNICIPAL_PER_LEVEL)} now.` : null,
      };
    }
    case 'auction':
      return {
        rule: 'Bazaar Auction: a random unowned district goes under the hammer.',
        note: 'Everyone, you included, places one sealed bid. The minimum is half its price. Nothing left unowned? Nothing happens.',
      };
    default:
      return { rule: tile.lore || '', note: null };
  }
}

/* ------------------------------------------------------------------ small pieces */

/**
 * A rupee amount that counts up when the sheet opens (and eases to a new value if it changes). The markup always
 * carries the final text (SSR, tests, screen readers); the count is a DOM-level tween on top of it, skipped for
 * reduced motion.
 */
function CountUp({ value }) {
  const ref = useRef(null);
  const shown = useRef(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    const to = Number(value) || 0;
    if (!el) return undefined;
    const from = shown.current == null ? 0 : shown.current;
    if (reduced || from === to) {
      el.textContent = formatINR(to);
      shown.current = to;
      return undefined;
    }
    const steps = countSteps(from, to);
    const total = motionMs('--dur-4', 600);
    el.textContent = formatINR(from);
    let timer = 0;
    let raf = 0;
    const t0 = performance.now() + 170; // let the sheet slide in first
    const tick = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / total));
      const i = k <= 0 ? -1 : Math.min(steps.length - 1, Math.floor(k * steps.length));
      if (i >= 0) {
        el.textContent = formatINR(steps[i]);
        shown.current = steps[i];
      }
      if (k < 1) raf = requestAnimationFrame(tick);
      else { el.textContent = formatINR(to); shown.current = to; }
    };
    timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, 0);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [value, reduced]);
  return <span ref={ref} className="hg-count">{formatINR(value)}</span>;
}

/** Landing-chance meter: a gradient bar that fills (a quarter chance = full) with a die riding its tip. */
function OddsMeter({ p }) {
  const m = oddsMeter(p);
  if (!m) return null;
  return (
    <div className="hg-odds" role="status" style={{ '--f': m.fill.toFixed(3) }}>
      <Icon name="dice" size={18} />
      <span>Chance to land here next roll: <b>{m.pct}%</b></span>
      <i aria-hidden="true">
        <em />
        <u><Icon name="dice" size={14} /></u>
      </i>
    </div>
  );
}

/** The collection as real slots: owned ones are filled with the owner's colour and glow, missing ones are dashed. */
function SetSlots({ tile, setIds, state, me }) {
  const taken = setIds.filter((t) => state.owners?.[t]).length;
  return (
    <ol className="hg-slots" role="img" aria-label={`${taken} of ${setIds.length} owned`}>
      {setIds.map((t) => {
        const T = TILES[t];
        const o = state.players.find((pl) => pl.id === state.owners?.[t]) || null;
        const mort = !!state.mortgaged?.[t];
        const st = o ? slotTones(o.color) : null;
        return (
          <li
            key={t}
            className={`hg-slot${o ? ' is-on' : ''}${t === tile.id ? ' is-here' : ''}${mort ? ' is-mort' : ''}`}
            style={st ? { '--pc': o.color, '--pi': st.ink, '--pf': st.from, '--pt': st.to } : undefined}
          >
            <span className="hg-slot-name">{T?.short || T?.name}</span>
            <span className="hg-slot-sub">{o ? (o.id === me ? 'You' : o.name) : 'Open'}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function PropertySheet({ session, tileId, onClose }) {
  const heldId = useHeld(tileId);
  const state = useStateLike(session);
  const tile = heldId != null ? TILES[heldId] : null;
  const o = session.options || {};
  const me = session.me;

  let body = null;
  let footer = null;
  let header = null;

  if (tile) {
    const { color } = tileAccent(tile);
    const tones = bandTones(color);
    const cfg = { ...DEFAULT_CFG, ...(session.view?.cfg || {}) };
    const district = tile.type === 'property';
    const buyable = isBuyableTile(tile);
    const coll = district ? collectionOf(tile) : null;
    const ownerId = buyable ? state.owners?.[tile.id] : null;
    const owner = ownerId ? state.players.find((p) => p.id === ownerId) : null;
    const level = state.levels?.[tile.id] || 0;
    const mine = !!ownerId && ownerId === me;
    const mortgaged = buyable && !!state.mortgaged?.[tile.id];
    const pend = session.view?.pending;
    const buyingThis = !!o.buy && pend?.type === 'buy' && pend.tile === tile.id;
    const skippingThis = !!o.skipBuy && pend?.type === 'buy' && pend.tile === tile.id;

    const setIds = district ? groupTiles(tile.group) : [];
    const ownedInSet = owner ? setIds.filter((t) => state.owners[t] === owner.id).length : 0;
    const fullSet = !!owner && setIds.length > 0 && ownedInSet === setIds.length;
    const baseLadder = district ? rentLadder(tile) : []; // the printed rents; every figure below is round(rent x multipliers x the table's rent level), like the engine
    const ladder = district ? rentLadder(tile, state.cfg) : [];
    const ev = district ? eventModifier(state, tile) : null;
    const rentNow = buyable && ownerId && !mortgaged ? previewRentSafe(state, tile.id, diceSum(session)) : 0;
    const youOrName = owner ? (owner.id === me ? 'You' : owner.name) : '';

    const buildOpt = o.upgrade?.find((u) => u.tile === tile.id);
    const sellOpt = o.sellBuilding?.find((u) => u.tile === tile.id);
    const mortOpt = o.mortgage?.find((u) => u.tile === tile.id);
    const unmortOpt = o.unmortgage?.find((u) => u.tile === tile.id);
    const up = mine && district ? canUpgradeSafe(session.view, me, tile.id) : null;
    const canBuild = !!buildOpt && !session.busy;
    const topLevel = level >= MAX_LEVEL;
    const nextName = levelNameOf(tile, Math.min(MAX_LEVEL, level + 1));

    const odds = o.roll ? landingOddsSafe(session.view, me) : null;
    const p = odds ? odds[tile.id] : null;

    const BuildingArt = district ? artPart('BuildingArt') : null;
    const CardBack = tile.type === 'card' ? artPart('CardBack') : null;
    const stageLevel = owner ? level : 0;
    const slab = mixHex(color, '#241a5c', 0.5);
    const bandVars = {
      '--band': color, '--ink': tones.ink, '--b1': tones.from, '--b2': tones.to, '--pill': tones.pill, '--emb': tones.emboss, '--hl': tones.hl,
    };

    header = (
      <div className="hg-prop-band" data-drag="" style={bandVars}>
        <span className="hg-prop-icon">
          {CardBack ? <CardBack deck={tile.deck} size={34} /> : <TileIcon tile={tile} size={40} />}
        </span>
        <div className="hg-prop-titles">
          <p className="hg-kicker hg-deed-kicker">{district ? coll?.name || 'District' : tile.corner ? 'Corner' : 'Square'}</p>
          <h2>{tile.name}</h2>
        </div>
        <span className="hg-prop-type">
          {district ? (owner ? levelNameOf(tile, level) : 'District for sale') : tileTypeLabel(tile)}
        </span>
      </div>
    );

    /* ---- the stage: the business you run here (or would open), under a Hyderabad skyline ---- */
    const stage = (
      <div
        className={`hg-prop-stage has-location${district ? '' : ' is-special'}${owner ? ' is-owned' : ''}${mortgaged ? ' is-mort' : ''}${fullSet ? ' is-set' : ''}`}
        style={{ '--band': color, ...(owner ? { '--pc': owner.color } : null) }}
      >
        <LocationScene key={`${tile.id}-${stageLevel}`} tile={tile} level={stageLevel} animated={!mortgaged} />
        {district ? (
          <div className="hg-prop-chips">
            <span className="hg-prop-chip">
              {owner ? `Level ${level + 1} of ${ladder.length}` : `Opens as ${levelNameOf(tile, 0)}`}
            </span>
            {owner && !mortgaged ? (
              fullSet ? (
                <span className="hg-prop-chip hg-prop-bonus is-on"><Icon name="spark" size={13} />Set bonus {fmtMult(SET_BONUS_MULT)}</span>
              ) : (
                <span className="hg-prop-chip hg-prop-bonus"><Icon name="lock" size={13} />Set bonus {fmtMult(SET_BONUS_MULT)}</span>
              )
            ) : null}
          </div>
        ) : null}
        {district ? (
          <div className="hg-deed-hero">
            <div className="is-price"><span>Price</span><b><CountUp value={tile.price} /></b></div>
            {owner ? (
              <div className="is-rent">
                <span>Rent now</span>
                <b className={mortgaged ? 'is-dim' : 'is-gold'}>{mortgaged ? 'None' : <CountUp value={rentNow} />}</b>
              </div>
            ) : (
              <div className="is-rent"><span>Base rent</span><b><CountUp value={ladder[0] || 0} /></b></div>
            )}
            <div className={`is-owner${owner ? '' : ' is-open'}`}>
              <span>Owner</span>
              {owner ? (
                <b className="hg-owner" style={{ '--pc': owner.color }}>
                  <PlayerToken player={owner} size={22} />
                  <span className="hg-owner-name">{owner.id === me ? 'You' : owner.name}</span>
                </b>
              ) : (
                <b className="is-dim">Unowned</b>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );

    /* ---- the deed card itself ---- */
    const deedNo = district ? `No. ${String(tile.id).padStart(3, '0')}` : `Sq. ${String(tile.id).padStart(2, '0')}`;
    const deedTop = (
      <div className="hg-deed-top">
        <span className="hg-deed-top-t"><i aria-hidden="true" />{district ? 'Title deed' : 'Square rule'}</span>
        <span className="hg-deed-no">{deedNo}</span>
      </div>
    );
    let deed = null;
    if (district && mortgaged) {
      deed = (
        <div className="hg-deed hg-deed--mortgaged" style={bandVars}>
          {deedTop}
          <div className="hg-deed-mbody">
            <b className="hg-deed-mname">{tile.name}</b>
            <b className="hg-deed-stamp">Mortgaged</b>
            <p>for {formatINR(mortgageOf(tile))}</p>
            <em>
              Collects no rent and cannot be upgraded.
              {mine ? ` Pay ${formatINR(unmortgageOf(tile))} to unmortgage.` : ''}
            </em>
          </div>
        </div>
      );
    } else if (district) {
      const BuildingThumb = BuildingArt;
      deed = (
        <div className="hg-deed" style={bandVars}>
          {deedTop}
          {ev ? (
            <p className={`hg-deed-event${ev.mult < 1 ? ' is-down' : ''}`} role="status">
              <Icon name="spark" size={14} />
              <span><b>{ev.title}</b>: rent {fmtMult(ev.mult)}{ev.upgradedOnly ? ' on upgraded businesses' : ''} this round</span>
            </p>
          ) : null}
          <table className="hg-deed-table hg-deed-ladder" aria-label="Rent by business">
            <tbody>
              {ladder.map((rent, i) => {
                const current = !!owner && level === i;
                const built = !!owner && i < level;
                const setLine = i === 0 ? (
                  fullSet
                    ? `Full set: ${fmtMult(SET_BONUS_MULT)} = ${formatINR(scaleRent(baseLadder[i] * SET_BONUS_MULT, state.cfg))}`
                    : `${fmtMult(SET_BONUS_MULT)} with the full set`
                ) : null;
                const evLine = ev && (!ev.upgradedOnly || i > 0)
                  ? `${ev.title}: ${formatINR(scaleRent(baseLadder[i] * (i === 0 && fullSet ? SET_BONUS_MULT : 1) * ev.mult, state.cfg))}` : null;
                return (
                  <tr key={i} className={current ? 'is-current' : built ? 'is-built' : owner ? 'is-next' : ''}>
                    <th scope="row" aria-current={current ? 'true' : undefined}>
                      <span className="hg-deed-name">
                        <span className="hg-deed-thumb" aria-hidden="true">
                          {BuildingThumb ? <BuildingThumb theme={coll?.theme} group={tile.group} level={i} color={color} size={58} slab={slab} /> : null}
                        </span>
                        <span className="hg-deed-lvltxt">
                          <small>Level {i + 1}</small>
                          <b>{levelNameOf(tile, i)}</b>
                        </span>
                      </span>
                    </th>
                    <td>
                      <span className="hg-deed-rent">{formatINR(rent)}</span>
                      {setLine ? <small className={fullSet ? 'is-on' : ''}>{setLine}</small> : null}
                      {evLine ? <small className="is-event">{evLine}</small> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="hg-deed-foot">
            <p className="hg-deed-line"><span>Upgrade</span><b>{formatINR(upgradeCostOf(tile))}</b><small>each step</small></p>
            <p className="hg-deed-line">
              <span>Mortgage value</span><b>{formatINR(mortgageOf(tile))}</b>
              {mine ? <small>lift for {formatINR(unmortgageOf(tile))}</small> : null}
            </p>
          </div>
        </div>
      );
    } else {
      const sp = squareRule(tile, { cfg, state, me });
      deed = (
        <div className="hg-deed hg-deed--special" style={bandVars}>
          {deedTop}
          <div className="hg-deed-sbody">
            <p className="hg-deed-rule">{sp.rule}</p>
            {sp.note ? <p className="hg-deed-note">{sp.note}</p> : null}
          </div>
        </div>
      );
    }

    body = (
      <>
        {stage}

        {tile.lore || district ? (
          <div className="hg-prop-lore" style={{ '--band': color }}>
            {district && coll?.identity ? <p className="hg-deed-identity">{coll.identity}</p> : null}
            {tile.lore ? (
              <p className="hg-lore">
                {tile.lore}
                {district ? <small className="hg-heritage">{HERITAGE_NOTE}</small> : null}
              </p>
            ) : district ? <p className="hg-lore"><small className="hg-heritage">{HERITAGE_NOTE}</small></p> : null}
          </div>
        ) : null}

        {deed}

        <OddsMeter p={p} />

        {district ? (
          <div className={`hg-setstat${fullSet ? ' is-full' : ''}`} style={{ '--sc': color }}>
            <SetSlots tile={tile} setIds={setIds} state={state} me={me} />
            <span className="hg-setstat-txt">
              <b>{coll?.name}</b>
              {' · '}
              {!owner
                ? `${setIds.filter((t) => state.owners[t]).length}/${setIds.length} owned`
                : fullSet
                  ? `${youOrName} own${owner.id === me ? '' : 's'} the full set: first businesses pay ${fmtMult(SET_BONUS_MULT)}`
                  : `${youOrName} own${owner.id === me ? '' : 's'} ${ownedInSet}/${setIds.length}`}
            </span>
          </div>
        ) : null}

        {owner && district && !mortgaged ? (
          <p className="hg-deed-level">
            <LevelPips level={level} color={color} tile={tile} />
            <span>{topLevel ? `Top business: ${levelNameOf(tile, level)}` : `${levelNameOf(tile, level)} · next: ${nextName}`}</span>
          </p>
        ) : null}
      </>
    );

    const sub = (sellOpt || mortOpt || unmortOpt) ? (
      <div className="hg-sheet-subactions">
        {sellOpt ? (
          <Button variant="dark" size="sm" disabled={session.busy} onClick={() => session.dispatch({ type: 'SELL_BUILDING', tile: tile.id })}>
            Sell {levelNameOf(tile, level)} +{formatINR(sellOpt.refund ?? Math.round(upgradeCostOf(tile) / 2))}
          </Button>
        ) : null}
        {mortOpt ? (
          <Button variant="dark" size="sm" disabled={session.busy} onClick={() => session.dispatch({ type: 'MORTGAGE', tile: tile.id })}>
            Mortgage +{formatINR(mortOpt.value ?? mortgageOf(tile))}
          </Button>
        ) : null}
        {unmortOpt ? (
          <Button variant="green" size="sm" disabled={session.busy} onClick={() => session.dispatch({ type: 'UNMORTGAGE', tile: tile.id })}>
            Unmortgage {formatINR(unmortOpt.cost ?? unmortgageOf(tile))}
          </Button>
        ) : null}
      </div>
    ) : null;

    const ride = tile.type === 'transport' && o.ride && state.players.find((pl) => pl.id === me)?.pos === tile.id ? o.ride : null;

    if (buyingThis || skippingThis) {
      footer = (
        <div className="hg-sheet-actions">
          {skippingThis ? <Button variant="dark" onClick={() => { session.dispatch({ type: 'SKIP_BUY' }); onClose?.(); }}>Skip</Button> : null}
          {buyingThis ? (
            <Button variant="green" size="lg" onClick={() => { session.dispatch({ type: 'BUY' }); onClose?.(); }}>
              Buy for {formatINR(pend.price ?? tile.price)}
            </Button>
          ) : (
            <span className="hg-hint is-warn">Not enough cash to buy</span>
          )}
        </div>
      );
    } else if (ride) {
      const to = TILES[ride.to] || nextStop(tile);
      footer = (
        <div className="hg-sheet-actions">
          <Button variant="gold" size="lg" disabled={session.busy} onClick={() => { session.dispatch({ type: 'RIDE' }); onClose?.(); }}>
            Ride to {to?.name || 'the next stop'} &middot; {formatINR(ride.fare ?? fareOf(tile))}
          </Button>
        </div>
      );
    } else if (mine && district && !mortgaged) {
      footer = (
        <div className="hg-sheet-actions">
          <Button
            variant={canBuild ? 'gold' : 'dark'}
            size="lg"
            className={canBuild && level + 1 === MAX_LEVEL ? 'hg-btn--hotel' : ''}
            disabled={!canBuild}
            onClick={() => session.dispatch({ type: 'UPGRADE', tile: tile.id })}
          >
            <Icon name="upgrade" size={20} />
            {topLevel
              ? `Top business: ${levelNameOf(tile, level)}`
              : <>Upgrade to {nextName} &middot; {formatINR(buildOpt?.cost ?? upgradeCostOf(tile))}</>}
          </Button>
          {!canBuild && !topLevel ? (
            <span className="hg-hint">
              {session.busy ? 'Wait for the action to finish' : up && !up.ok && up.reason ? up.reason : 'You can upgrade on your turn'}
            </span>
          ) : null}
          {sub}
        </div>
      );
    } else if (mine && sub) {
      footer = <div className="hg-sheet-actions">{sub}</div>;
    }
  }

  return (
    <Sheet
      open={tileId != null}
      onClose={onClose}
      ariaLabel={tile ? tile.name : 'Tile details'}
      header={header}
      footer={footer}
      className="hg-propsheet"
      desktop="drawer"
    >
      {body}
    </Sheet>
  );
}
