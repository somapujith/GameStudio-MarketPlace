# aw-gpu: Autowala's GPU side (render pipeline, materials, draw calls, shadows)

Branch `perf/aw-gpu`. Machine: the dev laptop's **integrated AMD Radeon** (Chrome on D3D11 / ANGLE, vsync and frame cap off), 1536x864 @ 1.25 (a 1920x1080
drawing buffer), production build, `scripts/perf/aw-probe.mjs` (new, documented in `scripts/perf/README.md`). The machine was shared with ~10 other agents
the whole time: single runs wobble by +-30 %, so every comparison below is **interleaved base / new** or taken from one page session. The baseline is
`ff7de38` with the frame-time sampler pinned (otherwise a busy machine drops "medium" to "low" within seconds and nothing can be measured).

## Headline

Medium tier (sampler held), the same 8 s bench after 6 s of warm-up, 1920x1080 drawing buffer. Base = `ff7de38`; new = this branch before the merge of main (`d46398e`), interleaved on the GPU:

| | base | new |
|---|---|---|
| fps (mean frame) | 24.3 / 26.8 (41.2 / 37.3 ms), earlier run 26.6 | 25.0 / 38.5 / 39.2 (40.1 / 26.0 / 25.5 ms) |
| p50 frame | 37.2 / 31.7 ms | 24.6 / 24.0 / 24.6 ms |
| p99 frame | 170 / 184 ms (114 earlier) | 285 / 76 / 57 ms |
| frames over 50 ms in 8 s | 47 / 28 (20 earlier) | 29 / 18 / 5 |
| draw calls, camera + shadow (Charminar) | 390 + 142 | 160 + 34 |
| GL calls per frame | ~2000 | ~1600 |
| programs | 162-163 | 88-90 (174 with the night set, merged) |
| GPU ms per frame (timer queries) | 50.5 (scene 30.3, post 7.1) | 16.8 (scene 14.3, post 2.8) |
| boot long tasks in the first seconds | 46-69 tasks, 4.4-6.9 s | 17-38 tasks, 2.2-5.2 s |
| geometries / textures | 169 / 55 | 329 / 68 (merged meshes, atlas, per-tile bakes) |

MERGED_ROWS

