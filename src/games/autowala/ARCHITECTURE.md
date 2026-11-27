# Autowala: architecture and contracts

An open-world Hyderabad auto-rickshaw driving game (three.js), a lazy-loaded screen of the Jalebi Games hub
(`/play/autowala`, manifest `src/games/autowala/manifest.js`, route `src/pages/SoloGame.jsx`).
**Read this before touching anything. Several people work in parallel: edit only the files you own.**

## Conventions (get these wrong and things are mirrored or invisible)
- Units: metres, seconds, rupees. **North is -z, east is +x.** Heading 0 faces +z; `forward = (sin h, cos h)`.
- **Steering: `steer = +1` is the driver's RIGHT** (D / arrow right). Heading *falls* when you steer right. Looking along +z, screen-right is -x.
- Speeds are m/s inside (`v.speed`), shown as km/h (`v.kmh`). Fuel is litres of CNG.
- Stack: React 19 + Vite, plain JS/JSX (no TypeScript), `three@0.187.0` (`import * as THREE from 'three'`, addons from `'three/addons/...'`).
- **CSP of the hub: `script-src 'self'`, `connect-src 'self'`, `media-src 'self' blob: data:`, `img-src 'self' data: blob:`, no CDN, no inline script, no eval.**
  Audio is Web Audio synthesis or files served from `public/audio/autowala/`. No external network calls from the game, ever.
- Never put a secret in client code. API keys are read from env vars by *offline scripts* (`scripts/`), never imported by `src/`.
- Fonts available: `Bricolage Grotesque Variable` (Latin), `Noto Sans Telugu Variable` (Telugu). Telugu text must render (customers, signs, banners).
- Style: Vice City neon (pink `--aw-pink`, cyan `--aw-cyan`, violet, gold) on dark translucent panels. CSS variables are defined on `.aw` in `ui/autowala.css`; every UI file has its OWN css file scoped under `.aw` (class prefix `aw-<area>-`).
- Run tests with the **PowerShell** tool, not Git Bash (vitest fails in Git Bash on this machine): `Set-Location A:\Coding\Projects\GameHub; npx vitest run src/games/autowala`.
  Pure logic (pricing, pathfinding, fare maths, loadout rules, line selection...) MUST have unit tests next to it (`*.test.js`).

## Map of the code and who owns what
```
game/        Game.js (OWNER: lead), camera.js, input.js, config.js, rng.js     -- lead only
render/      renderer, sky, materials, textures                                 -- lead only
world/       layout.js, roads.js, buildings.js, props.js, landmarks.js, ...     -- lead only
             routing.js                                                         -- minimap agent
sim/         vehicle.js, autoModel.js                                           -- lead only
             customize.js                                                       -- customisation agent
gameplay/    catalog.js, profile.js, economy.js                                 -- lead only (the shared contract)
             fares.js, customers.js (+ more fare/fuel files you create)         -- fares agent
             routeGuide.js                                                      -- minimap agent
             workshop.js (+ workshop/* files you create)                        -- workshop agent
audio/       ctx.js                                                             -- lead only
             horns.js                                                           -- customisation agent
             voices.js (+ voice files you create), scripts/gen-voicelines.mjs   -- voice agent
ui/          Hud.jsx, Toasts.jsx, TouchControls.jsx, Menus.jsx (+ hud.css...)   -- HUD agent
             Minimap.jsx (+ minimap.css)                                        -- minimap agent
             Workshop.jsx (+ workshop.css)                                      -- workshop agent
```
Need a change in a file you do not own? Do not edit it. Put the exact request in your final report.
You MAY create new files inside your own area (prefix them clearly, e.g. `gameplay/fare-*.js`).

