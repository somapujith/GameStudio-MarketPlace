# aw-gpu-actors: draw calls of Autowala's customers and the player's auto

Branch `perf/aw-gpu-actors` (from the aw-gpu branch at a8734c7). Scope: the non-instanced actors, so the waiting customers, the player's auto, and the small
groups the brief called "event / quest props". No look, animation or customisation change was intended; the few deliberate small differences are listed below.

## Result

Measured on the real GPU (integrated AMD Radeon, ANGLE / D3D11), 1536x864 at 1.25 (canvas 1920x1080), **medium tier held**, Charminar at hour 14 for the
customers and the garage for the auto, per-scene-object draw calls over 90 frames (`node scripts/perf/aw-actors.mjs --cmd suite`, `renderBufferDirect` wrapped
in the camera pass and in `shadowMap.render`). "Before" is a production build of a8734c7, "after" is this branch, both served side by side and run back to back
under one bench-lock hold. Triangle counts are unchanged (456 per person, 3692 for the auto with the default look, 6204 fully customised).

| | before | after |
|---|---|---|
| a customer in view (1 person): camera pass | 7 (8 with a suitcase) | **1** |
| a customer in view (2 people): camera pass | 14-15 | **1** |
| a customer inside the shadow frustum: shadow pass | 7 / 8 / 14 | **1** |
| materials per customer | 4-9, new ones each time | **1**, shared by every customer |
| player's auto, default loadout: camera pass / shadow pass | 45 / 16 | **27 / 3** |
| player's auto, fully customised (auto-budget FULL): camera / shadow | 65 / 23 | **47 / 3** |
| player's auto, FULL with the high canopy: camera / shadow | 55 / 23 | **37 / 3** |
| whole frame at Charminar, camera + shadow (the customers in view differ per run) | 411 + 123 (an earlier run: 420 + 137) | 361 + 98 (an earlier run: 364 + 98) |
| unit count, visible meshes (`auto-budget.test.js`), default / FULL | 44 / 81 calls, 16 / 25 casters | 27 / 63 calls, 3 / 3 casters |
| renderer objects at Charminar (several runs) | geometries 453-506, textures 88-90, programs 169 | geometries 406-430, textures 95-101, programs 170-171 |

The extra textures are one tiny (8x8 float) bone texture per live customer; the extra two programs are the skinned camera program and its depth twin. Eight
"leave the map, come back" cycles (every customer body dropped and rebuilt, `--cmd leak`) settle geometries at ~420, textures at 95-99 and programs at 170 from the
second cycle on, and the JS heap oscillates 44-72 MB without a trend, so nothing leaks (the baseline settles too: 438 / 90 / 169).

Frame time, honestly: on this machine (shared by ~10 agents) the same build swings between 22 and 44 fps from run to run, so a gain of 2-3 ms is inside the noise.
Five interleaved base / new pairs (`--cmd frames`, 8-10 s each, same Charminar view): base 31.1 fps, `gfx.render` 28.5 ms CPU; new 33.7 fps, 25.8 ms (-9 %). One
earlier, non-interleaved suite run went the other way (31.1 fps / 28.4 ms against 26.1 fps / 35.4 ms). Read the draw-call table, not the frame times.
The first 20 s of play are hitch-ridden in both builds (41-109 frames over 50 ms in three baseline runs, 69-83 in three runs of this branch: the game's own start-up on a
loaded machine), and not one of those frames coincided with a newly compiled shader program in either build: the customers' skinned program is compiled by the
boot-time `compileAsync` through a hidden warm-up customer (`installPersonWarmup`).

## What changed

**Customers** (`sim/person-mesh.js`, `gameplay/customers.js createRig`). A customer used to be 7-8 limb meshes per person, each with its own material
(torso, head, hair, two arms, two legs, a suitcase). Now one or two people plus the suitcase are ONE `SkinnedMesh`: rigid parts of one geometry bound to a small
skeleton, with the look baked into vertex colours and a single material shared by every customer (never disposed; its `dispose` is a no-op). The limb handles the
pose code drives, `rig.userData.persons[i].userData.{lArm,rArm,lLeg,rLeg}` and `persons[i].position.y`, are the skeleton's `Bone`s at the old rest positions, so
`poseWave` / `poseWalk` are untouched and still work, and so does anything else that poses them. Disposing the rig's geometry frees the skeleton's bone texture.
Roughness is 0.8 for every person (it was 0.7 shirt, 0.8 skin and trousers, 0.9 hair, 0.6 suitcase).

**The player's auto** (`sim/autoModel.js`, `sim/auto-canopy.js`, `sim/customize.js`). Every static part is merged per material across the old sub-groups:
paint, chrome (windscreen posts, header, fork, banner posts, window surround), a vertex-coloured "matte" mesh (dark chassis, meter, flaps, roof pinstripe, banner
board, dash beads), seat, roof + rear panel (roof colour), curtains, the lamps. Both number plates are one mesh and one material, left and right stripes / swish are
one mesh each, the two rear wheels are one spinning pair, the driver and the riders are one vertex-coloured mesh each, the windscreen glass is drawn in one pass.
The "high canopy" option used to move the posts, header and rear panel as nodes; that is now a second bake of the merged geometries (`canopyFrames`) that
`ud.canopyGeometry(on)` swaps in. Only the tub, the roof and the driver cast shadows, and `mountProp` makes every workshop bolt-on a non-caster.

## Verification

