const COVERS = {
  'hyderabad-tycoon': ['hero', '01'],
  'ludo-lanes': ['ludo', '02'],
  'tambola-night': ['tambola', '04'],
  'word-rush': ['word', '05'],
  'carrom-club': ['carrom', '03'],
};

export function publisherArt(game) {
  const cover = COVERS[game?.id];
  return cover ? { src: `/art/cinematic/${cover[0]}.webp`, number: cover[1] } : null;
}
