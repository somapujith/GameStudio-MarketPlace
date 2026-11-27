# aw-draw: Autowala's draw calls, GL calls and hitches

Branch `perf/aw-draw` (from main `3eb86f8`, merged with main `f0f0529` before the work, and again at the end). Machine: the dev laptop's integrated AMD Radeon (Chrome on D3D11 / ANGLE),
1536x864 @ 1.25 for the real-GPU runs; the **counters** (draw calls, GL calls, programs, materials, geometries) do not depend on the GPU, so they were taken on SwiftShader
(`--soft --no-lock`, 960x540 @ 1, medium tier held) with `scripts/perf/aw-draw.mjs` (new, below). Every before / after pair is the same probe on two production builds served side by side:
"before" is main + the names of the top-level scene groups (no rendering change), "after" is this branch. The machine was shared with ~10 other sessions: frame times wobble by +-10-30 %,
so the counters are the result and the frame times are confirmation.

## Headline

Camera + shadow draw calls and GL calls per frame, medium tier, fixed cameras (`aw-draw.mjs --cmd scenes`, 20 frames each, one session per build):

| scene | camera draws | shadow draws | GL calls / frame | materials in view | programs in view | geometries in view |
|---|---|---|---|---|---|---|
| Charminar, day | 173 -> **132** | 31 -> 29 | 1189 -> **870** (-27 %) | 100 -> 73 | 62 -> 54 | 132 -> 97 |
| street (Irani cafe), day | 163 -> **119** | 36 -> 32 | 1173 -> **848** (-28 %) | 96 -> 68 | 60 -> 52 | 137 -> 100 |
| shop street (Paradise), day | 165 -> 141 | 44 -> 35 | 1203 -> 949 (-21 %) | 94 -> 74 | 60 -> 55 | 125 -> 105 |
| Hi-Tech glass towers, day | 239 -> 191 | 25 -> 23 | 1528 -> 1150 (-25 %) | 121 -> 85 | 61 -> 56 | 175 -> 131 |
| metro (under the viaduct) | 109 -> 108 | 32 -> 30 | 654 -> 668 (flat) | 50 -> 49 | 44 -> 42 | 69 -> 72 |
| workshop showroom | 221 -> **166** | 20 -> 20 | 2052 -> **1516** (-26 %) | 173 -> 103 | 75 -> 67 | 293 -> 195 |
| night, Paradise | 165 -> 150 | 32 -> 24 | 1047 -> 958 (-9 %) | 80 -> 73 | 53 -> 49 | 122 -> 111 |
| rain, night, Charminar | 155 -> 136 | 30 -> 26 | 913 -> 744 (-19 %) | 78 -> 68 | 55 -> 49 | 108 -> 95 |

