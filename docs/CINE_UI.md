# Cine UI: the hub redesign

The owner wants the Jalebi Games hub to look and feel exactly like cinejoy.pk: calm, cinematic and soothing. This
supersedes the street-poster skin (jalebi.css, jalebi-layout.css, street-*.css) and the publisher layer (publisher*.css)
on **hub pages**. Game screens (`/play/**`) and the admin console (`/admin`) are out of scope.

**Hard rule:** match the reference's layout, components, spacing, type scale, colours, glass and motion, but never copy its
assets or content. No cinejoy logo, wordmark, images, posters, copy or brand names. Use Jalebi's own name, logo
(`src/components/art/Logo.jsx` / the jalebi logo), game art under `public/art/**`, and our own text.

## Reference
Screenshots are in `C:\Users\somap\AppData\Local\Temp\claude\77d889cd071b8b0f\3f309244-bf2b-4304-b6e2-ff362c3edfec\scratchpad\ref\`.
**Look at them with the Read tool before building**:
- `cjv-1440-full.jpg` / `cjv-390-full.jpg`: the home hero, desktop and phone (with the bottom dock).
- `cj-part0.jpg` … `cj-part6.jpg`: the rest of the home page at 1440, scaled. Contents: provider tiles, Top 10 with outlined
  numerals, poster rows, a "Movies on [Netflix ▾]" heading, and a modal.
- `cj-390-full.jpg` and `cj390-part*.jpg`: the home page on a phone.
- `cj-detail-full.jpg` / `cj-detail-a.jpg`: a title page (backdrop hero, white Play pill + round icon buttons, meta, an info card
  on the right, then rows: cast circles, wide trailer cards, collection posters, comments).
- `cj-detail-390-full.jpg`: the title page on a phone.
- `cj-lists-full.jpg`: "My Lists / Discover", a page title with a dim second tab, a blurred ambient backdrop and an empty
  state with a dashed folder and two pills.
- `cj-footer.jpg`: the minimal centred footer.
- `cj-1440-tokens.json`: measured fonts, colours, radii, sizes and motion variables.

Fresh screenshots of any cinejoy.pk page: `node refshot.mjs <port> <url> <w> <h> <out> [mobile]` in that folder, with your
own headless Chrome port. Set `VIEWPORT=1` for one viewport instead of the full page.

## Design system (already written: `src/styles/cine.css`, read it fully)
- Canvas `#04120b`; text white at 80% (`--cj-text`), strong `#fff`, dim 60%, faint 40%.
- Glass `rgba(255,255,255,.05/.1/.16)` with `backdrop-filter: blur(24px) saturate(140%)` and a 1px inset ring.
- Font: the system stack plus Inter Variable. Weights 500 / 600 / 700. Sizes: 12px meta, 14px body/card titles, 15–16px lede,
  20px section titles, 32–44px page titles. Display titles are uppercase and wide-tracked (`.cj-title-art`).
- Radii: 12px cards, 16px panels, 26px sheets, pills fully round. Card shadow `--cj-shadow-card`.
- Motion: `.4s cubic-bezier(.25,1,.5,1)` everywhere; the nav uses a spring `cubic-bezier(.34,1.56,.64,1)`. Respect reduced
  motion: OS setting + `:root[data-motion='reduced']`.
- Accents are sparing: green `--cj-live` for online/live, gold `--cj-gold` for coins/rewards. Jalebi orange appears only in
  the logo and tiny highlights. Primary actions are white pills (`.cj-btn--primary`), never orange.
- Primitives: `.cj-btn` (+`--primary` `--lg` `--sm` `--block`), `.cj-iconbtn`, `.cj-btngroup`, `.cj-glass`, `.cj-panel`,
  `.cj-facts`, `.cj-section` + `.cj-section__head` + `.cj-section__title` (+ chevron link) + `.cj-section__pick`, `.cj-row`
  (sideways scroller), `.cj-poster` (2:3) + `__title` `__sub` `__badge`, `.cj-wide` (16:9) + `__label`, `.cj-tile` +
  `__art`, `.cj-top10` + `.cj-top10__num`, `.cj-dots`, `.cj-chip`, `.cj-input`, `.cj-person`, `.cj-live-dot`, `.cj-empty`,
  `.cj-modal`, `.cj-checks`, `.cj-pagehead` + `__title` + `__tab`, `.cj-lede`, `.cj-title-art`, `.cj-meta`, `.cj-ambient`.
