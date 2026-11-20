// The Hyderabad Hustle board: 36 tiles on a 10x10 ring (docs/HUSTLE_PLAN.md 3.1, design: Hyderabad_Hustle_Game_Concept.md).
// START is the bottom-LEFT corner and play runs CLOCKWISE: up the left column to Traffic Jam (top-left), right along
// the top row to Chai Adda (top-right), down the right column to Municipal Charges (bottom-right), then left along the
// bottom row back to START. The cheapest districts come right after START, the New City sits just before it.
// Players buy FICTIONAL commercial ventures in each precinct, never the landmarks themselves (heritage rule).
// Pure data + tiny helpers. Shared by the browser and the Cloudflare Worker.

export { PIECES, PIECE_IDS, pieceById } from './pieces.js';

export const BOARD_SIZE = 36;
export const GRID = 10; // cells per side, corners included
export const START_TILE = 0;
export const TRAFFIC_TILE = 9; // Traffic Jam: you are stuck where you stand
export const CHAI_TILE = 18; // Chai Adda: pick up a chai token
export const MUNICIPAL_TILE = 27; // Municipal Charges
export const AUCTION_TILE = 32; // Bazaar Auction
export const TRANSPORT_TILES = Object.freeze([5, 14, 23]); // Auto Stand, Metro Interchange, MMTS Express
export const CORNER_TILES = Object.freeze([START_TILE, TRAFFIC_TILE, CHAI_TILE, MUNICIPAL_TILE]);
/** @deprecated The Hustle has no jail. Kept as an alias of TRAFFIC_TILE (the "stuck" corner) for older UI code. */
export const JAIL_TILE = TRAFFIC_TILE;

// Levels: a bought district is level 0 (its first business). Two upgrades take it to level 2.
export const MAX_LEVEL = 2;
/** @deprecated There is no hotel any more: the top business level. */
export const HOTEL_LEVEL = MAX_LEVEL;
/** Generic level names; every group has its own themed ones (GROUPS[g].levelNames, see levelName). */
export const LEVEL_NAMES = Object.freeze(['Business', 'Expanded', 'Flagship']);

export const PRICE_UNIT = 1000; // rents are rounded to whole thousands
export const RENT_RATIO = 0.1; // base rent = 10% of the price
export const LEVEL_RENT_MULT = Object.freeze([1, 2.7, 4.4]); // rent ladder by level, applied to the base rent
export const UPGRADE_RATIO = 0.4; // one upgrade costs 40% of the price
// Why these numbers (every district scales with its price, so one set covers all 24): upgrades need the whole collection, whose
// level-0 tiles already pay the 1.5x set bonus, so the real gain of an upgrade is measured against THAT rent. Level 1 (rent 0.27 x
// price) adds 0.12 x price for a 0.4 x price upgrade = pays back in about 3.3 opponent landings; level 2 (0.44 x price) adds 0.17 x
// price = about 2.4 landings. A fully upgraded district asks 4.4x a bare one (2.9x a bare full-set tile) for 1.8 x price in all.
export const SELL_RATIO = 0.5; // selling an upgrade back refunds 50% of what it cost
export const MORTGAGE_RATIO = 0.5; // the bank lends 50% of the price
export const UNMORTGAGE_INTEREST = 0.1; // lifting a mortgage costs +10%

// Owning all three districts of a collection pays 1.5x rent on its level-0 tiles (upgraded tiles never stack it).
export const SET_BONUS = Object.freeze({ full: 1.5 });
export function setMultiplier(owned, size) {
  return size > 0 && owned >= size ? SET_BONUS.full : 1;
}

export const START_CASH = 1500000; // ₹15 lakh (standard and classic modes)
export const QUICK_START_CASH = 2000000; // ₹20 lakh (quick mode)
export const PASS_START = 200000; // ₹2 lakh for passing or landing on START
export const TRAFFIC_FINE = 25000; // pay to get out of a traffic jam
export const CHAI_CAP = 1; // most chai tokens a player can hold
export const CHAI_MIN_RENT = 20000; // a chai token halves the first rent payment at least this big
export const MUNICIPAL_BASE = 40000; // Municipal Charges: flat part
export const MUNICIPAL_PER_LEVEL = 10000; // ... plus this per upgrade level you own
export const BAZAAR_MIN_RATIO = 0.5; // Bazaar Auction: minimum bid = 50% of the price
export const DECLINE_MIN_RATIO = 0.1; // Snatch bidding: minimum bid = 10% of the price (the name is historical: a pass no longer opens an auction)