The camera count includes the 8 draws of the post chain (aw-int's). The objects in the scene graph went 624 -> 497 at Charminar. Scene content that is random per run (customers, traffic) moves a count by +-5.

**The brief's targets were not reached**: camera draws <= 100 (132 at Charminar, 119 in the street) and GL calls <= 800 (870 / 848; 744 in the rain at night). What is left, with numbers, and the levers, is in "What is left".

Real GPU (1536x864 @ 1.25, medium held, governor off), see "On the real GPU" below: the frame-time gain is **small and only just visible above the noise**: 0 to +11 % fps in the clean interleaved pairs (59.8 -> 66.7, 58.4 -> 58.0 fps; p99 34.8 -> 32.9 and 37.8 -> 34.7 ms), nothing measurable at the fixed Charminar camera, GPU timer 14-15 ms either way. The GL calls fell by 27 %; the frame did not fall by 27 %. The teleport-tour comparison is inconclusive (one quiet pair 119 -> 44 frames over 50 ms, one pair on a saturated machine 257 vs 392).

## What the frame is made of (measured, new in this report)

`aw-draw.mjs` counts the GL calls made inside every `renderBufferDirect` and classifies the draw by what changed since the previous one (Charminar, before):

| draw class | draws / frame | GL calls per draw |
|---|---|---|
| camera, non-instanced, program switch | 37 | 10.8 |
| camera, non-instanced, material switch | 33 | 7.5 |
| camera, non-instanced, same material | 24 | 6.2 |
| camera, instanced, program switch | 23 | 5.5 |
| camera, instanced, material switch | 8 | 3.9 |
| camera, instanced, same material | 48 | **2.3** |
| shadow, non-instanced / instanced | 14 / 19 | 5.8 / 2.7 |

Why: three uploads `modelViewMatrix` / `normalMatrix` per object but skips the call when the value equals the last upload of that program, so an object whose matrix is the identity (an instanced set, or a static mesh baked into world space) costs bindVertexArray + draw; a program switch re-uploads the light state; a material switch the colour / roughness / maps. **The 94 non-instanced draws were 800 of the 1200 GL calls.** That is the lever used here: bake and merge statics, share materials and programs, unlit where the light is invisible.

GL calls by scene object at Charminar after the work (camera pass, per frame): post chain 8 draws / **156 calls**, shops 12 / 94, props 23 / 77, metro 15 / 63, the player's auto 8 / 63, landmarks 12 / 62, the garage's entry rings 5 / 55 (fixed, see below), buildings 8 / 29, signals 11 / 26, rule art 7 / 18, terrain 3 / 15.

Two findings on the real GPU (CPU profile of 6 s of play, new build, 60 fps in that view): the top self times are all GL calls: `uniform3f` 12 %, `uniformMatrix4fv` 10 %, **`bindFramebuffer` 8.3 %**, `uniform4fv` 4.7 %, `bindTexture` 4.1 %, `viewport` 3.3 %, `depthMask` 2.4 %, `scissor` 1.6 %. And a one-page matrix (`--cmd eval --jsfile matrix.js`, same build): hiding every named world group leaves a frame of 10.8 ms (47 calls); the shadow pass is ~3 ms (shadows off: 17.3 -> 14.5 ms); the whole city's draws are ~6.5 ms of the rest. So a floor of ~10 ms per frame is the post chain, the shadow pass, the auto / people / traffic and the ground; this stream cannot lower that (aw-int's files, see the requests).

## What changed

All in `src/games/autowala` unless named. Tests: `npx vitest run src/games/autowala` 110 files, 1375 tests green; `npx vite build` green. New tests: `render/atlas-pack.test.js`, `render/merge-static.test.js` (+8), `sim/auto-uber.test.js`, `sim/auto-atlas.test.js`, `sim/customize.test.js` (+), `sim/auto-budget.test.js` (budgets tightened).

