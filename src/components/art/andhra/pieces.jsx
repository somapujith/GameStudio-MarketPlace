// Andhra Aatalu tokens: the six piece ids (pearl, auto, handi, chai, bat, camera) re-skinned as the concept's starter
// tokens. Ids never change (they are stored in rooms and game states); only the drawing swaps when the Andhra map is active.
//   pearl -> mango            auto -> fishing boat        handi -> red chilli
//   chai  -> Kondapalli elephant     bat -> veena          camera -> Sankranti kite
// (The concept's cinema camera and paddy bundle are the two optional deluxe pieces: no spare ids, so not drawn.)
// 40x40 box, ground at y ~34, same ink outline as the Hyderabad pieces so every token reads on any tile.
import { lighten, darken } from '../palette.js';
import { Elephant } from './kit.jsx';

const OUT = '#1d1840';
const OW = 1.3;
const o = (fill, extra) => ({ fill, stroke: OUT, strokeWidth: OW, strokeLinejoin: 'round', ...extra });

function Mango({ c }) {
  return (
    <g>
      <path d="M16.6 31V28H23.4V31Z" {...o(darken(c, 0.12))} />
      <path d="M20 7C30 7 33.4 17 30.4 24.6C28.6 29 23 30 19.4 29C12 27 9.6 17.6 13.8 11.6C15.6 8.8 17.6 7 20 7Z" {...o('#f6b21a')} />
      <path d="M25.6 9.6C31.4 14.6 31.6 22 27.6 27" fill="none" stroke="#e4572b" strokeWidth="3" strokeLinecap="round" opacity=".85" />
      <path d="M14.6 14Q15.6 11 18 9.4" fill="none" stroke="#fff3c4" strokeWidth="1.3" strokeLinecap="round" opacity=".9" />
      <path d="M20 7V4" fill="none" stroke={OUT} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M20.6 5Q23 .8 29.4 2.4Q27.4 7.6 20.6 5Z" {...o('#3f9a5f')} />
    </g>
  );
}

function Boat({ c }) {
  return (
    <g>
      <path d="M3.6 26Q20 36 36.4 22L32.4 30Q20 36 8 30Z" {...o(c)} />
      <path d="M3.6 26Q20 31 36.4 22" fill="none" stroke={lighten(c, 0.5)} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M19 26V5" fill="none" stroke={OUT} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19.6 6L33 23H19.6Z" {...o('#f6ebd2')} />
      <path d="M18.4 10L9 23H18.4Z" {...o('#f2b11d')} />
      <path d="M19 5L25 7L19 9" {...o('#c4553a', { strokeWidth: 1 })} />
      <path d="M7 31q2-1.8 4 0t4 0" fill="none" stroke="#7fd0f2" strokeWidth="1.2" strokeLinecap="round" />
    </g>
  );
}

function RedChilli({ c }) {
  return (
    <g>
      <path d="M8.4 12C20 8 33 15 31.4 29C26.4 21.4 19 18.6 11.4 18.6Z" {...o('#d62f2f')} />
      <path d="M9.6 13.6C18 12 25 14 29 19" fill="none" stroke="#ff8d73" strokeWidth="1.5" strokeLinecap="round" opacity=".9" />
      <path d="M8.4 12L5 8.6M8.8 12.4C6 9 8 5.6 11.4 6" {...o('#3f9a5f', { strokeWidth: 1.2 })} />
      <path d="M6.6 11.2Q6 7.2 11 7.6Q11.4 11 8.4 13Z" {...o('#3f9a5f')} />
      <path d="M26 21.6l3.2-3" stroke={c} strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </g>
  );
}

function ElephantPiece({ c }) {
  return (
    <g transform="translate(9.6 33.4) scale(.62)" stroke={OUT} strokeWidth="2.1" strokeLinejoin="round">
      <Elephant x={0} y={0} s={1} c="#f2b11d" trim={c} />
    </g>
  );
}

function Veena({ c }) {
  return (
    <g>
      <path d="M12 28L31 9" fill="none" stroke={OUT} strokeWidth="5.4" strokeLinecap="round" />
      <path d="M12 28L31 9" fill="none" stroke="#a46d3f" strokeWidth="3.6" strokeLinecap="round" />
      <ellipse cx="11" cy="26" rx="8" ry="6.4" transform="rotate(-42 11 26)" {...o(c)} />
      <circle cx="11" cy="26" r="2.2" {...o('#fff3c4', { strokeWidth: 1 })} />
      <circle cx="31.6" cy="9" r="4" {...o('#c4553a')} />
      <circle cx="23" cy="17.6" r="3.2" {...o('#f2b11d', { strokeWidth: 1 })} />
      <path d="M13 24.6L30 10.6" fill="none" stroke="#fff3c4" strokeWidth=".8" />
    </g>
  );
}

function Kite({ c }) {
  return (
    <g>
      <path d="M20 31V26" fill="none" stroke={OUT} strokeWidth="2" strokeLinecap="round" />
      <path d="M20 3L30 15 20 28 10 15Z" {...o(c)} />
      <path d="M20 3V28M10 15H30" fill="none" stroke="#f6ebd2" strokeWidth="1.1" />
      <path d="M20 3L25 9 20 15 15 9Z" fill="#f2b11d" stroke="none" opacity=".9" />
      <path d="M20 28q-5 3-1 5t-2 4" fill="none" stroke={OUT} strokeWidth="1.1" strokeLinecap="round" />
    </g>
  );
}

export const ANDHRA_DRAW = { pearl: Mango, auto: Boat, handi: RedChilli, chai: ElephantPiece, bat: Veena, camera: Kite };

export const ANDHRA_PIECE_NAMES = {
  pearl: 'Mango',
  auto: 'Fishing boat',
  handi: 'Red chilli',
  chai: 'Kondapalli elephant',
  bat: 'Veena',
  camera: 'Sankranti kite',
};
