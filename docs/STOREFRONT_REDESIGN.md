# GameHub storefront redesign: brief, design direction, work packages

Status: in progress (parallel build). Companion to [`MARKETPLACE.md`](MARKETPLACE.md) (product flow, routes, manifest, API contracts). This file is the shared brief every work package (WP) builds against.

## Brief
- **Class:** frontend (the Worker, DB and WebSocket protocol exist and do not change).
- **Goal:** turn the hub from "a common game place" into a publish-ready games marketplace: a storefront with real hierarchy, rich game listing pages, discoverable catalogue (browse, search), complete account/social/room surfaces, and the legal/help/SEO/PWA basics a public launch needs.
- **Surfaces:** hub shell and navigation, Home, Browse, Search, Game detail (live + coming soon), Profile, Shop, Login, Rank, Friends, Friend link, Join, Lobby, online-game loading/error screens, About / Help / Privacy / Terms, 404 and error screens, `index.html`, PWA files.
- **Out of scope:** the Tycoon game itself (board, engine, `src/components/game/**`, `shared/**`, `worker/**`, `src/components/art/**` except the hub art kit), DB schema, new API endpoints.
- **Acceptance (every WP):** renders cleanly at 360, 390, 768, 1280 px with no horizontal scroll; light and dark hub themes; keyboard path and visible focus; loading, empty, error and offline states designed; no console errors with the API unreachable; `prefers-reduced-motion` honoured; `npx vite build` passes; tests you touch pass.

## Design direction: "night bazaar storefront"
GameHub is a Hyderabad night market for games: every game is a lit shopfront with its own sign. Keywords: **signage, lantern-warm, tactile, confident, alive**.

- **Keep** the hub palette and tokens (`--hub-*` in `src/styles/hub.css`: indigo brand, gold, cream light theme, navy dark theme). Never hard-code a hex colour in a hub component; use tokens, and `themeVars(game.theme)` (`@/platform/game/color.js`) to tint a game's own card or page with its accent.
- **Raise** these things on purpose:
  1. **Type.** Display = Bricolage Grotesque Variable (`var(--font-hub-display)`), body = Plus Jakarta Sans Variable (`var(--font-hub-body)`), both self-hosted via @fontsource and already applied to `.hub-app` / `.hub-page` / `h1-h3` by `src/styles/store.css`. Use the `--st-t-*` scale. Big tight headlines, small tracked-caps eyebrows (`.st-eyebrow`), never one weight everywhere.
  2. **Hierarchy.** One hero per page, then rails with a visible peek of the next card, then dense tiles. Uneven rhythm, not a stack of identical cards.
  3. **Signage details.** Eyebrow labels, ticket-style chips (`.st-chip`), game-accent glow under a card on hover/focus, pill buttons.
  4. **Signature element: the live bazaar.** The hub always shows that people are here right now: pulse dot (`.st-live`) chips with open tables, friends online, "Live now" on listings. Real data only (see rules).
- **Motion language** (tokens in `tokens.css`): `--dur-1` 120 ms press/hover, `--dur-2` 220 ms small enter/exit, `--dur-3` 360 ms sections/sheets; easings `--ease-out`, `--ease-spring`. Animate transform and opacity only. Section entrance = `.st-reveal` with `--i` stagger. Honour reduced motion (the `data-motion="reduced"` attribute and the media query; `store.css` shows how).
- **Responsive skeleton.** Phone: bottom tab bar, single column, snap rails with a peek (`.st-rail`). From 900 px: left rail, two-column pages. Max content width is the existing `.hub-container`.
- **States** to design everywhere: skeleton shaped like the content (`.st-skel`), empty (say why, offer the next action), error with retry, offline, long names, many items, signed-out vs guest vs signed-in.

