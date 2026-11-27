# Landscape gate: Autowala and Tiffin Centre are landscape games on touch devices

Owner requirement (2026-11-27): the two 3D games must be played in horizontal orientation on phones and tablets, so the controls are usable. This stream builds the shared mechanism; the UI streams design the in-game layouts for landscape.

Branch `perf/landscape`. Code: `src/platform/game/orientation*`, `OrientationGate.jsx`, `useOrientationPolicy.js`. Proof script: `scripts/perf/landscape-proof.mjs`. Screenshots: `docs/perf/landscape/`.

## What the player sees

| Device | State | What happens |
|---|---|---|
| Phone or tablet (a finger is the main pointer), window taller than wide | upright | A full-screen "Turn your phone sideways" screen (English and Telugu, an animated phone, "Back to the game page", and on Android Chrome "Tap to play in landscape") covers the game. The game stays mounted but hidden and `inert`, its render loop and sound are stopped. |
| The same device, window wider than tall | sideways | No gate. The game runs. The moment the viewport turns landscape the screen is removed and the loop restarts, with no reload and no lost state. |
| Desktop, laptop, Chromebook (a mouse is the main pointer) | any | Never gated, even in a narrow, tall window. The gate is not mounted as DOM beyond a `display: contents` wrapper. |
| Any device | the game's page `/games/:id` | Normal page, with a generic "Best played in landscape" chip and an "Orientation: Landscape on phones and tablets" row in Details. |

## Design

```
manifest.orientation = 'landscape'
        |
pages/SoloGame.jsx, pages/OnlineGame.jsx  ->  <ManifestOrientationGate game backTo>      (no field: no wrapper at all)
        |
OrientationGate  =  useOrientationPolicy(policy)  +  OrientationContext { paused, gated, policy }  +  <TurnScreen>
        |                         |
        |                 orientationController.js   reads window, debounces, publishes a snapshot (useSyncExternalStore)
        |                 orientationPolicy.js       PURE: shouldGate, resolvePortrait, windowShape, detectKeyboard
        |                 orientationLock.js         fullscreen + screen.orientation.lock bookkeeping (via src/lib/mobile.js)
        |
game screen: useGamePaused()  ->  stops its rAF loop and its audio        (Autowala: ui/useOrientationHold.js, Tiffin: TiffinGameImpl.jsx)
```

### The decision (`orientationPolicy.js`, pure, unit-tested)

`shouldGate({ policy, coarse, viewport: {w, h}, portrait, keyboardOpen, prevPortrait })`

- `policy` `'any'` (or unknown, or missing) never gates. `'landscape'` gates a touch device that is portrait; `'portrait'` is the mirror image.
- `coarse` is `isCoarsePointer()` from `src/lib/mobile.js` (`(pointer: coarse)`, or `any-pointer: coarse` with no fine pointer). A mouse-first device is never gated, whatever its window shape. A touch laptop whose primary pointer is a mouse is also left alone.
- Shape comes from the **layout viewport** (`innerWidth` x `innerHeight`), not from the device: split-screen and small windows are cramped by the window, so the window decides. A device in landscape with a tall, narrow split-screen window is gated; a portrait device with a short, wide strip is not.
- **Hysteresis**: a window within 8% of square keeps the previous decision (foldables, a split-screen divider being dragged, a collapsing toolbar never flicker the gate).
- **Virtual keyboard**: when a text field has focus and the visible height fell by at least 120 px and 15% since the width last changed, the keyboard is "open". While it is, the window shape is ignored (the keyboard eats height, so a portrait phone with the keyboard up can look wider than tall) and the device's own reading (`screen.orientation.type`, `window.orientation` on old iOS) or the previous decision is used. Typing never un-gates a phone held upright. A collapsing browser toolbar (about 70 px, nothing focused) is not a keyboard.

### The controller (`orientationController.js`)

- `orientationchange`, `resize`, `pageshow`, `visualViewport` resize, `screen.orientation` change, the `(orientation: portrait)` media query and `focusin` / `focusout` all re-read the window.
- **Un-gating is applied at once** (the first reading that says "sideways"), so the game resumes in the same task as the resize event. **Gating waits for the next animation frame** (browsers run the resize steps, then the animation-frame callbacks, then ResizeObserver and paint, so the screen is committed before the player ever sees the game stretched to the new shape; the events of one rotation land in one frame and are read once), with a 40 ms timer (`SETTLE_MS`) as the fallback where there is no frame (a hidden tab) and a late re-read at 320 ms (`LATE_MS`). iOS handing out stale sizes in `orientationchange` is corrected by the `resize` that follows.
- The snapshot has no sizes in it, so a desktop window being dragged re-renders nothing.
- Listeners attach with the first subscriber and all of them (and the timers) are removed with the last.

