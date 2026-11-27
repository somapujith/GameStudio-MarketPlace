# tf-prog2: Tiffin Centre programs, draw calls, load and hitches (wave 3)

Branch `perf/tf-prog2` (cut from main `a4a2390`, main merged in at the end). It replaces the stalled `tf-prog` stream: that stream's unreviewed WIP (`13fd84c`) was
reviewed, finished and wired in (section 2). Machine: the dev laptop's integrated AMD Radeon (`ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11)`), Chrome
headless on the real GPU, production build, 1536x864 @ 1.25, **tier pinned to medium** (see 0), practice level 1 unless a row says tutorial. Every A/B is two builds
(`main` on one preview port, the branch on another) measured back to back or interleaved on the same machine in the same minutes. Other agents were running builds and
tests on this laptop all afternoon (CPU 60 to 75 % at times): the order of two builds in an interleaved pair is meaningful, an absolute number moves by 20 %.

## 0. What the default tier is on this machine, and what was measured

On this machine **Auto ends on `lite`** (`bench.mjs --game tiffin`, no tier, quiet machine: `tier: lite`, 998 fps, 126 draw calls, 85 programs, 0 frames over 50 ms): the
governor leaves `medium` because medium cannot hold its frame budget on the iGPU (tf-int, section 3). `lite` already meets the draw-call and program targets and loads in
4.2 s cold / 1.9 s warm. Everything that is wrong is in **medium** (and high), so every number below is medium unless it says lite, pinned through the Graphics setting
(`--tier medium`). If medium gets cheap the governor has a reason to stay on it. **Lite and low are not slower to load than on main** (section 3).

## 1. Headline (medium, main vs this branch)

| | main (`a4a2390`) | this branch | how it was measured |
|---|---|---|---|
| shader programs created **after** the reveal | 9 in the first 3 s (every dish, 2 depth programs), then rain +4, cricket +2, festival +2, inspector +1 | **0** (60 s of level 1 and six forced events; `tf-census --strict` passes) | `tf-census.mjs`, `tf-events.probe.js`, `scene.debug.reveal` |
| programs at the reveal / after a session with events | 93-104 / 111 | 112-115 / 112 | same |
| first appearance of an event (worst frame) | rain 252 ms, cricket 206, festival 359, inspector 131 (+113 geometries), rain+power+festival 161 | **34 to 59 ms** in three runs (power 41-50, cricket 36-51, festival 37-59) | `tf-events.probe.js` forces each event on in the live page |
| a customer walks up (the frame that pays for it) | 15-50 ms (a 49 and a 50 ms frame in two 60 s runs) | **0-33 ms**, built a stage per frame (<= 8 ms each) | `tf-hitch.probe.js`, `tf-build-times.mjs` |
| main-pass draw calls with **3 customers** | 359 (463 with the shadow pass) | **153 (192)** | `tf-draws.probe.js` |
| draw calls of ONE customer, main / shadow pass | 59-93 / 25-39 | **11-13 (family 20) / 7-9 (15)** | same |
| main-pass draws, tutorial, no customers | 140 | **122** | `tf-who.probe.js` (onBeforeRender counter) |
| `renderer.info.render.calls`, tutorial frame (shadow + post included) | 168-172 | **134-150** (traffic in view changes it) | `tf-who`, `tf-load.mjs` |
| load, warm shader cache (click to `window.__tiffin`) | 3.06 / 3.37 s | 3.81 / 3.81 s (a later pair under load: main 3.5 / 3.5, branch 4.0 / 3.8) | `tf-load.mjs --passes 2`, interleaved pairs |
| load, cold shader cache | 10.3 / 10.9 s | **11.9 / 12.3 s** | same |
| lite load, warm / cold | 2.1-2.3 / 4.2-5.6 s | 2.3 / 4.6 s (unchanged) | `tf-load.mjs --tier lite` |
| long tasks (>= 50 ms) in a 60 s level-1 run, fixed render scale 0.7 | 1-3 | 0-5 (the last run was under heavy machine load) | `tf-hitch.probe.js` |
| frames over 50 ms after the first 3 s, same runs | 1-2 | 0-2 | same |

