import { memo, useContext, useRef, useState } from 'react';
import * as Art from '@/components/art/index.js';
import { isCorner, pawnPlacement, sideOf } from './fx/geometry.js';
import PhoneBoardContext from './phone/PhoneBoardContext.js';
import { PawnBeacon, PawnTag } from './board/PawnBeacon.jsx';
import { pawnZ } from './board/beaconModel.js';
import TrailFx, { trailItem } from './TrailFx.jsx';
import '@/styles/board.css';

export { pawnPlacement } from './fx/geometry.js';

// Looked up by name so the board still renders before the art kit ships PieceArt.
const PIECE_ART = 'PieceArt';
const INITIAL = { pearl: 'P', auto: 'A', handi: 'H', chai: 'C', bat: 'B', camera: 'F' };

/**
 * A player's piece (pearl, auto, handi, chai, bat, camera) tinted by the player's colour: the art kit's
 * PieceArt when it exists (on its coloured base unless `base={false}`), else a coloured disc with the piece's
 * initial. Used by the pawn and the tile's owner chip.
 */
export function PieceToken({ piece, color = '#ffd23f', size = 24, base = true, className = '' }) {
  const PieceArt = Art[PIECE_ART];
  if (typeof PieceArt === 'function' || (PieceArt && typeof PieceArt === 'object')) {
    return (
      <span className={`hb-piece${className ? ` ${className}` : ''}`}>
        <PieceArt piece={piece || 'pearl'} color={color} size={size} base={base} />
      </span>
    );
  }
  return (
    <span className={`hb-piece hb-piece--fallback${className ? ` ${className}` : ''}`} style={{ '--c': color }}>
      <b>{INITIAL[piece] || ''}</b>
    </span>
  );
}

/**
 * One player's piece on the board. `pos` is the tile id: the presenter steps it one tile at a time and the
 * pawn glides there with `transform: translate()` (never left/top) while its inner hop replays
 * anticipation -> jump -> landing for every step (crouch, an arc leaning into the move, a squash and a puff of dust
 * where it touches down, a fading ghost left on the tile it left), over `--hb-step` (the presenter's `display.stepMs`,
 * set on the layer). The piece stands on a glossy puck in the player's colour above a contact shadow. The pawn whose
 * turn it is (`isTurn`) is unmistakable: drawn bigger and on top, in a beacon (glow, white ring, two expanding rings)
 * with a name tag over it (`isMe`: the tag says YOU and the ring is gold-white), for the whole turn, moving or not
 * (board/PawnBeacon.jsx; the parts are children of the pawn, so they follow it and scale with the camera).
 *
 *  motion: null (walk) | 'ride' (fast hop with a little vehicle trail) | 'teleport' (one arc over the board)
 *  stuck:  stuck in traffic: a small cone with a brake light
 *  bankrupt: fades and shrinks out (hidden straight away if it already was when the pawn mounted)
 *  trail:  the equipped pawn-trail id (a catalogue item of kind 'trail'): a TrailFx particle group is left behind every
 *          step, whatever the motion (a ride streams along the skim, a teleport bursts at arrival). No / unknown id = nothing.
 */
function PawnImpl({
  id = '',
  name = '',
  color = '#ffd23f',
  piece = 'pearl',
  pos = 0,
  slot = 0,
  count = 1,
  isTurn = false,
  isMe = false,
  avatar = null,
  stuck = false,
  motion = null,
  bankrupt = false,
  tileName = '',
  trail = null,
}) {
  const disc = useContext(PhoneBoardContext); // the simple phone table draws pawns as round discs with a white rim
  // Re-key the hop and shadow whenever the pawn moves, so the motion replays per step.
  const [seen, setSeen] = useState(pos);
  const [steps, setSteps] = useState(0);
  const [from, setFrom] = useState(pos);
  if (seen !== pos) {
    setFrom(seen);
    setSeen(pos);
    setSteps(steps + 1);
  }
  const outAtMount = useRef(bankrupt);
  if (bankrupt && outAtMount.current) return null;

  const { x, y, d } = pawnPlacement(pos, slot, count);
  const style = {
    '--x': x / 100,
    '--y': y / 100,
    '--pd': d,
    '--c': color,
    zIndex: pawnZ({ isTurn, slot }),
  };
  // where it came from, as a fraction of the ring: the ghost stays put there while the pawn moves on
  const was = steps ? pawnPlacement(from, slot, count) : null;
  const gx = was ? (was.x - x) / 100 : 0;
  const gy = was ? (was.y - y) / 100 : 0;
  style['--gx'] = gx;
  style['--gy'] = gy;
  style['--lean'] = Math.abs(gx) > Math.abs(gy) ? Math.sign(-gx) : 0; // leans into a sideways move
  const kind = motion === 'ride' || motion === 'teleport' ? motion : 'walk';
  const cls = ['hb-pawn', `is-${kind}`];
  if (isTurn) cls.push('is-turn');
  if (isTurn && isMe) cls.push('is-me');
  if (stuck) cls.push('is-stuck');
  if (bankrupt) cls.push('is-out');
  const moving = steps ? ' is-step' : '';
  const trailFor = steps ? trailItem(trail) : null;

  return (
    <div
      className={cls.join(' ')}
      style={style}
      role="img"
      data-fx-pawn={id || undefined}
      data-side={isCorner(pos) ? undefined : sideOf(pos)}
      aria-label={`${name}${tileName ? ` on ${tileName}` : ''}${stuck ? ', stuck in traffic' : ''}${isTurn ? ', current turn' : ''}${bankrupt ? ', bankrupt' : ''}`}
    >
      <span className="hb-pawn__body">
        {/* The shadow stays on the board while the pawn is lifted, then tightens as it is set down. */}
        <span className={`hb-pawn__shadow${moving}`} key={`s${steps}`} />
        {isTurn ? <PawnBeacon /> : null}
        {trailFor ? <TrailFx finish={trailFor.finish} colors={trailFor.colors} steps={steps} motion={kind} gx={gx} gy={gy} compact={!!disc} /> : null}
        {kind === 'ride' && steps ? <span className="hb-pawn__trail" key={`t${steps}`} /> : null}
        {kind !== 'ride' && steps && !disc ? (
          <span className="hb-pawn__ghost" key={`g${steps}`} aria-hidden="true">
            <PieceToken piece={piece} color={color} size={48} base={false} className="hb-pawn__piece" />
          </span>
        ) : null}
        <span className={`hb-pawn__hop${moving}`} key={steps}>
          {disc ? (
            <span className="hb-pawn__disc">
              <PieceToken piece={piece} color="#ffffff" size={48} base={false} className="hb-pawn__glyph" />
            </span>
          ) : (
            <>
              <span className="hb-pawn__puck" />
              <PieceToken piece={piece} color={color} size={48} base={false} className="hb-pawn__piece" />
            </>
          )}
          {isTurn ? <PawnTag name={name} color={color} pos={pos} isMe={isMe} disc={disc} avatar={avatar} /> : null}
        </span>
        {steps && !disc ? <span className="hb-pawn__dust" key={`d${steps}`} aria-hidden="true" /> : null}
        {stuck && (
          <span className="hb-pawn__stuck" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path className="hb-cone" d="M9.6 3h4.8l4.3 15H5.3z" />
              <path className="hb-cone__band" d="M8.4 8.6h7.2l.9 3.2H7.5z" />
              <rect className="hb-cone__foot" x="3" y="18" width="18" height="3" rx="1.2" />
            </svg>
            <i className="hb-pawn__brake" />
          </span>
        )}
      </span>
    </div>
  );
}

export const Pawn = memo(PawnImpl);
export default Pawn;
