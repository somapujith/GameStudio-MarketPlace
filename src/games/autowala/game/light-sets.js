// The light sets Autowala draws with. Every different set is a different set of shader programs (see warm.js), so the game knows them up front.
//   - the street-lamp pool (world/props.js) is off by day and on at night, `POOL_LIGHTS[tier]` real point lights (the number of VISIBLE lights is
//     what three.js puts in a program's key, so the lights are toggled with `visible`, not left on at intensity 0: a constant count would make every
//     lit pixel of the day pay ~2.8 ms for three lights that give nothing; the price is a second set of programs, built behind the loading bar)
//   - the sun casts shadows except on the low tier
//   - the workshop's showroom has NO set of its own: it borrows two pool lights and the auto's headlight (gameplay/workshop/light-bank.js) and
//     while they are lent the day shows as many lights as the night, so a lit workshop is one of the two sets above

/** Real lamp lights in the street-lamp pool per quality tier. */
// (every point light is ~4 GL uniform calls on each program switch and ~70 ALU ops per lit pixel: 2 / 3 / 5, was 2 / 5 / 8)
export const POOL_LIGHTS = { low: 2, medium: 3, high: 5 };

/**
 * How many pool lights are visible: `active` at night, none by day, except that while any are lent (the workshop) the day shows as many as the
 * night does, so the light SET stays one of the two the warm-up built. At least the lent ones.
 */
export const visibleLights = (night, active, lent = 0) => (night || lent > 0 ? Math.max(active, lent) : 0);

/**
 * The light set a tier draws with, as totals in the terms warm.js compiles (the camera pass's programs and, where the sun casts shadows, the shadow
 * pass's). `baseSpots` is the number of spot lights the scene always has (the auto's headlight).
 */
export const lightSet = (q, { night = false, baseSpots = 1 } = {}) => ({
  points: night ? POOL_LIGHTS[q] : 0,
  spots: baseSpots,
  shadow: q !== 'low',
});
