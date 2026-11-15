// The board's structure is the same on every map: eight collections of three property slots. Art is keyed by these
// slots (tile ids), never by display names or group ids, so it survives any renaming.
export const COLLECTION_TILES = Object.freeze([
  Object.freeze([1, 3, 4]), // Towns & Markets
  Object.freeze([6, 7, 8]), // Andhra Crafts
  Object.freeze([10, 11, 13]), // Godavari Gold
  Object.freeze([15, 16, 17]), // Uttarandhra
  Object.freeze([19, 20, 22]), // Nature & Heritage
  Object.freeze([24, 25, 26]), // Rayalaseema
  Object.freeze([28, 29, 31]), // Spiritual Andhra
  Object.freeze([33, 34, 35]), // Capital & Commerce
]);

/** 0..7 for a property tile id, -1 for anything else. */
export const collectionOf = (tileId) => COLLECTION_TILES.findIndex((c) => c.includes(Number(tileId)));

/** The collection's shop prop and the sign used by the little building art. */
export const COLLECTION_PROPS = Object.freeze(['sacks', 'toys', 'coconuts', 'crates', 'cups', 'nuts', 'laddu', 'tech']);
