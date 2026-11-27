# tf-prog2: Tiffin Centre programs, draw calls, load and hitches (wave 3)

Branch `perf/tf-prog2` (cut from main `a4a2390`, main merged in at the end). It replaces the stalled `tf-prog` stream: that stream's unreviewed WIP (`13fd84c`) was
reviewed, finished and wired in (section 2). Machine: the dev laptop's integrated AMD Radeon (`ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11)`), Chrome
headless on the real GPU, production build, 1536x864 @ 1.25, **tier pinned to medium** (see 0), practice level 1 unless a row says tutorial. Every A/B below is two
builds (`main` on port 5852, the branch on 5853 / 5856) measured back to back or interleaved on the same machine, the same minutes.

## 0. What the default tier is on this machine, and what was measured

On this machine **Auto ends on `lite`** (`bench.mjs --game tiffin`, no tier: `tier: lite`, 998 fps, 126 draw calls, 85 programs, 0 frames over 50 ms): the governor
leaves `medium` because medium cannot hold its frame budget on the iGPU (tf-int, section 3). `lite` already meets the draw-call and program targets, and its load is
4.2 s cold / 1.9 s warm. Everything that is wrong is in **medium** (and high), so every number here is medium, pinned through the Graphics setting
(`--tier medium`). If medium gets cheap the governor has a reason to stay on it.

## 1. Headline (medium, same conditions, main vs this branch)

| | main (`a4a2390`) | this branch | how it was measured |
|---|---|---|---|
| shader programs created **after** the reveal | 9 in the first 3 s (every dish, 2 depth programs), then rain +4, cricket +2, festival +2, inspector +1 | **0** (60 s of level 1 and six forced events) | `tf-census.mjs`, `tf-events.probe.js`, `scene.debug.reveal` |
| programs at the reveal / after a session with events | 93-104 / 111 | 112-115 / 112 | same |
| first appearance of an event (frames over 50 ms) | rain 252 ms, cricket 206, festival 359, inspector 131 (+113 geometries), rain+power+festival 161 | **none over 51 ms** (worst: power 50, cricket 51) | `tf-events.probe.js` forces each event on in the live page |
| a customer walks up (frame that pays for it) | 15-50 ms (one 49 and one 50 ms frame in two 60 s runs) | **1-33 ms**, built a stage per frame (<= 8 ms each) | `tf-hitch.probe.js`, `tf-build-times.mjs` |
| main-pass draw calls, **3 customers** (uncle, office, office) | 359 (463 with the shadow pass) | **166 (204)** | `tf-draws.probe.js` |
| draw calls of ONE customer, main / shadow pass | 59-93 / 25-39 | **11-13 (family 20) / 7-8 (15)** | same |
| main-pass draws, tutorial, no customers | 140 | **135** | `tf-who.probe.js` (onBeforeRender counter) |
| `renderer.info.render.calls`, tutorial frame (shadow + post included) | 172 | **163** | `tf-load.mjs` |
| load, warm shader cache (click to `window.__tiffin`) | 3.06 / 3.37 s | 3.81 / 3.81 s | `tf-load.mjs --passes 2`, 2 interleaved pairs |
| load, cold shader cache | 10.3 / 10.9 s | **11.9 / 12.3 s** | same |
| long tasks of the 60 s level-1 run (>= 50 ms) | 1-3 | 0-2 | `tf-hitch.probe.js` (fixed render scale 0.7, no governor) |
| frames over 50 ms after the first 3 s, same run | 1-2 | 0-2 | same |

**Not claimed: frame rate.** Two interleaved pairs of 60 s runs at a fixed scale: 3137 / 3136 frames (main) against 3586 / 3750 (branch); a later pair gave 3825 (main)
against 3561 (branch). The customers that walk up differ between runs and the machine drifts by 20 %: I cannot say faster or slower from those. What is solid: the draw
calls, the programs, the hitch tables. In the per-section profile (`h.cpu`) the render section's main-thread time went from 17.7-19.4 ms (357-435 calls) to 14.8-18.4 ms
(208-222 calls) with the same GPU median (12.9-16.5 ms main, 12.9-14.0 branch): the frame is **GPU-bound on this iGPU at medium**, so fewer draws buy a few ms of
command submission and no more.

Targets of the brief, honestly: no program after the reveal **met**; zero frames over 50 ms after 3 s **not met strictly** (0-2 per minute remain, none from a compile or a
model build: section 4); click-to-playable warm <= 6 s **met** (3.8 s), cold <= 12 s **borderline** (11.9-12.3 s, +1.7 s over main because 10 more programs are
linked behind the loading screen instead of in play); main-pass draw calls <= 120 **not met** (135 without customers, 166 with three; the customers are fixed, the
static scene is not: section 5).

