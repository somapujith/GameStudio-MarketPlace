// The phone face of a board tile (Tile.jsx renders this inside the simple portrait-phone table only):
//   district   flat colour, a lighter band on top with the PRICE (or an owner-coloured tag with the RENT once owned),
//              the name in its original case (horizontal on every side), small upgrade pips
//   stop       light tile: a coloured capital label (AUTO / METRO / MMTS) on top, our transit art under it
//   card       light tile: the deck's card art with LUCK / DRAMA
//   corner     light tile: the icon on top, a grey pill label under it (START, TRAFFIC, CHAI ADDA, MUNICIPAL, AUCTION)
// Sizes come from board.css's --hb-u (one edge tile) in phoneboard.css; long names shrink with --chars.
import { useRef } from 'react';
import { compactINR } from '@shared/format.js';
import { MAX_LEVEL } from '@shared/board.js';
import { TileIcon } from '@/components/art/index.js';
import { useArtMap } from '@/components/art/andhra/artMap.js';
import { ChaiSteam, CardShimmer } from '../fx/TileFx.jsx';
import { sideOf } from '../fx/geometry.js';
import { bestInk } from '../PropertySheet.jsx';
import { calloutFor, faceKind, faceLabel, faceName, faceTones, isLightInk, pipStates } from './phoneModel.js';

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true" className="pt__arrow">
    <path d="M12 2.5 3.5 12H9v9.5h6V12h5.5z" />
  </svg>
);

/**
 * Upgrade pips along the foot of an owned district: one little building per level, each a step taller, lit up to the current
 * level. A pip that lights because the level just went up pops (is-new); the first render never pops.
 */
function Pips({ level }) {
  const max = Math.max(1, MAX_LEVEL | 0);
  const before = useRef(level);
  const states = pipStates(level, max, before.current);
  before.current = level;
  return (
    <span className="pt__pips" aria-hidden="true">
      {states.map((p, i) => <i key={i} className={p.fresh ? 'is-on is-new' : p.on ? 'is-on' : undefined} />)}
    </span>
  );
}

/** The tile in play names itself for a moment (CSS timing: it waits out a walking step, pops, holds, fades). */
function Callout({ tile, owned, rent, mortgaged, ownerColor }) {
  const c = calloutFor(tile, { owned, rent, mortgaged });
  if (!c) return null;
  return (
    <span className="pt__call" aria-hidden="true">
      <b>{c.name}</b>
      {c.amount ? (
        <i className={c.kind === 'rent' || c.kind === 'mortgaged' ? 'is-owned' : undefined}>
          {owned && ownerColor ? <u style={{ background: ownerColor }} /> : null}
          {c.kind === 'rent' ? `Rent ${c.amount}` : c.amount}
        </i>
      ) : null}
    </span>
  );
}

export default function PhoneTileFace({ active = false, ...props }) {
  return (
    <>
      <Face {...props} />
      {active ? <Callout tile={props.tile} owned={props.owned} rent={props.rent} mortgaged={props.mortgaged} ownerColor={props.ownerColor} /> : null}
    </>
  );
}

function Face({
  tile, group, owned = false, ownerColor = null, level = 0, rent = 0, mortgaged = false, stuck = 0, chai = 0, drawing = false,
}) {
  const kind = faceKind(tile);
  const mapId = useArtMap();

  if (kind === 'prop') {
    const tones = faceTones(group?.color || '#8a7a66');
    const side = sideOf(tile.id);
    const { lines, chars } = faceName(tile, { wide: side === 'left' || side === 'right' });
    const style = { '--pt-body': tones.body, '--pt-band': tones.band, '--pt-ink': tones.ink, '--chars': chars };
    if (owned && ownerColor) {
      style['--tag'] = ownerColor;
      style['--tag-ink'] = bestInk(ownerColor);
    }
    return (
      <span className="pt pt--prop" style={style} data-owned={owned && ownerColor && !mortgaged ? '' : undefined} data-mortgaged={mortgaged ? '' : undefined} data-ink={isLightInk(tones.ink) ? 'light' : 'dark'}>
        <span className="pt__band">
          {owned && ownerColor && !mortgaged ? (
            <b className="pt__tag">{compactINR(rent)}</b>
          ) : (
            <b className="pt__price">{compactINR(tile.price)}</b>
          )}
        </span>
        <span className="pt__name" data-lines={lines.length} aria-hidden="true">
          {lines.map((l, i) => <span key={i}>{l}</span>)}
        </span>
        {owned && !mortgaged ? <Pips level={level} /> : null}
        {mortgaged ? <span className="pt__m" aria-hidden="true">M</span> : null}
      </span>
    );
  }

  const label = faceLabel(tile, mapId);
  const labelStyle = { '--chars': Math.max(label.length, 1) };

  if (kind === 'transport') {
    return (
      <span className="pt pt--light pt--stop" style={labelStyle}>
        <b className="pt__cap">{label}</b>
        <span className="pt__icon"><TileIcon tile={tile} size={48} /></span>
      </span>
    );
  }

  if (kind === 'card') {
    return (
      <span className="pt pt--light pt--card" style={labelStyle}>
        <span className="pt__icon"><TileIcon tile={tile} size={48} /></span>
        <b className="pt__cap">{label}</b>
        <CardShimmer active={drawing} />
      </span>
    );
  }

  return (
    <span className="pt pt--light pt--corner" style={labelStyle}>
      <span className="pt__icon">{tile.type === 'start' ? <ArrowUp /> : <TileIcon tile={tile} size={48} />}</span>
      <b className="pt__pill">{label}</b>
      {tile.type === 'traffic' && stuck > 0 ? (
        <span className="hb-tile__stuck" aria-hidden="true"><i className="hb-tile__brake" /><b>{stuck}</b></span>
      ) : null}
      {tile.type === 'chai' ? <ChaiSteam count={chai} /> : null}
    </span>
  );
}
