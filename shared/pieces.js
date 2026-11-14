// The six playable pieces (docs/HUSTLE_PLAN.md 3.5). Tiny on purpose: the game manifest imports it eagerly.
// Ids never change once shipped (they are stored in rooms and game states).
export const PIECES = Object.freeze([
  Object.freeze({ id: 'pearl', name: 'Pearl' }),
  Object.freeze({ id: 'auto', name: 'Auto-rickshaw' }),
  Object.freeze({ id: 'handi', name: 'Biryani handi' }),
  Object.freeze({ id: 'chai', name: 'Irani chai glass' }),
  Object.freeze({ id: 'bat', name: 'Cricket bat' }),
  Object.freeze({ id: 'camera', name: 'Film camera' }),
]);

export const PIECE_IDS = Object.freeze(PIECES.map((p) => p.id));

export const pieceById = (id) => PIECES.find((p) => p.id === id) || null;
