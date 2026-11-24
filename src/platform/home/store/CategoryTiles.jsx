// Category tiles for the home page's "Browse by Category" row (HomeRows.jsx draws them as cine tiles).
import { allGames, categoryList } from '../catalog.js';
import { categoryTiles as buildTiles } from './categoryModel.js';

/** Tiles for the live catalogue: `{ ...category, live, soon, lead }` per category that has a game. */
export const categoryTiles = (games = allGames(), cats = categoryList()) => buildTiles(games, cats);
