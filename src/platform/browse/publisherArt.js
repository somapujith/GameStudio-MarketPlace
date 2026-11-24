// The cinematic art of a game, for the cine hub (posters, wide cards, hero backdrops). Every game with a painted cover
// under public/art/cinematic/ is listed here; a game without one (a new plugin) falls back to its manifest's SVG cover.
const COVERS = {
  'hyderabad-tycoon': ['hero', '01'],
  'ludo-lanes': ['ludo', '02'],
  'tambola-night': ['tambola', '04'],
  'word-rush': ['word', '05'],
  'carrom-club': ['carrom', '03'],
};

/** `{ src, number }` of a game's painted cover (720x480 or 2:1), or null. */
export function publisherArt(game) {
  const cover = COVERS[game?.id];
  return cover ? { src: `/art/cinematic/${cover[0]}.webp`, number: cover[1] } : null;
}

/**
 * The full-bleed backdrop of a title (home hero slide, game page). `flip` mirrors art whose quiet side is on the
 * right so the title text always sits on the calm left; `pos` is the object-position that keeps the subject in view.
 */
const BACKDROPS = {
  'hyderabad-tycoon': { src: '/art/cinematic/hero.webp', pos: '86% 40%', phonePos: '64% 30%' },
};
const DETAIL_BACKDROPS = {
  'hyderabad-tycoon': { src: '/art/cinematic/nawabi-setup.webp', pos: '30% 40%', phonePos: '32% 30%', flip: true },
};

export function backdropArt(game, { detail = false } = {}) {
  const id = game?.id;
  const own = (detail && DETAIL_BACKDROPS[id]) || BACKDROPS[id];
  if (own) return own;
  const art = publisherArt(game);
  return art ? { src: art.src, pos: '62% 45%', phonePos: '60% 40%' } : null;
}