## Shared rules for every WP
1. **Ownership.** Edit only the files listed for your WP. Shared files (`src/App.jsx`, `src/main.jsx`, `src/platform/paths.js`, `src/styles/hub.css`, `src/styles/store.css`, `package.json`, `index.html` except WP-G) are frozen: report the exact change you need instead. Do not edit files owned by another WP; import from them read-only.
2. **Working tree has the owner's uncommitted changes** (many files show `M` in `git status`). Edit in place. Never run `git checkout`, `git restore`, `git stash`, `git reset` or `git clean`. No commits, no pushes.
3. **Never touch the game:** `src/components/game/**`, `src/components/art/**` (except importing), `shared/**`, `worker/**`, `src/games/hyderabad-tycoon/{OnlineGame.jsx,settings.js}`, `src/lib/session/**`.
4. **Real data only.** Never invent ratings, reviews, download or install counts, "players online" numbers, testimonials or prices. Allowed sources: the game manifest, `GET /api/games`, `/api/rooms/open`, `/api/rooms/mine`, `/api/leaderboard`, `/api/me`, `/api/friends` (see `docs/MARKETPLACE.md` section 7) and local stores. If a number is unavailable, show nothing or an honest empty state.
5. **URLs** come from `paths` in `@/platform/paths.js` (new: `paths.games()`, `paths.search(q)`, `paths.about()`, `paths.help()`, `paths.privacy()`, `paths.terms()`). Money via `formatINR` / `compactINR` from `@shared/format.js`. Icons: `HubIcon` (`@/platform/game/HubIcon.jsx`) or inline SVG; no emoji as icons. No external assets or CDN.
6. **Game manifests** (`src/games/*/manifest.js`, registry in `src/games/registry.js`) are the catalogue. WP-B adds these **optional** fields; every reader must tolerate their absence: `publisher` (string), `version` (string), `released` (ISO date), `ageRating` (e.g. `'12+'`), `languages` (string[]), `platforms` (string[], e.g. `['Phone','Tablet','Desktop']`), `tags` (string[]), `highlights` ([{ icon, title, text }]), `howToPlay` ([{ icon, title, text }]), `gallery` ([{ kind: 'cover'|'scene'|'board', caption }]).
7. **Verifying.** Dev server is already running at `http://localhost:5181` (Vite, HMR; do not start another on that port). The production API is NOT reachable on purpose: use the Playwright mock harness at `C:\Users\somap\AppData\Local\Temp\claude\75b3eebdd3dd98cc\1ee5c7d0-3a8c-4594-8594-7986e9a33c95\scratchpad\mock.mjs` — `node mock.mjs <url> <outPrefix> <w> <h> <scrollYs comma list> [full|guest|empty|offline|auth]` (run it from the scratchpad directory; it fakes `/api/*`, prints page errors, writes PNGs you read with the image reader). Put your PNGs in `scratchpad\shots\<your-wp>\`. Copy and extend the harness under another name if you need more mock routes. Never start Wrangler or call the production API. For builds use `npx vite build --outDir <scratchpad>\dist-<wp> --emptyOutDir` (parallel agents must not share `dist`). Run `npx vitest run <files>` for tests you touch; two pre-existing failing files (`turn.test.js` and one more, both missing `@/styles/trade.css`) are game-side and not yours.
8. **Final report ≤ 200 words:** files created/changed, public exports others need, edits you need in frozen shared files (exact), known gaps, what you verified and at which widths/themes.

## Work packages (disjoint file ownership)
| WP | Scope | Owns |
|---|---|---|
| **A Home** | `/` storefront: spotlight hero, live strip, rails/collections, top players, daily reward, resume | `src/pages/Home.jsx`, `src/platform/home/{Hero,GameCard,CategoryRow,CategoryChips,TopPlayers,GameArt,catalog,gameTheme}.*`, `src/components/shell/home/**`, `src/styles/{hubhome,x-home}.css`, new `src/platform/home/store/**` |
| **B Game detail** | `/games/:id` as a store listing (live + soon), manifest metadata | `src/pages/GameDetail.jsx`, `src/platform/game/**`, `src/games/registry.js`, `src/games/hyderabad-tycoon/manifest*.js`, `src/games/_soon/**`, new `src/styles/store-detail.css` |
| **C Shell & routing** | chrome, nav, command palette, route guards, 404/error screens, document titles | `src/components/shell/{AppShell,TabBar,ProfileChip,ErrorBoundary,RouteSkeleton,InstallPrompt,Modal,PageHeader,Loading,ui}.jsx`, `src/components/shell/nav/**`, `src/components/shell/{theme,transitions,hooks}.js`, `src/pages/NotFound.jsx`, `src/App.jsx`, `src/styles/{hub,mobile,x-shell}.css` |
| **D Account** | Login, Profile, Shop | `src/pages/{Login,Profile,Shop}.jsx`, `src/platform/home/{ProfileHeader,AccountSection,SettingsSection,BadgeGrid,GameStatCards,badges,gameStats}.*`, `src/styles/x-profile.css` |
| **E Social & Rank** | Leaderboard, Friends, Friend link | `src/pages/{Leaderboard,Friends,FriendLink}.jsx`, `src/platform/home/{LeaderTabs,Podium,RankRow,PageHead,Ava,useApi}.*`, `src/components/online/{friendsModel,InviteFriends,InviteToGameSheet,InviteBanner}.*`, `src/styles/x-social.css` |
| **F Rooms** | Join, Lobby, online-game loading/error, connection states | `src/pages/{Lobby,JoinRoom,OnlineGame}.jsx`, `src/components/online/**` (except the three owned by E), `src/components/shell/Toast.jsx`, `src/styles/{x-lobby,online}.css` |
| **G Publish-readiness** | About, Help, Privacy, Terms, footer, SEO/OG, PWA, docs | `src/pages/{About,Help,Privacy,Terms}.jsx`, new `src/components/shell/Footer.jsx`, `index.html`, `public/**`, `src/styles/x-legal.css` (new), `docs/**` (except this file's plan sections) |
| **H Browse & Search** | `/games` catalogue with filters/sort, `/search` with live results | `src/pages/{Games,Search}.jsx`, new `src/platform/browse/**`, new `src/styles/store-browse.css` |

Integration (me, after the wave): footer into AppShell, nav entries, barrel exports, cross-WP seams, build, screenshots, review.

## Wave 0 shared helpers (already in place)
- `src/components/shell/nav/safeNext.js` — `safeNext(raw, fallback)` validates a `?next=` redirect target. WP-D's Login consumes it; any screen that sends a visitor to sign in uses `paths.login(location.pathname + location.search)`.
- `src/platform/browse/searchGames.js` — `searchGames(query, games?) -> [{ game, score }]`. WP-H owns it (may improve, keep the signature); WP-C's command palette and `/search` call it.
- `src/styles/store.css` — type tokens and primitives (`.st-eyebrow`, `.st-head`, `.st-chip`, `.st-card`, `.st-rail`, `.st-live`, `.st-reveal`, `.st-skel`, `.st-link`).