/**
 * The eight collections (3 districts each).
 *   levelNames  business names for level 0, 1, 2
 *   theme       art family for the businesses: bazaar | food | transit | venue | tech
 */
export const GROUPS = {
  bazaar: { id: 'bazaar', name: 'Bazaar Beginnings', color: '#c98b4a', ink: '#2a1600', tiles: [1, 3, 4], levelNames: ['Stall', 'Shop', 'Trading Hub'], theme: 'bazaar' },
  oldcity: { id: 'oldcity', name: 'Old City Icons', color: '#e2725b', ink: '#ffffff', tiles: [6, 7, 8], levelNames: ['Irani Cafe', 'Biryani House', 'Food Franchise'], theme: 'food' },
  everyday: { id: 'everyday', name: 'Everyday Hyderabad', color: '#f2b134', ink: '#2a1a00', tiles: [10, 11, 13], levelNames: ['Tiffin Centre', 'Restaurant', 'Food Court'], theme: 'food' },
  twin: { id: 'twin', name: 'Twin Cities', color: '#3fb68b', ink: '#04261a', tiles: [15, 16, 17], levelNames: ['Kiosk', 'Showroom', 'Transit Mall'], theme: 'transit' },
  lake: { id: 'lake', name: 'Lake & Leisure', color: '#3aa7e0', ink: '#03243a', tiles: [19, 20, 22], levelNames: ['Snack Kiosk', 'Boathouse Cafe', 'Lakeside Resort'], theme: 'venue' },
  luxury: { id: 'luxury', name: 'Lights, Camera, Luxury', color: '#b06ad9', ink: '#ffffff', tiles: [24, 25, 26], levelNames: ['Studio', 'Entertainment Venue', 'Premium Complex'], theme: 'venue' },
  cyber: { id: 'cyber', name: 'Cyberabad', color: '#4f7cff', ink: '#ffffff', tiles: [28, 29, 31], levelNames: ['Startup Office', 'Business Centre', 'Tech Campus'], theme: 'tech' },
  newcity: { id: 'newcity', name: 'The New City', color: '#1fb5a6', ink: '#02241f', tiles: [33, 34, 35], levelNames: ['Co-working Floor', 'Corporate Tower', 'Skyline Campus'], theme: 'tech' },
};

// Tile fields
//   type    start | property | transport | card | traffic | chai | municipal | auction
//   name    full name; short: fits a tile; lore: one line for the deed / tooltip
//   corner  true on the four corners
//   property: group, price          transport: fare          card: deck 'luck' (Nawabi Luck) | 'drama' (City Drama)
//   art     art key: start | property | auto | metro | mmts | luck | drama | traffic | chai | municipal | auction
const P = (id, name, short, group, price, lore) => ({ id, type: 'property', name, short, group, price, art: 'property', emoji: '🏬', lore });
const LUCK = (id) => ({ id, type: 'card', deck: 'luck', name: 'Nawabi Luck', short: 'Nawabi Luck', art: 'luck', emoji: '🪙',
  lore: 'Draw a Nawabi Luck card: fortune smiles on the bold.' });
const DRAMA = (id) => ({ id, type: 'card', deck: 'drama', name: 'City Drama', short: 'City Drama', art: 'drama', emoji: '🎭',
  lore: 'Draw a City Drama card. Hyderabad always has a plot twist.' });

