// True inside the simple portrait-phone table: the board's tiles and pawns then draw their phone faces
// (flat colour tiles with a price band, light corner tiles with a pill label, disc pawns). Everything else keeps the
// regular faces. See phone/PhoneTileFace.jsx and styles/phoneboard.css.
import { createContext } from 'react';

export const PhoneBoardContext = createContext(false);
export default PhoneBoardContext;
