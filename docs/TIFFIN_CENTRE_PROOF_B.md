# Tiffin Centre: operations proof B (first-person run in headless Chrome)

Build under test: `feat/tiffin-centre` @ 0dbeab9 (isolated worktree, dev server, headless Chrome + SwiftShader, 1280x800 desktop).
Evidence: `docs/tiffin-centre-proofs/final-b/` (40 JPEGs, each <= 120 KB, named `b-NN-...` for L3 and `b-L5-` / `b-L12-` for the event runs).

## How it was run (and what was forced)

- Real UI: practice levels were started from the SoloHome level cards (tutorial flag set in localStorage, progress seeded so cards 1-12 are open), then the briefing "Open the stall".
- Play: `session.dispatch` through the shared `chooseAutoAction` bot plus real clicks on HUD buttons (slot buttons, prep sheet, Swap, Mark sold out, board) and the real `T` key.
- Engine events (rain, power, cricket, festival, inspector, delivery, regulars, parcel/big customers) fired NATURALLY from the level plan. To reach them quickly the page's `performance.now` was scaled (3x fast-forward with the bot playing, 0.12-0.5x slow motion for shots, because SwiftShader takes 5-15 s per screenshot). Lives were pinned at 5 during the fast-forward so a weak bot did not end the shift before the events (hearts shown in those shots are therefore not meaningful).
- Forced state (direct edits of `session.state`, then the game ticked on its own): dosa batter stock = 0, tawa gunk/heat, gas units, some idly batter stock. Everything after the edit is the real engine and HUD.
- Console: ONLY SwiftShader / autoplay noise (expected) plus one `THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported` warning (expected on SwiftShader). Zero exceptions, zero unhandled rejections, zero `console.error` in all three runs (L3, L5, L12). Env note: the junctioned worktree needed `resolve.preserveSymlinks` in ITS vite config or fonts failed to decode ("OTS parsing error"); that is an isolation artefact, not a game bug.

## Pass / fail

| # | Check | Result | Evidence |
|---|---|---|---|
| a1 | Stock bars fall as customers are served; sour/low colours | PASS | b-01 |
| a2 | "Out of dosa batter": sheet reasons, red Out tile, "Mark sold out" offered | PASS | b-02 |
| a3 | Refusal toast "Out of dosa batter" when the cook picks the dish (real click) | PASS | b-03-l5 (toast text also read from DOM) |
| a4 | Prep sheet usage: stock meters, "+12 on the way", cost line, cost/profit move to -₹60 | PASS | b-04, b-05 |
| a5 | Cook turned ROUND to the back counter (head swings to the prep counter while the sheet is open) | PASS | b-04, b-05 |
| a6 | Batch ready then collected: slot shows ready tick, stock bar goes to 12 | PASS | b-07, b-08 |
| a7 | Market buy ("Buy 5 idly batter for ₹28", stock 1 to 6, toast) | PASS | b-19 |
| b1 | Tawa caked + cold: Wipe pulses, need 1.0 | PASS (state) / WEAK (visual) | b-09: the Wipe button is off-screen (dock scrolled); the pan itself does not look caked |
| b2 | Torn dish on a caked tawa (flaw "torn", cracked dosa art, "Torn" badge on the slot) | PASS | b-10 |
| b3 | Tend with the T key (need 1.0 to 0.05, Wipe greys out) | PASS | b-11 |
| c1 | Gas gauge low (19%) | PASS | b-12 |
| c2 | Gas-out: "No gas" red gauge, "Out of gas" toast, dish progress frozen (0 to 0 over 4 s) | PASS | b-13 |
| c3 | Swap cylinder mid-animation ("Changing 4s", ticks fill, camera turns to the stand, ₹90 charged, toast "New cylinder on") | PASS | b-14, b-15 |
| d1 | Mark a dish sold out: struck through, "Back on board", BOARD "1 off" | PASS | b-17 |
| d2 | Customers react: "Token 5 wanted Set Dosa: sold out and had Pesarattu instead" (seen in the real toast); a customer who cannot be served politely leaves | PASS | b-18 (toast in frame) |
| e1 | Rain: streaks, dark sky, banner "Rain 30s", rain-themed speech | PASS (partial) | b-L12-rain, -rain-up, -rain-road. Umbrellas and roof drips could NOT be identified in the frames; wet road is only a faint darkening |
| e2 | Power cut: candle lit on the counter, dim scene, "Power cut" chip, "no steamer, no grinder" | PASS | b-L5-power, b-L5-power-candle, b-L12-power* |
| e2b | Generator | N/A: there is no generator model in the scene or catalogue (burners keep running by design) | |
| e3 | Cricket night: banner + burst crowd + cricket speech ("SRH is playing today") | PASS | b-L12-cricket |
| e3b | Cricket TV on screen | NOT VERIFIED: `lookAt` did not frame the TV in the capture (b-L12-cricket-tv shows the street) | |
| e4 | Festival: bunting, "Festival rush" chip, combo and tip pop-ups | PASS | b-L12-festival, -festival-up |
| e5 | Inspector: window banner "Inspector in 12s", verdict text | PASS (text) | b-L5-inspector (window); verdict read from the DOM and engine event: "The inspector fined you ₹65 (tawa not tended) and a heart is lost" (no image: the toast expired before the slow screenshot) |
| e6 | Delivery boy: seated, DELIVERY BOY 45s timer chit, 5 parcel dishes | PASS | b-L12-cust-delivery-boy |
| e7 | Parcel / big-office customers, regular stars | PASS | b-L5-cust-parcel, b-L12-cust-parcel, -big-parcel, -regular; "REGULAR" chit with 3 stars |
| f1 | Top bar cost / profit (₹118 cost, profit -₹118; later ₹108 / ₹72) | PASS | b-01, b-L5-power-candle, b-L12-power |
| f2 | Results galla with profit | PASS with a layout caveat (bug B2) | b-L5-results-galla, b-L12-results-galla, b-L12-results-galla-scrolled-profit (Wasted/Fines/Profit -₹234, star ruler, "Today's chit") |
| g1 | HUD at 1280x800 with ops UI on | PASS with bug B1 | all shots |
| g2 | Dialogue bubbles + subtitles: Telugu, Hindi and English readable | PASS | b-L12-power (Telugu), b-L12-cricket (Hindi), b-L12-rain (Telugu) |

