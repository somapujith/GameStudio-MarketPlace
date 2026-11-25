// The workshop catalogue: every customisation the garage sells, as data. This file is the CONTRACT between the workshop UI
// (gameplay/workshop.js, ui/Workshop.jsx) and the auto's look and sound (sim/customize.js, audio/horns.js): both read the same
// ids. Prices are rupees. `price: 0` = stock (free). Re-applying something already bought is free (profile.owned).
//
// The player's current choices are a LOADOUT (see DEFAULT_LOADOUT); performance parts are UPGRADES (levels 0..4).

export const DEFAULT_LOADOUT = {
  paint: { body: 'auto-yellow', roof: 'night-black', finish: 'gloss' },
  plate: { text: 'TS09 EZ4040', style: 'yellow' },
  horn: 'stock',
  lights: { head: 'white', under: 'off', tail: 'red' },
  roofStyle: 'stock',
  curtains: 'khaki',
  decals: { stripe: 'none', banner: 'జై హనుమాన్', mudflap: 'none', dash: 'none', rearWindow: 'AUTO RAJA', rearWindowFrame: 'white', badge: 'HA' },
  rear: { cover: 'louver', bumper: 'stock', flaps: 'black', ladder: false, antenna: false, sideGuards: false },
  wheels: 'steel',
  tint: 0,
  interior: { seats: 'maroon', garland: false },
};

export const DEFAULT_UPGRADES = { engine: 0, tyres: 0, tank: 0, brakes: 0, turbo: 0 };

const named = (list) => list.map(([id, name, price, extra = {}]) => ({ id, name, price, ...extra }));

/** Body paint: hex is what the auto turns. */
export const BODY_COLORS = named([
  ['auto-yellow', 'Auto Yellow', 0, { hex: '#ffc400' }],
  ['irani-chai', 'Irani Chai', 220, { hex: '#b5651d' }],
  ['pista-green', 'Pista Green', 220, { hex: '#93c572' }],
  ['charminar-cream', 'Charminar Cream', 220, { hex: '#f3e3c6' }],
  ['bonalu-red', 'Bonalu Red', 260, { hex: '#e03a4a' }],
  ['sagar-teal', 'Hussain Sagar Teal', 260, { hex: '#12a8a0' }],
  ['gulmohar', 'Gulmohar Orange', 260, { hex: '#ff6a2d' }],
  ['haleem-brown', 'Haleem Brown', 220, { hex: '#7a4a2d' }],
  ['saffron', 'Biryani Saffron', 260, { hex: '#ff9f1c' }],
  ['neon-pink', 'Neon Pink', 380, { hex: '#ff3d9a' }],
  ['vice-violet', 'Vice Violet', 380, { hex: '#8f6bff' }],
  ['midnight', 'Midnight Blue', 320, { hex: '#1a2a6c' }],
  ['pearl-white', 'Pearl White', 320, { hex: '#f4f1ea' }],
  ['gunmetal', 'Gunmetal', 320, { hex: '#3a3d4a' }],
  ['rani-pink', 'Rani Pink', 380, { hex: '#e91e8c' }],
  ['lime-rush', 'Lime Rush', 380, { hex: '#a6ff3d' }],
  ['bottle-green', 'Bottle Green', 240, { hex: '#1d7a45' }],
]);

export const ROOF_COLORS = named([
  ['night-black', 'Night Black', 0, { hex: '#241f2c' }],
  ['auto-yellow', 'Auto Yellow', 120, { hex: '#ffc400' }],
  ['khaki', 'Khaki Canvas', 100, { hex: '#a89a6a' }],
  ['bonalu-red', 'Bonalu Red', 160, { hex: '#c22b3a' }],
  ['sagar-teal', 'Sagar Teal', 160, { hex: '#0e8a85' }],
  ['pista-green', 'Pista Green', 160, { hex: '#5fa34a' }],
  ['white', 'Chalk White', 140, { hex: '#eeeae0' }],
  ['silver', 'Silver', 220, { hex: '#c9ccd6' }],
  ['neon-pink', 'Neon Pink', 240, { hex: '#ff3d9a' }],
  ['vice-violet', 'Vice Violet', 240, { hex: '#6a4bd8' }],
  ['midnight', 'Midnight Blue', 200, { hex: '#1a2a6c' }],
]);

