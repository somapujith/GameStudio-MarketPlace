// Cosmetic catalogue: purely visual items bought with coins (never a gameplay advantage).
// The server (worker/routes/shop.js) is the source of truth for prices and ownership; the client
// uses this list to render the shop and previews. Ids never change once shipped.
//
// kinds:
//   frame  - ring drawn around the player's avatar (hub + lobby seat + in-game seat + results)
//   dice   - skin of the die the player rolls (colours below, `finish` = the material)
//   trail  - the effect a player's pawn leaves behind as it walks the board (`finish` = the particle kind)
//   board  - a visual theme for the game board (colours below), cosmetic only
//   title  - short text badge shown under the player's name
//   voice  - a short voice clip its owner plays on demand at the table (everybody in the room hears it).
//            OWNED-ONLY: never "equipped" (users.equipped keeps one item per kind, a clip library does not
//            fit), so cleanEquipped and POST /api/shop/equip ignore it (EQUIPPABLE_KINDS = the equippable kinds).
//            The audio lives in public/audio/voice/ and is fetched lazily by the client, never bundled.
//
// fields beyond id/kind/name/price/rarity:
//   colors  frame [a, b] gradient stops · dice [face, pip, edge] · trail [a, b] particle colours · board [night, paper, accent]
//   finish  the material / effect key the art switches on (never shown to users), see FINISHES below
//   glow    dice only: the halo / sparkle colour of the skin (hex), defaults to the skin's edge colour
//
// rarity: common < rare < epic < legendary. Legendary items are the shiny ones (animated sheen, sparkle).

export const COSMETIC_KINDS = Object.freeze(['frame', 'dice', 'trail', 'board', 'title', 'voice']);
/** Kinds that have an "equipped" slot (users.equipped). `voice` is owned-only. */
export const EQUIPPABLE_KINDS = Object.freeze(COSMETIC_KINDS.filter((k) => k !== 'voice'));

/** Rarity tiers, lowest first (the shop sorts and styles by this order). */
export const RARITIES = Object.freeze(['common', 'rare', 'epic', 'legendary']);

/**
 * The `finish` keys the art knows, by kind. The catalogue test pins that every `finish` below is listed here, so an art
 * agent can switch on exactly these. Items without a `finish` draw the plain, flat look.
 */
export const FINISHES = Object.freeze({
  dice: Object.freeze(['gold', 'silver', 'bronze', 'rosegold', 'chrome', 'obsidian', 'ruby', 'emerald', 'crystal', 'holo', 'jade']),
  frame: Object.freeze(['silver', 'emerald', 'obsidian', 'aurora', 'diamond']),
  trail: Object.freeze(['dust', 'steam', 'petals', 'sparks', 'streak', 'coins', 'comet', 'flame', 'stardust']),
  board: Object.freeze(['bazaar', 'lake', 'grid', 'marble', 'obsidian', 'emerald', 'goldleaf']),
});