## Bugs and observations

| ID | Sev | File | Symptom | Suggested fix |
|---|---|---|---|---|
| B1 | Medium | `src/games/tiffin-centre/ui/hud/hud.css` (stall status panel) / `StallStatus.jsx` | At 1280x800 on L12 (10 ingredient tiles), with one or more event chips (power, rain+cricket+festival) the status tile grid is pushed down and its last rows (Oil, Tea/Coffee, Biscuits and the BOARD tile) are covered by the dish list that starts at a fixed y=406. The BOARD tile is cut in half with one event and fully hidden with three. Measured: status 95-402 px, chips list top 406 px; each event chip adds ~30 px. | Cap the status block to the space above the dish list (`max-height` + `overflow:auto`) or flow the dish list below the status block instead of at a fixed offset. Not fixed (outside my two files). |
| B2 | Low-Medium | `ui/menus/menus.css` (Results) | At 1280x800 the CTA bar ("Open the shutters again" / "Invite friends") overlaps the lower part of the galla card on first paint; Wasted, Fines and the PROFIT line are below the fold and only appear after scrolling the results panel. | Make the results panel shorter, or move the profit line above Takings/Tips, or let the CTA bar be non-overlapping. |
| B3 | Low | `ui/hud/StallStatus.jsx` / `PrepSheet.jsx` | A stock item at 0 still shows a freshness figure ("Out  92% fresh"). | Hide freshness when stock is 0. |
| B4 | Low | `ui/hud/Subtitles.jsx` + `WorldBubbles.jsx` | The same speech line is shown twice at once (a speech bubble above the customer and the subtitle bar at the bottom). Readable, but redundant on small screens. | Show only one when subtitles are on. |
| B5 | Info | `ui/hud/HudLayer.jsx` | Raw `session.dispatch` refusals (e.g. "Out of dosa batter") do not raise a toast; only HUD-initiated actions do. Expected (the toast is the HUD's job). | none |
| B6 | Info | harness | After the shift, Results is drawn over a still-mounted HUD (the HUD buttons stay in the DOM); harmless visually. | none |

No crash, exception, NaN or stuck state was seen in any flow. The L5 and L12 shifts ran to a natural end (L5 `done`, L12 `closed` after the pinned hearts were not enough once the pin was released at the end).

## Not covered / honest gaps

- Umbrellas, roof drips and the cricket TV were not seen in a screenshot (B-level gap, may exist; the frame did not include them).
- Pass-verdict of the inspector (+bonus) was not captured; only the fail verdict text.
- Only desktop 1280x800 was exercised (as requested).
- Real-GPU frame timing was not measured (SwiftShader).

## Files created

- `docs/tiffin-centre-proofs/final-b/*.jpg` (40 images)
- `docs/TIFFIN_CENTRE_PROOF_B.md`
- Scratch only: `<scratchpad>\qab\*` (harness scripts, logs). The worktree and its `node_modules` junction were removed; the main tree was not touched except for the two items above.