**Not claimed: frame rate.** Interleaved pairs of 60 s runs at a fixed scale gave 3137 / 3136 frames (main) against 3586 / 3750 (branch) early on, 3825 against 3561 later, and 2861
in the last run (the laptop was busy): the customers that walk up differ between runs and the machine drifts by 20 %, I cannot say faster or slower from them. What is solid:
the draw calls, the programs, the hitch tables. The per-section profile (`h.cpu`, two customers in view) put the render section's main-thread time at 17.7-19.4 ms (357-435 calls) on
main and 14.8-18.4 ms (208-222 calls) on the branch with the same GPU median (12.9-16.5 ms main, 12.9-14.0 branch): the frame is **GPU-bound on this iGPU at medium**, so fewer
draws buy a few ms of command submission and no more.

Targets of the brief, honestly: **no program after the reveal: met** (medium and high; lite and low keep their old post-reveal dish warm-up: section 3); **zero frames over 50 ms after
3 s: not met strictly** (0-2 a minute remain on both builds, none from a compile or a model build; section 4); **click-to-playable warm <= 6 s: met** (3.8 s), **cold <= 12 s:
borderline** (11.9-12.3 s, +1.7 s over main because 10 more programs are linked behind the loading screen instead of in play); **main-pass draw calls <= 120: not met** (122 without
customers, 153 with three; the customers are fixed, the static scene is not: section 5).

## 2. What changed (commits `3d5037c`, `3b34587`, `812238a`, `70079aa`)

1. **Review of the WIP `13fd84c`.** Taken: `models/pack.js` (+ tests), the `skin.js` packed material variants, the `pack` draw mode, `withEverythingDrawn`, the probe scripts.
   Rewritten: the preload was never called (its `warmPark` was added to the actors root for every scene, which broke the scene test that counts the actors' children; the tools could not
   be warmed because the viewmodel did not exist yet; the world fx update ran every frame once they were created). `zz-census.scratch.test.js` was not taken.
2. **Packed people** (`models/pack.js`, medium and high; lite and low keep their baked path). The rig (limbs, cloth, face morph targets, IK) is untouched and still drives its own nodes;
   every skin / eye / hair / plain-standard mesh of a person is written, after the rig's update, into ONE dynamic mesh per shading class (skin, eye, hair, uber, plus one per odd
   material) and the rig's own meshes are retired (`isMesh` shadowed by false: not drawn, not shadowed, not compiled). The face skin (13 GPU morph targets) and transparent / emissive
   props stay live. A customer is 11-13 draws (+7-9 in the shadow pass) instead of 59-93 (+25-39), the cook's own arms 4 (was 12). **Picture checked** (section 6).
3. **One of everything is built, linked and drawn before the reveal** (medium and high; `sync.preload()`, `settleFirstFrame` in `scene/index.js`, `withEverythingDrawn` in `loader.js`): the weather
   and the events' props, the inspector, the delivery rider and his scooter, a parcel bag, a regular's star, a plate of every dish (and one `perfect` plate: the wisp shader), every tool
   of the cook's hands, one customer of every kind and a cook (as before). The scene is then drawn ONCE with every hidden object visible and nothing culled (parked customers, rain, TV,
   tools, far street): the first-draw cost of everything (uploads, the shadow-depth programs, the driver's per-program first use) is paid behind the loading screen; a second, normal frame
   follows. The post-reveal shader warm-up (one dish per frame for 12 s: the hitches at 3 to 5 s) is gone. `scene.debug.reveal` (`{ atReveal, count, late: [...] }`, `createRevealWatch` in
   `loader.js`, unit-tested) lists any program created after the reveal; `tf-census.mjs --strict` exits 1 when there is one. A tier switch builds the new tier's programs on purpose (behind a
   held frame): it is listed too.
4. **Customers are built a stage per frame** (`buildPersonSteps`, `buildCustomerSteps`: head, body, hair, clothes, props, pose, packing; `sync.stepBuilds`, a 5 ms budget a frame, all tiers).
   Warm stage times (`tf-build-times.mjs`, six kinds x three seeds): 0.1 to 8 ms per step, 9 to 21 ms for the whole build (it was ~27). The customer appears a few frames after the state says so
   (the walk-in lasts 1.5 s); one who is gone before he is ready is dropped; the first state and late joins are still built at once.
