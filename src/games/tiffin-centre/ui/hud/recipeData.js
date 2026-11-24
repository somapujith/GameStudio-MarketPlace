// Recipe cards for the coach mark and the action sheet's '?' peek. The real text lives in shared/tiffin-centre/recipes.js
// (`RECIPES[dish] = { steps: [en...], te: [...], hi: [...], tip, tipTe, tipHi }`: parallel arrays; the older `steps: [{ en, te, hi }]`
// shape is read too). When that file is absent a short card is built from the catalogue (station, cook and burn times), so the peek
// always has something true to say.
import { DISHES, STATION_KINDS } from '@shared/tiffin-centre/catalog.js';

const RECIPE_MODULES = import.meta.glob('../../../../../shared/tiffin-centre/recipes.js', { eager: true });
const RECIPE_MOD = Object.values(RECIPE_MODULES)[0] || null;
const RECIPES = RECIPE_MOD?.RECIPES && typeof RECIPE_MOD.RECIPES === 'object' ? RECIPE_MOD.RECIPES : null;

const VERB = { tawa: 'Pour it on the tawa', steamer: 'Fill an idly tray', kadai: 'Drop it in the hot oil', chai: 'Pour it at the chai counter' };

/** The catalogue-only card (also what tests see when recipes.js is missing). */
export function fallbackRecipe(dishId) {
  const d = DISHES[dishId];
  if (!d) return null;
  const kind = STATION_KINDS[d.station];
  return {
    dish: dishId,
    steps: [
      { en: `Tap an empty spot at the ${kind?.name?.toLowerCase() || 'station'}, then choose ${d.name}.`, te: '', hi: '' },
      { en: `${VERB[d.station] || 'Start it'}. It takes ${d.cook} seconds: watch the ring fill.`, te: '', hi: '' },
      { en: `At the ping, take it right away. Leave it ${d.burn} seconds and it burns.`, te: '', hi: '' },
      { en: 'Carry it to the customer whose token asks for it.', te: '', hi: '' },
    ],
    tip: 'Fresh from the pan is a perfect dish, and a perfect dish earns a bigger tip.',
    tipTe: '',
    tipHi: '',
    generic: true,
  };
}

/** steps as [{ en, te, hi }] from either shape of a recipe entry. */
export function normalizeSteps(r) {
  const steps = Array.isArray(r?.steps) ? r.steps : [];
  return steps.map((s, i) =>
    typeof s === 'string'
      ? { en: s, te: Array.isArray(r.te) ? r.te[i] || '' : '', hi: Array.isArray(r.hi) ? r.hi[i] || '' : '' }
      : { en: s?.en || '', te: s?.te || '', hi: s?.hi || '' },
  );
}

/** { dish, name, te (the dish's Telugu name), steps: [{ en, te, hi }], tip, tipTe, tipHi, price, generic? } or null for an unknown dish. */
export function getRecipe(dishId) {
  const d = DISHES[dishId];
  if (!d) return null;
  const r = RECIPES?.[dishId];
  const steps = r ? normalizeSteps(r) : [];
  const base = steps.length ? { dish: dishId, steps, tip: r.tip || '', tipTe: r.tipTe || '', tipHi: r.tipHi || '' } : fallbackRecipe(dishId);
  return { ...base, dish: dishId, name: d.name, te: d.te, price: d.price };
}

export const hasRealRecipes = () => !!RECIPES;