/** Paint finish: C2 maps these to roughness / metalness / clearcoat on the paint material. */
export const FINISHES = named([
  ['gloss', 'Gloss', 0, { roughness: 0.28, metalness: 0.04, clearcoat: 0.6 }],
  ['matte', 'Matte', 150, { roughness: 0.85, metalness: 0.0, clearcoat: 0 }],
  ['metallic', 'Metallic', 300, { roughness: 0.3, metalness: 0.55, clearcoat: 0.8 }],
  ['pearl', 'Pearlescent', 450, { roughness: 0.22, metalness: 0.35, clearcoat: 1, sheen: true }],
  ['chrome', 'Chrome', 900, { roughness: 0.08, metalness: 1, clearcoat: 1 }],
]);

/** Number plates. `text` rules: A-Z, 0-9, space and hyphen, 1-10 characters (see sanitizePlate). Changing the text costs PLATE_TEXT_PRICE. */
export const PLATE_TEXT_PRICE = 250;
export const PLATE_MAX = 12;
export const PLATE_STYLES = named([
  ['yellow', 'Commercial (yellow)', 0, { bg: '#ffd21f', fg: '#14100a', border: '#14100a' }],
  ['white', 'Private (white)', 120, { bg: '#fffaf0', fg: '#14100a', border: '#14100a' }],
  ['green', 'Electric (green)', 200, { bg: '#1fa35a', fg: '#ffffff', border: '#ffffff' }],
  ['black', 'Self-drive (black)', 200, { bg: '#16141a', fg: '#ffd21f', border: '#ffd21f' }],
  ['film', 'Film Star (neon)', 450, { bg: '#2a0a3a', fg: '#ff9ad0', border: '#ff3d9a', glow: true }],
  ['carbon', 'Carbon Fibre', 380, { bg: '#22232b', fg: '#e6e8f2', border: '#8a8ea0' }],
]);
export const sanitizePlate = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, PLATE_MAX);

/** Horns: audio/horns.js synthesises each id with Web Audio (no sample files). */
export const HORNS = named([
  ['stock', 'Peep-Peep', 0, { te: 'పీప్ పీప్' }],
  ['cycle', 'Cycle Bell', 80],
  ['cuckoo', 'Cuckoo Clock', 200],
  ['whistle', 'Traffic Whistle', 220],
  ['filmy', 'Filmy Tune', 300],
  ['airhorn', 'Truck Air Horn', 350],
  ['shehnai', 'Shehnai', 400],
  ['sitar', 'Sitar Twang', 450],
  ['dholak', 'Dholak Beat', 500],
  ['baraat', 'Baraat Brass', 650],
]);

export const HEADLIGHTS = named([
  ['white', 'Xenon White', 0, { hex: '#fff4d6' }],
  ['warm', 'Warm Halogen', 50, { hex: '#ffd89a' }],
  ['amber', 'Amber', 100, { hex: '#ffb347' }],
  ['ice', 'Ice Blue', 150, { hex: '#bfe6ff' }],
  ['pink', 'Hot Pink', 200, { hex: '#ff7ac8' }],
  ['cyan', 'Neon Cyan', 200, { hex: '#5ff0ff' }],
  ['lime', 'Lime', 200, { hex: '#c8ff5a' }],
  ['violet', 'Violet', 250, { hex: '#b48aff' }],
]);

/** Underglow neon under the auto. 'rainbow' cycles hue. 'off' is stock. */
export const UNDERGLOW = named([
  ['off', 'Off', 0, { hex: null }],
  ['white', 'White', 300, { hex: '#ffffff' }],
  ['pink', 'Pink', 350, { hex: '#ff3d9a' }],
  ['cyan', 'Cyan', 350, { hex: '#37e6ff' }],
  ['violet', 'Violet', 350, { hex: '#8f6bff' }],
  ['lime', 'Lime', 350, { hex: '#a6ff3d' }],
  ['orange', 'Orange', 350, { hex: '#ff8a2d' }],
  ['red', 'Red', 350, { hex: '#ff2a3a' }],
  ['rainbow', 'Rainbow', 700, { hex: null, cycle: true }],
]);

export const TAILLIGHTS = named([
  ['red', 'Red', 0, { hex: '#ff2a3a' }],
  ['orange', 'Amber', 60, { hex: '#ff8a2d' }],
  ['pink', 'Pink', 150, { hex: '#ff3d9a' }],
  ['cyan', 'Cyan', 150, { hex: '#37e6ff' }],
]);

