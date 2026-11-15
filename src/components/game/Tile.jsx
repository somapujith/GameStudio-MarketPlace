import { memo, useContext } from 'react';
import * as B from '@shared/board.js';
import { compactINR, formatINR } from '@shared/format.js';
import { BuildingArt, TileIcon } from '@/components/art/index.js';
import { cornerOf, sideOf } from './fx/geometry.js';
import { BuildPop, CardShimmer, ChaiSteam, OwnerChip, OwnerStamp } from './fx/TileFx.jsx';
import { PieceToken } from './Pawn.jsx';
import { labelLines } from './tileLabel.js';
import PhoneBoardContext from './phone/PhoneBoardContext.js';
import PhoneTileFace from './phone/PhoneTileFace.jsx';
import '@/styles/board.css';

const { GROUPS, MAX_LEVEL } = B;
const SHY = '­';
// looked up by name: the Hustle engine ships rentTable(tile) -> [L0, L1, L2]; older builds only rentFor
const RENT_TABLE = 'rentTable';
const DEFAULT_SALARY = 200000;

// Hand-picked syllable breaks for the long Hyderabad names so they wrap on a narrow tile (a soft hyphen
// only breaks the word when it does not fit, so wide boards still show the whole name).
const BREAKS = {
  Chowmahalla: 'Chow' + SHY + 'mahalla',
  Charminar: 'Char' + SHY + 'minar',
  Mehdipatnam: 'Mehdi' + SHY + 'patnam',
  Tolichowki: 'Toli' + SHY + 'chowki',
  Sainikpuri: 'Sainik' + SHY + 'puri',
  Malakpet: 'Malak' + SHY + 'pet',
  Gachibowli: 'Gachi' + SHY + 'bowli',
  Kondapur: 'Konda' + SHY + 'pur',
  Madhapur: 'Madha' + SHY + 'pur',
  Necklace: 'Neck' + SHY + 'lace',
  Financial: 'Finan' + SHY + 'cial',
  District: 'Dis' + SHY + 'trict',
  Precinct: 'Pre' + SHY + 'cinct',
  Interchange: 'Inter' + SHY + 'change',
  Municipal: 'Muni' + SHY + 'cipal',
  Lumbini: 'Lum' + SHY + 'bini',
  Paradise: 'Para' + SHY + 'dise',
};
const VOWELS = 'aeiouAEIOU';

function hyphenate(word) {
  if (BREAKS[word]) return BREAKS[word];
  const mid = Math.round(word.length / 2);
  for (let d = 0; d <= 2; d++) {
    for (const i of [mid - d, mid + d]) {
      if (i > 2 && i < word.length - 2 && VOWELS.includes(word[i - 1]) && !VOWELS.includes(word[i])) {
        return word.slice(0, i) + SHY + word.slice(i);
      }
    }
  }
  return word.slice(0, mid) + SHY + word.slice(mid);
}

/** Insert soft hyphens into words that are too long for one line of a tile. */
export function softName(text) {
  return String(text || '')
    .split(' ')
    .map((w) => (BREAKS[w] || w.length >= 9 ? hyphenate(w) : w))
    .join(' ');
}

// ---- transport modes --------------------------------------------------------

/** 'auto' | 'metro' | 'mmts' for a transport stop. */
export function transportKind(tile) {
  const k = tile?.mode || tile?.ride || tile?.art;
  if (k === 'auto' || k === 'metro' || k === 'mmts') return k;
  const n = String(tile?.name || '').toLowerCase();
  if (n.includes('auto')) return 'auto';
  if (n.includes('metro')) return 'metro';
  return 'mmts';
}

// TileIcon resolves the art key itself (start, auto, metro, mmts, luck, drama, traffic, chai, municipal, auction).
const Icon = ({ tile, size }) => <TileIcon tile={tile} size={size} />;

// ---- city event marks -------------------------------------------------------
// One frozen descriptor per effect, shared by every tile it touches, so a memoised Tile only re-renders
// when its own mark appears or disappears.
const MARKS = {
  rush: Object.freeze({ tone: 'rush', text: 'x1.5', note: 'rush hour, rent x1.5 this round' }),
  boom: Object.freeze({ tone: 'boom', text: 'x2', note: 'biryani boom, upgraded businesses pay double this round' }),
  gift: Object.freeze({ tone: 'gift', text: '+20K', note: 'wedding season, upgraded venues pay their owner 20,000' }),
  rain: Object.freeze({ tone: 'rain', text: 'x0.5', note: 'monsoon, rent halved this round' }),
};

