# Mobile board camera

On a phone the board is 330-410 px wide, so a tile is 30-38 px and a place name prints at 6.5-8 px. The camera is
what makes the game readable there: it follows the pawn, holds on the tile you landed on, and lets you pinch, drag and
double-tap. It replaces the old 1.07x "lean" (`.fx-cam`).

Code: `src/components/game/fx/`

| file | what |
| --- | --- |
| `CameraFocus.jsx` | `BoardCamera` (still exported as the default of `CameraFocus.jsx`, `Board.jsx` imports it): the wrapper, the wiring |
| `cameraPolicy.js` | the AUTO policy: `situationOf`, `cameraDirective`, `createDirector` (pure) |
| `cameraMath.js` | camera maths: fit, clamp, focus, pinch, pan, double tap, follow (pure) |
| `cameraController.js` | the engine: critically damped spring, drag, inertia, one transform written from `requestAnimationFrame` |
| `useBoardGestures.js` | `createGestureMachine` (pure state machine) and the Pointer Events hook |
| `CameraHud.jsx`, `cameraHudModel.js` | the HUD (who is moving, zoom out / in / whole board, live region) |
| `src/styles/camera.css` | viewport, layer, HUD |

## Scope

The camera exists only when the board is narrow: `<= 520 px` wide, the same width as the container query that prints the
short tile names (`@container (max-width: 520px)` in `board.css`). Measured with a `ResizeObserver` on the viewport.

On wider boards (desktop, tablets) the wrapper is a plain `position: absolute; inset: 0` box with no data attributes beyond
`data-camera="off"`, no transform, no listeners, no HUD, no tab stop. Desktop is unchanged (checked: the `.bc` markup is
identical with the setting on `auto` and `off`, and nothing moves during a whole turn at 1404x863).

## One transform, two layers

```
.hb-board                      (container, overflow: clip)
  .bc                          viewport = the board's box; touch-action: none (only here); focusable
    .bc-layer                  transform: translate(tx, ty) scale(s); origin 0 0   <- the only thing that moves
      .hb-frame ...            the board, unchanged
    .bc-hud                    overlay above the zoomed content, never scaled
```

* The camera is `{ s, cx, cy }`: the scale and the board point (fractions of the board) in the middle of the view.
  Parametrising by the centre, not by the translation, keeps the focused point put while the scale grows. The window
  can only travel `0.5/s .. 1 - 0.5/s`, which is what keeps the board's edge out of the frame at every moment
  (tested at the four corner tiles START / Traffic Jam / Chai Adda / Municipal and the middle of every edge, at every
  scale the auto camera uses).
* Every frame is an imperative style write from `requestAnimationFrame`. React only gets coarse flags (zoomed or not, the
  HUD line, the live-region text). Moving costs no layout: in a measured turn the camera added 1 layout and ~9 style
  recalculations over 7 s, the same frame times as with the camera off.
* While the content is scaled, `.bc[data-lens]` clips tightly (`overflow: clip` + the frame's rounded radius,
  `isolation: isolate` for WebKit), so zoomed tiles never spill over the players or the dock. At rest it clips nothing,
  so the board looks exactly as before.
* While moving the layer is `translate3d` + `will-change: transform` (one compositor layer). When it settles it becomes a
  plain `translate()` on whole device pixels with no `will-change`, so the text is rasterised crisp at the new scale.