1. **The player's auto: 27 -> 8 camera draws** (a sub-stream, branch `perf/aw-draw-auto`, merged). `sim/auto-uber.js` + `sim/auto-atlas.js` + `autoModel.js` + `customize.js`. One merged body mesh draws chrome, matte, seat, roof, curtains, panes, the four lamps, plates, banner and rear-window sticker with ONE shared material that reads each part's colour / roughness / metalness / emissive / env strength per vertex slot from the OLD per-part material objects every frame; those objects (`ud.chrome`, `roofM`, `seatM`, `tailLampM`, `brakeM`, `plateRearM`, `bannerM`, ...) are now data, so `customize.js` and `Game.syncAuto` still write them by reference. One decal mesh + a 1024x320 decal atlas (cover art, mud-flap art, badge; `setMap` still swaps textures, the atlas copies the cell on change). Paint (Physical), the two wheel meshes, the glass, the driver and the stock bumper keep their own draw. Default 27 -> 8; fully customised 63 -> 47 (the rest is workshop props: dome lights alone are 10); high canopy still works (second bake). The windscreen is no longer a milky white sheet from the front (the glass was lit like paint: colour x 0.25, same opacity per tint level; the lead's item). Details, numbers and four proof grids: see "The auto" below.
2. **Landmarks, tile-merged** (`render/merge-static.js mergeStaticTiles`, `world/landmarks.js`): after the per-model merge, the meshes of ALL landmarks that share a material are baked into world space and merged per 1024 m tile (grid shifted by 512 m: the whole centre of the city is one tile; 12k triangles in all). Lone Lambert parts bake into the shared vertex-coloured materials, equal glow boxes share a material, every sign board / clock face / hospital cross is a plane of ONE atlas texture and ONE material (`render/atlas-pack.js`: shelf packing, edge-replicating gutter, so mip-mapping never bleeds). All parts receive shadows (a per-part flag split the draws and flipped a uniform per draw). Landmarks 23 -> 12 camera draws, 15 materials -> 10.
3. **Shadow proxies**: `mergeStaticTiles(..., { shadowProxy: true })` makes the visible meshes of a tile non-casting (so the cast flag no longer splits them) and adds ONE caster mesh per tile (positions only, `layers` 1) that only the sun's shadow camera draws (`render/sky.js`: `key.shadow.camera.layers.enable(1)`; three r187 takes the layers of the shadow camera when it has layer bits besides 0). Landmark shadow draws 9 -> 6, shops 4 -> 1-2; the draws of the camera pass lose another 2-3.
4. **Shops** (`world/shop-kit.js`, `world/shops.js`): textured materials are shared by the branches of a brand (their textures already were), and all shop meshes + the stalls are baked into world space and merged per 512 m tile (blended parts, the pools and the glass, stay as they are); the sign boards no longer cast (a caster with a `map` gets its own shadow-pass program, built at first sight: 234 ms at the first Bawarchi / Delhi shop in the tour).
5. **Metro**: deck, pillars, cross-beams and stations share ONE matte material (Lambert ignores roughness; `headFix` is a no-op for the parts that do not stretch), and every instanced set carries an instance colour (white where untinted: whether an object has one is part of the program key), so they are one program and one uniform set instead of four materials and two programs.
5b. **Customers are drawn to 300 m, not 520 m** (`gameplay/fares.js:772`, one number in aw-logic's file; their pickup markers are separate): a customer is ~5 px tall at 300 m and every visible one is a skinned draw of ~15 GL calls (3-7 fewer draws in a busy street).
6. **Markers**: the fare / quest markers' additive double-sided materials are `forceSinglePass` (additive: the two passes add up to the same picture, half the draws) and hidden while empty (an empty instanced mesh still switches programs: two sets were drawn with 0 instances every frame). `gameplay/fare-markers.js` (3 lines, aw-logic's file).
7. **The garage's entry rings** (`gameplay/workshop/showroom.js`, aw-logic's file, rendering only): two lit transparent double-sided MeshStandard rings = 4 draws of ~11 GL calls each (55 calls at Charminar, 130 m away, because of the 26 m light column); they are all emissive, so they are unlit MeshBasic now (the same colour x the same pulse), single pass: 2 draws.
8. **Junction patches** (`world/roads.js`, `render/textures.js`; the lead's item): they were a flat `0x38333f` with a hard edge against the textured asphalt. They use a plain-asphalt texture (the road's speckle, no lane markings) mapped by world position and the road's own program (one program switch less).
9. **Probe** `scripts/perf/aw-draw.mjs` (new, documented in its header): `--cmd scenes [--rows] [--progs] [--shots]` (8 fixed scenes + `x-*` look-only scenes; draws per object, GL calls by draw class and by object, programs in view with their users), `--cmd tour` (the teleport tour with the game's own `perf.report()` slow-frame attribution per leg), `--cmd frames`, `--cmd gpu`, `--cmd eval --jsfile f.js --pin <scene>`, `--tune`. The top-level scene groups got names (`buildings`, `landmarks`, `props`, `terrain`, `roads`, `road-patches`, `slabs`) so a draw can be attributed.

### The auto (sub-stream report, summarised)
Default loadout, SwiftShader, camera / shadow: **27 / 3 -> 8 / 3** (`aw-actors.mjs --cmd suite`: 29 -> 8; FULL 49 -> 31; FULL + canopy 39 -> 21; workshop 27 / 62 -> 8 / 46). Materials 23 -> 6, programs 9 -> 6, geometries 27 -> 8; GL calls inside the auto's camera draws 209 -> 71. FULL is still 46-47: the workshop props (dome lights 10, toy, ladder, antenna, side guards, spiked bumper, garland, stripes, apron) animate their own nodes and materials; merging them generically would break that. Visual comparison (viewed by the sub-agent and re-checked here in `world-3`): paint, chrome, plates, "AUTO RAJA" sticker, cover louvres, lamps, glow wheels, underglow, LED cover, peacock flaps, canopy are identical; the one intended difference is the windscreen. Risks: two new programs (merged body, decal) compiled by the boot warm-up; the custom depth program of the body is built at the first shadowed frame; `ud.hlLamp`, `plates`, `badge`, `banner`, `rearWin.center`, `wheelParts` are data objects (`visible` still shows / hides their slot); the high-canopy variant swaps the merged geometries. One commit subject (`f68724c`) starts with a BOM (a PowerShell `Set-Content`); history was not rewritten.

## On the real GPU

Interleaved `aw-probe.mjs --cmd bench` (start view at the garage, the auto driving; 8 s after 8 s of warm-up; medium held; one lock hold each), base = main `7489c2a` (with aw-int's governor) served on 5864, new = this branch at `960ebf5` on 5863 (the two last tweaks, metro instance colour and customers at 300 m, are not in these runs):

| pair | build | fps | mean / p50 / p99 ms | frames > 50 ms | camera + shadow draws (`gfx.cost`) | programs | geometries / textures |
|---|---|---|---|---|---|---|---|
| 1 | base | 59.8 | 16.7 / 15.8 / 34.8 | 0 | 154 + 35 | 176 | 333 / 74 |
| 1 | new | **66.7** | 15.0 / 13.8 / 32.9 | 1 | 127 + 26 | 169 | 221 / 62 |
| 2 | base | 58.4 | 17.1 / 16.2 / 37.8 | 2 | 151 + 32 | 176 | 330 / 71 |
| 2 | new | 58.0 | 17.2 / 16.3 / 34.7 | 2 | 101 + 25 | 169 | 220 / 61 |
| 3 | base | 43.6 | 22.9 / 18.5 / 133 | 21 | 151 + 33 | 176 | 329 / 71 |
| 3 | new | 35.6 | 28.1 / 15.9 / 200 | 45 | 102 + 25 | 168 | 220 / 61 |

Pair 3 is a run on a saturated machine (both builds have 20-45 frames over 50 ms with no program built: other sessions' work); I do not use it. An earlier set against the older main (`f0f0529`, quieter machine): base 50.9 fps (p99 40.7), new 54.8 and 57.5 fps (p99 37.5 and 33.9); the two hitchy runs of that set (base 37.4, new 31 fps) are noise. And the fixed-camera `--cmd frames` at Charminar (3 x 6 s, two interleaved rounds): base 51.4 / 48.5 fps, new 51.6 / 47.5 fps, `gfx.render` CPU 17.7 / 18.6 vs 17.4 / 18.8 ms; GPU timer (frame / scene / post): 14.2 / 10.1 / 2.6 and 14.8 / 12.2 / 3.0 against 15.2 / 11.7 / 2.8 and 13.2 / 9.9 / 2.7 ms.

**Honest reading.** Over the clean runs the new build is 0-11 % faster and its p99 2-3 ms lower, which is about what the one-page matrix predicts (the world's ~130 draws are ~6.5 ms of a frame; 40 fewer draws is 1.5-2 ms) and within the run-to-run noise of this shared machine (+-1.5 ms). The 27 % fewer GL calls did not become 27 % less frame time: a floor of ~10 ms per frame (post chain, shadow pass, the auto / people / traffic, the ground) is untouched by this stream, and the frame is not purely bound by the calls this stream removed (the removed ones were mostly cheap same-material and identity-matrix draws; the program switches, 54 -> 53 in view, are what stays expensive). I claim fewer draw calls, GL calls, programs, materials, geometries and scene objects, and a small frame-time gain; not 60 fps at medium by this change alone.

## The teleport tour and the dusk freeze

The 14-leg tour (`aw-draw.mjs --cmd tour`: Charminar noon / dusk, Cyber noon / night / rain, Birla, Golconda, airport, Paradise, stadium in rain, station, Mecca, garage, a CNG station in rain, hospital; 6 s each, real GPU, medium held), one run per build and set:

| | main `f0f0529` -> new (quieter machine) | main `7489c2a` -> new (saturated machine) |
|---|---|---|
| frames over 50 ms (84 s) | 119 -> 44 | 257 -> 392 |
| main-thread long tasks / total | 111 / 11.3 s -> 41 / 7.6 s | 237 / 28.0 s -> 358 / 32.0 s |
| worst frame | 744 -> 882 ms | 702 -> 764 ms |
| new programs / textures / geometries in play | 84 / 24 / 25 -> 84 / 27 / 26 | 87 / 8 / 9 -> 80 / 9 / 9 |

**The tour cannot rank the two builds.** In the second pair most legs of BOTH builds show 30-45 frames over 50 ms with no program built (the machine was saturated by other sessions); the first pair was taken in a quieter period. I do not claim a hitch improvement. What the tour does give, in both pairs and both builds, is the attribution below: in every slow frame the game's own profiler puts >= 90 % of the time in the `render` phase (`sim` <= 18 ms, `world` <= 11 ms, `camera` <= 5 ms): there is no main-thread tile build, geometry merge or disposal after boot (the world is built once, staged; teleporting builds nothing), so there is nothing in `world/**` to time-slice. The hitches are programs compiled in play and first-sight uploads:

What is left is not the scene, and not in my files:
- **Dusk freeze (the lead's item 1, props.js:259).** Cause found and attributed: every program compiled in play during the tour is a **`MeshDepthMaterial` (shadow-pass) program**; the camera-pass programs of the night light set are all built by `game/warm.js`. At the first night frame (`hour` 17.9-18.5, the lamp pool's 3 lights become visible) the shadow pass needs the depth programs of the night set: skinned customers, the instanced scenery (terrain, props x2), the merged statics (my shadow proxies) and the auto's custom depth: **6-7 programs, ~750 ms in one frame on the real GPU** (`+prog6` at 757 ms in the tour; 3.3 s in SwiftShader, 3.1 s of it the terrain's instanced depth program). The depth programs depend on the light count because three puts the scene's light counts in every program key. Fix, for aw-int (`warm.js` / `Game.js`): build the depth programs for each light set too: render ONE shadow-casting frame behind the loading screen with the night set (the pool lights visible AND the auto's headlight spot visible, `gfx.invalidateShadows()`), or compile `MeshDepthMaterial` variants (instanced, skinned, plain, the `customDepthMaterial`s) against the night warm scene. (My attempt to prove it from outside the game, one `gfx.render` with the lights toggled in the same task, did not change the count: it does not reproduce the exact set of lights / spots of the night frame, so I did not claim a fix; I only made the cause certain.) The same applies to the workshop's set (+46 programs at the garage leg, 640-890 ms frames) and the rain legs (+31).
- **Birla +1 program (525-852 ms)**: the textured depth program of the Bawarchi / Delhi sign boards; fixed (they do not cast any more): the second pair shows `+prog 1` (525 ms) on main and `+prog 0` on this branch at that leg; the Garage (+16 to +46) and CNG-in-rain (+27 to +31) legs are the workshop and rain sets, aw-int's.
- **First-sight uploads** (cyber night: 659 ms in one frame, +4 textures +4 geometries) are driver-side uploads of the first customers / merged tiles; the warm-up frame draws the scene once, but the shadow pass of the merged proxies (layer 1) is first seen at the first shadowed frame. Not separated further.

## Visual QA (`docs/perf/aw-draw/`, 960x540 grids, before | after, SwiftShader, same camera / hour / weather; I looked at every one)
- `world-1-charminar-street`: day, Charminar from the street, and the cafe street: identical (a customer who happens to wait elsewhere). The pickup beam and diamond are the same size and colour.
- `world-2-shops-hitech`: Paradise by day, Hi-Tech towers: identical facade, sign, takeaway tag, canopy, shadows, trees, viaduct.
- `world-3-metro-workshop`: the underside of the viaduct (deck, beams) and the workshop showroom: identical (turntable, pink / cyan rings, the auto; the windscreen is clearer after).
- `world-4-night-rain`: Paradise at night and Charminar in the rain at night: identical neon, lamp pool, wet-road tone, rain; the customer's pickup diamond is elsewhere.
- `world-5-bawarchi-delhi`: Bawarchi's facade, awning, logo, and a park corner with the OYO / Delhi stalls row: identical.
- `world-6-oyo-delhi-night`: OYO at dusk, a shop row at night: identical.
- `world-7-landmark-signs`: the Nimrah Cafe sign (glowing border and Telugu line), the station clock lit at night and its sign: identical; (CNG "GAS" sign with the green glow boxes and "MAMA'S GARAGE" with its Telugu line were compared separately: identical). These are the sign atlas.
- `auto-*` (4 grids): the sub-stream's before / after of the auto: default, full + canopy, night glow, workshop glass.
- 844x390 (a phone landscape): Charminar, Paradise and the night shop at the same cameras: same picture, nothing cut or shifted.
Not compared pixel for pixel: junction patches (I did not find a camera that shows one clearly; the road and patch share the asphalt colour now); the shadow of the sign boards (gone), of small landmark parts (the proxies keep every caster that was one; only the cast flag per part of the former visible meshes is gone).

## What is left (and why)

Camera draws at Charminar (132): props 23 (instanced, 8 sets x tiles), landmarks 12, metro 15 (instanced deck / pillars / beams per tile, 3 train meshes, 4 station meshes), shops 12, signals 11, the auto 8, buildings 8, **post 8**, rule art 7, the rest 28 (traffic types 6, clouds / glow instanced 8, terrain 3, roads 2, customers 1 each, markers, sky). To get to 100 and below 800 GL calls:
1. **Shop textures into an atlas / one material per shop**: shops are 12-48 draws (the textured planes: front, sides, back, sign, canopy, takeaway per shop; 55 textured materials in the city). Done here: sharing between branches + tile merge. Not done: a per-brand texture atlas. It would need ~2k x 2k atlases per brand (about the memory of today's textures x 1.8) and a mip-safe gutter, and touches four builders' drawing code; the better cut is to pack only the sign + canopy + takeaway tags of a shop into one texture (3 draws -> 1, ~-2 per shop) and share the back facade with the front.
2. **The post chain: 8 draws = 156 GL calls (18 % of the frame's calls) and `bindFramebuffer` 8 % of the main thread** (aw-int's `render/post.js`): fewer render-target switches / viewport / scissor / depthMask redundancy.
3. **Program switches** (54 per frame) are what a lit draw costs: 5 GL calls each plus ~40 uniform3f for the lights. Merging programs further means unifying materials (Standard -> Lambert where the specular is invisible, one uber material for the statics with per-vertex roughness / emissive); not started.
4. **Shadow pass**: ~3 ms (the map is redrawn every 24 ms = every frame at 50 fps): `QUALITY.medium.shadowInterval` 0.024 -> 0.05 halves it (aw-int's `game/config.js`).
5. **Customers**: one skinned draw each (~15 GL calls with the bone texture); the distance is 300 m now (was 520); instancing skinned people is not possible with three's SkinnedMesh.
6. Instanced sets with different geometries (rule art signs, signal heads / cameras / cops, props trunk / canopy / lamp / flags) cost 2.3 GL calls each: merging them saves little; not done.

## Requests for aw-int (not edited by me)
- `game/warm.js`: depth programs for every light set (see "dusk freeze"): ~750 ms at dusk and the workshop / rain legs.
- `render/post.js`: the render-target switches and per-pass viewport / scissor / depthMask (8 % + 3 % + 2 % + 1.6 % of the main thread in the profile).
- `game/config.js`: `shadowInterval` (see 4 above) and the shadow map size are the next cheap frame-time lever.
- `ARCHITECTURE.md` addendum 5 says "the lamp point lights stay visible with intensity 0 by day"; `world/props.js` now toggles `visible` (aw-cpu's warm-up builds both sets). One of the two is out of date.

## Files changed outside my area
`gameplay/fare-markers.js` (3 lines: single-pass additive, hidden when empty), `gameplay/fares.js` (one number: customers drawn to 300 m), `gameplay/workshop/showroom.js` (the entry rings: unlit, single pass), `render/sky.js` (one line: shadow camera layer 1), `render/textures.js` (plain asphalt), `render/merge-static.js` + new `render/atlas-pack.js` (render/ shared helpers), `scripts/perf/aw-draw.mjs` (new), `src/games/autowala/ARCHITECTURE.md` (addendum 6), `docs/perf/aw-draw/*.jpg`. Not touched: `render/{renderer,post,quality}.js`, `game/{config,warm,light-sets,perf}.js`, `game/Game.js`, `ui/**`, `gameplay/**` rules.

## Risks
- Landmark / shop casters are drawn by proxy meshes on layer 1: anything that renders the scene with a camera that has layer 1 enabled (none) would draw them black; `renderer.compile` compiles the proxy material (a plain MeshBasic, an existing program).
- Merged tiles are culled by their whole bounding sphere (1024 m for landmarks, 512 m for shops): about 12k + 76k triangles drawn when any part of the tile is in view.
- Shops: a shared texMat means one night-glow value per (texture, strength); the back facade keeps its own material (k 0.5).
- The auto's uber material reads its parts' material objects in `onBeforeRender` every frame: code that replaces a material object (instead of writing its fields) will not be seen (nothing in the repo does).
