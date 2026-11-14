// Tap any square. A district opens its DEED: collection + identity, lore with the heritage note, price, the rent
// ladder of its three themed businesses (current one highlighted, full-set x1.5 on the first, city-event modifier),
// upgrade cost, mortgage line, owner chip and the owner's actions from session.options (Upgrade to <next> /
// Sell <current> / Mortgage / Unmortgage), plus Buy / Skip while that purchase is pending.
// Special squares (START, transport, cards, Traffic Jam, Chai Adda, Municipal Charges, Bazaar Auction) show their rule.
import '@/styles/deed.css';
import '@/styles/sheets.css';
import { TileIcon } from '@/components/art/index.js';
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import PlayerToken, { artPart } from './ui/PlayerToken.jsx';
import { LevelPips, SetDots } from './ui/TileChip.jsx';
import {
  CHAI_CAP, CHAI_MIN_RENT, DEFAULT_CFG, MAX_LEVEL, MUNICIPAL_BASE, MUNICIPAL_PER_LEVEL, PASS_START_AMOUNT, SET_BONUS_MULT,
  TRAFFIC_FINE, canUpgradeSafe, collectionOf, deckOf, diceSum, eventModifier, fareOf, groupTiles, isBuyableTile,
  landingOddsSafe, levelNameOf, mortgageOf, nextStop, previewRentSafe, rentLadder, tileAccent, tileTypeLabel,
  unmortgageOf, upgradeCostOf, useHeld, useStateLike,
} from './ui/helpers.js';

const X = '×';
export const HERITAGE_NOTE = 'A fictional venture in the precinct, not the landmark itself.';
const fmtMult = (m) => `${X}${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, '')}`;

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
    const { color, ink } = tileAccent(tile);
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
    const ladder = district ? rentLadder(tile) : [];
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
    const oddsPct = p == null ? null : p > 0 && p < 0.005 ? '<1' : String(Math.round(p * 100));

    const BuildingArt = district ? artPart('BuildingArt') : null;
    const CardBack = tile.type === 'card' ? artPart('CardBack') : null;
    header = (
      <div className="hg-prop-band" data-drag="" style={{ '--band': color, '--ink': ink }}>
        <span className="hg-prop-icon">
          {BuildingArt && owner
            ? <BuildingArt theme={coll?.theme} group={tile.group} level={level} color={color} size={48} />
            : CardBack ? <CardBack deck={tile.deck} size={46} /> : <TileIcon tile={tile} size={44} />}
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

    /* ---- the deed card itself ---- */
    let deed = null;
    if (district && mortgaged) {
      deed = (
        <div className="hg-deed hg-deed--mortgaged" style={{ '--band': color }}>
          <b className="hg-deed-mname">{tile.name}</b>
          <b className="hg-deed-stamp">Mortgaged</b>
          <p>for {formatINR(mortgageOf(tile))}</p>
          <em>
            Collects no rent and cannot be upgraded.
            {mine ? ` Pay ${formatINR(unmortgageOf(tile))} to unmortgage.` : ''}
          </em>
        </div>
      );
    } else if (district) {
      deed = (
        <div className="hg-deed" style={{ '--band': color }}>
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
                const setLine = i === 0 ? (
                  fullSet
                    ? `Full set: ${fmtMult(SET_BONUS_MULT)} = ${formatINR(Math.round(rent * SET_BONUS_MULT))}`
                    : `${fmtMult(SET_BONUS_MULT)} with the full set`
                ) : null;
                const evLine = ev && (!ev.upgradedOnly || i > 0)
                  ? `${ev.title}: ${formatINR(Math.round(rent * (i === 0 && fullSet ? SET_BONUS_MULT : 1) * ev.mult))}` : null;
                return (
                  <tr key={i} className={current ? 'is-current' : ''}>
                    <th scope="row">
                      <span className="hg-deed-lvl" aria-hidden="true">{i + 1}</span>
                      {levelNameOf(tile, i)}
                    </th>
                    <td>
                      {formatINR(rent)}
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
        <div className="hg-deed hg-deed--special" style={{ '--band': color }}>
          <p className="hg-deed-rule">{sp.rule}</p>
          {sp.note ? <p className="hg-deed-note">{sp.note}</p> : null}
        </div>
      );
    }

    body = (
      <>
        {district && coll?.identity ? <p className="hg-deed-identity" style={{ '--band': color }}>{coll.identity}</p> : null}
        {tile.lore ? (
          <p className="hg-lore">
            {tile.lore}
            {district ? <small className="hg-heritage">{HERITAGE_NOTE}</small> : null}
          </p>
        ) : district ? <p className="hg-lore"><small className="hg-heritage">{HERITAGE_NOTE}</small></p> : null}

        {district ? (
          <div className="hg-deed-hero">
            <div><span>Price</span><b>{formatINR(tile.price)}</b></div>
            {owner ? (
              <div><span>Rent now</span><b className={mortgaged ? 'is-dim' : 'is-gold'}>{mortgaged ? 'None' : formatINR(rentNow)}</b></div>
            ) : (
              <div><span>Base rent</span><b>{formatINR(ladder[0] || 0)}</b></div>
            )}
            <div>
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

        {deed}

        {oddsPct != null ? (
          <div className="hg-odds" role="status">
            <Icon name="dice" size={18} />
            <span>Chance to land here next roll: <b>{oddsPct}%</b></span>
            <i aria-hidden="true"><em style={{ '--f': Math.min(1, Math.max(0, (p || 0) * 4)).toFixed(3) }} /></i>
          </div>
        ) : null}

        {district ? (
          <div className={`hg-setstat${fullSet ? ' is-full' : ''}`} style={{ '--sc': color }}>
            <SetDots
              owned={ownedInSet}
              total={setIds.length}
              color={color}
              colors={setIds.map((t) => state.players.find((pl) => pl.id === state.owners[t])?.color || null)}
            />
            <span>
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
