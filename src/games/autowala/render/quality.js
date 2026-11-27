// Pure tier maths for Autowala: nothing here touches WebGL, the DOM or the clock, so every rule has a unit test (quality.test.js).
//
// The idea: the pipeline (canvas, scene target, bloom pyramid) is allocated ONCE for the highest tier the session may reach, at that
// tier's pixel ratio (`allocRatio`). A lower tier is the same allocation drawn into a smaller sub-rectangle (`tierScale`), and the
// governor's render scale multiplies on top of that. So neither a tier step nor a scale step re-allocates a thing: only a window resize does.
import { QUALITY } from '../game/config.js';

export const TIERS = ['low', 'medium', 'high'];

/** The gfx layer knows lite / low / medium / high; Autowala has no `lite`. A cap outside this game's ladder maps to the nearest tier at or below it. */
const GENERIC = ['lite', 'low', 'medium', 'high'];
export function mapTierCap(cap, tiers = TIERS) {
  if (tiers.includes(cap)) return cap;
  const at = GENERIC.indexOf(cap);
  for (let i = at; i >= 0; i--) if (tiers.includes(GENERIC[i])) return GENERIC[i];
  return tiers[0];
}

/** A gpu classification (gfx/gpu.js) whose `tierCap` is a tier of THIS game, so chooseInitialTier never starts a software renderer on `high`. */
export const gpuForTiers = (gpu, tiers = TIERS) => ({ ...gpu, tierCap: mapTierCap(gpu?.tierCap, tiers) });

/**
 * The pixel ratio a tier draws at: its own ratio, never above the device's, and never so high that the frame would shade more than the
 * tier's pixel budget (megapixels) at render scale 1. `view` = { w, h (css px), dpr }.
 */
export function pixelRatioFor(cfg, { w, h, dpr = 1 }) {
  const want = Math.min(cfg.pixelRatio, dpr || 1);
  const area = Math.max(1, w * h);
  const cap = cfg.pixelBudget > 0 ? Math.sqrt((cfg.pixelBudget * 1e6) / area) : Infinity;
  return Math.max(0.5, Math.min(want, cap));
}

/** The ratio the canvas and the scene target are allocated at: the one of the highest tier this session may reach. */
export const allocRatio = (maxTier, view, table = QUALITY) => pixelRatioFor(table[maxTier], view);

/** What fraction of the allocation `tier` draws (1 = the whole of it): its own pixel ratio over the allocated one. */
export function tierScale(tier, maxTier, view, table = QUALITY) {
  const alloc = allocRatio(maxTier, view, table);
  return Math.min(1, pixelRatioFor(table[tier], view) / alloc);
}

/** The sub-rectangle fraction the pipeline is told: the tier's share times the governor's scale (both 0..1), never below `floor`. */
export const effectiveScale = (tierShare, govScale, floor = 0.3) => Math.min(1, Math.max(floor, tierShare * govScale));

/** Megapixels the scene pass shades at a tier and governor scale: what the pixel budget bounds. */
export function shadedMegapixels(tier, maxTier, govScale, view, table = QUALITY) {
  const a = allocRatio(maxTier, view, table);
  const s = effectiveScale(tierScale(tier, maxTier, view, table), govScale);
  return (view.w * a * s) * (view.h * a * s) / 1e6;
}

/**
 * The highest tier a session may reach: a player's choice pins it; otherwise the class cap of the GPU, raised to a remembered tier that is
 * higher (a result this very machine proved).
 */
export function sessionMaxTier({ pref, cap, remembered = null, tiers = TIERS }) {
  if (tiers.includes(pref)) return pref;
  const c = mapTierCap(cap, tiers);
  return remembered && tiers.indexOf(remembered) > tiers.indexOf(c) ? remembered : c;
}

/** The settings choice as the gfx layer wants it: a tier, or 'auto'. */
export const prefOf = (saved) => (TIERS.includes(saved) ? saved : 'auto');

/** One tier down / up (clamped to the ladder). */
export const tierBelow = (t, tiers = TIERS) => tiers[Math.max(0, tiers.indexOf(t) - 1)];
export const tierAbove = (t, tiers = TIERS) => tiers[Math.min(tiers.length - 1, tiers.indexOf(t) + 1)];

/**
 * The thinnest exp2 fog density that hides a far plane: the fog fraction at the far plane is 1 - exp(-(density * far)^2), so a density of
 * `k / far` leaves 1 - exp(-k^2) (k = 1.35: 84 %) and a tower cut by the plane is nearly the colour of the haze. Never thinner than the palette's own.
 */
export const fogFloorFor = (far, k = 1.35) => (far > 0 ? k / far : 0);