* The deed, the pawns, coin flights and the odds overlay all live inside the layer; hit testing goes through the
  transform natively (a tap on a zoomed tile opens that tile's deed: verified). Coin flights measure with
  `getBoundingClientRect`; an endpoint inside the zoomed board (the bank in the middle) is clipped to the visible part of
  the viewport (`visibleRect` in `FxLayer.jsx`), so coins never fly to a point outside the board. Speech bubbles anchor to
  the player pods, which are outside the camera.

## The automatic camera: policy table

`situationOf(session)` reads what the session already exposes (`display.moving`, `display.landing`,
`display.players[].pos / motion`, `view.pending`, `options`, `busy`, `rolling`, `card`, `handoff`, `bubble.type`,
`view.phase`); `cameraDirective(sit)` maps it to a shot; the first matching row wins.

| # | Situation | Camera | Why |
| --- | --- | --- | --- |
| 1 | Setting `off`, or board wider than 520 px | nothing, no gestures, no HUD | desktop tiles are legible already; `off` is an opt-out |
| 2 | Setting `manual` | auto never moves; pinch, drag, double tap, HUD work | "I want to drive" |
| 3 | Reduced motion (OS, hub / in-game switch, `[data-motion='reduced']`, `.hg-game[data-rm]`) | auto camera off. Manual zoom works, instantly: no spring, no inertia | no unrequested motion |
| 4 | Card reveal, turn banner, auction, trade, debt, city event, game over | overview (1x) | these live in the middle of the board or are about all of it |
| 5 | Die tumbling, the number sinking in, my turn waiting for Roll, anybody's idle wait | overview | the die and the centre panel must stay visible; nothing is changing on the board |
| 6 | A pawn is walking (dice settled -> steps) | FOLLOW 1.8x on the pawn | tiles ~65 px, names readable; the pawn is kept in the middle third (a dead zone: the view only re-centres once the pawn leaves it) |
| 6b | the same, trip > LONG_TRIP (12) squares | 1.4x | keeps orientation on a long card trip |
| 7 | Teleport, Auto / Metro / MMTS ride | PAN straight to the destination (1.8x, 1.4x if long) | the pawn skims or flies; following every tile would whip |
| 8 | Just landed | HOLD 2.2x on that tile for `ANIM_MS.land` (x0.7 for other players, as the presenter trims it) + 450 ms | it is the moment the deed matters; the hold is sticky: the presenter drops its landing flag after its own 700 ms beat, which is shorter than reading a name |
| 9 | My buy prompt, landscape phone (the prompt is in the dock) | stay framed on the tile at 2.0x; after Buy / Pass keep the frame 900 ms (the purchase stamp), then overview | name and price readable while deciding |
| 9b | My buy prompt, portrait phone table (the `BuyCard` is a card over the board, `PhoneBoardContext`) | no framing | the card already carries the name and price; zooming behind its scrim would only move what the player cannot see |
| 10 | Upgrades, mortgages, trades offered, chat, a log line, a wait | overview | no single tile to look at / nothing changed on the board: never zoom for it |
| 11 | Other players' routine moves | same shots as 6-8, shorter holds (`QUICK` pacing) | you still see what happened without being whipsawed |

Never more than 2.4x automatically; the user can go to 3x.

### Time rules (anti-nausea), in `createDirector`

* **Debounce**: at most one change of shot per 250 ms. Tracking a walking pawn is one shot, not a change per step.
* **Minimum hold**: a zoomed shot lasts at least 500 ms before the camera goes back out.
* **Grace**: the presenter drops `moving` one render before it raises `landing`; a pawn that has just stopped stays the shot
  for 220 ms, so there is no trip out and back in between walking and landing.
* **Ease**: critically damped spring (`smoothDamp`, no overshoot), zoom smoothed in log space. Smoothing times at
  speed 1: follow 0.26 s, land / decision 0.30 s, pan 0.40 s, back to overview 0.40 s (the zoom-in is a quick start with a
  long tail, the zoom-out starts soft: ease-out in, ease-in-out back). `playbackSpeed` (0.75..2) divides every hold and
  every smoothing time, like the other animations.
* Frame steps are capped at 250 ms, so a slow phone plays the glide in real time instead of in slow motion.

## Manual control

| gesture | result |
| --- | --- |
| two pointers | pinch zoom about the pinch midpoint, 1x..3x; moving both fingers pans as well |
| one finger, board zoomed | pan, clamped to the board's edge; a flick coasts on (exponential decay, 0.32 s) |
| one finger, board not zoomed | a vertical drag is handed to the scrolling ancestor (`touch-action: none` on the frame would otherwise swallow it) |
| quick tap (< 8 px, < 300 ms) | not a gesture: the browser's click reaches the tile and opens its deed |
| double tap | whole board -> 2.2x centred on the tapped point; zoomed -> back to the whole board |
| ctrl + wheel / trackpad pinch | zoom about the cursor (desktop emulation); the wheel pans a zoomed board |
| keyboard (board focused) | `+` `-` zoom steps (1, 1.6, 2.2, 3), arrows pan, `0` shows the whole board |

* Pointer Events with `setPointerCapture` once a drag passes the 8 px slop (so a tap still reaches the tile, which a capture
  from the first touch would redirect). `pointercancel` aborts without coasting; a third finger is ignored; a pinch that
  ends with one finger down continues as a pan.
* **Double tap vs the deed.** A single tap on a tile opens a sheet that would eat the second tap, so a tile's click is held
  back for the 260 ms double-tap window and replayed (a synthetic click on the same tile) unless a second tap follows.
  Measured: a single tap opens the deed about 420-500 ms after touchend (260 ms window plus the sheet's own animation).
  Keyboard activation (`detail === 0`), buttons and the HUD are not delayed.
* **iOS Safari**: `touch-action: none` on the frame, non-passive `touchstart` / `touchmove` that `preventDefault` for two
  touches or while a pan / pinch is active, and `gesturestart` / `gesturechange` handlers that `preventDefault`, so the
  page never zooms from a pinch on the board. The viewport keeps `user-scalable` on, so everything else can still be
  zoomed for accessibility.
* `touch-action: none` is on `.bc` only (verified: it is the only element on the page with it).
* **Pause**: any manual gesture, a HUD button or a key pauses the auto camera until **Fit**, the **turn changes**, or **8 s
  without a touch**; then it resumes from where you left the view, back towards the policy. After **Fit** during a shot
  the camera stays out for the rest of that sequence (no zoom straight back in).
* Pinching out to (almost) 1x snaps to the whole board.

## HUD

Appears only while zoomed (auto or manual): a pill with the turn player's avatar token and one short line
(`Sana is moving…`, `You are moving…`, `Landed on Madhapur`, `Buy Madhapur?`, `Sana is rolling…`, `Your turn`,
`Sana's turn`), because the die and the status in the middle of the board scroll out of view. Three buttons, each a
44x44 tap target (36 px visible disc): Zoom out, Zoom in, Show whole board (greyed at the ends). It docks to the top and
moves to the bottom edge when the action is in the top 30% of the view, so it does not sit on the pawn.

Accessibility: the buttons are the keyboard / screen-reader alternative to pinch (real `<button>`s with `aria-label`s,
focus visible, hidden from the tab order while the HUD is hidden). A polite live region says `Zoomed in on Madhapur` (a
hold, pan or decision) / `Zoomed in` (tracking a pawn) / `Board overview` when the zoomed state flips, never per frame.
The board frame is focusable with an `aria-label` that lists the keys. Text is 13 px bold, white on `rgba(10,14,32,.88)`
(AA). The board sits inside the game frame's safe-area padding, so the HUD needs none of its own.

## Setting

`settings.boardCamera` in `src/lib/storage.js`: `'auto'` (default) | `'manual'` | `'off'`. Hub: Profile > Settings > "Board
camera on phones" (`SettingsSection.jsx`); in game: Menu > Playback > "Board zoom (phones)". Anything else falls back to
`auto`.

## Interaction with other parts

* `FxLayer.jsx` clips board-inside coin endpoints to the camera viewport (`visibleRect`).
* `PhoneBoardContext` (the portrait phone table) tells the camera the buy prompt is a card (policy row 9b).
* The retired `.fx-cam` rules are gone from `fx.css`; the camera's CSS is `camera.css`.

## What was verified, and how

Unit tests (`npm test`): `cameraMath`, `cameraPolicy` (every table row, debounce, minimum hold, grace, tail, reduced motion,
long trips, modes), `cameraController` (spring, no overshoot, edge never exposed on the way, drag coalescing, inertia),
gesture machine, HUD markup / ARIA, the storage setting, `visibleRect`.

Real runs with Playwright against a mock table built on the real engine and the real presenter, and against the local
two-guest stack: Pixel 7 (Chromium, real multi-touch through CDP), iPhone 13 (WebKit, real touch taps, synthetic Pointer
Events for the two-finger gestures), 360x740, 844x390 landscape, 1404x863 desktop; reduced motion by OS and by switch;
`manual` and `off`.

Not verified: the feel of a real pinch on an iPhone, real Android GPU rasterisation, a notch in landscape (Playwright does not
emulate safe-area insets).