## The game context (`ctx`), built in `game/Game.js`
```
ctx.scene, ctx.camera, ctx.gfx            three.js scene / camera / renderer wrapper
ctx.world                                 { city, colliders, sky, props, landmarks, buildings, roads, terrain, shared, heightAt }
  world.city = { half, lake, nodes[], edges[], blocks[], pois[], poiById{} }
     node  { id, x, z, out:[edgeId], w, curve }                       road junctions
     edge  { id, a, b (node ids), len, w (width), dx, dz (unit dir), name, curve }   straight road piece a->b
     block { id, x0,x1,z0,z1,cx,cz,w,d, district, type: 'normal'|'landmark'|'park'|'water' }  land between roads
     poi   { id, name, te (Telugu), kind, x, z (block centre), w, d, front:{x,z,edge,t} (nearest road point) }
  pois: charminar mecca station paradise cyber birla golconda airport garage stadium hospital irani cng_old cng_north cng_west cng_south
  world.colliders: { resolve(p,r), near(x,z,r), blocked(x0,z0,x1,z1), inside(x,z,pad) }  static boxes
ctx.vehicle / ctx.v                       the player's auto (state): x z y heading speed kmh fwd side steer drifting driftCharge boosting
                                          fuel (litres) airborne jolt (0..1 recent roughness) distance braking reversing hornTime
ctx.auto                                  the auto's THREE.Group. userData: body, wheels[], front, hlM, tailM, brakeM, headlight (SpotLight), driver, pax[2], paint
ctx.clock                                 { hour (0..24), time (s since start), day }
ctx.input                                 drive(), pressed(name) (true once per press), held(name), setTouch(name,on), setStick(-1..1)
ctx.state                                 { paused, menu, weather, upgrades (live object), cameraOverride, cameraMode, debugCam }
ctx.profile                               createProfile(): profile.data (wallet, loadout, owned, upgrades, rides, ...), save(), flush()
ctx.economy                               { wallet, session, canAfford(n), add(n, reason, kind), spend(n, reason) -> bool }
ctx.emit(type, data) / game.on(fn)        the event bus
ctx.toast(text, {tone,icon,ms})           a message on screen (tone: 'info'|'good'|'bad'|'gold')
ctx.setPrompt(id, text|null, key='E')     a "Press E to ..." hint (one visible at a time)
ctx.openMenu(name) / ctx.closeMenu()      sets state.menu; while set, the auto is held with the brake on and driving keys are ignored
ctx.addSystem({ update(dt, ctx), dispose(ctx) })   register a per-frame system (also push to ctx.systems)
ctx.addSnapshot(() => ({...}))            merge keys into the HUD snapshot (10 Hz)
```
Each gameplay module exports `installX(ctx)`; `Game.js` calls them in this order: customization, fares, routeGuide, workshop, voices
(a failing one is logged and skipped). Inside, create your objects, `ctx.addSystem(...)`, `ctx.addSnapshot(...)`, listen to events with `ctx.game.on(...)`.
Clean up everything in `dispose` (meshes: `scene.remove` + geometry/material `dispose`; listeners; timers).

## Event bus (type + payload). Add new ones freely, prefix with your area (`fare:`, `workshop:`, `voice:`)
Core: `honk`, `crash {strength 0..1.4, tag}`, `drift-start`, `drift-end {time}`, `boost-start`, `boost-end`, `launch`, `land {air, impact}`,
`wallet {wallet, delta, reason}`, `toast {text, tone, ms, icon}`, `menu {name|null, was}`, `loadout {loadout, preview:boolean}` (workshop -> customization: fit this look now).
Fares (fares agent defines the payloads in its code and doc comment): `fare:hail {customer}`, `fare:pickup {trip}`, `fare:dropoff {trip, fare, tip, rating}`, `fare:missed {customer}` ...

## Shared state shapes (the fares agent owns the real implementation)
```
ctx.fares = {
  waiting: [{ id, x, z, name, te, kind, patience (0..1, 1 = fresh), fareEstimate, voice? }],   live customers waiting by the road
  trip: null | { id, name, kind, from:{x,z}, dest:{x,z,name,te,poiId?,front:{x,z,edge,t}}, distanceTotal, distanceLeft, fareNow, fareEstimate,
                 timeLeft|null, pax:1..2, status:'riding'|'arrived' },
  target(): null | { type:'pickup'|'dropoff', id, x, z, name }       what the route/minimap should lead to (dropoff when riding, else the selected/nearest customer)
  select(id)                                                         the player picks which waiting customer to route to
}
ctx.route = { points: [{x,z}], length (m), eta (s), target }          (minimap agent) polyline along roads from the player to ctx.fares.target()
ctx.workshop = { isOpen, open(), close() }                           (workshop agent)
```
`findRoute(city, from, to) -> [{x,z}]` lives in `world/routing.js` (minimap agent) and is pure (unit-tested): A* over `city.nodes/edges`,
starting from the player's nearest road point, ending at the target's nearest road point.