function inGroups(event, tile, fallback) {
  if (!tile.group) return false;
  if (event.group) return tile.group === event.group;
  if (Array.isArray(event.groups) && event.groups.length) return event.groups.includes(tile.group);
  return !!fallback && fallback.includes(tile.group);
}

/**
 * What the active city event (`view.event`) does to this tile, as a stable descriptor, or null.
 * rush_hour / monsoon hit one collection (`event.group`), biryani_boom the food collections, wedding_season the
 * lake and luxury venues (`event.groups` when sent). festival touches no tile.
 */
export function eventMark(event, tile) {
  if (!event || !tile || tile.type !== 'property') return null;
  switch (event.id) {
    case 'rush_hour':
      return inGroups(event, tile) ? MARKS.rush : null;
    case 'monsoon':
      return inGroups(event, tile) ? MARKS.rain : null;
    case 'biryani_boom':
      return inGroups(event, tile, ['oldcity', 'everyday']) ? MARKS.boom : null;
    case 'wedding_season':
      return inGroups(event, tile, ['lake', 'luxury']) ? MARKS.gift : null;
    default:
      return null;
  }
}

/** Rent the owner collects at a level (before set / event multipliers). */
export function tileRent(tile, level = 0) {
  try {
    const table = typeof B[RENT_TABLE] === 'function' ? B[RENT_TABLE](tile) : null;
    if (Array.isArray(table) && table.length) return table[Math.max(0, Math.min(table.length - 1, level))] || 0;
    return B.rentFor(tile, level) || 0;
  } catch {
    return 0;
  }
}

// ---- small glyphs -------------------------------------------------------------

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M12 2.5 3.5 12H9v9.5h6V12h5.5z" />
  </svg>
);

const EventIcon = ({ tone }) => {
  if (tone === 'rain') return <svg viewBox="0 0 24 24" focusable="false"><path d="M12 2.5C9 7.4 6.5 10.4 6.5 14a5.5 5.5 0 0 0 11 0c0-3.6-2.5-6.6-5.5-11.5z" /></svg>;
  if (tone === 'gift') return <svg viewBox="0 0 24 24" focusable="false"><path d="M12 21s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 8.3 4.3 4.3 0 0 1 19.5 11c0 5.4-7.5 10-7.5 10z" /></svg>;
  return <svg viewBox="0 0 24 24" focusable="false"><path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.2 1.2-6.5L2.5 9.5l6.6-.9z" /></svg>;
};