/** Roof extras. Each is a prop mounted on / around the roof (C2 builds the meshes). */
export const ROOF_STYLES = named([
  ['stock', 'Stock Canopy', 0],
  ['flag', 'Telangana Flag Topper', 150],
  ['garland', 'Marigold Garland', 200],
  ['speaker', 'Loudspeaker Box', 300],
  ['led-bar', 'LED Light Bar', 400],
  ['high-canopy', 'High Canopy', 500],
  ['dome-lights', 'Disco Dome Lights', 650],
]);

export const CURTAINS = named([
  ['khaki', 'Khaki Canvas', 0, { hex: '#6b6046' }],
  ['black', 'Black Vinyl', 100, { hex: '#25232d' }],
  ['red-check', 'Red Check', 100, { hex: '#b8323c', pattern: 'check' }],
  ['blue', 'Ocean Blue', 100, { hex: '#2a5bb0' }],
  ['green', 'Pista Green', 100, { hex: '#3f8a52' }],
  ['floral', 'Floral Print', 150, { hex: '#d86a9a', pattern: 'floral' }],
  ['tricolor', 'Tricolour', 200, { hex: '#ff9933', pattern: 'tricolor' }],
  ['film-poster', 'Film Poster', 300, { hex: '#7a3aa8', pattern: 'poster' }],
]);

/** Decals. `banner` is the board on the back of the roof: a preset or custom text (BANNER_CUSTOM_PRICE). */
export const BANNER_CUSTOM_PRICE = 200;
export const BANNER_MAX = 22;
export const BANNERS = named([
  ['జై హనుమాన్', 'జై హనుమాన్ (stock)', 0],
  ['మా అమ్మ ఆశీర్వాదం', 'మా అమ్మ ఆశీర్వాదం', 120],
  ['JAI BALAYYA', 'JAI BALAYYA', 120],
  ['HYDERABADI', 'HYDERABADI', 120],
  ['HORN OK PLEASE', 'HORN OK PLEASE', 120],
  ['CHALO BIRYANI', 'CHALO BIRYANI', 120],
  ['RAJA RAANI', 'RAJA RAANI', 120],
  ['MAMA PRIDE', 'MAMA PRIDE', 120],
]);
export const sanitizeBanner = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, BANNER_MAX);

export const STRIPES = named([
  ['none', 'None', 0],
  ['tricolor', 'Tricolour', 200, { colors: ['#ff9933', '#ffffff', '#138808'] }],
  ['zigzag', 'Zigzag', 200, { colors: ['#14100a', '#ffffff'] }],
  ['stars', 'Stars', 250, { colors: ['#ffffff'] }],
  ['checker', 'Checker', 250, { colors: ['#14100a', '#ffffff'] }],
  ['flame', 'Flames', 300, { colors: ['#ff3d1f', '#ffb100'] }],
  ['wave', 'Pink Wave', 300, { colors: ['#ff3d9a', '#8f6bff'] }],
  ['rainbow-swish', 'Rainbow Swish', 320, { colors: ['#ff3d6e', '#ffb100', '#3dd68c', '#37a8ff'] }],
]);

/** Mud-flap messages (the rear mudguard text, a classic of Indian truck art). */
export const MUDFLAPS = named([
  ['none', 'None', 0, { text: '' }],
  ['horn-ok', 'Horn OK Please', 80, { text: 'HORN OK PLEASE' }],
  ['buri-nazar', 'Buri Nazar Waale…', 80, { text: 'BURI NAZAR WAALE TERA MUH KAALA' }],
  ['mother', "Mother's Blessings", 80, { text: "MOTHER'S BLESSINGS" }],
  ['speed', 'Speed Thrills', 80, { text: 'SPEED THRILLS BUT KILLS' }],
  ['jalebi', 'Jalebi', 80, { text: 'JALEBI GAMES' }],
]);

/** Dashboard bobbleheads. */
export const DASH_TOYS = named([
  ['none', 'None', 0],
  ['cricketer', 'Nodding Cricketer', 150],
  ['hanuman', 'Nodding Hanuman', 150],
  ['ganesh', 'Ganesh', 150],
  ['cow', 'Happy Cow', 200],
  ['dancer', 'Dancing Doll', 200],
  ['lucky-cat', 'Lucky Cat', 200],
]);