## 2. What changed (commits `3d5037c`, `3b34587`, `812238a`)

1. **Review of the WIP `13fd84c`.** Taken: `models/pack.js` (+ its tests), the `skin.js` packed material variants, the `pack` draw mode, `withEverythingDrawn`, the
   probe scripts. Rewritten: the preload was never called (its `warmPark` was added to the actors root for every scene, which broke the scene test that counts the actors'
   children; the tools could not be warmed because the viewmodel did not exist yet; the world fx update ran every frame once they were created). `zz-census.scratch.test.js`
   was not taken.
2. **Packed people** (`models/pack.js`, medium and high; lite and low keep their baked path). The rig (limbs, cloth, face morph targets, IK) is untouched and still
   drives its own nodes; every skin / eye / hair / plain-standard mesh of a person is written, after the rig's update, into ONE dynamic mesh per shading class (skin,
   eye, hair, uber, plus one per odd material) and the rig's own meshes are retired (`isMesh` shadowed by false: not drawn, not shadowed, not compiled). The face skin
   (13 GPU morph targets) and transparent / emissive props stay live. A customer is 11-13 draws (+7-8 in the shadow pass) instead of 59-93 (+25-39), the cook's own
   arms 4. **Picture checked** (section 6): the same six customers photographed unpacked and packed differ by 2.5 grey levels on average inside the people region
   (1.7 % of the pixels over 16), the interiors are identical and only sub-pixel silhouette edges differ.