export const TILES = [
  { id: 0, type: 'start', corner: true, name: 'START — Namma Hyderabad', short: 'START', art: 'start', emoji: '🏁',
    lore: 'Every hustle starts here. Pass or land on START to collect ₹2,00,000.' },

  // ---- left column (bottom -> top): Bazaar Beginnings, Old City Icons
  P(1, 'Sultan Bazaar', 'Sultan Bazaar', 'bazaar', 60000, 'A fictional saree-and-stationery stall row in the busy old market lanes.'),
  LUCK(2),
  P(3, 'Monda Market', 'Monda Market', 'bazaar', 70000, 'A vegetable-and-spice wholesale stall that opens before the first train.'),
  P(4, 'Begum Bazaar', 'Begum Bazaar', 'bazaar', 80000, 'A wholesale kirana counter where bargaining is a competitive sport.'),
  { id: 5, type: 'transport', name: 'Auto Stand', short: 'Auto Stand', fare: 25000, art: 'auto', emoji: '🛺',
    lore: 'Auto anna will take you to the Metro Interchange. Meter? What meter?' },
  P(6, 'Laad Bazaar', 'Laad Bazaar', 'oldcity', 100000, 'A fictional bangle boutique glittering in the lane of lac and glass.'),
  P(7, 'Charminar Precinct', 'Charminar', 'oldcity', 110000, 'A tea-and-snacks venture in the precinct; the monument itself belongs to everyone.'),
  P(8, 'Chowmahalla Precinct', 'Chowmahalla', 'oldcity', 120000, 'A heritage-walk cafe near the palace courtyards. Respect the old city, sell good chai.'),
  { id: 9, type: 'traffic', corner: true, name: 'Traffic Jam', short: 'Traffic Jam', art: 'traffic', emoji: '🚦',
    lore: 'Horns, heat and zero movement. Stuck here: pay ₹25,000, spend a chai, or wait a turn.' },

  // ---- top row (left -> right): Everyday Hyderabad, Twin Cities
  P(10, 'Malakpet', 'Malakpet', 'everyday', 140000, 'A neighbourhood tiffin centre famous for its morning idli rush.'),
  P(11, 'Mehdipatnam', 'Mehdipatnam', 'everyday', 150000, 'A bus-hub eatery where everyone grabs a quick plate between connections.'),
  DRAMA(12),
  P(13, 'Tolichowki', 'Tolichowki', 'everyday', 160000, 'A late-night food stall that turns into a crowd every weekend.'),
  { id: 14, type: 'transport', name: 'Metro Interchange', short: 'Metro', fare: 35000, art: 'metro', emoji: '🚇',
    lore: 'Change trains for the MMTS Express. Smooth, air-conditioned, slightly crowded.' },
  P(15, 'Sainikpuri', 'Sainikpuri', 'twin', 180000, 'A quiet-suburb kiosk that sells everything from stamps to samosas.'),
  P(16, 'Patny Centre', 'Patny Centre', 'twin', 190000, 'A gadget showroom in the twin-city shopping crossroads.'),
  P(17, 'Paradise Circle', 'Paradise', 'twin', 200000, 'A fictional transit-mall counter where the biryani queue never ends.'),
  { id: 18, type: 'chai', corner: true, name: 'Chai Adda', short: 'Chai Adda', art: 'chai', emoji: '☕',
    lore: 'One Irani chai, one Osmania biscuit. Take a chai token: it halves your next big rent.' },

  // ---- right column (top -> bottom): Lake & Leisure, Lights Camera Luxury
  P(19, 'Lumbini Park Precinct', 'Lumbini Park', 'lake', 220000, 'A lakeside snack kiosk with a front-row view of the evening lights.'),
  P(20, 'Tank Bund', 'Tank Bund', 'lake', 230000, 'A boathouse cafe along the promenade, busiest at sunset.'),
  LUCK(21),
  P(22, 'Necklace Road', 'Necklace Rd', 'lake', 240000, 'A breezy lakefront venture where joggers become customers.'),
  { id: 23, type: 'transport', name: 'MMTS Express', short: 'MMTS', fare: 45000, art: 'mmts', emoji: '🚆',
    lore: 'The local train loops you round past START to the Auto Stand. Salary on the way!' },
  P(24, 'Film Nagar', 'Film Nagar', 'luxury', 260000, 'A small dubbing studio where tomorrow\'s blockbusters get their punch dialogues.'),
  P(25, 'Banjara Hills', 'Banjara Hills', 'luxury', 270000, 'A boutique venue for launches, parties and very serious selfies.'),
  P(26, 'Jubilee Hills', 'Jubilee Hills', 'luxury', 280000, 'A premium lounge where deals are signed over filter coffee.'),
  { id: 27, type: 'municipal', corner: true, name: 'Municipal Charges', short: 'Municipal', art: 'municipal', emoji: '🏛️',
    lore: 'The city sends its bill: ₹40,000 plus ₹10,000 for every upgrade you own.' },

  // ---- bottom row (right -> left): Cyberabad, Bazaar Auction, The New City
  P(28, 'Kondapur', 'Kondapur', 'cyber', 300000, 'A startup office above a busy PG mess. Stand-ups happen over breakfast.'),
  P(29, 'Madhapur', 'Madhapur', 'cyber', 320000, 'A business centre where every cafe table is somebody\'s meeting room.'),
  DRAMA(30),
  P(31, 'HITEC City', 'HITEC City', 'cyber', 340000, 'A glass-walled tech campus. Own it and you will never stop talking about it.'),
  { id: 32, type: 'auction', name: 'Bazaar Auction', short: 'Auction', art: 'auction', emoji: '🔨',
    lore: 'A random unowned district goes under the hammer. Minimum bid: half its price.' },
  P(33, 'Gachibowli', 'Gachibowli', 'newcity', 360000, 'A co-working floor next to the stadium, packed with pitch decks.'),
  P(34, 'Kokapet', 'Kokapet', 'newcity', 380000, 'A corporate tower rising out of the newest skyline in town.'),
  P(35, 'Financial District', 'Fin. District', 'newcity', 400000, 'A skyline campus of glass and global offices. The priciest address on the board.'),
];

