// The "high canopy" roof option lifts the roof and stretches everything that joins it (posts, rear panel, windscreen). The static parts
// of the auto are baked into a handful of merged meshes (sim/autoModel.js), so instead of moving nodes the canopy is a SECOND set of merged
// geometries in which every part carries its lifted position; customize.js swaps the mesh geometries when the option changes.
// Pure numbers and matrices, shared by autoModel.js (bakes them) and customize.js (moves the few decal nodes that stay separate).
import { Matrix4 } from 'three';

export const CANOPY_LIFT = 0.3;

/** The factors the canopy uses for a given lift: the rear panel, the windscreen posts and the glass stretch to meet the lifted roof. */
export function canopyScales(lift = CANOPY_LIFT) {
  return { upper: (0.95 + lift) / 0.95, posts: (0.78 + lift) / 0.78, glass: (0.58 + lift) / 0.58 };
}

/**
 * Matrices that carry a part from its normal place to its canopy place, by the frame (group) it belongs to:
 * roof: lifted; upper: the rear panel stretched about y = 1.05; window: half the lift; posts: stretched about their middle and moved up
 * half the lift (their y is the world y, they sit about y = 1.64); header: lifted.
 */
export function canopyFrames(lift = CANOPY_LIFT) {
  const s = canopyScales(lift);
  const T = (y) => new Matrix4().makeTranslation(0, y, 0);
  const S = (k) => new Matrix4().makeScale(1, k, 1);
  return {
    roof: T(lift),
    upper: T(1.05 * (1 - s.upper)).multiply(S(s.upper)),
    window: T(lift / 2),
    posts: T(1.64 + lift / 2).multiply(S(s.posts)).multiply(T(-1.64)),
    header: T(lift),
  };
}