/** Level pips: one diamond per upgrade, MAX_LEVEL of them, filled up to the current level. */
function Pips({ level }) {
  const max = Math.max(1, MAX_LEVEL | 0);
  return (
    <span className="hb-pips" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < level ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

/** A transit line along the band: dashes and three stops in the mode's colour. */
const Route = () => (
  <span className="hb-route" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);

/**
 * The tile's printed name for phone boards (board.css shows it instead of `.hb-tile__name` when the board is narrow):
 * one or two short lines with real hyphens, see tileLabel.js. Decorative: the button's aria-label has the full name.
 */
function PhoneName({ tile }) {
  const lines = labelLines(tile);
  if (!lines.length) return null;
  return (
    <span className="hb-tile__nm" aria-hidden="true" data-lines={lines.length}>
      {lines.map((line, i) => (
        <span key={i}>{line}</span>
      ))}
    </span>
  );
}

const CORNER_SUB = {
  traffic: 'Stuck here',
  chai: 'Free chai',
  municipal: 'Pay up',
};

/**
 * One board tile. Pure / primitive props so React.memo can skip untouched tiles.
 *  ownerColor / ownerName / ownerId / ownerPiece: the owner (null colour = unowned).
 *  level: 0..MAX_LEVEL (level 0 = the first business). setState 'full': the owner holds the whole collection.
 *  mortgaged: greyed out with stripes and an M badge. event: descriptor from eventMark() or null.
 *  active: the mover stands here (festival-lantern glow). highlight: a sheet is open for it.
 *  stuck: players stuck on this traffic tile. chai: chai tokens in play (Chai Adda puffs steam when it rises).
 *  drawing: a card is being drawn from this tile (shimmer). salary: START's pay.
 */
function TileImpl({
  tile,
  ownerColor = null,
  ownerName = '',
  ownerId = null,
  ownerPiece = null,
  level = 0,
  setState = 'none',
  mortgaged = false,
  event = null,
  highlight = false,
  active = false,
  stuck = 0,
  chai = 0,
  drawing = false,
  salary = DEFAULT_SALARY,
  onSelect,
}) {
  const corner = cornerOf(tile.id);
  const side = sideOf(tile.id);
  const group = tile.group ? GROUPS[tile.group] : null;
  const owned = !!ownerColor;
  const isProperty = tile.type === 'property';
  const lvl = Math.max(0, Math.min(MAX_LEVEL, level | 0));
  const full = owned && !mortgaged && setState === 'full';
  const kind = tile.type === 'transport' ? transportKind(tile) : null;
  const phone = useContext(PhoneBoardContext); // the simple portrait-phone table prints its own tile faces

  const { col, row } = B.tilePosition(tile.id);
  const style = { gridColumn: col + 1, gridRow: row + 1 };
  if (group) style['--g'] = group.color;
  if (owned) style['--o'] = ownerColor;

  const cls = ['hb-tile', `hb-tile--${tile.type}`, `hb-side--${side}`];
  if (corner) cls.push('hb-tile--corner', `hb-tile--${corner}`);
  if (tile.type === 'card') cls.push(`hb-deck--${tile.deck === 'drama' ? 'drama' : 'luck'}`);
  if (kind) cls.push(`hb-mode--${kind}`);
  if (tile.group) cls.push(`hb-g--${tile.group}`);
  if (owned) cls.push('is-owned');
  if (full) cls.push('is-set');
  if (mortgaged) cls.push('is-mortgaged');
  if (isProperty && owned && lvl >= MAX_LEVEL) cls.push('is-max');
  if (event) cls.push('is-event', `is-ev--${event.tone}`);
  if (highlight) cls.push('is-hl');
  if (active) cls.push('is-active');
  if (stuck > 0) cls.push('has-stuck');
  if (drawing) cls.push('is-drawing');
  if (phone) cls.push('hb-tile--phone');

  const levelName = group && Array.isArray(group.levelNames) ? group.levelNames[lvl] : null;
  const rent = isProperty && owned ? tileRent(tile, lvl) : 0;

  // ---- accessible name
  const label = [tile.name];
  if (group) label.push(group.name);
  if (isProperty) {
    if (owned) label.push(`owned by ${ownerName || 'a player'}`, levelName || `level ${lvl}`, mortgaged ? 'mortgaged, no rent' : `rent ${formatINR(rent)}`);
    else if (tile.price != null) label.push(`for sale, ${formatINR(tile.price)}`);
  }
  if (tile.type === 'transport' && tile.fare != null) label.push(`ride to the next stop for ${formatINR(tile.fare)}`);
  if (tile.type === 'card') label.push(tile.deck === 'drama' ? 'draw a City Drama card' : 'draw a Nawabi Luck card');
  if (tile.type === 'start') label.push(`collect ${formatINR(salary)}`);
  if (tile.type === 'traffic') label.push(stuck > 0 ? `${stuck} stuck in traffic` : 'traffic jam, you get stuck');
  if (tile.type === 'chai') label.push('collect a chai token');
  if (tile.type === 'municipal') label.push('pay municipal charges');
  if (tile.type === 'auction') label.push('a city property goes to auction');
  if (full) label.push('full collection');
  if (event) label.push(event.note);

  const name = softName(tile.short || tile.name);
  const mBadge = (
    <span className="hb-tile__m" aria-hidden="true">
      M
    </span>
  );

  let inner;
  if (corner) {
    const sub = tile.type === 'start' ? `Collect ${compactINR(salary)}` : CORNER_SUB[tile.type] || '';
    inner = (
      <>
        <span className="hb-tile__icon hb-tile__icon--corner">
          <Icon tile={tile} size={64} />
          {tile.type === 'start' && (
            <span className="hb-tile__go" aria-hidden="true">
              <ArrowUp />
            </span>
          )}
        </span>
        <span className="hb-pill">
          <span className="hb-pill__t">{tile.short || tile.name}</span>
          <PhoneName tile={tile} />
        </span>
        {sub && <span className="hb-tile__sub">{sub}</span>}
        {tile.type === 'traffic' && stuck > 0 && (
          <span className="hb-tile__stuck" aria-hidden="true">
            <i className="hb-tile__brake" />
            <b>{stuck}</b>
          </span>
        )}
        {tile.type === 'chai' && <ChaiSteam count={chai} />}
      </>
    );
  } else if (isProperty) {
    inner = (
      <>
        <span className="hb-tile__band">
          {owned && (
            <OwnerChip owner={ownerId || ownerColor}>
              <PieceToken piece={ownerPiece} color={ownerColor} size={20} base={false} />
            </OwnerChip>
          )}
          {mortgaged ? mBadge : owned ? <Pips level={lvl} /> : null}
        </span>
        <span className={`hb-tile__body${owned ? ' hb-tile__body--built' : ''}`}>
          {owned && (
            <BuildPop level={lvl} className="hb-tile__bldg">
              <BuildingArt theme={group?.theme} group={tile.group} level={lvl} size={64} />
            </BuildPop>
          )}
          <span className="hb-tile__txt">
            <span className="hb-tile__name">{name}</span>
            <PhoneName tile={tile} />
            <span className="hb-tile__price">
              <span className="hb-amt--full">{formatINR(owned ? rent : tile.price)}</span>
              <span className="hb-amt--short">{compactINR(owned ? rent : tile.price)}</span>
            </span>
          </span>
        </span>
      </>
    );
  } else if (tile.type === 'card') {
    inner = (
      <span className="hb-tile__card">
        <span className="hb-tile__icon">
          <Icon tile={tile} size={48} />
        </span>
        <span className="hb-tile__name">{name}</span>
        <PhoneName tile={tile} />
        <CardShimmer active={drawing} />
      </span>
    );
  } else {
    // transport (route band + icon + fare), and any other edge special
    inner = (
      <>
        {tile.type === 'transport' && (
          <span className="hb-tile__band hb-tile__band--route">
            <Route />
          </span>
        )}
        <span className="hb-tile__body hb-tile__body--icon">
          <span className="hb-tile__icon">
            <Icon tile={tile} size={48} />
          </span>
          <span className="hb-tile__txt">
            <span className="hb-tile__name">{name}</span>
            <PhoneName tile={tile} />
            {tile.fare != null && (
              <span className="hb-tile__price">
                <span className="hb-amt--full">{formatINR(tile.fare)}</span>
                <span className="hb-amt--short">{compactINR(tile.fare)}</span>
              </span>
            )}
          </span>
        </span>
      </>
    );
  }

  if (phone) {
    inner = (
      <PhoneTileFace
        tile={tile}
        group={group}
        owned={owned}
        ownerColor={ownerColor}
        level={lvl}
        rent={rent}
        mortgaged={mortgaged}
        stuck={stuck}
        chai={chai}
        drawing={drawing}
      />
    );
  }

  return (
    <button
      type="button"
      className={cls.join(' ')}
      style={style}
      aria-label={label.join(', ')}
      title={[tile.name, event && event.note].filter(Boolean).join(' - ')}
      data-tile={tile.id}
      data-fx-tile={tile.id}
      onClick={() => onSelect?.(tile.id)}
    >
      {inner}
      {event && (
        <>
          <i className="hb-tile__glow" aria-hidden="true" />
          <span className="hb-tile__ev" aria-hidden="true">
            <EventIcon tone={event.tone} />
            <b className="hb-tile__ev-t">{event.text}</b>
          </span>
        </>
      )}
      <OwnerStamp color={ownerColor} owner={ownerId || ownerColor} side={side} />
      {mortgaged && !isProperty && mBadge}
    </button>
  );
}

export const Tile = memo(TileImpl);
export default Tile;
