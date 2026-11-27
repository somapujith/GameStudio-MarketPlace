// The light sets Autowala draws with. Every different set is a different set of shader programs (see warm.js), so the game knows them up front.
//   - the street-lamp pool (world/props.js) is off by day and on at night, `POOL_LIGHTS[tier]` real point lights
//   - the sun casts shadows except on the low tier
//   - the workshop's showroom adds a spot light and two point lights while it is open

/** Real lamp lights in the street-lamp pool per quality tier. */
// (every point light is ~4 GL uniform calls on each program switch and ~70 ALU ops per lit pixel: 2 / 3 / 5, was 2 / 5 / 8)
export const POOL_LIGHTS = { low: 2, medium: 3, high: 5 };

/**
 * The light set a tier draws with, as totals in the terms warm.js compiles. `baseSpots` is the number of spot lights the scene always has
 * (the auto's headlight).
 */
export const lightSet = (q, { night = false, workshop = false, baseSpots = 1 } = {}) => ({
  points: (night ? POOL_LIGHTS[q] : 0) + (workshop ? 2 : 0),
  spots: baseSpots + (workshop ? 1 : 0),
  shadow: q !== 'low',
});