export const WHEELS = named([
  ['steel', 'Stock Steel', 0, { hex: '#a29a90', metalness: 0.5 }],
  ['black', 'Gloss Black', 200, { hex: '#1c1a22', metalness: 0.4 }],
  ['chrome', 'Chrome', 200, { hex: '#e3e6f2', metalness: 1 }],
  ['gold', 'Gold', 350, { hex: '#e9b64a', metalness: 0.9 }],
  ['neon-pink', 'Neon Pink', 300, { hex: '#ff3d9a', metalness: 0.2, glow: true }],
  ['neon-cyan', 'Neon Cyan', 300, { hex: '#37e6ff', metalness: 0.2, glow: true }],
  ['whitewall', 'Whitewall Tyres', 250, { hex: '#e3e6f2', metalness: 0.3, whitewall: true }],
]);

/** Windscreen tint: level 0..3 (opacity of the glass). */
export const TINTS = named([[0, 'Clear', 0], [1, 'Light', 100], [2, 'Dark', 200], [3, 'Limo', 300]]).map((t) => ({ ...t, id: Number(t.id) }));

export const SEATS = named([
  ['maroon', 'Maroon Vinyl', 0, { hex: '#a13a2c' }],
  ['black', 'Black Leather', 80, { hex: '#1a1820' }],
  ['tan', 'Tan', 80, { hex: '#c79a62' }],
  ['blue', 'Royal Blue', 100, { hex: '#2a4fa8' }],
  ['pink', 'Rani Pink', 150, { hex: '#e8478f' }],
  ['leopard', 'Leopard Print', 250, { hex: '#d9a14a', pattern: 'leopard' }],
]);
export const GARLAND_PRICE = 120;

/** Performance parts: `prices[n]` is the price of reaching level n (index 0 is the stock level, free). */
export const UPGRADES = {
  engine: { label: 'Engine', te: 'ఇంజిన్', blurb: 'More top speed and pull.', prices: [0, 600, 1200, 2200, 3600] },
  tyres: { label: 'Tyres', te: 'టైర్లు', blurb: 'More grip: tighter corners, shorter slides.', prices: [0, 450, 900, 1700, 2800] },
  brakes: { label: 'Brakes', te: 'బ్రేకులు', blurb: 'Stops faster.', prices: [0, 400, 800, 1500, 2400] },
  tank: { label: 'CNG Tank', te: 'ట్యాంక్', blurb: 'Bigger tank: fewer trips to the pump.', prices: [0, 400, 800, 1400, 2200] },
  turbo: { label: 'Jugaad Turbo', te: 'టర్బో', blurb: 'Stronger, longer boost from drifting.', prices: [0, 800, 1600, 2600, 4000] },
};
export const MAX_UPGRADE = 4;


// ---- Rear and exterior parts, modelled on real Hyderabad autos (white-top / yellow-bottom Bajaj RE, rear window lettering,
// louvred engine cover carrying the plate, chrome bumper and guards, painted mud-flaps, LED panels). The customisation agent
// builds the meshes; the workshop agent lists them.

/** The sticker lettering across the rear window (a preset or custom text, BANNER_CUSTOM_PRICE like the roof banner). */
export const REAR_WINDOW_TEXTS = named([
  ['AUTO RAJA', 'AUTO RAJA', 0],
  ['DUBAI WHITE HOUSE', 'DUBAI WHITE HOUSE', 120],
  ['MERI JAANI', 'MERI JAANI', 120],
  ['BADSHAH', 'BADSHAH', 120],
  ['LUXZARY', 'LUXZARY', 120],
  ['MAA KA ASHEERVAD', 'MAA KA ASHEERVAD', 120],
  ['JAI BALAYYA', 'JAI BALAYYA', 120],
  ['KING OF HYD', 'KING OF HYD', 120],
]);
/** The outline colour round the rear-window sticker. */
export const WINDOW_FRAMES = named([
  ['white', 'White', 0, { hex: '#ffffff' }],
  ['red', 'Red', 60, { hex: '#ff2a3a' }],
  ['pink', 'Hot Pink', 60, { hex: '#ff3d9a' }],
  ['cyan', 'Cyan', 60, { hex: '#37e6ff' }],
  ['gold', 'Gold', 80, { hex: '#ffc857' }],
]);
/** The small oval badge on the top of the rear roof (2-4 letters, e.g. a driver's initials). */
export const BADGE_MAX = 4;
export const BADGE_PRICE = 100;
export const sanitizeBadge = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9&+]/g, '').slice(0, BADGE_MAX);