### The frame freeze (`orientationFreeze.js`)

A game stops its own loop with `useGamePaused()`, but a screen is full of other loops nobody pauses. Measured on Autowala, upright and "paused" **before** the freeze: 280 animation-frame callbacks a second (the minimap and a second HUD loop) and about a fifth of a core. So, once the game has been on screen, the gate also freezes the page's `requestAnimationFrame` while it is up: a requested callback is queued (negative ids), the callbacks the browser already had scheduled run once more and queue themselves, and the queue is replayed through the real scheduler on the first landscape frame. `cancelAnimationFrame` works on queued ids, on ids already replayed, and on ordinary ids. It is installed lazily by the first freeze (never on desktop) and it engages **at once for a game that has been on screen** but only after a **6 s grace period (`FREEZE_GRACE_MS`) for a game opened upright**: that game keeps loading behind the screen (Autowala's world build yields through `requestAnimationFrame`), so it is ready when the phone has been turned, and a phone left resting on the screen still goes quiet. Every CSS animation under the gate is also stood still (`animation-play-state: paused`): measured on Autowala, a hidden HUD's glow loops alone kept the main thread at 120 to 150 ms of tasks a second behind the screen; with them paused it is 2.4 ms. Opt out with `<OrientationGate freezeFrames={false}>` / `useOrientationPolicy(p, { freezeFrames: false })`. It cannot reach callbacks scheduled through a reference a library captured before the patch, nor timers (`setInterval`): those are the game's to pause with `useGamePaused()`.

### The lock (`orientationLock.js`, `useOrientationPolicy`)

On a touch device with a `landscape` policy, the **first tap, key press or click** after the game screen opens asks once for fullscreen and `screen.orientation.lock('landscape')` (Android Chrome and Firefox for Android: a user gesture and fullscreen are required). The gate's "Tap to play in landscape" button does the same on demand, and shows only where the browser has a `lock` method and a way into fullscreen. When the player leaves the screen the lock is released, and the fullscreen is exited only if this module entered it (the game's own fullscreen toggle is left alone). A refused fullscreen or lock is swallowed: the gate screen still works.

While the screen is up on a touch device the page's own gestures are off through `lockGestures(document.documentElement)` from `src/lib/mobile.js` (not a copy of it): pinch zoom, double-tap zoom, pull-to-refresh (`overscroll-behavior: none`), the long-press menu. Everything is restored on leave.

### What the gate looks like in CSS (`orientation.css`)

- `position: fixed; height: 100vh; height: 100dvh` (the visible height on a phone with a collapsing toolbar), padded by `max(16px, env(safe-area-inset-*))` on all four sides, scrollable in a tiny window so the buttons are always reachable.
- 56 px and 52 px buttons (44 px minimum), 16 px base gutters, `text-wrap: balance`.
- The phone icon turns on the compositor (a plain `transform: rotate()` on an HTML box, no paint per frame), four times (about 14 s), then rests on its side. Under `prefers-reduced-motion` or the hub's own `html[data-motion='reduced']` switch nothing moves and the phone is already on its side.
- Dressed in the game's manifest theme (`--g-accent`, `--g-accent-2`, `--g-bg`).
- The wrapper `.og-game` has `display: contents` (no box: a game root that is `position: fixed; inset: 0` lays out as before) and exports `--og-safe-top|right|bottom|left` (the safe-area insets) to the game.

## How a new game opts in

1. Manifest: `orientation: 'landscape'` (or `'portrait'`). Nothing else is needed for the hub: the solo page and the online page wrap the game screen, the game page prints the chip.
2. In the game screen: `const paused = useGamePaused()` (from `@/platform/game/orientationContext.js`, a React-only module) and stop the render loop and the audio while it is true, start them again when it drops. Do not restart from an effect cleanup (that also runs on unmount). Outside a gate (desktop, no field) it is always false.
3. Design for landscape first and delete your own "rotate your phone" hint. See `docs/ADDING_A_GAME.md` section 11.

## What cannot work on iOS (and what we do instead)

- iOS Safari has **no `screen.orientation.lock`** and, on iPhone, **no fullscreen for a page**. The app cannot rotate the phone or pin it. The gate screen is the whole solution there: "turn your phone sideways", and a line about the rotation lock ("Screen rotation locked? Switch it off in your quick settings.").
- iPad Safari has fullscreen but no lock, so no "Tap to play in landscape" button is shown (it would do nothing useful).
- The gate cannot know about iOS rotation lock being on except by the phone staying upright. The hint line covers it.
- iOS may report stale sizes in `orientationchange`; the controller re-reads on `resize`, at 40 ms and at 320 ms.
- The wake lock, haptics and fullscreen toggles remain the games' own (`src/lib/mobile.js`).

