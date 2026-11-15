// Andhra Aatalu business art for owned tiles: the same stall / shop / complex as the location postcards, shrunk to a
// 64x64 token on a small ground plate. One look per collection (its goods on the counter), tinted by the group colour.
import { memo } from 'react';
import { GROUPS } from '@shared/board.js';
import { K, ACCENTS } from './kit.jsx';
import { Shop } from './scenes.jsx';
import { collectionOf, COLLECTION_PROPS } from './collections.js';

const THEME_COLLECTION = { bazaar: 0, food: 1, transit: 3, venue: 4, tech: 7 };

/** Collection index 0..7 for a group id / theme (via the group's first tile), 0 when unknown. */
export function collectionForGroup(group, theme) {
  const g = group && GROUPS[group];
  const first = g && Array.isArray(g.tiles) ? g.tiles[0] : undefined;
  const c = first != null ? collectionOf(first) : -1;
  if (c >= 0) return c;
  return THEME_COLLECTION[theme] ?? 0;
}

function AndhraBuildingBase({ group, theme, level = 0, color, size = 64, slab, className, title }) {
  const lv = Math.max(0, Math.min(2, Number(level) || 0));
  const c = collectionForGroup(group, theme);
  const accent = color || GROUPS[group]?.color || ACCENTS[c];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" data-map="andhra" data-level={lv} style={{ flex: 'none', overflow: 'visible' }}>
      {title ? <title>{title}</title> : null}
      <ellipse cx="32" cy="58.4" rx="29" ry="4.2" fill={slab || accent} opacity=".42" />
      <ellipse cx="32" cy="58" rx="26" ry="3.2" fill={K.ink} opacity=".18" />
      <g transform="translate(32 58) scale(.36) translate(-126 -178)" stroke={K.ink} strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round">
        <Shop prop={COLLECTION_PROPS[c]} color={accent} level={lv} text={false} />
      </g>
    </svg>
  );
}

export const AndhraBuilding = memo(AndhraBuildingBase);
export default AndhraBuilding;