- `npx vitest run src/games/autowala`: 83 files, 1120 tests, all passing. New:
  `sim/person-mesh.test.js` (skinning maths, bone handles, shared material, disposal, vertex-colour recolouring, warm-up), stripe winding / prop shadows / glass
  single pass in `customize.test.js`, canopy bake and the new budgets in `auto-budget.test.js` (default <= 27 calls and <= 3 casters, FULL <= 64 calls and <= 3 casters).
  Existing tests were adapted where the structure they pinned changed (handles `posts` / `header` are gone, `wheels` has 2 entries, the canopy test checks the baked geometry):
  the same behaviours are still asserted, none was deleted.
- `npx vite build` passes. The probe's `errors` is empty in every run (the only message is SwiftShader's missing `KHR_parallel_shader_compile` in the soft runs).
- Screenshots (`docs/perf/aw-gpu-actors/`, SwiftShader 960x540, HUD hidden, before = a8734c7 build, after = this branch, same camera). I looked at each pair:
  - `*-cust-solo`: one customer with a fixed look (blue shirt) on the same pavement spot, waving: same colours, proportions, raised-arm angle, shadow.
  - `*-cust-duo-bag`: two people with a suitcase: same. The suitcase highlight is a hair softer (roughness 0.6 to 0.8), no other difference I can see.
  - `*-cust-walker`: legs and arms swung by hand (the `poseWalk` values): the limbs pivot about the same centres, identical silhouette.
  - `*-auto-default-rear`, `*-auto-full-rear`, `*-auto-canopy`: the default look, the fully customised auto (LED cover, spiked bumper, ladder, antenna, side guards,
    peacock mud-flaps, dome lights, underglow, leopard seats, garland) and the high canopy: the same auto. The traffic and the camera framing differ slightly because
    the game runs in real time.
  - Not copied here but viewed: gloss / matte / pearl finishes (same), the workshop showroom at two views (same turntable, lights and auto; the orbit camera is not at
    the same azimuth at the instant of capture), the customer with both arms waving (identical).
  Draw calls and triangles are renderer independent: the soft-rendered runs gave the same counts as the GPU runs, so most pictures were taken on SwiftShader to avoid the GPU queue.

## Deliberate small differences (all tiny, none changes a silhouette or a colour you can name)

- Customers: roughness 0.8 for everyone; the suitcase is vertex-coloured like the people.
- Auto: the pale-steel window surround is now chrome (roughness 0.3 to 0.15); the roof pinstripe / banner board / dash beads use the matte material (roughness 0.65,
  metalness 0.25) with a vertex-colour gain that keeps their diffuse colour; the front fork rolls with the body; the shadows of tyres, chrome, posts, seat and curtains are
  gone (the tub, roof and driver shadows cover them at the shadow-map resolution); workshop bolt-ons (antenna flag, ladder, bumpers) no longer cast shadows.

## What I could not do, and why

- **Player's auto <= 14 camera calls: not reached** (27 default, 47-63 customised). What is left is irreducible without an atlas or an uber-shader: 12 body materials that
  `customize.js` recolours, retextures or animates (paint, chrome, matte, seat, roof, curtains, glass, side panes, tail lamp, tail reflector, brake lamp, head lamp), 6 textured
  decals (engine cover, plates, badge, banner, rear window, mud-flaps) and the emblem, 6 wheel meshes (tyre, rim and spokes for the front wheel and for the rear pair; rim
  and spokes stay separate because glowing wheels light them differently), the stock bumper and the driver. Customised parts add more (each prop is merged per material, but props are separate nodes so they can be swapped). The shadow target (<= 4) is met: 3.
- **Customers beyond the draw distance**: not done. At 1 call each they are cheap, and the cut-off lives in `gameplay/fares.js` (`d < 520`); a customer at 300 m is ~5 px tall.
- **Brief vs reality**: scene child "46" (15 children, 306 meshes, 239 casters, 65 camera + 57 shadow calls per frame) is NOT the customers: it is `world/landmarks.js` (15
  landmarks). That is the largest actor-like draw-call cost left and belongs to `world/**` (aw-gpu): merge each landmark per material and let only the big shells cast. The
  customers are the ten groups "76".."85" (7-15 meshes each). Other leftovers seen in the attribution, also not mine: `rules-signals` 14 calls and `rules-art` 6 (one
  `InstancedMesh` per map tile and type, `world/signals.js`, `gameplay/rule-art.js`).
- `aw-probe.mjs --cmd draws|cost` lets the renderer's frame-time sampler drop the tier to `low` on a busy machine (no shadow pass at all), which my first baseline run showed
  (shadow 0). `scripts/perf/aw-actors.mjs` (new) holds the tier from the first frame; use it for before / after.

## Risks

- A new skinned shader variant (+2 programs). The camera one is compiled at boot by a hidden warm-up customer; the depth twin is compiled at the first shadowed customer
  (not measured separately; no program compiled after boot in the 20 s hitch runs).
- `rig.userData.persons[i]` are `Bone`s, not `Group`s: code that adds children to a person or reads `.torso` / `.head` / `.mats` of a customer would break (nothing in the repo does).
  `userData.wheels` / `wheelParts` have 2 entries, `posts` / `header` are gone from the auto, `plateRearM === plateFrontM`, `stripes.left === stripes.right`.
- Per live, visible customer: one 8x8 float bone-texture upload per frame (not measurable against the ~50 us per draw call it replaces).
- `fares.js` was not touched; `customers.js` only in `createRig` and its imports. `world/**`, `render/**`, `game/config.js`: untouched.

## Files

`sim/person-mesh.js` (+ test), `sim/auto-canopy.js`, `sim/autoModel.js`, `sim/customize.js`, `sim/auto-budget.test.js`, `sim/customize.test.js`, `gameplay/customers.js`
(createRig), `ARCHITECTURE.md` (addendum 4: contracts), `scripts/perf/aw-actors.mjs` + `README.md` (the probe), this report and its screenshots.