What the numbers say, plainly:
- **Draw calls** (camera + shadow pass, medium, Charminar, the densest view): **530 -> ~195** (camera 390 -> 160, shadow 142 -> 34). GL calls per frame ~2000 -> ~1600.
- **GPU time** (timer queries, same view, same session): whole frame **50 ms -> 17 ms**, scene pass 30 -> 14 ms, post chain 7.1 -> 2.8 ms.
- **Programs**: 162 -> 88 for one light set (aw-cpu's warm-up now builds the day and the night set, 174, behind the loading screen); no program is compiled in play.
- **60 fps in the default tier was NOT reached on this machine**: typical frame ~24 ms (p50), 38-39 fps mean in the good runs, p99 55-75 ms. The frame is now limited by per-draw cost in the browser / GPU
  process (about 1600 GL calls a frame at ~10 us each here), not by pixels or triangles; see "What the frame is bound by". The remaining stutter is main-thread work in `Game.js` (aw-cpu's area), not GPU.

## What the frame is bound by (measured, not assumed)

| experiment (one page, medium, Charminar at dusk, `--cmd exp`) | frame |
|---|---|
| as is | 26-29 ms |
| render at half scale (4x fewer pixels) | 24-28 ms (no gain) |
| shadow pass off | 22 ms (-4: 40 draws) |
| shadow map 1024 | 27 ms (no gain) |
| no bloom / no FXAA | 27-29 ms (no gain) |
| MSAA 4x (the old default) | 31-36 ms (+5) |
| lamp lights 0 / 2 (of 5) | 24 / 22 ms (-2 / -4) |
| no traffic and pedestrians | 23-25 ms (-1) |

`gfx.render` takes 20-26 ms of CPU in every variant, a quarter-area canvas is not faster, and the V8 profile is 60 % `uniformMatrix4fv` / `uniform3f` / `drawElements*`:
the cost is **GL calls and state changes**, ~10 us each through Chrome's command buffer and ANGLE here. `--cmd glcalls`: ~2000 per frame at baseline (260 draws, 360 uniform
matrix uploads, 380 `uniform3f`, 260 `bindVertexArray`, 88 `useProgram`...). Two mechanisms multiply it:
1. **A program switch re-uploads the whole light state and camera uniforms (~100 calls)**; three sorts opaque draws by material id, which interleaves programs (71 switches a frame, ~100
   material switches, 163 distinct materials in view). Every point light adds ~4 calls per switch and ~70 ALU ops per lit pixel.
2. **A draw is ~50-90 us** all in. A frame of 540 draws (camera + shadow) cannot be faster than ~25 ms here whatever the GPU does.

## What changed, in the order of the evidence

1. **Programs compiled for the wrong target (162 -> 88).** three derives a program's colour space and tone mapping from the render target bound when it is built. Loading compiled ~80 programs for
   the screen (sRGB + ACES), the first real frame (into the HDR target: linear, no tone mapping) compiled ~80 more *synchronously*, and the lamp pool's light-count variants came on top. The compile now
   binds a target (aw-cpu's `game/warm.js` does the same after the merge and also builds the night light set). Boot long tasks 46 / 4.4 s -> 17 / 2.2 s in my pre-merge runs; frames over 50 ms
   in an 8 s bench 20-47 -> 4-29.
2. **A leaner pipeline** (`render/post.js`, replaces EffectComposer + RenderPass + UnrealBloomPass + OutputPass): scene -> **R11G11B10F** target (32 bit; RGBA16F / RGBA8 fallbacks, probed on a throw-away
   context), **no MSAA**, dual-Kawase bloom on a <= 1/4-resolution pyramid, ONE composite (FXAA-lite on perceptual luma + bloom + the same ACES chunk and exposure as `OutputPass` + sRGB + 1-LSB dither).
   Post chain GPU time 7.1 -> 2.8 ms, MSAA's ~5 ms gone. **`gfx.setScale(s)`** (0.5..1, free: the scene is drawn into a sub-rectangle of a fixed-size target and the composite reads it with a scaled UV),
   **`gfx.cost`** (whole-frame calls / triangles / shadow calls / programs: `renderer.info.autoReset` is off and reset once per frame; `calls` used to read 1), `gfx.autoTier = false`, `gfx.invalidateShadows()`,
   `gfx.target` / `gfx.composer` for `game/warm.js`. Fallbacks (8-bit pipeline, direct rendering when a post shader fails) are exercised by `tier.hdr = 'none'` / `tier.post = false` (pair 10).
3. **Shadows**: the sun's box is snapped to the shadow map's texel grid (`render/shadow-grid.js`, no crawling) and re-rendered every 24 ms on medium / 50 ms on low / every frame on high (time based, a slow
   frame never skips twice). The cached map lags a moving caster by <= 1 frame at 60 fps.
4. **Draw calls 530 -> ~195**: one building material and program for every facade look (`BUILDING_LOOKS`, per-instance `aLook`); the nine neon signs in one atlas; roof details baked per tile; 26 clouds in one
   instanced draw; landmarks merged per material (`render/merge-static.js`, 306 meshes / 239 casters -> a handful, with colour baking into a few vertex-coloured materials); 1024 m tiles on medium / high
   (a draw costs far more than culling saves: the whole city is ~700k triangles); matrices of static groups frozen; the sky dome drawn last. aw-gpu-actors (sub-stream, `docs/perf/aw-gpu-actors.md`):
   customers 7-15 draws -> 1 (one skinned mesh), the player's auto 45 -> 27 draws and 16 -> 3 shadow casters.
5. **Opaque draws sorted by program, then material** (`opaqueByProgram`): program switches 71 -> 58.
6. **Pixel cost**: MeshLambertMaterial wherever PBR is invisible (matte walls, ground, shore, rocks, pavement, trunks, canopies, landmark stone, shop walls, metro concrete; glass towers, the train, the auto,
   roads keep PBR); ground / roads / slabs drawn *after* the buildings (`renderOrder` 100) so the depth test rejects the pixels behind walls; the sky dome last. Six before / after cameras look the same (pairs 2-7).
7. **Lamp lights**: 2 / 3 / 5 per tier instead of 2 / 5 / 8 (`game/light-sets.js` `POOL_LIGHTS`, one line outside my area): lights-2 vs 5 was -4 ms in the matrix. The nearest lamps keep their light, the farther
   ones keep their additive glow pool. The pool still switches on at dusk: `game/warm.js` builds both sets while loading, so dusk compiles nothing.
8. Smaller: metro deck / beam / station share one program, trees / palms / bunting share one (sway is a uniform); the post chain keeps its compiled programs across a resize; the warm-up frame draws the
   whole scene once with culling off (every tile's buffers and every sign texture uploaded while the loading screen is up); a failing shader is logged and only the post chain's own shaders trigger the fallback.

## For the governor (gfx-core) and the follow-up stream
`gfx.setScale(s)` is free (no reallocation, no new program) and survives tier rebuilds; `gfx.cost` is the per-frame counter set; `gfx.autoTier = false` switches the built-in frame-time sampler off. The sampler no longer judges
the first 4 s after a (re)build, which is what dropped every medium / high / auto run to `low` during the warm-up (compile stalls counted as slow frames). Tiers stay monotone (unit-tested). Tuning without
a rebuild: `globalThis.__awTune = { medium: { chunk: 1024, shadowInterval: 0.05, bloomLevels: 3, msaa: 0 } }` before the game starts (`--tune` in the probe).

## Screenshots (`docs/perf/aw-gpu/`, 960x540 each, before | after, SwiftShader at the same camera / hour / weather)
SwiftShader because draw calls and pictures do not depend on the GPU and it needs no GPU lock; the frame times above are all real-GPU. The game state (which customer is waiting, the chase camera's heading)
differs between the two runs, which is why a route ribbon / the auto's heading differ in pairs 1, 2, 6, 7, 8; the scenery, light, shadows, neon glow and rain are what to compare.
1. `pair-1-day-street`: noon, chase camera at the garage. Same street, sky, sun shadows, palm and tree; building shadows fall on the road in both.
2. `pair-2-day-charminar`: morning, Charminar down the lane. Same facades, signs ("FILMY CINEMA"), bunting, Charminar and tree; the ground and road look identical.
3. `pair-3-dusk-hitech`: dusk, Hi-Tech towers. Same sky, lit windows, palms, metro; the star field twinkles differently (time dependent).
4. `pair-4-night-paradise`: night, Paradise. Same neon, lamp pool on the pavement, auto; the tree canopy is a little smoother-shaded (Lambert) and its lit side a little less yellow.
5. `pair-5-night-birla`: night, Birla Mandir across the park: same trees, shadows, lit towers; more stars visible after (time dependent).
6. `pair-6-rain-night`: rain at night, Charminar: same rain, neon halo ("DUM BIRYANI"), wet-road tone.
7. `pair-7-rain-day`: rain by day, station clock tower: same overcast sky and road.
8. `pair-8-dusk-auto`: dusk, the auto up close with the actors' merged parts: same paint, plate, curtain; a thin white edge highlight on the roof's right edge after.
9. `pair-9-setscale-half`: `gfx.setScale(1)` | `gfx.setScale(0.5)`: soft but correctly framed, no offset or border.
10. `pair-10-fallback-8bit-vs-direct`: the two fallback pipelines (8-bit target; direct rendering) at night: both draw the full picture.
Not compared pixel for pixel: FXAA replaces 4x MSAA, so edges and the thin lamp posts are antialiased differently; the bloom is a 4-level pyramid from 1/4 resolution instead of 5 gaussian mips from 1/2 (neon glow looks equal in 6).

## Tests
`npx vitest run src/games/autowala` (101 files, 1278 tests) passes. New: `render/post.test.js` (scale rectangle, bloom pyramid and energy, shadow schedule, tier monotony, program-sorted opaque order),
`render/shadow-grid.test.js`, `render/merge-static.test.js` (merge, bounds preserved, shadow filter, colour baking), `render/materials.test.js` (looks, flavours, tile size). `npx vite build` passes.

## Files changed outside my area
`game/light-sets.js` (POOL_LIGHTS 2 / 3 / 5) and `game/warm.test.js` (the two expectations that follow it); `src/games/autowala/ARCHITECTURE.md` (addendum 5); `scripts/perf/README.md`, `scripts/perf/aw-probe.mjs`;
`docs/AUTOWALA_PERFORMANCE.md` (pointer). aw-gpu-actors touched `gameplay/customers.js` (`createRig` only), `sim/**`, `ARCHITECTURE.md` addendum 4.

## Not done / risks
- **60 fps in the default tier is not met here** (see Headline). What is left is draw count: the player's auto (25 draws, 21 materials, customised by reference from `customize.js`), shops (~20 draws, 63 textured materials),
  metro (~14), signals / rule art (~15), props (~19, eight instanced sets per tile) and the post chain (8). Each is a few ms; merging them needs uber materials with per-vertex attributes (sway, glow), a
  decal atlas for the auto, and a shop texture atlas. `GL_calls / frame` is the number to drive down (`--cmd glcalls`).
- The tour (teleport to 14 landmarks / hours / rain) still shows 100-190 frames over 50 ms per 70 s with **0 new programs and 0-7 new textures**: those are main-thread long tasks after a teleport (vehicles
  and customers spawning, fares), aw-cpu's side, not the GPU or a compile.
- Lamp lights are 3 on medium instead of 5 (a visible but small change on the nearest-lamp lighting at night); glass towers' sun glints on windows are only on the two glassy looks.
- `high` is no cheaper than before per frame except through the shared changes: it keeps a shadow map update every frame, 5 lamp lights and a 5-level bloom. The default pick on an 8-core is still `high`
  (`pickQuality`); no GPU classifier was added (the shared governor's job), so the auto tier on this machine starts on `high` and relies on the sampler / governor.
- Shadows of moving casters lag by up to a frame at 60 fps (a frame or two at 20 fps shadows on low).
- The workshop showroom's lights (`gameplay/workshop/showroom.js`) change the light count while it is open; aw-cpu's warm-up covers that set.