/** The rear engine cover (the panel the number plate sits on). 'led-*' are glowing light panels like the pink grid in the photos. */
export const ENGINE_COVERS = named([
  ['louver', 'Louvred Steel (stock)', 0],
  ['mesh', 'Mesh Grille', 150],
  ['chrome-grille', 'Chrome Grille', 300],
  ['jali', 'Carved Jali', 350],
  ['led-pink', 'LED Panel: Pink', 600, { hex: '#ff3d9a' }],
  ['led-cyan', 'LED Panel: Cyan', 600, { hex: '#37e6ff' }],
  ['led-rainbow', 'LED Panel: Rainbow', 900, { hex: null, cycle: true }],
  ['royal', 'Royal Emblem Panel', 450],
]);
export const BUMPERS = named([
  ['stock', 'Stock Bumper', 0],
  ['chrome-bar', 'Chrome Bar', 250],
  ['double-chrome', 'Double Chrome Bar', 450],
  ['spiked', 'Spiked Guard', 500],
]);
/** Painted / studded mud-flaps hanging behind the rear wheels. */
export const MUDFLAP_STYLES = named([
  ['black', 'Plain Black Rubber', 0],
  ['studs', 'Chrome Studs', 150],
  ['flowers', 'Painted Flowers', 220],
  ['eyes', 'Buri Nazar Eyes', 220],
  ['checker', 'Checker Border', 180],
  ['peacock', 'Peacock Art', 300],
]);
/** Bolt-on extras, each a yes/no with a price (keyed by loadout path). */
export const ACCESSORIES = {
  'rear.ladder': { label: 'Rear Ladder', te: 'నిచ్చెన', price: 200 },
  'rear.antenna': { label: 'Whip Antenna + Flag', te: 'యాంటెన్నా', price: 120 },
  'rear.sideGuards': { label: 'Chrome Side Guards', te: 'గార్డులు', price: 280 },
};

/** Look up an item by catalogue list + id (or null). */
export const find = (list, id) => list.find((x) => x.id === id) || null;

/** Everything keyed by the loadout path it fills, so a menu can be built generically. */
export const OPTIONS = {
  'paint.body': BODY_COLORS,
  'paint.roof': ROOF_COLORS,
  'paint.finish': FINISHES,
  'plate.style': PLATE_STYLES,
  horn: HORNS,
  'lights.head': HEADLIGHTS,
  'lights.under': UNDERGLOW,
  'lights.tail': TAILLIGHTS,
  roofStyle: ROOF_STYLES,
  curtains: CURTAINS,
  'decals.stripe': STRIPES,
  'decals.rearWindowFrame': WINDOW_FRAMES,
  'rear.cover': ENGINE_COVERS,
  'rear.bumper': BUMPERS,
  'rear.flaps': MUDFLAP_STYLES,
  'decals.mudflap': MUDFLAPS,
  'decals.dash': DASH_TOYS,
  wheels: WHEELS,
  tint: TINTS,
  'interior.seats': SEATS,
};

/** Read / write a dotted path in a loadout ('paint.body'). */
export const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export const withPath = (o, path, value) => {
  const keys = path.split('.');
  const out = { ...o };
  let cur = out;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else {
      cur[k] = { ...cur[k] };
      cur = cur[k];
    }
  });
  return out;
};

/** Merge a stored (possibly old or hostile) loadout over the defaults, dropping anything unknown. Safe on any input. */
export function normalizeLoadout(raw) {
  const out = JSON.parse(JSON.stringify(DEFAULT_LOADOUT));
  if (!raw || typeof raw !== 'object') return out;
  for (const [path, list] of Object.entries(OPTIONS)) {
    const v = getPath(raw, path);
    if (v !== undefined && list.some((x) => x.id === v)) Object.assign(out, withPath(out, path, v));
  }
  const text = sanitizePlate(raw.plate?.text);
  if (text) out.plate.text = text;
  const banner = sanitizeBanner(raw.decals?.banner);
  if (banner) out.decals.banner = banner;
  if (typeof raw.interior?.garland === 'boolean') out.interior.garland = raw.interior.garland;
  const rw = sanitizeBanner(raw.decals?.rearWindow);
  if (rw) out.decals.rearWindow = rw;
  const badge = sanitizeBadge(raw.decals?.badge);
  if (badge) out.decals.badge = badge;
  for (const k of ['ladder', 'antenna', 'sideGuards']) if (typeof raw.rear?.[k] === 'boolean') out.rear[k] = raw.rear[k];
  return out;
}

export function normalizeUpgrades(raw) {
  const out = { ...DEFAULT_UPGRADES };
  if (raw && typeof raw === 'object') for (const k of Object.keys(out)) out[k] = Math.max(0, Math.min(MAX_UPGRADE, Math.floor(Number(raw[k]) || 0)));
  return out;
}