export const TILE_TYPES = ['start', 'property', 'transport', 'card', 'traffic', 'chai', 'municipal', 'auction'];

/** groupId -> array of tile ids */
export const GROUP_TILES = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, TILES.filter((t) => t.group === g).map((t) => t.id)]));

/** Only districts can be bought, owned, mortgaged and traded. */
export const isBuyable = (t) => !!t && t.type === 'property';

const round1000 = (x) => Math.round(x / PRICE_UNIT) * PRICE_UNIT;

/** [level 0, level 1, level 2] rent of a district (HITEC City: 34,000 / 92,000 / 1,50,000). Empty for other tiles. */
export function rentTable(tile) {
  if (!tile || tile.type !== 'property') return [];
  const base = Math.round(tile.price * RENT_RATIO);
  return LEVEL_RENT_MULT.map((m, i) => (i === 0 ? base : round1000(base * m)));
}

/**
 * Rent of a district at `level`. `fullSet` = its owner holds the whole collection (1.5x, level 0 only).
 * City events, card boosts and mortgages are applied by the engine on top (see engine.previewRent).
 */
export function rentFor(tile, level = 0, fullSet = false) {
  const table = rentTable(tile);
  if (!table.length) return 0;
  const lv = Math.max(0, Math.min(MAX_LEVEL, level | 0));
  const rent = table[lv];
  return lv === 0 && fullSet ? Math.round(rent * SET_BONUS.full) : rent;
}

/** Cost of ONE upgrade on a district: 40% of its price (₹24,000 - ₹1,60,000; always whole thousands, prices are multiples of 10,000). */
export function upgradeCost(tile) {
  return tile && tile.type === 'property' ? Math.round(tile.price * UPGRADE_RATIO) : 0;
}

/** What selling one upgrade back to the bank refunds. */
export const sellRefund = (tile) => Math.round(upgradeCost(tile) * SELL_RATIO);

export const mortgageValue = (tile) => (tile && tile.type === 'property' ? Math.round(tile.price * MORTGAGE_RATIO) : 0);
export const unmortgageCost = (tile) => Math.round(mortgageValue(tile) * (1 + UNMORTGAGE_INTEREST));

/** The themed business name of a district at `level` ("Startup Office"), or the generic name for other tiles. */
export function levelName(tile, level = 0) {
  const lv = Math.max(0, Math.min(MAX_LEVEL, level | 0));
  const g = tile && GROUPS[tile.group];
  return (g && g.levelNames[lv]) || LEVEL_NAMES[lv];
}

/** The next transport stop clockwise after `tileId` (5 -> 14 -> 23 -> 5). */
export function nextTransport(tileId) {
  const t = ((Number(tileId) || 0) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
  return TRANSPORT_TILES.find((x) => x > t) ?? TRANSPORT_TILES[0];
}

/** Municipal Charges for someone holding `levels` upgrade levels in total. */
export const municipalFor = (levels) => MUNICIPAL_BASE + MUNICIPAL_PER_LEVEL * Math.max(0, levels | 0);

/** Minimum bid of an auction for `tileId`: `reason` 'bazaar' = 50% of the price, otherwise (Snatch bidding) 10%. */
export function auctionMinBid(tileId, reason) {
  const tile = TILES[tileId];
  const ratio = reason === 'bazaar' ? BAZAAR_MIN_RATIO : DECLINE_MIN_RATIO;
  return Math.max(PRICE_UNIT, round1000((tile ? tile.price : 0) * ratio));
}

/**
 * Cell on the 10x10 board grid (col,row both 0..9, row 0 = top) for a tile index.
 * Tile ids ascend CLOCKWISE from START at the bottom-LEFT corner.
 */
export function tilePosition(i) {
  const last = GRID - 1; // 9
  if (i <= 9) return { col: 0, row: last - i }; // left column, bottom -> top
  if (i <= 18) return { col: i - 9, row: 0 }; // top row, left -> right
  if (i <= 27) return { col: last, row: i - 18 }; // right column, top -> bottom
  return { col: last - (i - 27), row: last }; // bottom row, right -> left
}

/** Which side of the board a tile sits on: 'left' | 'top' | 'right' | 'bottom' (a corner belongs to the side it ends). */
export function tileSide(i) {
  if (i <= 9) return 'left';
  if (i <= 18) return 'top';
  if (i <= 27) return 'right';
  return 'bottom';
}