export const COSMETICS = Object.freeze([
  // Avatar frames
  { id: 'frame-sandstone', kind: 'frame', name: 'Sandstone', price: 300, rarity: 'common', colors: ['#e3b778', '#a8743a'] },
  { id: 'frame-pearl', kind: 'frame', name: 'Hyderabadi Pearl', price: 800, rarity: 'rare', colors: ['#f6f1ea', '#c9b8d8'] },
  { id: 'frame-lake', kind: 'frame', name: 'Hussain Sagar', price: 800, rarity: 'rare', colors: ['#4cc9f0', '#2a6fdb'] },
  { id: 'frame-nizam', kind: 'frame', name: 'Nizam Gold', price: 2000, rarity: 'epic', colors: ['#ffd36b', '#ff8a3d'] },
  { id: 'frame-silver', kind: 'frame', name: 'Sterling Silver', price: 2200, rarity: 'epic', colors: ['#f4f7ff', '#8d99b3'], finish: 'silver' },
  { id: 'frame-emerald', kind: 'frame', name: 'Deccan Emerald', price: 2400, rarity: 'epic', colors: ['#3ee8a0', '#0b7a4d'], finish: 'emerald' },
  { id: 'frame-obsidian', kind: 'frame', name: 'Midnight Obsidian', price: 2600, rarity: 'epic', colors: ['#5a5a7a', '#14141f'], finish: 'obsidian' },
  { id: 'frame-aurora', kind: 'frame', name: 'Aurora', price: 5500, rarity: 'legendary', colors: ['#7bffd9', '#b46bff'], finish: 'aurora' },
  { id: 'frame-golconda', kind: 'frame', name: 'Golconda Diamond', price: 8000, rarity: 'legendary', colors: ['#e6f6ff', '#7cc7ff'], finish: 'diamond' },

  // Dice skins: face, pip and edge colours (+ `finish` material and `glow` halo colour for the shiny ones)
  { id: 'dice-ivory', kind: 'dice', name: 'Ivory', price: 0, rarity: 'common', colors: ['#fbf7ef', '#1b1340', '#d9cdb5'] },
  { id: 'dice-biryani', kind: 'dice', name: 'Biryani Saffron', price: 400, rarity: 'common', colors: ['#ffb347', '#5a2a00', '#e08a1e'] },
  { id: 'dice-cyber', kind: 'dice', name: 'Cyberabad Neon', price: 900, rarity: 'rare', colors: ['#141a3a', '#5ef2ff', '#7b6dff'] },
  { id: 'dice-bangle', kind: 'dice', name: 'Laad Bazaar Bangle', price: 1500, rarity: 'epic', colors: ['#b5179e', '#ffe066', '#7209b7'] },
  { id: 'dice-bronze', kind: 'dice', name: 'Antique Bronze', price: 1200, rarity: 'rare', colors: ['#cd8b4f', '#2b1608', '#7a4a24'], finish: 'bronze', glow: '#ffb070' },
  { id: 'dice-crystal', kind: 'dice', name: 'Crystal Ice', price: 1800, rarity: 'rare', colors: ['#cfeeff', '#12395c', '#86c8ee'], finish: 'crystal', glow: '#bff1ff' },
  { id: 'dice-jade', kind: 'dice', name: 'Imperial Jade', price: 2600, rarity: 'epic', colors: ['#7fcf9e', '#0f3b27', '#3f8f68'], finish: 'jade', glow: '#b8ffd6' },
  { id: 'dice-obsidian', kind: 'dice', name: 'Obsidian & Gold', price: 2800, rarity: 'epic', colors: ['#15151f', '#ffd36b', '#3a3a52'], finish: 'obsidian', glow: '#a79dff' },
  { id: 'dice-rosegold', kind: 'dice', name: 'Rose Gold', price: 3000, rarity: 'epic', colors: ['#f0b4a6', '#4a1f2a', '#b76e79'], finish: 'rosegold', glow: '#ffc9d1' },
  { id: 'dice-silver', kind: 'dice', name: 'Sterling Silver', price: 3200, rarity: 'epic', colors: ['#dfe4ee', '#1c2333', '#8b95aa'], finish: 'silver', glow: '#cfe0ff' },
  { id: 'dice-chrome', kind: 'dice', name: 'Mirror Chrome', price: 3600, rarity: 'epic', colors: ['#e9eef5', '#0b1020', '#6e7b92'], finish: 'chrome', glow: '#9fd8ff' },
  { id: 'dice-ruby', kind: 'dice', name: 'Ruby Gem', price: 5000, rarity: 'legendary', colors: ['#d1163f', '#fff1f3', '#7a0a25'], finish: 'ruby', glow: '#ff5c7a' },
  { id: 'dice-emerald', kind: 'dice', name: 'Emerald Gem', price: 5200, rarity: 'legendary', colors: ['#0fa968', '#eafff3', '#07613c'], finish: 'emerald', glow: '#4dffb0' },
  { id: 'dice-gold', kind: 'dice', name: 'Solid Gold', price: 6500, rarity: 'legendary', colors: ['#f5c542', '#5a3a00', '#b8860b'], finish: 'gold', glow: '#ffd86b' },
  { id: 'dice-holo', kind: 'dice', name: 'Holo Prism', price: 7500, rarity: 'legendary', colors: ['#e8e0ff', '#2a1a5e', '#9a7cff'], finish: 'holo', glow: '#ff9df5' },

  // Pawn trails: what the piece leaves behind as it walks (colours = the two particle colours)
  { id: 'trail-dust', kind: 'trail', name: 'Hyderabad Dust', price: 350, rarity: 'common', colors: ['#e3b778', '#a8743a'], finish: 'dust' },
  { id: 'trail-chai', kind: 'trail', name: 'Chai Steam', price: 500, rarity: 'common', colors: ['#fff1dd', '#d9a066'], finish: 'steam' },
  { id: 'trail-petals', kind: 'trail', name: 'Rose Petals', price: 900, rarity: 'rare', colors: ['#ff7aa8', '#ffc2d6'], finish: 'petals' },
  { id: 'trail-sparks', kind: 'trail', name: 'Cracker Sparks', price: 1100, rarity: 'rare', colors: ['#ffd36b', '#ff8a3d'], finish: 'sparks' },
  { id: 'trail-neon', kind: 'trail', name: 'Cyber Streak', price: 1300, rarity: 'rare', colors: ['#5ef2ff', '#7b6dff'], finish: 'streak' },
  { id: 'trail-coins', kind: 'trail', name: 'Gold Coin Shower', price: 2500, rarity: 'epic', colors: ['#ffd36b', '#f5a623'], finish: 'coins' },
  { id: 'trail-comet', kind: 'trail', name: 'Comet Tail', price: 2800, rarity: 'epic', colors: ['#b9e6ff', '#6a7cff'], finish: 'comet' },
  { id: 'trail-flame', kind: 'trail', name: 'Dragon Flame', price: 4500, rarity: 'legendary', colors: ['#ffdf6b', '#ff3d2e'], finish: 'flame' },
  { id: 'trail-stardust', kind: 'trail', name: 'Stardust', price: 5200, rarity: 'legendary', colors: ['#fff6c9', '#c58cff'], finish: 'stardust' },

  // Board themes: night (frame / backdrop), paper (tile surface) and accent (trim) colours
  { id: 'board-bazaar', kind: 'board', name: 'Laad Bazaar', price: 600, rarity: 'common', colors: ['#3a1d2e', '#f6e3c4', '#ff9d3c'], finish: 'bazaar' },
  { id: 'board-lake', kind: 'board', name: 'Hussain Sagar Night', price: 1400, rarity: 'rare', colors: ['#0e2347', '#e4f1fb', '#4cc9f0'], finish: 'lake' },
  { id: 'board-grid', kind: 'board', name: 'Cyberabad Grid', price: 1800, rarity: 'rare', colors: ['#0b0f26', '#dfe6ff', '#5ef2ff'], finish: 'grid' },
  { id: 'board-marble', kind: 'board', name: 'Royal Marble', price: 3000, rarity: 'epic', colors: ['#2b2740', '#f5f2ee', '#d4af37'], finish: 'marble' },
  { id: 'board-obsidian', kind: 'board', name: 'Obsidian & Gold', price: 3400, rarity: 'epic', colors: ['#0a0a12', '#2a2a38', '#ffd36b'], finish: 'obsidian' },
  { id: 'board-emerald', kind: 'board', name: 'Emerald Court', price: 3200, rarity: 'epic', colors: ['#073b2a', '#e8f6ee', '#3ee8a0'], finish: 'emerald' },
  { id: 'board-goldleaf', kind: 'board', name: 'Golconda Gilded', price: 7000, rarity: 'legendary', colors: ['#2a1a05', '#fbf0cf', '#ffcf5a'], finish: 'goldleaf' },

  // Titles
  { id: 'title-chai', kind: 'title', name: 'Chai Connoisseur', price: 250, rarity: 'common' },
  { id: 'title-biryani', kind: 'title', name: 'Biryani Baron', price: 600, rarity: 'rare' },
  { id: 'title-hitec', kind: 'title', name: 'HITEC Hustler', price: 600, rarity: 'rare' },
  { id: 'title-dice', kind: 'title', name: 'Dice Whisperer', price: 700, rarity: 'rare' },
  { id: 'title-charminar', kind: 'title', name: 'Charminar Champion', price: 1500, rarity: 'epic' },
  { id: 'title-nawab', kind: 'title', name: 'Nawab of the City', price: 1800, rarity: 'epic' },
  { id: 'title-golconda', kind: 'title', name: 'Golconda Royalty', price: 4000, rarity: 'legendary' },
  { id: 'title-kingpin', kind: 'title', name: 'The Kingpin', price: 5000, rarity: 'legendary' },

  // Voice lines: owned-only clips played for the whole table (docs/CONTRACT.md "Voice lines").
  // src is served from public/ (Vercel / Vite / Worker assets); durationMs is the real length of the file.
  {
    id: 'voice-sheru-bhai', kind: 'voice', name: 'Sheru Bhai', price: 900, rarity: 'rare',
    icon: 'tiger', emoji: '🐯', src: '/audio/voice/sheru-bhai.mp3', durationMs: 8300, caption: 'Sheru Bhai!',
  },
  {
    id: 'voice-ladle-meow', kind: 'voice', name: 'Ladle Meow', price: 700, rarity: 'rare',
    icon: 'cat', emoji: '🐱', src: '/audio/voice/ladle-meow.mp3', durationMs: 6350, caption: 'Ladle meow! gop gop gop',
  },
  {
    id: 'voice-old-man', kind: 'voice', name: 'Old Man', price: 500, rarity: 'rare',
    icon: 'oldman', emoji: '👴', src: '/audio/voice/old-man.mp3', durationMs: 2590, caption: 'Oye!',
  },
]);