3. **One of everything is built, linked and drawn before the reveal** (`sync.preload()`, `settleFirstFrame` in `scene/index.js`, `withEverythingDrawn` in `loader.js`): the
   weather and the events' props, the inspector, the delivery rider and his scooter, a parcel bag, a regular's star, a plate of every dish (and one `perfect` plate: the wisp
   shader), every tool of the cook's hands, one customer of every kind and a cook (as before). The scene is then drawn ONCE with every hidden object visible and nothing
   culled (parked customers, rain, TV, tools, far street), which pays the first-draw cost of everything: uploads, the shadow-depth programs, the driver's per-program
   first use. A second, normal frame follows. The post-reveal shader warm-up (one dish per frame for 12 s: the hitches at 3 to 5 s) is gone. `scene.debug.reveal`
   ( `{ atReveal, count, late: [...] }`, `createRevealWatch` in `loader.js`, unit-tested) lists any program created after the reveal; `tf-census.mjs --strict` exits 1 when
   there is one. (A tier switch builds the new tier's programs on purpose, behind a held frame: it is listed too.)
4. **Customers are built a stage per frame** (`buildPersonSteps`, `buildCustomerSteps`: head, body, hair, clothes, props, pose, packing; `sync.stepBuilds`, a 5 ms budget a
   frame). Warm stage times (`tf-build-times.mjs`, six kinds x three seeds): 0.1 to 8 ms per step, 9 to 21 ms for the whole build (it was ~27). The customer appears a few
   frames after the state says so (the walk-in lasts 1.5 s); a customer who is gone before he is ready is dropped, the first state and late joins are still built at once.
5. **Tint merge** (`merge.js`): textured standard materials with the same texture set and only a different colour (the street's plasters: one texture, six paints) fold into
   one vertex-coloured draw (`isTintable`, `tintMaterialFor`, 3 tests). Street-static 19 -> 14 draws.
6. Probes (all `tf-probe.mjs` bodies unless noted): `tf-draws`, `tf-who` (every drawn object and its material, from an `onBeforeRender` counter), `tf-hitch` (every frame with
   its cause), `tf-cpu`, `tf-events`, `tf-nodes`, `tf-dead`, `tf-progsize`; `tf-people-qa.mjs` (packed against unpacked people, needs a Vite dev server as the base), `tf-census.mjs
   --strict`.

## 3. Programs

* Census after 60 s of level 1 (`tf-census.mjs`): main 93 at the reveal, 102 after 60 s, 111 once the events had run; branch **112 at the reveal and 112 later**, none created
  after (`scene.debug.reveal.count` 0 as well). Fragment shaders are 72 KB on average (85-93 KB for the lit ones: 7 point lights, shadows, env map; `tf-progsize`); that, not
  the number of draws, is what a cold link pays for (about 70 ms a program here).
* Customers added **no** program per kind: the packed skin / eye / hair / uber programs are the same for all six kinds (that is the programs-per-customer-kind lever the
  brief asked for; weather, events and dishes are not through uniforms, they are pre-compiled: section 2.3).
* The census' "dead" programs (20 in the first census) are not waste: 4 are PMREM, 5 the post passes, 2 depth, and the rest are three.js's back-face variants of
  transparent double-sided materials (the renderer draws them back, then front, switching `side` and re-keying the program: `tf-dead.probe.js` shows each differs from its
  live twin by the side bit only). `forceSinglePass` on the planar ones would save about 3 programs and 3 draws; not done.
* `MeshPhysicalMaterial` -> `MeshStandardMaterial` was **not** done: the ones left are physical because they use clearcoat, sheen or anisotropy (brushed steel, leaf, glass,
  porcelain, the eyes, food); the pbr materials are shared and switch their normal map / anisotropy per tier through `registerQuality`, so a clone would not follow a tier change.

## 4. Hitches

* **Events (`tf-events.probe.js`, level 1, scale 0.7, each event forced on for 6 s):** main: rain 252 ms frame (4 programs), cricket 206 (2), festival 359 (2), inspector 131
  (1 program, 113 geometries), the three together 161; branch (two runs): no frame over 51 ms, **0 new programs**, 0 to 20 new geometries (the cricket TV's own 9).
* **Customer arrival (`tf-hitch.probe.js`):** main's arrival frames 15, 32, 49, 28, 50 ms; branch 1, 33, 31, 17, 20, 21, 2, 15 ms. One 51 ms frame 140 ms after an arrival
  remains in one of the branch runs (not a program, not a geometry: no counter moved; not identified).
* **The first 3 s after the reveal:** the post-reveal warm-up is gone; the one 60 to 64 ms frame at ~3.3 s in both builds is the probe's own `setScale`.
* **What still crosses 50 ms:** 0 to 2 frames a minute on both builds (a GC pause, the first draw of a texture such as the cricket canvas, a tier switch). Not met strictly.

## 5. Draw calls

| group (tutorial, no customers, medium; `tf-who.probe.js`) | main-pass draws |
|---|---|
| street: static textured meshes (one per texture set), upper storeys, hoardings, blade signs, decals, tubes, monument, merged | 43 (was 48) |
| stall: merged PBR sets (26) and static (6) | 32 |
| stall: station props (kadai 7, steamer 2, tawa, chai), flame / steam shader quads, particles | 28 |
| traffic: instanced vehicles (a body and a lamp mesh per kind in view) | 18 |
| the dog (7 animated parts), the cart | 8 |
| the cook's arms (packed: 4, was 12), sky, point sprites | 8 |
| **total** | **135** (was 140) |

What the list says: the remaining draws are one per **texture set** (the shop faces, signs and hoardings are painted canvases, unique per object) and one per **animated
part**; neither merges without an atlas (the detail normal / roughness maps repeat per material, so an atlas needs a custom shader) or a rewrite of the traffic into a
`BatchedMesh` (all kinds in one draw: worth trying, not started). The packed customers are where the draws were: 3 customers cost 43 draws now, 215 before.

## 6. Screenshots (`docs/perf/tf-prog2/`, JPEG q72, 1280 wide, HUD hidden, medium, same camera; everything that moves by itself differs between two shots)

| file | what I see |
|---|---|
| `people-rig-h13.jpg` / `people-pack-h13.jpg` | the SAME six customers (office, student, family with the child in front, uncle with his stick, autowala, techie), once with the rig's own meshes, once packed, built in the live page at the six customer spots, noon, street hidden. I could not tell them apart by eye: faces, the glasses, the cap, the kurta placket, the backpack, the laptop bag, the stick, the hands |
| `diff-people-h13.jpg` | amplified x4 difference of the two: the people's interiors are black; thin lines on silhouettes and the cook's hands (the viewmodel animates between the two shots) and the flames |
| `before-h9.jpg` / `after-h9.jpg` | tutorial, 09:00: the stall (awning, drums, wok, hands, menu board) and the street (shop signs, buildings, plaster colours, the end-of-lane tower) match; the traffic is different (random) |
| `before-h13.jpg` / `after-h13.jpg` | noon: same; the bus in a different place |
| `before-h19_5.jpg` / `after-h19_5.jpg` | dusk: the bulbs and their glow, the purple sky, the lit windows, the tail lights and the sauce in the wok match |
| `before-customers-h13.jpg` / `after-customers-h13.jpg` | level 1, 30 s in: different customers (the random ones), the same stall and street; `after` shows two customers (blue shirt with bag, green kurta), a pedestrian, a tuk-tuk and the bus |
| `after-phone-h19_5.jpg` | 844x390 @ 2 at dusk: the phone landscape picture with two customers, bulbs and bloom |

The inspector, the delivery rider and the cook's avatar were photographed unpacked / packed the same way (mean difference 2.0 in the people region): identical to the eye
(not kept: twelve images at most). The tint merge shows up nowhere in the before / after pairs: the street's building bodies keep their six tints.

## 7. Tests and commands

`npx vitest run src/games/tiffin-centre shared/tiffin-centre src/platform/gfx` and `npx vite build`: see the end of the report (final run after the merge of main).
New or changed tests: `models/pack.test.js` (every kind in every mood: the packed buffers equal the rig's meshes to 2e-5; classification; hidden parts; dispose),
`models/customers.steps.test.js` (the stepped build equals the one-shot build for every kind, yields at least 5 / 8 times, is alive), `models/merge.test.js` (tint merge: six
paints in one mesh with their colours, anything else keeps its own mesh, off without the uber option), `scene/loader.test.js` (`createRevealWatch`, `withEverythingDrawn` and its
restore on a throw, `applyModelTier` packs medium / high only).

```powershell
node scripts/perf/tf-census.mjs --base http://127.0.0.1:5856 --port 9880 --tier medium --level 1 --seconds 60 --strict      # exit 1 if a program appears after the reveal
node scripts/perf/tf-probe.mjs --base ... --port ... --tier medium --level 1 --warm 6 --js scripts/perf/tf-events.probe.js   # each event forced on
node scripts/perf/tf-probe.mjs --base ... --port ... --tier medium --level 1 --warm 4 --js scripts/perf/tf-hitch.probe.js    # a minute of play, every hitch with its cause
node scripts/perf/tf-probe.mjs --base ... --port ... --tier medium --level 1 --warm 12 --js scripts/perf/tf-draws.probe.js   # draws with customers in view
node scripts/perf/tf-people-qa.mjs --base http://127.0.0.1:<vite dev port> --port 9964 --out docs/perf/tf-prog2             # packed vs unpacked people (dev server)
```
(`tf-probe.mjs --args` does not survive PowerShell's quoting of JSON: the probes have defaults and read `args` only when it parses.)

## 8. Risks

* **Memory:** the preload draws everything once, so the renderer holds **647 geometries and 236 textures at the reveal (main: 151 and 150)**; main reached about 240 / 180 in a long
  session (tf-cpu soak), so this is the plateau reached early. JS heap is the same (90-103 MB). GPU memory was not measured.
* **Cold load +1.7 s** (10 more programs linked before the reveal); a returning player (warm cache) pays +0.75 s. The same programs were compiled in play before, as 100 to 360 ms
  hitches at the first dish, the first rain, the inspector.
* **A customer appears 3 to 8 frames after the state says so** (sliced build); `speak()` for him before that is ignored (the first ~100 ms of his first line has a still mouth).
* **Packing relies on `isMesh` being shadowed on the retired rig meshes** (three r187 sets it per instance in the constructor; `dispose()` puts it back) and on the rig meshes'
  world matrices being current when `update()` runs; anything that walks a person's tree with `isMesh` (`shade`, `limitShadowCasters`) skips the retired ones. The visible
  face still uses the unpacked skin program (morph targets on the GPU).
* **Tier switches** still compile their new programs (behind a held frame): `scene.debug.reveal` lists them, they are not a violation.
* Tint merge clones the first material of a group: the tint clone does not follow a later change of that material (none of the street's std materials changes).

## 9. Not done

* Main-pass draw calls <= 120 (135 / 166): the static scene's one-draw-per-texture-set and the traffic (a `BatchedMesh` would take it to ~1-2 draws; an atlas for the
  painted signs would take ~15 more).
* Texture baking in a worker (`models/textures-pbr.js`, `scene/art.js`): not touched; the load is 0.9 s of it, behind the loading screen, in slices.
* Zero per-frame allocation audit of `sync.js` / `pack.js` (`for..of` over Maps and the `outs` array allocate an iterator a frame); not measured as a cost.
* `matrixAutoUpdate = false`: 2203 of 2362 nodes update every frame, `scene.updateMatrixWorld()` costs **0.32 ms** (`tf-nodes.probe.js`): not worth the risk.
* Customer pooling: not needed once the build is sliced (a build is 9 to 21 ms spread over 5 frames, a customer lives for a minute).
* Physical -> Standard, forceSinglePass on planar transparent shaders: section 3.

## 10. Files outside my list

`src/games/tiffin-centre/scene/index.js` (tf-int's): import of `withEverythingDrawn` / `createRevealWatch`, `sync.preload()` called in `settleFirstFrame`, the two-frame first
render, the post-reveal warm-up skipped when the load settled, `scene.debug.reveal`. `scripts/perf/{tf-census,tf-groups,tf-shot}.mjs` (small) and the new probes. Nothing in
`shared/`, `worker/` or `src/platform/`.
