import { Avatar } from '@/components/art/index.js';
import { inkOn, tagAnchor, tagLabel, tagPlacement } from './beaconModel.js';
import '@/styles/pawnbeacon.css';

/**
 * The "it is your turn" highlight of one pawn, drawn only for the player whose turn it is (Pawn.jsx renders both parts as
 * children of the pawn, so they ride along with it, scale with the camera and need no positioning of their own):
 *
 *  <PawnBeacon />  a ground glow, a white selection ring and two staggered rings that expand and fade (the only loop on
 *                  the board's pieces; transform + opacity). Goes in the pawn body, under the piece.
 *  <PawnTag />     a name tag floating over the piece: a pill with the first name on the desktop board, a small teardrop
 *                  pin with the avatar / initial on the phone table; "YOU" when the player is me. Sits below the piece on
 *                  the top row so it stays on the board. Goes inside the pawn's hop so it rides the jump.
 */
export function PawnBeacon() {
  return (
    <span className="hb-pawn__beacon" aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

export function PawnTag({ name = '', color = '#ffd23f', pos = 0, isMe = false, disc = false, avatar = null }) {
  const hasAvatar = disc && avatar !== null && avatar !== undefined && avatar !== '' && Number.isFinite(Number(avatar));
  const label = tagLabel({ name, isMe, disc, hasAvatar });
  const spot = tagPlacement(pos);
  const place = disc ? { v: spot.v, h: 'center' } : spot; // the pin is narrow: it is only ever flipped, never shifted
  const cls = ['hb-pawn__tag', `is-${place.v}`, `is-h-${place.h}`, disc ? 'is-pin' : 'is-pill', `is-${label.kind}`].join(' ');
  const style = { '--ptr': `${tagAnchor(place.h) * 100}%`, '--tc': inkOn(color) };
  return (
    <span className={cls} style={style} aria-hidden="true">
      <span className="hb-pawn__tagbob">
        <span className="hb-pawn__nib" />
        {disc ? (
          <span className="hb-pawn__pin">
            <span className="hb-pawn__drop" />
            <span className="hb-pawn__pin-in">
              {label.kind === 'avatar' ? <Avatar preset={Number(avatar)} size={24} className="hb-pawn__ava" /> : <b>{label.text}</b>}
            </span>
          </span>
        ) : (
          <span className="hb-pawn__pill">{label.text}</span>
        )}
      </span>
    </span>
  );
}