## Snapshot (HUD data, ~10 Hz, passed to React as `snap`)
Core keys: `kmh, fuel (0..1), fuelLitres, hour, day, drifting, boosting, driftCharge (0..1), airborne, x, z, heading, paused, quality, menu,
wallet, rating, rides, totalEarned, session {earned, spent, fares, tips}, prompt {text,key}|null`.
Systems add more through `ctx.addSnapshot` (fares: `trip`, `waitingCount`; route: `route {length, eta}`; ...).
**Per-frame data (minimap player arrow, markers) must NOT go through the snapshot**: UI canvases read `game.ctx.v`, `game.ctx.fares`, `game.ctx.route` directly inside their own `requestAnimationFrame`.

## UI rules
- Components get `{ game, snap }`. Never import `Game.js`. Talk to the game only through `game.ctx` / `game.on` / `ctx.input`.
- Menus open with `ctx.openMenu(name)`; the full-screen React menu renders when `snap.menu === name`. Keyboard: `Esc` closes/pauses, `E` interact, `M` map, `Q` quests, `T` talk, `H` horn, `C` camera, `R` radio, `Space` handbrake, `Shift` boost.
- Everything must work with keyboard, gamepad and touch; touch targets >= 44 px; respect `prefers-reduced-motion`.

## Testing and screenshots
- Dev server: `npx vite --port <yourport> --strictPort` (start in the background, KILL it when you finish). Game URL: `http://127.0.0.1:<port>/play/autowala`.
- Headless screenshot tool (software GL, slow: ~2-4 fps, so use `__autowala.debug.step(seconds)` to fast-forward the simulation):
  `node <scratchpad>/shot.mjs <outDir> <vitePort> '<json steps>'` with env `CDP_PORT=<yourcdpport>` (unique per person!). Steps: `{name, cam:{x,y,z,yaw,pitch,fov}|null, hour, weather, teleport:[x,z,heading], eval:"js", wait:ms}`.
  Debug hooks on `window.__autowala`: `debug.cam/hour/teleport/weather/drive({throttle,steer,...})/step(sec)`, plus `ctx`, `world`, `vehicle`, `state`, `emit`.
  CDP-synthesised key presses do not reach the page; drive with `debug.drive`, or dispatch in-page: `window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'}))`.
- Before you report: your unit tests pass, `npx vite build` passes, the screenshots look right, the console shows no errors.

---
## Addendum: shops, metro, traffic, road rage, pause (second wave of agents)

### New ownership
```
world/       shops.js (+ world/shop-*.js), and the `paradise` section of landmarks.js   -- shops agent
             metro.js (+ world/metro-*.js)                                              -- metro agent
sim/         traffic.js (+ sim/traffic-*.js)                                            -- traffic agent
gameplay/    roadRage.js (+ gameplay/rage-*.js)                                         -- traffic agent
```
`world.js` already calls `buildShops` / `buildMetro` and exposes `world.shops`, `world.metro`; `Game.js` calls `installTraffic` and `installRoadRage`.

### Shops (`world.shops`)
`city.pois` entries with a `brand` ('paradise' | 'bawarchi' | 'delhi' | 'oyo') are blocks reserved for branded shopfronts (ids `paradise`, `paradise_old`,
`bawarchi_*`, `delhi_*`, `oyo_*`). `buildShops(...)` returns `{ shops, update(night, time), dispose() }` where each shop is
`{ id, brand, name, te, kind: 'restaurant'|'sweets'|'hotel'|'stall', x, z, front:{x,z,edge,t}, hail:{x,z} }` and `hail` is a valid pavement spot in front of it
where customers wait (the fares agent hails ~40% of its customers at shop fronts, so keep `hail` clear of colliders and roads). Also panipuri / chaat stalls on pavements.
Official logo image files are NOT bundled (trademarks). Wordmarks are drawn in code; if `public/art/brands/<brand>.png` (or .webp/.svg) exists it overrides the generated one.

