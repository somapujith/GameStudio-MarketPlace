// Cosmetic catalogue: purely visual items bought with coins (never a gameplay advantage).
// The server (worker/routes/shop.js) is the source of truth for prices and ownership; the client
// uses this list to render the shop and previews. Ids never change once shipped.
//
// kinds:
//   frame  - ring drawn around the player's avatar (hub + in-game seat)
//   dice   - skin of the die the player rolls (colours below)
//   title  - short text badge shown under the player's name
//   voice  - a short voice clip its owner plays on demand at the table (everybody in the room hears it).
//            OWNED-ONLY: never "equipped" (users.equipped keeps one item per kind, a clip library does not
//            fit), so cleanEquipped and POST /api/shop/equip ignore it (EQUIPPABLE_KINDS = the equippable kinds).
//            The audio lives in public/audio/voice/ and is fetched lazily by the client, never bundled.

export const COSMETIC_KINDS = Object.freeze(['frame', 'dice', 'title', 'voice']);
/** Kinds that have an "equipped" slot (users.equipped). `voice` is owned-only. */
export const EQUIPPABLE_KINDS = Object.freeze(COSMETIC_KINDS.filter((k) => k !== 'voice'));

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
 * `{ frame?, dice?, title? }` -> the same object with unknown ids / wrong kinds dropped.
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