5. **Tint merge** (`merge.js`): textured standard materials with the same texture set and only a different colour (the street's plasters: one texture, six paints) fold into one
   vertex-coloured draw (`isTintable`, `tintMaterialFor`, 3 tests). Street-static 19 -> 13 draws.
6. **The traffic in two draws** (`street.js`, `street-batch.js`, 4 tests): every vehicle kind, the parked scooters and the pedestrians' torsos and legs already shared one body material and
   one lamp material; one `BatchedMesh` now draws all the bodies and one all the lamps (a body and a lamp `InstancedMesh` per kind in view: 18 draws). A slot object speaks the
   `InstancedMesh` calls the street code already makes. The static merger and the shadow proxy never swallow a `BatchedMesh`. (The street's tint-mask shader patch looks for
   `vColor.xyz *= instanceColor.xyz`, which three r187 writes as `vColor.rgb *= instanceColor.rgb`: the patch does nothing today, every instance is tinted whole; the batch keeps that look.)
7. **`forceSinglePass`** on the additive flame, glow and light-shaft shaders: three.js draws a transparent double-sided material twice (back faces, then front) with two program variants;
   additive blending is order-independent, so one pass is the same picture.
8. Probes (all `tf-probe.mjs` bodies unless noted): `tf-draws`, `tf-who` (every drawn object and its material), `tf-hitch` (every frame with its cause), `tf-cpu`, `tf-events`, `tf-nodes`,
   `tf-dead`, `tf-progsize`, `tf-ds`; `tf-people-qa.mjs` (packed against unpacked people, needs a Vite dev server as the base), `tf-census.mjs --strict`.

## 3. Programs, and the tiers

* Census after 60 s of level 1: main 93 at the reveal, 102 after 60 s, 111 once the events had run; branch **112 at the reveal and 112 later**, none created after (`scene.debug.reveal.count` 0 as well).
  Fragment shaders are 72 KB on average (85-93 KB for the lit ones: 7 point lights, shadows, env map; `tf-progsize`): that, not the number of draws, is what a cold link pays for (about 70 ms
  a program here). The cook's hand tools alone own 16 programs.
* Customers added **no** program per kind: the packed skin / eye / hair / uber programs are the same for all six kinds (the programs-per-customer-kind lever the brief asked for; weather,
  events and dishes are not made uniform-driven, they are pre-compiled: section 2.3).
* **Lite and low do not get the preload.** The first A/B on lite (preload on for every tier) measured warm load 2.1 -> 3.3 s, cold 4.2-5.6 -> 6.4-7.1 s, 85 -> 99 programs, 123 -> 897
  geometries and one 1.4-1.9 s task: lite's programs are small and it never stuttered on them, so the preload runs only where shadows are on (medium, high). With the gate lite is 2.3 s warm /
  4.6 s cold, 84 programs, as on main; its dishes are still warmed after the reveal, as before. The sliced customer build and the traffic batch apply to every tier (lite and low sanity runs:
  customers arrive and leave, no errors).
* The census' "dead" programs (20 in the first census) are not waste: 4 are PMREM, 5 the post passes, 2 depth, the rest three.js's back-face variants of transparent double-sided materials
  (`tf-dead.probe.js`: each differs from its live twin by the side bit only). `tf-ds.probe.js` lists the 25 transparent double-sided materials of the scene; forcing every one single-pass
  saves 2 more draws, not done.
* `MeshPhysicalMaterial` -> `MeshStandardMaterial` was **not** done: the physical ones left use clearcoat, sheen or anisotropy (brushed steel, leaf, glass, porcelain, the eyes, food); the
  pbr materials are shared and switch normal map / anisotropy per tier through `registerQuality`, so a clone would not follow a tier change.

## 4. Hitches

* **Events (`tf-events.probe.js`, level 1, scale 0.7, each event forced on for 6 s):** main: rain 252 ms frame (4 programs), cricket 206 (2), festival 359 (2), inspector 131 (1 program,
  113 geometries), the three together 161; branch (three runs): worst frames 34-59 ms, **0 new programs**, 0 to 20 new geometries (the cricket TV's own 9 to 10).
* **Customer arrival (`tf-hitch.probe.js`):** main's arrival frames 6, 15, 19, 32, 49, 50 ms; branch 0, 1, 2, 10, 11, 13, 17, 18, 20, 31, 33 ms. One 51 ms frame 140 ms after an arrival remains in
  one branch run (no counter moved: not a program, not a geometry; not identified).
* **The first 3 s after the reveal:** the post-reveal warm-up is gone; the one 60 to 64 ms frame at ~3.3 s in both builds is the probe's own `setScale`.
* **What still crosses 50 ms:** 0 to 2 frames a minute on both builds (a GC pause, the first draw of a canvas texture such as the cricket TV's, a tier switch). Not met strictly.

## 5. Draw calls

| group (tutorial, no customers, medium; `tf-who.probe.js`) | main-pass draws | was |
|---|---|---|
| street: static textured meshes (one per texture set), upper storeys, hoardings, blade signs, decals, tubes, monument, merged | 43 | 48 |
| stall: merged PBR sets (26) and static (6) | 32 | 32 |
| stall: station props (kadai, steamer, tawa, chai), flame / steam shader quads, particles | 26 | 28 |
| traffic: bodies + lamps of every kind (one `BatchedMesh` each) and the few instanced extras | 5 | 18+ |
| the dog (7 animated parts), the cart | 8 | 8 |
| the cook's arms (packed), sky, point sprites | 8 | 16 |
| **total** | **122** | **140** |

What the list says: the remaining draws are one per **texture set** (the shop faces, signs and hoardings are painted canvases, unique per object) and one per **animated part**. Neither merges
without an atlas (the detail normal / roughness maps repeat per material, so an atlas needs a custom shader) or packing the dog like a person. The packed customers are where the draws
were: three cost 31-37 draws now, 215 before; a frame with three customers and the street is 153.

## 6. Screenshots (`docs/perf/tf-prog2/`, JPEG q72, 1280 wide, HUD hidden, medium, same camera; everything that moves by itself differs between two shots)

| file | what I see |
|---|---|
| `people-rig-h13.jpg` / `people-pack-h13.jpg` | the SAME six customers (office, student, family with the child in front, uncle with his stick, autowala, techie), once with the rig's own meshes, once packed, built in the live page at the six customer spots, noon, street hidden. I could not tell them apart by eye: faces, the glasses, the cap, the kurta placket, the backpack, the laptop bag, the stick, the hands |
| `diff-people-h13.jpg` | amplified x4 difference of the two: the people's interiors are black (mean difference 2.5 grey levels in the people region, 1.7 % of the pixels over 16); thin lines on silhouettes, the cook's hands (the viewmodel animates between the two shots) and the flames |
| `before-h9.jpg` / `after-h9.jpg` | tutorial, 09:00: the stall (awning, drums, wok, hands, menu board) and the street (shop signs, buildings and their plaster colours, the tower at the end of the lane) match; the traffic is different (random) |
| `before-h13.jpg` / `after-h13.jpg` | noon: same; the bus in a different place |
| `before-h19_5.jpg` / `after-h19_5.jpg` | dusk: the bulbs and their glow, the purple sky, the lit windows, the tail lights and the sauce in the wok match |
| `before-customers-h13.jpg` / `after-customers-h13.jpg` | level 1, 30 s in: different customers (random), the same stall and street; `after` shows the uncle, an office worker and the child, a pedestrian, a tuk-tuk, a scooter, the bus: three customers and a busy street |
| `after-phone-h19_5.jpg` | 844x390 @ 2 at dusk (final build): two customers, bulbs and bloom, a parked scooter with its tail lights |

Also photographed and compared, not kept (twelve images at most): the inspector, the delivery rider and the cook's avatar packed against unpacked (mean difference 2.0 in the people
region, identical to the eye); the batched traffic at 09:00, 13:00 and 22:00 (bus, tuk-tuks, scooters, riders, head and tail lights as before).

## 7. Tests and commands

`npx vitest run src/games/tiffin-centre shared/tiffin-centre src/platform/gfx` (104 files, 2408 tests, all passing; run before the last merge of main, which only touched `src/platform/game`) and `npx vite build` (passes).
New or changed tests: `models/pack.test.js` (every kind in every mood: the packed buffers equal the rig's meshes to 2e-5; classification; hidden parts; dispose), `models/customers.steps.test.js`
(the stepped build equals the one-shot build for every kind, yields at least 5 / 8 times, is alive), `models/merge.test.js` (tint merge: six paints in one mesh with their colours, anything
else keeps its own mesh, off without the uber option), `scene/street-batch.test.js` (slots, colours, matrices land on the right instance, bad geometry refused, never merged statically),
`scene/loader.test.js` (`createRevealWatch`, `withEverythingDrawn` and its restore on a throw, `applyModelTier` packs medium / high only).

```powershell
node scripts/perf/tf-census.mjs --base http://127.0.0.1:5856 --port 9880 --tier medium --level 1 --seconds 60 --strict      # exit 1 if a program appears after the reveal
node scripts/perf/tf-probe.mjs --base ... --port ... --tier medium --level 1 --warm 6 --js scripts/perf/tf-events.probe.js   # each event forced on
node scripts/perf/tf-probe.mjs --base ... --port ... --tier medium --level 1 --warm 4 --js scripts/perf/tf-hitch.probe.js    # a minute of play, every hitch with its cause
node scripts/perf/tf-probe.mjs --base ... --port ... --tier medium --level 1 --warm 12 --js scripts/perf/tf-draws.probe.js   # draws with customers in view
node scripts/perf/tf-people-qa.mjs --base http://127.0.0.1:<vite dev port> --port 9964 --out docs/perf/tf-prog2             # packed vs unpacked people (dev server)
```
(`tf-probe.mjs --args` does not survive PowerShell's quoting of JSON: the probes have defaults and read `args` only when it parses.)

## 8. Risks

* **Memory (medium, high):** the preload draws everything once, so the renderer holds **556-647 geometries and 236-242 textures at the reveal (main: 151 and 150)**; main reached about 240 / 180 in a
  long session (tf-cpu soak), so this is the plateau reached early. JS heap is the same (90-103 MB). GPU memory was not measured.
* **Cold load +1.7 s** on medium (10 more programs linked before the reveal); a returning player (warm cache) pays +0.4 to 0.75 s. The same programs were compiled in play before, as 100 to 360 ms
  hitches at the first dish, the first rain, the inspector.
* **A customer appears 3 to 8 frames after the state says so** (sliced build); `speak()` for him before that is ignored (the first ~100 ms of his first line has a still mouth).
* **Packing relies on `isMesh` being shadowed on the retired rig meshes** (three r187 sets it per instance in the constructor; `dispose()` puts it back) and on the rig meshes' world matrices being
  current when `update()` runs; anything that walks a person's tree with `isMesh` (`shade`, `limitShadowCasters`) skips the retired ones. The visible face still uses the unpacked skin program.
* **The traffic `BatchedMesh` needs `WEBGL_multi_draw` to be one draw** (ANGLE has it; three.js falls back to a draw per geometry without it: the old count, never a wrong picture). Instances are culled by
  their own sphere, so a vehicle partly in view is drawn whole.
* **High tier:** a 70 s census created no program after the reveal (117 at the reveal), but one earlier 60 s run showed a shadow-depth program 24 s in (a 391 ms frame at a customer's arrival): a
  customer look (hair style, headwear) the parked ones did not cover can still bring a depth variant. Medium: none in five runs. Not chased (high runs at about 8 fps on this iGPU).
* **Tier switches** still compile their new programs (behind a held frame): `scene.debug.reveal` lists them, they are not a violation. After a switch the old post-reveal warm-up runs again.
* Tint merge clones the first material of a group: the clone does not follow a later change of that material (none of the street's std materials changes).

## 9. Not done

* Main-pass draw calls <= 120 with customers (122 without, 153 with three): the static scene's one-draw-per-texture-set and the dog; an atlas for the painted signs would take ~15 more.
* Texture baking in a worker (`models/textures-pbr.js`, `scene/art.js`): not touched; the load spends ~0.9 s on it behind the loading screen, in slices.
* Zero per-frame allocation audit of `sync.js` / `pack.js` (`for..of` over Maps and the `outs` array allocate an iterator a frame); not measured as a cost.
* `matrixAutoUpdate = false`: 2203 of 2362 nodes update every frame, `scene.updateMatrixWorld()` costs **0.32 ms** (`tf-nodes.probe.js`): not worth the risk.
* Customer pooling: not needed once the build is sliced (a build is 9 to 21 ms over ~5 frames, a customer lives for a minute).
* Physical -> Standard, forceSinglePass on the planar transparent materials left (2 draws): section 3.
* Lowering the cold link further needs fewer / lighter lit programs (tf-gpu's shaders), e.g. the 16 programs of the hand tools.

## 10. Files outside my list

`src/games/tiffin-centre/scene/index.js` (tf-int's): import of `withEverythingDrawn` / `createRevealWatch`, `sync.preload()` called in `settleFirstFrame` on shadow tiers, the two-frame first render,
the post-reveal warm-up skipped when the load preloaded, `scene.debug.reveal`. `models/shaders/flame.js`, `scene/stall.js` (`forceSinglePass`; tf-gpu's / mine). `scripts/perf/{tf-census,tf-groups,tf-shot}.mjs`
(small) and the new probes. Nothing in `shared/`, `worker/` or `src/platform/`.