### Metro (`world.metro`)
Hyderabad Metro: elevated viaduct on pillars (pillars sit on the road verge, never blocking the carriageway), station buildings with names, trains running on the line.
`buildMetro(...)` returns `{ lines: [{ id, name, color, points:[{x,z}] }], stations: [{ id, name, te, line, x, z, front:{x,z,edge,t} }], update(dt, time, night), dispose() }`.
Stations are POIs for the minimap (an "M" icon) and customers wait outside them (fares agent reads `world.metro.stations[].front`).

### Traffic and road rage
`ctx.traffic = { vehicles: [{ id, kind: 'car'|'bus'|'bike'|'auto'|'truck', x, z, heading, speed, mode: 'drive'|'chase'|'stopped' }], ... }` (read-only for others).
`ctx.rage = { active, heat (0..1), chasers (count), escape (0..1 progress toward being free), caughtIn (0..1 progress toward being caught) }`.
Events: `traffic:hit { kind, id, severity (0..1), speed, x, z }` (the player touched a vehicle or ped), `rage:start { chasers }`, `rage:escaped`, `rage:caught { fine, chasers }`.
Rules: hit a vehicle (or knock a pedestrian/cow) and the offended drivers (and neighbours) chase you with honking; get far enough away / out of sight for ~10 s and the rage ends with
NO fine; if chasers box you in / stay on you and you are held (speed ~0 or surrounded) for ~4 s you are CAUGHT: `economy.spend(min(fine, wallet))` and the active trip is penalised
(`ctx.fares.penalize({ fareMul: 0.7, mood: -0.25, reason })`, implemented by the fares agent). Snapshot key `rage: { active, heat, chasers, escape, caughtIn }` for the HUD.

