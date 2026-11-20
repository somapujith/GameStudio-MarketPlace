import { BRAND } from '@/platform/brand.js';

// Room records keep their stable identity while public links use the new game name.
export const normalizeGameId = (id) => id === BRAND.defaultGameSlug ? BRAND.defaultGameId : id;
export const gameSlug = (id) => id === BRAND.defaultGameId ? BRAND.defaultGameSlug : id;
