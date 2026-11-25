// Character quality tiers (people: faces, bodies, hands, hair). Node-safe, no three import.
// `setCharacterQuality('lite'|'low'|'medium'|'high')` is global and read when a character is BUILT (existing ones keep their tier).
// Every factory also accepts an explicit `{ quality }` option which wins over the global.

export const TIERS = {
  high: {
    id: 'high',
    headCols: 44, // columns around the head loft (even)
    headDetail: 0.75, // 1 = all rows; 0.75 = skip a few non-landmark rows
    morphs: 'all',
    normalMaps: true, // procedural pore/wrinkle bump in the skin shader, cloth weave normal maps
    handSides: 5, // cross-section sides of a finger
    fingerSegs: 3,
    limbSides: 8,
    limbRings: 8,
    eyeSeg: [12, 9],
    hairCards: 1,
    lashes: true,
    teeth: true,
    ears: true,
    clothFolds: 1,
  },
  medium: {
    id: 'medium',
    headCols: 34,
    headDetail: 0.55,
    morphs: 'core',
    normalMaps: true,
    handSides: 4,
    fingerSegs: 3,
    limbSides: 7,
    limbRings: 6,
    eyeSeg: [11, 8],
    hairCards: 0.7,
    lashes: true,
    teeth: true,
    ears: true,
    clothFolds: 0.7,
  },
  // lite: the minimum-requirements tier (software renderers, old phones): coarse heads and limbs, no extras, built to be merged into few draw calls
  lite: {
    id: 'lite',
    headCols: 22,
    headDetail: 0.55,
    morphs: 'min',
    normalMaps: false,
    handSides: 3,
    fingerSegs: 1,
    limbSides: 5,
    limbRings: 4,
    eyeSeg: [8, 6],
    hairCards: 0.25,
    lashes: false,
    teeth: false,
    ears: false,
    clothFolds: 0.15,
  },
  low: {
    id: 'low',
    headCols: 26,
    headDetail: 0.55,
    morphs: 'min',
    normalMaps: false,
    handSides: 4,
    fingerSegs: 2,
    limbSides: 6,
    limbRings: 5,
    eyeSeg: [9, 7],
    hairCards: 0.4,
    lashes: false,
    teeth: false,
    ears: false,
    clothFolds: 0.4,
  },
};

let current = 'high';
export function setCharacterQuality(q) {
  if (TIERS[q]) current = q;
  return current;
}
export const getCharacterQuality = () => current;

// Draw-call merging of people (merge.js): off by default so a bare buildCustomer() is exactly what it always was; the scene turns it on per tier.
const draw = { merge: false, limitShadows: false, baked: false };
/** setCharacterDrawMode({ merge, limitShadows }): merge static sub-meshes of newly built people; keep tiny parts (eyes, lids, fingers) out of the shadow pass. */
export function setCharacterDrawMode(o = {}) {
  if (typeof o.merge === 'boolean') draw.merge = o.merge;
  if (typeof o.limitShadows === 'boolean') draw.limitShadows = o.limitShadows;
  if (typeof o.baked === 'boolean') draw.baked = o.baked;
  return { ...draw };
}
export const getCharacterDrawMode = () => ({ ...draw });
/** Resolve an option (string or undefined) to a tier object. */
export const tierOf = (q) => TIERS[q] || TIERS[current];