### Pause screen
`ctx.openMenu('pause')` (HUD agent). A visible pause button on the HUD and `Esc`/`P`; GTA Vice City-style pause menu (see the HUD agent's brief).

---
## Addendum 3: the job, missions, rules, sound, weather (third wave)

Goal: make the work feel like a real Hyderabad auto driver's day, and the game more interesting to play.

### New ownership
```
gameplay/  career.js (+ career-*.js), ui/Hisaab.jsx (+ ui/career/*)        -- career agent
           fares.js, customers.js, fare-*.js (all existing fare files)     -- fares-realism agent (now owns them)
           quests.js (+ quest-*.js), ui/QuestLog.jsx (+ ui/quests/*)        -- quests agent (+ the BRIEF panel in ui/menus/PausePanels.jsx)
           rules.js (+ rule-*.js), world/signals.js                         -- rules agent (+ minimal signal obedience in sim/traffic-*.js)
           weather.js (+ weather-*.js, event-*.js), world/rain.js           -- weather agent
audio/     sound.js (+ audio/engine-*.js, ambience-*.js, radio-*.js), ui/Radio.jsx -- sound agent
```
`Game.js` installs, after the earlier systems: weather, career, rules, quests, sound.

### Contracts between them (all optional-safe: code defensively when another agent's piece is missing)
- `ctx.career` (career agent): `{ day, shiftActive, rent:{due, paid}, damage 0..1, fatigue 0..1, dayStats:{earned, tips, expenses:{cng, rent, repair, challan}}, goal, ladder, peak():{mult,label} }`; events `career:*` (`career:shift-start`, `career:shift-end {hisaab}`, `career:damage`, `career:repaired`, `career:tired`, `career:rested`); snapshot key `career`.
  Anything that costs money goes through `ctx.economy.spend` and tells career with `ctx.emit('expense', { kind, amount })` (kinds: cng, rent, repair, challan, fine, other) so the Hisaab can list it.
- `ctx.fares` stays as documented (fares-realism agent keeps the shapes and adds fields: `trip.terms {mode:'meter'|'fixed', fixedFare}`, `trip.shared`, `trip.surge`, `trip.luggage`, `trip.urgent`, `waiting[i].wants`). Events add `fare:bargain`, `fare:decline`, `fare:shared`, `fare:complain`.
- `ctx.quests` (quests agent): `{ active:{id,title,te,steps,stepIndex,timeLeft}|null, available:[...], done:[ids], accept(id), abandon(), board() }`; events `quest:offer|accept|step|complete|fail {id}`; snapshot key `quest`. Quest rewards pay through `ctx.economy.add(n,'quest','bonus')`. Quests make their OWN markers/passengers (use fare-markers.js / customers.js read-only); they never edit fares files.
- `ctx.rules` (rules agent): `{ signals[], cameras[], limitAt(x,z):kmh, violations[] }`; events `rule:violation {kind:'signal'|'speed'|'wrongside'|'checkpoint', fine, x, z}` and `rule:fined`; fines go through `ctx.economy.spend` (capped by the wallet) and `ctx.emit('expense', { kind:'challan', amount })`. Snapshot key `rules {limit, zone, signalAhead}`.
- `ctx.weather` (weather agent): `{ rain 0..1, event:{id,name,te,until}|null, wet 0..1 }`; it drives `ctx.state.weather` (0..1: sky, fog, wet roads already react), `ctx.state.gripMul` (rain makes it slippery) and `ctx.state.speedMul` if needed; events `weather:rain-start|rain-end`, `event:start|end {id}`; snapshot key `weather`.
- Sound (sound agent): reads `ctx.v`, `ctx.state.weather`, `ctx.clock`, `ctx.world.sky.state.night`; honours `audio:volume {master,fx,voice,music,muted}` events and `getAudio()` from audio/ctx.js (it may add buses there); radio state in snapshot key `radio {station, name, on}`; keyboard `R` cycles (use `game.input.pressed('radio')`).
- Time: a game day is 24 min (`DAY.secondsPerHour = 60`); shifts follow it: office rush 8-10 AM and 5-8 PM, night premium after 10 PM, the shift runs until the player clocks out or the day ends (the HUD agent's clock-out flow calls `ctx.career.endShift()` if present).

### Driving surface and guardrails (changed after wave 2)
- The auto drives on roads AND pavements. A pavement slab is a 0.2 m step: `world.heightAt(x, z)` (`world/boundaries.js` `createSlabIndex`) and the vehicle eases `y` onto it.
- Only solids stop the auto: buildings, landmarks, metro pillars, trees, lamp posts (`prop`) and the lake edge. They are guardrails: the auto stops and slides along them, with no bounce and no damage.
- Such contacts are reported as `{ type: 'crash', strength, tag, guard: true }`. Systems must treat `guard: true` as soft (HUD: no red flash; fares: a small mood jolt, not counted as a crash; voices: silent; career damage and rules fines: ignore). Real crashes (traffic, rage rams) have no `guard`.
- `colliders.drivable(x, z)` = not inside a solid and not in the lake. `colliders.inside(x, z, pad)` is for placement checks.

### Wave 3 integration notes
- The job widget moved: `ui/hud/JobChip.jsx` (replaces the old one in `Hisaab.jsx`); rules readouts are in `ui/hud/RulesStrip.jsx`.
- Voices connect to the `voice` bus and horns to the `fx` bus of `audio/sound-bus.js` (`getBuses()`); both fall back to the master gain.
- `<FareChoice/>` is mounted in `AutowalaGame.jsx`. The workshop has a Repair action that calls `ctx.career.repairCost()` / `repair()`.
- Not done: wrong-way and no-entry streets, crossing notes, local (stadium-only) match traffic, visible dents on the auto, traffic-horn routing through the `fx` bus.

---
## Addendum 4: draw-call budget of the actors (perf overhaul, aw-gpu-actors)

Draw calls, not triangles, are what the frame costs on an integrated GPU (~50 us each), so the people and the player's auto are built to be few calls:
- **Customers** (`gameplay/customers.js createRig`, `sim/person-mesh.js`): a waiting customer (one or two people and a suitcase) is ONE `SkinnedMesh` = one camera-pass call and one shadow-pass call, and every customer shares one vertex-coloured material.
  `rig.userData.persons[i]` is the person's root `Bone` (`.position.y` bounces) and `.userData.{lArm,rArm,lLeg,rLeg}` are `Bone`s with the same rest positions the old limb meshes had, so the pose functions animate them with the same `.position` / `.rotation` writes. Anything new that poses a customer keeps using those handles (do not look for `torso` / `head` / `mats`: they are not separate objects any more).
  Disposing the rig's geometry frees its skeleton; the shared material is never disposed. The rig is moved / rotated as a whole (it is the mesh).
- **The player's auto** (`sim/autoModel.js`): every static part is merged per material (paint, chrome, matte (vertex colours), seat, roof, curtains, lamps...). Only the tub, the roof and the driver cast shadows; bolt-on props from the workshop never do (`customize.js mountProp`). The high canopy no longer moves nodes for the posts / header / rear panel: `ud.canopyGeometry(on)` swaps the merged meshes to a second bake (`sim/auto-canopy.js`).
  Contract changes: `userData.wheels` and `wheelParts` have TWO entries (the front wheel, and both rear wheels as one pair: they always spin together); `userData.posts` / `header` are gone; `plateRearM === plateFrontM`; `stripes.left === stripes.right` (one mesh, toggling either shows both), same for `swish`; the driver / riders are one mesh each (`userData.mats.shirt.color.set(...)` still recolours them).
- Budget (asserted in `sim/auto-budget.test.js`): default rig <= 27 draw calls and <= 3 shadow casters, fully customised <= 64 calls and <= 3 casters.

---
## Addendum 5: the render pipeline and what keeps it cheap (perf overhaul, aw-gpu)

The frame is bound by DRAW CALLS (a call is ~50 us of CPU through the browser and the driver), not triangles or pixels: a box city of ~700k triangles is nothing for an integrated GPU. Rules for anything that draws:
- **Few, big calls.** Static things are baked: `render/merge-static.js` (`mergeStaticMeshes` per model, `freezeMatrices`), instance sets are split by map tile (`render/chunks.js`, tile size is a tier setting `QUALITY[q].chunk`, set by `createRenderer` BEFORE the world is built). One facade material for every building look (`BUILDING_LOOKS`, per-instance `aLook`), one atlas for the shop signs, one instanced draw for the clouds.
- **The light count never changes while playing.** three compiles a program per light count: the lamp point lights stay visible with intensity 0 by day (`world/props.js`); do not add / remove / toggle a `Light` or switch `receiveShadow` / `castShadow` on a live mesh. New lights belong in the scene at load.
- **Pipeline** (`render/renderer.js`, `render/post.js`): scene -> R11G11B10F target (RGBA16F / RGBA8 fallbacks), no MSAA -> dual-Kawase bloom (<= 1/4 resolution) -> ONE composite (FXAA-lite + bloom + ACES 0.95 + sRGB + dither). The loading step compiles with a render target bound (programs depend on it) and draws the whole scene once into a 16 x 9 target, so buffers, textures and shadow-depth programs are ready before the first frame.
- **Quality is decided by the shared governor** (`platform/gfx`, wired in `game/Game.js` + `game/gfx-control.js`; there is no frame-time sampler in the renderer any more). Start tier and scale: the player's choice (`settings.quality`), else tier memory (`jalebi.gfx.v1.autowala`, written after 8 s of stable play, not from the start screen), else a ~250 ms calibration behind the loading bar (`GFX.models`, fitted to measured frame times), else the GPU class (an integrated GPU never starts on high). The pipeline is allocated ONCE for the highest tier the session may reach (`render/quality.js` `allocRatio`); a tier is a share of it (`tierScale`), so neither a tier step nor a scale step reallocates anything. A tier step builds the new tier's light set in the background first and swaps on a frame boundary (`game/tier-switch.js`). The governor is fed the game's own JS time (outside `gfx.render`), so the resolution is tried first and a draw-call-bound tier is left through the "resolution did not help" verdict; the scale floor of such a tier becomes 1 (`createScaleFloors`). Knobs: `gfx.setQuality(tier|null)` (the Graphics setting, live), `gfx.setTier(q)`, `gfx.setScale(0.5..1)` (free), `gfx.scale` (the governor's), `gfx.renderScale` (the share of the allocation actually drawn), `gfx.maxQuality`, `gfx.cost`, `gfx.setBloomThreshold(t)`, `gfx.autoTier = false` (probes: the game ignores the governor), `gfx.invalidateShadows()`. `game.adaptive` = `{ aq, gpu, calibration, governor, loop, timer, switcher, describe(), recalibrate() }`; `game.perf.report().hitches` counts frames over 33 / 50 / 100 ms since 3 s after START. The sun's shadow map is re-rendered every `QUALITY[q].shadowInterval` seconds, its box snapped to the texel grid (`render/shadow-grid.js`).
- Measure with `scripts/perf/aw-probe.mjs` (`--cmd suite|bench|draws|gpu|programs|tour|shots`, see its header and `docs/perf/aw-gpu.md`).