## Hooks into other owners' files (small, listed)

| File | Change |
|---|---|
| `src/games/autowala/manifest.js`, `src/games/tiffin-centre/manifest.js` | one line each: `orientation: 'landscape'` |
| `src/games/autowala/AutowalaGame.jsx` | 2 lines: import and call `useOrientationHold(game)` |
| `src/games/autowala/ui/useOrientationHold.js` (new) | stops `game.stop()` / `game.start()` and holds the shared sound (mute + `AudioContext.suspend`, the player's own mute choice restored) |
| `src/games/tiffin-centre/TiffinGameImpl.jsx` | `useGamePaused()`; scene `stop()` / `start()`; ambience and speech off; effects muted (player's mute choice kept); a local shift's clock held through the existing `hold()` / `gated` path, released two frames after landscape |
| `src/pages/SoloGame.jsx`, `src/pages/OnlineGame.jsx` | wrap the game screen in `ManifestOrientationGate` |
| `src/pages/GameDetail.jsx`, `src/platform/game/GameHero.jsx`, `src/platform/game/detailModel.js` | the generic "Best played in landscape" chip and Details row |
| `src/games/registry.test.js`, `src/games/autowala/autowala.test.js`, `src/games/tiffin-centre/manifest.test.js` | the field is validated |
| `docs/ADDING_A_GAME.md` (section 11), `docs/MARKETPLACE.md` (field table) | the field is documented |

## Proof: a real Chrome, emulating the devices

`node scripts/perf/landscape-proof.mjs` (production build served by `vite preview`, headless Chrome on the dev laptop's integrated AMD GPU with vsync on, the bench lock held). Device emulation: `Emulation.setDeviceMetricsOverride` with `mobile: true` and `screenOrientation`, touch emulation (`(pointer: coarse)` matches, `(pointer: fine)` does not) and a mobile user agent. The loop is measured by counting `requestAnimationFrame` callbacks the page runs (a patched rAF, with the heaviest callbacks by source), the renderer's own `info.render.frame`, `Performance.getMetrics` script time, and renderer / GPU **process** CPU from `SystemInfo.getProcessInfo`.

### The gate shows, and the game really stops

Autowala (390x844 held upright after the game has been playing; the auto was driving at 60 km/h when the phone was turned):

| state | rAF callbacks / s | renderer frames / s | script ms / s | renderer proc CPU | GPU proc CPU |
|---|---|---|---|---|---|
| playing, 844x390 | 106 to 126 (3 loops) | 71 to 84 | 400 to 810 | 43 to 58 % | 47 to 101 % |
| upright, the game's own loop stopped only (first version, before the freeze) | 283 (the HUD's two loops) | 0 | 103 | 33 % | 25 % |
| **upright, final** (3.5 s after turning, the gate icon turning) | **0** | **0** | **0.4** | **4.3 %** | **6.6 %** |
| **upright, final, reduced motion** | **0** | **0** | 1.0 | **1.1 %** | **0.2 %** |
| opened upright, 9 s after the load (frozen) | 0 | 0 | 0 | 10 % (one-off settle) | 1.3 % |
| tablet 820x1180 upright | 0 | 0 | 0.4 | 5.8 % | 16 % (gate raster at 2x, first second) |

The auto stood still while paused (`x` 228.6 at the start and 228.6 two seconds later) and carried on from the same place after the phone was turned back. Tiffin Centre, turned upright mid-shift: 0 rAF callbacks, 0 frames, 0.1 ms/s of script, renderer 4.5 %, GPU 5 %; `session.status` went `playing` -> `paused` and the effects were muted (`audio.isMuted()` true); turned back: `playing`, `isMuted()` false.

### Turning is fast

| transition | what was timed | result |
|---|---|---|
| upright -> sideways (resume) | resize event to the first renderer frame (the gate was already gone when the resize event arrived: `screen.orientation` fires its change first) | 9 and 64 ms (Autowala), 20 ms (Tiffin): always inside the first animation frame |
| sideways -> upright (pause) | resize event to the gate in the DOM | 57 to 98 ms (Autowala), 92 ms (Tiffin): two animation frames. Before gating moved into the animation frame it was 77 ms and 1,194 ms (Tiffin's own render-target resize ran first) |
| first resume of a game that was OPENED upright | resize event to the first frame | 1.4 s to 4.5 s on this shared GPU. Only one frame was ever drawn before the pause, so this is the game's cold first real frame (new render targets, first draws) happening at the moment of the turn. The gate itself resumes in one frame; the cold-frame cost belongs to the games' start-up work (shader warm-up) |

### Desktop is never gated

1280x800 (mouse, no touch): `data-og="live"`, no gate, the page's `touch-action` stays `auto`, Autowala and Tiffin run. A 600x900 desktop window without touch (narrow and tall): the same. The unit tests add a 390x844 window without touch.

### Safe areas, scrolling, pull-to-refresh

With the screen up on a touch device the page reports `touch-action: none` and `overscroll-behavior-y: none` on `<html>` (from `lockGestures`); on desktop it stays `auto` (not locked). The CSS uses `100dvh` and `max(16px, env(safe-area-inset-*))` on all four sides. Chrome's emulation cannot supply a notch, so the inset values were not exercised on a real notch (see below).

## Screenshots (`docs/perf/landscape/`, all viewed)

| file | what it shows |
|---|---|
| `autowala-gate-portrait-390x844.jpg` | the gate on a 390x844 phone held upright (Autowala colours, the turning phone caught mid-turn, English and Telugu, "Tap to play in landscape", "Back to the game page", the rotation-lock hint) |
| `autowala-gate-tablet-820x1180.jpg` | the same screen on a portrait tablet (the phone has come to rest on its side) |
| `autowala-landscape-844x390.jpg` | the same phone turned: the game, no gate. The in-game layout is the UI stream's work; this is today's HUD |
| `autowala-desktop-1280x800.jpg` | desktop: the game untouched |
| `tiffin-gate-portrait-390x844.jpg` | Tiffin Centre's gate (saffron theme) |
| `tiffin-landscape-844x390.jpg` | Tiffin Centre turned sideways, tutorial running |
| `hub-game-page-chip-1280x800.jpg` | the game page: "Live, 1 player, 10-30 min, Best played in landscape" |

## Device matrix

| Device | How it was tested | Result |
|---|---|---|
| iPhone 14 portrait 390x844 / landscape 844x390 / landscape with Safari toolbar 844x340, iPhone SE landscape 667x375 | unit tests (`shouldGate`, controller with a fake window); Chrome emulation 390x844 and 844x390 with an iPhone user agent (Tiffin) | gated upright, plays sideways |
| Pixel 7 portrait 412x915 / landscape 915x412 | unit tests; Chrome emulation 390x844 / 844x390 with an Android user agent (Autowala) | same |
| iPad 820x1180 / 1180x820 | unit tests; Chrome emulation 820x1180 with an iPad user agent | portrait gated, landscape plays |
| Galaxy Fold cover 344x754, inner 690x829 / 829x690 | unit tests only | gated in portrait; the near-square band keeps the last decision |
| Desktop 1280x800, a 600x900 window, a 390x844 window (no touch) | unit tests; Chrome at 1280x800 and 600x900 | never gated |
| Android with the keyboard open (412x400 layout, 915x180) | unit tests with a focused text field and a shrunk layout / visual viewport | a portrait phone stays gated, a landscape phone stays in landscape |
| Split screen (a 450x800 window on a landscape device, a 412x300 strip on a portrait one) | unit tests | the window decides |
| `orientationchange` / `resize` order, stale iOS sizes, a glitch inside one frame, listener and timer cleanup | unit tests with fake timers and a fake frame clock | no flicker, nothing left attached |
| fullscreen + lock sequence (enter, lock, release, refused, iPhone Safari with neither, iPad with fullscreen only, leaving mid-request) | unit tests with a fake `screen.orientation` | as designed |

## Not verified, and risks

- **No real device.** iOS Safari's rotation timing (stale sizes) and the Android Chrome fullscreen + `lock('landscape')` pin are covered by fakes and by what Chrome's emulation exposes (it has the `lock` method but cannot rotate a real screen). Safe-area insets on a real notch were not exercised. A Galaxy Fold was not tried.
- **First resume after opening upright** costs the game's cold first frame (above). It is not the gate's: a game that warms its shaders during start-up pays less.
- **An online Tiffin room keeps running while a player is upright.** The server owns the clock, so a player who turns the phone upright in the middle of a shift misses part of it (the screen stops, the sound stops, nothing is lost on their side). The lobby page (`/lobby/:code`) is a hub page and is not gated, so a player can press Start in portrait and land on the gate; the lobby should tell them to turn the phone first (not done: not in this stream's files).
- **No "play anyway" escape.** By the owner's requirement there is none; a device that cannot rotate (a stand-mounted tablet in portrait) cannot play. The rotation-lock hint is the only help.
- **The frame freeze cannot reach** callbacks scheduled through a reference a library captured before the first freeze, or `setInterval` timers: games pause those with `useGamePaused()`. A game opened upright keeps loading for 6 s (`FREEZE_GRACE_MS`) before its loops are frozen.
- The games' own portrait layouts and hints (`TouchControls` `RotateHint`, Tiffin `OrientationHint`) are still in the code. They are hidden under the gate; the UI streams remove them.