- `cine.css` is the shared base. Add page-specific styles in your own file (`src/styles/cine/<area>.css`, prefixed
  `cj-<area>-`). Only the shell agent edits `cine.css` itself. If you need a new shared primitive, put it in your area file and
  report it.
- Icons: use `HubIcon` (`src/platform/game/HubIcon.jsx`); lucide-style outline icons fit cinejoy's look.

## Screen mapping (cinejoy → Jalebi)
- **Nav (desktop ≥ 900px):** logo top-left, white and small like the reference, with no orange banner. A floating glass pill
  top-right: Arcade (home icon) · Browse · The Adda · Leaderboard. The active item is a white pill with its icon and the
  others are 80% white text. After a hairline: a search icon (opens the existing command palette) and the coins / bells /
  profile cluster as round glass icons, the profile as an avatar. The "Enter code" action becomes a small glass pill or an
  icon in the cluster. The pill condenses on scroll (smaller padding, more opaque), like the reference's condense variables.
- **Nav (phone < 900px):** logo top-left only. A floating glass **bottom dock** with icons: Arcade, Browse, The Adda,
  Leaderboard, Search, Profile; the active one sits in a rounded square highlight. Badges stay. Safe areas respected.
- **Home:**
  - A full-bleed hero carousel of the games: Nawabi Raj live, plus the coming-soon teasers. Backdrops come from
    `public/art/cinematic/*.webp`; the left and bottom fade into the canvas.
  - Each slide has the game name in `.cj-title-art`, a meta row (★ rating if any, players 2–6, time, category), a 2–3 line
    description, a white **Play** pill (or "Notify me" for teasers) and a glass group (+ invite, ⓘ details). Dots sit
    bottom-right and the carousel auto-advances slowly (paused on hover, focus and reduced motion).
  - Then rows:
    - "Browse by Category" (tiles)
    - "Top 10 on Jalebi today": the top players by the leaderboard API, as avatar/poster cards over outlined numerals
    - "Open tables" (live rooms, if any)
    - "Friends online" (when signed in)
    - "Coming soon" (posters)
    - "Achievements to chase" (when signed in)
  - Everything is real data with honest empty states (no invented numbers).
  - Then the minimal centred footer.
- **Browse (/games) and Search:** the page-head pattern, category chips and grids/rows of posters.
- **Game detail (/games/:id):**
  - The title-page layout: the backdrop hero with name, category, a white Play pill (create table) and round icon buttons
    (invite, share, rules).
  - A meta line (players · time · maps), the description, and on the right a `.cj-facts` card (Players, Match length, Maps,
    Rules, Publisher).
  - Then rows: "Maps" as wide cards, "Top players" as circles, "Gallery" as wide cards, "Open tables", "More like this" as
    posters.
  - Every existing feature on that page stays (map picker, create flow, sign-in, offline notice, tour hooks).
- **Leaderboard, Profile, Shop, The Adda, Login, Help/About/Privacy/Terms, 404, Join, Friend link, Lobby:**
  - The `.cj-pagehead` pattern (big title with dim sibling tabs where tabs exist), the `.cj-ambient` backdrop, glass panels,
    white pills and poster/person rows.
  - The leaderboard keeps fitting the viewport with no page scroll on desktop (the owner asked for that earlier). Its top 3
    use the Top-10 outlined-numeral treatment instead of the podium art.
- **Overlays** (modals, sheets, toasts, command palette, daily reward, gift popup, notification inbox, confirm dialogs): the
  `.cj-modal` look (glass, 26px radius, white full-width pill), with bottom sheets on phones.

