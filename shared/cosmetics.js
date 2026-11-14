// Cosmetic catalogue: purely visual items bought with coins (never a gameplay advantage).
// The server (worker/routes/shop.js) is the source of truth for prices and ownership; the client
// uses this list to render the shop and previews. Ids never change once shipped.
//
// kinds:
//   frame  - ring drawn around the player's avatar (hub + in-game seat)
//   dice   - skin of the die the player rolls (colours below)
//   title  - short text badge shown under the player's name

export const COSMETIC_KINDS = Object.freeze(['frame', 'dice', 'title']);

export const COSMETICS = Object.freeze([
  // Avatar frames
  { id: 'frame-sandstone', kind: 'frame', name: 'Sandstone', price: 300, rarity: 'common', colors: ['#e3b778', '#a8743a'] },
  { id: 'frame-pearl', kind: 'frame', name: 'Hyderabadi Pearl', price: 800, rarity: 'rare', colors: ['#f6f1ea', '#c9b8d8'] },
  { id: 'frame-lake', kind: 'frame', name: 'Hussain Sagar', price: 800, rarity: 'rare', colors: ['#4cc9f0', '#2a6fdb'] },
  { id: 'frame-nizam', kind: 'frame', name: 'Nizam Gold', price: 2000, rarity: 'epic', colors: ['#ffd36b', '#ff8a3d'] },

  // Dice skins: face, pip and edge colours
  { id: 'dice-ivory', kind: 'dice', name: 'Ivory', price: 0, rarity: 'common', colors: ['#fbf7ef', '#1b1340', '#d9cdb5'] },
  { id: 'dice-biryani', kind: 'dice', name: 'Biryani Saffron', price: 400, rarity: 'common', colors: ['#ffb347', '#5a2a00', '#e08a1e'] },
  { id: 'dice-cyber', kind: 'dice', name: 'Cyberabad Neon', price: 900, rarity: 'rare', colors: ['#141a3a', '#5ef2ff', '#7b6dff'] },
  { id: 'dice-bangle', kind: 'dice', name: 'Laad Bazaar Bangle', price: 1500, rarity: 'epic', colors: ['#b5179e', '#ffe066', '#7209b7'] },

  // Titles
  { id: 'title-chai', kind: 'title', name: 'Chai Connoisseur', price: 250, rarity: 'common' },
  { id: 'title-biryani', kind: 'title', name: 'Biryani Baron', price: 600, rarity: 'rare' },
  { id: 'title-hitec', kind: 'title', name: 'HITEC Hustler', price: 600, rarity: 'rare' },
  { id: 'title-nawab', kind: 'title', name: 'Nawab of the City', price: 1800, rarity: 'epic' },
]);

/** Items everybody owns without buying. */
export const FREE_COSMETICS = Object.freeze(COSMETICS.filter((c) => c.price === 0).map((c) => c.id));

export const cosmeticById = (id) => COSMETICS.find((c) => c.id === id) || null;

/**
 * `{ frame?, dice?, title? }` -> the same object with unknown ids / wrong kinds dropped.
 * Use it on anything that came over the network.
 */
export function cleanEquipped(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const kind of COSMETIC_KINDS) {
    const item = cosmeticById(raw[kind]);
    if (item && item.kind === kind) out[kind] = item.id;
  }
  return out;
}