/** Items everybody owns without buying. */
export const FREE_COSMETICS = Object.freeze(COSMETICS.filter((c) => c.price === 0).map((c) => c.id));

export const cosmeticById = (id) => COSMETICS.find((c) => c.id === id) || null;

/** Position of a rarity in RARITIES (unknown -> 0), for sorting and "shiny" checks (>= legendary). */
export const rarityRank = (rarity) => Math.max(0, RARITIES.indexOf(rarity));

/**
 * Soundboard limits the server enforces on `{t:'voice'}` (worker/GameRoom.js); the client uses the same numbers for its
 * cooldown ring. Per player: cooldownMs between two lines, at most `burst` within burstWindowMs, `perGame` per match;
 * whole room: at most `roomMax` voice broadcasts within roomWindowMs.
 */
export const VOICE_LIMITS = Object.freeze({
  cooldownMs: 3000,
  burst: 3,
  burstWindowMs: 10_000,
  perGame: 60,
  roomMax: 6,
  roomWindowMs: 5000,
});
export const VOICE_COOLDOWN_MS = VOICE_LIMITS.cooldownMs;
export const VOICE_BURST = VOICE_LIMITS.burst;

/** Voice lines in catalogue order. */
export const voiceLines = () => COSMETICS.filter((c) => c.kind === 'voice');
/** Is `id` a known voice line? (non-strings and unknown ids are false) */
export const isVoiceId = (id) => typeof id === 'string' && voiceLines().some((c) => c.id === id);
/** The audio URL (path under the web root) of a voice line, or null. */
export const voiceSrc = (id) => (isVoiceId(id) ? cosmeticById(id).src : null);

/**
 * `{ frame?, dice?, trail?, board?, title? }` -> the same object with unknown ids / wrong kinds dropped.
 * Use it on anything that came over the network.
 */
export function cleanEquipped(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const kind of EQUIPPABLE_KINDS) {
    const item = cosmeticById(raw[kind]);
    if (item && item.kind === kind) out[kind] = item.id;
  }
  return out;
}