## Rules for every agent
- Keep every feature, route, data flow, `data-tour` hook, aria label and test-relevant behaviour. This is a visual
  redesign. Update tests only where they assert markup or classes that legitimately changed, and keep behaviour assertions.
- Stop loading the street-poster / publisher CSS for screens you rebuild. The shell agent decides the global imports in
  App.jsx; page CSS that a page imports itself is yours to drop.
- No horizontal page scroll at 360, 390, 768, 1024 or 1440. Rows scroll inside themselves.
- Accessible: labelled icon buttons, focus-visible rings, real headings, carousel controls with `aria-roledescription` and
  pause.
- Run tests from **PowerShell** (`npx vitest run`); vitest breaks in Git Bash because of a drive-letter-case quirk. Build
  with `npx vite build --outDir "$env:TEMP\jg-<you>" --emptyOutDir` so `dist/` isn't touched.
- Do not commit or push.
- **Visual check:**
  - Vite runs at http://localhost:5173 (hot reload).
  - Use your own headless Chrome port (listed in your brief).
  - The local API has real public data. Signed-in data can be mocked with the DevTools Fetch domain; see
    `scratchpad\shotmock.mjs` and `scratchpad\player-ui\pshot.mjs`.
  - Screenshot your screens at 1440x900 and 390x844 and compare them side by side with the reference shots. Iterate until
    they read as the same design language.

## Shell decisions (shell agent)
- **The nav floats over content.** `.hub-main` has **no top padding** on any hub page; the home hero runs full-bleed under the nav.
- `--topbar-h` = the band the floating nav covers (excluding the notch): **88px at >= 900px** (pill sits 20px from the top,
  52px tall, plus breathing room), **64px below 900px** (logo only; the phone header scrolls away with the page).
  `.cj-pagehead` already clears it (its top padding is >= the band); anything else that starts at the very top of a page
  pads by `var(--cj-safe-top)` (= `calc(var(--topbar-h) + var(--safe-top, 0px))`).
- `--tabbar-h` = the band the phone dock covers above the home indicator: **72px below 900px** (60px dock + 12px gap), **0 at
  >= 900px**. The shell already pads the footer slot by it, so normal scrolling pages need nothing. Fixed / viewport-fit
  layouts subtract `var(--cj-safe-bottom)` (= `calc(var(--tabbar-h) + var(--safe-bottom, 0px))`).
- Viewport-fit pages (leaderboard): available height = `100dvh - var(--cj-safe-top) - var(--cj-safe-bottom)`.
- The hub backdrop is the plain `--cj-bg` canvas (no art, no grain). A page that wants the blurred colour field renders its
  own `<div className="cj-ambient" aria-hidden="true" />` (or `cj-ambient cj-ambient--warm`) anywhere in the page.
- Global stylesheets: `jalebi.css`, `jalebi-layout.css` and `publisher*.css` are no longer loaded. `cine.css` then
  `cine/shell.css` load last in App.jsx.
- `.hub-app` has `overflow-x: clip` as a safety net (full-bleed `100vw` art no longer makes the page scroll sideways);
  rows still scroll inside themselves. `.hub-container` is full-bleed (no max-width, no padding): every page owns its
  gutters through the `.cj-*` primitives (`var(--cj-gutter)`).
- Nav markup hooks: `header.hub-topbar.cj-nav` (+ `.is-condensed` after 16px of scroll) > `.cj-nav__row[data-fit]` >
  `.cj-nav__logo` + `.cj-nav__pill` (`.cj-nav__links` with the white `.cj-nav__ind`, `.cj-nav__rule`, `.cj-nav__tools`).
  Phone dock: `nav.cj-dock` > `.cj-dock__list` > `.cj-dock__item` (+ `.cj-dock__ind`). Footer: `footer.cj-foot`.
- Strips (invites, announcements, live events) sit in `.cj-strips` in the page flow, just under the nav band; when one is
  showing, `.cj-pagehead` drops its own top clearance to 28px so the gap is not doubled.
