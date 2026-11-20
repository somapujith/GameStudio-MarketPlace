// Pure helpers behind the game listing page: what to show, in which order. No React, no network, so every
// rule is unit-tested (platformGame.test.js). Every manifest field read here is optional.
import { getCategory } from '@/games/registry.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** "2–6 players" / "4 players" ('' when the manifest has no usable range). */
export function playersLabel(players) {
  const min = Number(players?.min);
  const max = Number(players?.max);
  if (!Number.isFinite(max) || max < 1) return '';
  if (!Number.isFinite(min) || min === max) return `${max} player${max === 1 ? '' : 's'}`;
  return `${min}–${max} players`;
}

/** ISO date -> "12 Mar 2026"; anything unparseable -> '' (the row is then hidden). */
export function formatReleased(iso) {
  const s = str(iso);
  if (!s) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** `manifest.howToPlay` -> clean `[{ title, text, icon? }]` (max 4). */
export function howToPlaySteps(game) {
  const list = Array.isArray(game?.howToPlay) ? game.howToPlay : [];
  return list
    .filter((s) => s && typeof s.title === 'string' && s.title)
    .slice(0, 4)
    .map((s) => ({ title: s.title, text: typeof s.text === 'string' ? s.text : '', icon: typeof s.icon === 'string' ? s.icon : null }));
}

/** `manifest.highlights` -> `[{ title, text, icon? }]` (max 6). */
export function highlightList(game) {
  const list = Array.isArray(game?.highlights) ? game.highlights : [];
  return list
    .filter((h) => h && typeof h.title === 'string' && h.title.trim())
    .slice(0, 6)
    .map((h) => ({ title: h.title.trim(), text: str(h.text), icon: str(h.icon) || null }));
}

/** A game that has maps (a `map` setting drawn as the map picker): the listing gets a Maps section. */
export const hasMaps = (game) => Array.isArray(game?.settings) && game.settings.some((f) => f && f.key === 'map' && f.widget === 'map');

const KINDS = new Set(['cover', 'scene', 'board', 'icon']);
const FOCUS = { left: '18% 52%', right: '80% 54%', center: '50% 50%', top: '50% 22%', bottom: '50% 80%' };

/**
 * `manifest.gallery` -> slides `[{ kind, caption, origin }]`. Slides are built from the game's own art (cover, a
 * zoomed crop of it, the icon), so a game without a gallery still gets its cover; an empty manifest gives one slide.
 */
export function galleryItems(game) {
  const raw = Array.isArray(game?.gallery) ? game.gallery : [];
  const items = raw
    .filter((g) => g && KINDS.has(g.kind))
    .slice(0, 8)
    .map((g) => ({ kind: g.kind === 'icon' ? 'board' : g.kind, caption: str(g.caption), origin: FOCUS[g.focus] || FOCUS.center }));
  if (!items.length && game?.art?.cover) items.push({ kind: 'cover', caption: '', origin: FOCUS.center });
  return items;
}

/** The rows of the "Game details" table. Rows without a value are left out. */
export function detailRows(game) {
  if (!game) return [];
  const cat = getCategory(game.category);
  const soon = game.status === 'coming_soon';
  const rows = [
    ['Publisher', str(game.publisher)],
    ['Status', soon ? 'Coming soon' : 'Live'],
    ['Version', str(game.version)],
    ['Released', formatReleased(game.released)],
    ['Age rating', str(game.ageRating)],
    ['Languages', strList(game.languages).join(', ')],
    ['Platforms', strList(game.platforms).join(', ')],
    ['Players', playersLabel(game.players)],
    ['Duration', str(game.duration)],
    ['Category', cat ? cat.label : ''],
  ];
  const out = rows.filter(([, v]) => v).map(([label, value]) => ({ label, value }));
  const tags = strList(game.tags);
  if (tags.length) out.push({ label: 'Tags', value: tags.join(', '), list: tags });
  return out;
}

/**
 * The in-page anchor nav: only sections that will actually render. `live` = a playable game.
 * ids are the section element ids on the page.
 */
export function sectionList(game, { live = true } = {}) {
  if (!game) return [];
  const has = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
  const out = [];
  if (game.description || has(game.highlights) || has(game.features)) out.push({ id: 'gd-about', label: live ? 'About' : 'What to expect' });
  if (live && hasMaps(game)) out.push({ id: 'gd-maps', label: 'Maps' });
  if (live && howToPlaySteps(game).length) out.push({ id: 'gd-how', label: 'How to play' });
  if (galleryItems(game).length) out.push({ id: 'gd-gallery', label: 'Gallery' });
  if (live) {
    out.push({ id: 'gd-live', label: 'Live now' });
    out.push({ id: 'gd-board', label: 'Leaderboard' });
  }
  if (detailRows(game).length) out.push({ id: 'gd-details', label: 'Details' });
  return out;
}

/** One-line description for meta tags: the tagline plus the first sentence(s) of the description, <= 160 chars. */
export function metaDescription(game) {
  if (!game) return '';
  const tag = str(game.tagline);
  const desc = str(game.description).replace(/\s+/g, ' ');
  const base = [tag && /[.!?]$/.test(tag) ? tag : tag && `${tag}.`, desc].filter(Boolean).join(' ');
  if (base.length <= 160) return base;
  const cut = base.slice(0, 157);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, at > 80 ? at : 157).replace(/[\s,.;:]+$/, '')}…`;
}

/** schema.org VideoGame block for search engines (no ratings, reviews or counts: only what the manifest says). */
export function gameJsonLd(game, url) {
  if (!game) return null;
  const cat = getCategory(game.category);
  const ld = { '@context': 'https://schema.org', '@type': 'VideoGame', name: game.name };
  if (game.description) ld.description = str(game.description);
  if (url) ld.url = url;
  if (cat) ld.genre = cat.label;
  if (game.publisher) ld.publisher = { '@type': 'Organization', name: str(game.publisher) };
  const min = Number(game.players?.min);
  const max = Number(game.players?.max);
  if (Number.isFinite(min) && Number.isFinite(max)) ld.numberOfPlayers = { '@type': 'QuantitativeValue', minValue: min, maxValue: max };
  const platforms = strList(game.platforms);
  if (platforms.length) ld.gamePlatform = platforms;
  const langs = strList(game.languages);
  if (langs.length) ld.inLanguage = langs;
  return ld;
}

/** What the share button hands to `navigator.share` / the clipboard. */
export function shareData(game, url) {
  return { title: game?.name || 'Jalebi Games', text: [game?.name, str(game?.tagline)].filter(Boolean).join(': '), url };
}

/** Search words for an unknown id ("hyderbad-tycoon" -> "hyderbad tycoon"). */
export function idToQuery(id) {
  return String(id ?? '')
    .replace(/[-_+.]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}
