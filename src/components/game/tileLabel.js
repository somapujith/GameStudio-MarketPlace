// Short, break-safe labels for the board tiles on phones.
//
// On a phone the board is ~330-430px wide, so an edge tile is only ~30-38px wide: a name has to be at most two short lines
// of ~7px bold text. `labelLines(tile)` returns those lines (never more than two for any tile on the board), built from
// the tile's own `short` name:
//   - words that fit stay whole ("Sultan" / "Bazaar"),
//   - long words are split at a syllable with a real hyphen in the text ("Toli-" / "chowki"), so no browser has to guess
//     where to break and nothing is ever cut with an ellipsis,
//   - a few names get a hand-picked abbreviation ("Fin. District" -> "Fin." / "Dist.").
// The full name stays in the tile's aria-label and tooltip; this is only the printed face.

/** Hand-picked lines, keyed by the tile's `short` (or `name`). */
export const LABELS = Object.freeze({
  // Bazaar Beginnings
  'Sultan Bazaar': ['Sultan', 'Bazaar'],
  'Monda Market': ['Monda', 'Market'],
  'Begum Bazaar': ['Begum', 'Bazaar'],
  // Old City Icons
  'Laad Bazaar': ['Laad', 'Bazaar'],
  Charminar: ['Char-', 'minar'],
  Chowmahalla: ['Chow-', 'mahalla'],
  // Everyday Hyderabad
  Malakpet: ['Malak-', 'pet'],
  Mehdipatnam: ['Mehdi-', 'patnam'],
  Tolichowki: ['Toli-', 'chowki'],
  // Twin Cities
  Sainikpuri: ['Sainik-', 'puri'],
  'Patny Centre': ['Patny', 'Centre'],
  Paradise: ['Para-', 'dise'],
  // Lake & Leisure
  'Lumbini Park': ['Lumbini', 'Park'],
  'Tank Bund': ['Tank', 'Bund'],
  'Necklace Rd': ['Neck-', 'lace Rd'],
  // Lights, Camera, Luxury
  'Film Nagar': ['Film', 'Nagar'],
  'Banjara Hills': ['Banjara', 'Hills'],
  'Jubilee Hills': ['Jubilee', 'Hills'],
  // Cyberabad
  Kondapur: ['Konda-', 'pur'],
  Madhapur: ['Madha-', 'pur'],
  'HITEC City': ['HITEC', 'City'],
  // The New City
  Gachibowli: ['Gachi-', 'bowli'],
  Kokapet: ['Koka-', 'pet'],
  'Fin. District': ['Fin.', 'Dist.'],
  // transport, cards, specials
  'Auto Stand': ['Auto', 'Stand'],
  Metro: ['Metro'],
  MMTS: ['MMTS'],
  'Nawabi Luck': ['Nawabi', 'Luck'],
  'City Drama': ['City', 'Drama'],
  Auction: ['Auction'],
  // corners
  START: ['START'],
  'Traffic Jam': ['Traffic', 'Jam'],
  'Chai Adda': ['Chai', 'Adda'],
  Municipal: ['Municipal'],
});

const MAX_WORD = 7;

/** Syllable-ish split for a long word that has no hand-picked entry: after a vowel near the middle. */
function splitWord(word) {
  if (word.length <= MAX_WORD) return [word];
  const mid = Math.round(word.length / 2);
  for (let d = 0; d <= 2; d += 1) {
    for (const i of [mid - d, mid + d]) {
      if (i > 2 && i < word.length - 2 && /[aeiou]/i.test(word[i - 1]) && !/[aeiou]/i.test(word[i])) {
        return [`${word.slice(0, i)}-`, word.slice(i)];
      }
    }
  }
  return [`${word.slice(0, mid)}-`, word.slice(mid)];
}

/** One or two printed lines for a tile on a phone board. Always at least one line (never empty for a real tile). */
export function labelLines(tile) {
  const key = String(tile?.short || tile?.name || '').trim();
  if (!key) return [];
  if (LABELS[key]) return [...LABELS[key]];
  const words = key.split(/\s+/);
  if (words.length === 1) return splitWord(words[0]);
  // two or more words: one word per line, long words split; capped at two lines (the rest joins the second)
  const [first, ...rest] = words;
  return [...splitWord(first).slice(0, 1), rest.join(' ')].filter(Boolean);
}

/** The label as plain text (hyphen breaks removed): what a screen reader or a test would compare with the name. */
export const labelText = (lines) => lines.map((l, i) => (l.endsWith('-') ? l.slice(0, -1) : (i < lines.length - 1 ? `${l} ` : l))).join('');
