// Catalogue search shared by /search, /games and the command palette. Pure: no React, no network.
// Searches name, tagline, description, category and tags. Accent-insensitive, punctuation-insensitive, and
// tolerant of small typos (edit distance 1 for terms of 4-7 characters, 2 for 8+). Every term must match.
import { CATEGORIES, GAMES } from '@/games/registry.js';

const MARKS = /[̀-ͯ]/g;

/** Lower-case, accent-free, punctuation turned into single spaces. */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The search terms of a query (normalised words). */
export function queryTerms(query) {
  return norm(query).split(' ').filter(Boolean);
}

/** Optimal-string-alignment distance (insert, delete, substitute, swap two neighbours), with an early-out. */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** How many typos a term of this length may carry (0 for short terms: "ludo" must not match "lido"-style noise). */
const allowance = (len) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);

/** Does `term` fuzzily equal `word` (or the start of it, so half-typed words still match)? */
function fuzzyWord(term, word) {
  const k = allowance(term.length);
  if (!k || !word) return false;
  if (editDistance(term, word, k) <= k) return true;
  return word.length > term.length && editDistance(term, word.slice(0, term.length), k) <= k;
}

const words = (s) => (s ? s.split(' ') : []);

function prepare(game, categories) {
  const cat = norm(categories.find((c) => c.id === game.category)?.label ?? game.category);
  const tags = (Array.isArray(game.tags) ? game.tags : []).map(norm).filter(Boolean);
  const name = norm(game.name);
  const tagline = norm(game.tagline);
  const description = norm(game.description);
  return { name, cat, tags, tagline, description, nameWords: words(name), tagWords: [...words(cat), ...tags.flatMap(words)], taglineWords: words(tagline), descWords: words(description) };
}

/** Best score of one term against one prepared game, or 0 when it does not match at all. */
function scoreTerm(t, g) {
  if (g.name === t) return 100;
  if (g.name.startsWith(t)) return 80;
  if (g.nameWords.some((w) => w.startsWith(t))) return 66;
  if (g.name.includes(t)) return 45;
  if (g.tags.includes(t) || g.cat === t) return 36;
  if (g.tagWords.some((w) => w.startsWith(t))) return 30;
  if (g.taglineWords.some((w) => w.startsWith(t))) return 20;
  if (g.tagline.includes(t)) return 14;
  if (g.description.includes(t)) return 10;
  // typo tolerance, weaker than any exact hit
  if (g.nameWords.some((w) => fuzzyWord(t, w))) return 32;
  if (g.tagWords.some((w) => fuzzyWord(t, w))) return 22;
  if (g.taglineWords.some((w) => fuzzyWord(t, w))) return 8;
  if (g.descWords.some((w) => fuzzyWord(t, w))) return 5;
  return 0;
}

/**
 * Ranked matches for `query` over `games` (default: the whole catalogue).
 * Returns `[{ game, score }]`, best first (live games ahead of coming-soon ones on a tie); an empty query returns
 * every game with score 0 in catalogue order.
 */
export function searchGames(query, games = GAMES, categories = CATEGORIES) {
  const terms = queryTerms(query);
  if (!terms.length) return games.map((game) => ({ game, score: 0 }));
  const phrase = terms.join(' ');
  const out = [];
  games.forEach((game, order) => {
    const g = prepare(game, categories);
    let score = 0;
    for (const t of terms) {
      const s = scoreTerm(t, g);
      if (!s) return;
      score += s;
    }
    if (terms.length > 1 && g.name.includes(phrase)) score += 30;
    out.push({ game, score: score + (game.status === 'coming_soon' ? 0 : 5), order });
  });
  return out.sort((a, b) => b.score - a.score || a.order - b.order).map(({ game, score }) => ({ game, score }));
}

/**
 * Split `text` into `[{ text, hit }]` so a result can highlight what matched. Accent-insensitive; a term with no
 * exact hit highlights the word it fuzzily matched.
 */
export function highlightParts(text, query) {
  const src = String(text ?? '');
  const terms = queryTerms(query);
  if (!src || !terms.length) return [{ text: src, hit: false }];
  // fold per character so indexes stay aligned with the original string
  let folded = '';
  for (const ch of src) {
    const f = ch.toLowerCase().normalize('NFKD').replace(MARKS, '');
    folded += f.length === ch.length ? f : ch.toLowerCase();
  }
  if (folded.length !== src.length) return [{ text: src, hit: false }];
  const hit = new Array(src.length).fill(false);
  const mark = (from, to) => {
    for (let i = from; i < to; i++) hit[i] = true;
  };
  for (const t of terms) {
    let at = folded.indexOf(t);
    if (at !== -1) {
      while (at !== -1) {
        mark(at, at + t.length);
        at = folded.indexOf(t, at + t.length);
      }
      continue;
    }
    for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) if (fuzzyWord(t, m[0])) mark(m.index, m.index + m[0].length);
  }
  const parts = [];
  for (let i = 0; i < src.length; ) {
    let j = i;
    while (j < src.length && hit[j] === hit[i]) j++;
    parts.push({ text: src.slice(i, j), hit: hit[i] });
    i = j;
  }
  return parts;
}

export default searchGames;
