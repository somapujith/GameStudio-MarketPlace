# GameHub launch checklist

Everything a public launch needs besides features. Tick each box before announcing the site. Companion to [`DEPLOY.md`](DEPLOY.md) (how to deploy) and [`MARKETPLACE.md`](MARKETPLACE.md) (routes, API).

## 0. Read this first: legal review

> **The Privacy and Terms pages are plain-language summaries written from what the code does. Have them reviewed by counsel before launch.** They are deliberately free of any company name, address, registration number or governing-law clause: those belong to the operator, and none is invented here.

Give counsel `src/pages/Privacy.jsx` and `src/pages/Terms.jsx` (plain JS data, easy to read) and ask them to confirm or decide:

- [ ] **Who is the operator?** Legal name, address and contact details to publish (the pages currently say "the operator" and "we").
- [ ] **Governing law and jurisdiction**, dispute handling, and whether a **grievance officer** or **data-protection contact** must be named where you operate.
- [ ] **Minimum age.** The pages say "not designed for children under 13; under 18 with a parent or guardian's permission". Confirm the right wording for your market (for example India's DPDP Act treats under-18s specially; Google Sign-In has its own age rules).
- [ ] **Data rights and retention** (see gaps below): the Privacy page tells the truth that there is no self-service account deletion and no automatic expiry yet. Decide whether to build them before launch or promise a manual process and a response time.
- [ ] **Cross-border transfer** wording (Cloudflare, Neon and Google process data in their own regions).
- [ ] **Coins and cosmetics.** The Terms say there is nothing to buy with real money and coins have no cash value. If you ever add paid items, the Terms, Privacy and store listings all need rework first.
- [ ] After any change to what the app stores, update the text **and** `LEGAL_UPDATED` in `src/components/shell/legal/contact.js`.

Known product gaps that the legal pages disclose (not bugs in the pages):

| Gap | Where it shows | Suggested fix |
|---|---|---|
| No self-service "delete my account" | Privacy: "Your choices and rights" | A `DELETE /api/me` that removes the user row (FKs already cascade; `match_players.user_id` is set null) and signs out |
| No automatic expiry of guest accounts or match history | Privacy: "How long we keep it" | Scheduled job on `users.last_seen` for `is_guest` rows (an index `users_guest_last_seen_idx` already exists) |
| Display name stays on old match records after deletion | Privacy: "How long we keep it" | Null or replace `match_players.name` on deletion |
| No in-app "report a player/bug" | Help: "How do I report..." | A report form or a mailto with the room code prefilled |

## 1. Configuration

| Variable | Where | Needed for | Notes |
|---|---|---|---|
| `DATABASE_URL` | Worker secret | everything | Neon connection string |
| `JWT_SECRET` | Worker secret | sessions | 48+ random bytes; changing it signs everyone out |
| `GOOGLE_CLIENT_ID` | Worker secret | Google sign-in | Public id; without it only guest play works |
| `ALLOWED_ORIGINS` | `wrangler.toml [vars]` | split Vercel + Worker mode only | exact origins |
| `VITE_API_ORIGIN` | build env (Vercel) | split mode only | Worker origin, no trailing slash |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Worker secrets | push notifications | Optional: without them every push call is a no-op |
| `VITE_CONTACT_EMAIL` | build env | Privacy / Terms / Help contact line | **Done:** set to the operator address in the local `.env` (git-ignored) and as the GitHub Actions repository variable `VITE_CONTACT_EMAIL`. Make sure that mailbox is monitored. |
| `VITE_SITE_URL` | build env | canonical URL, `og:url`, absolute share images, `sitemap.xml` | Optional. Defaults to the single-Worker URL in `docs/DEPLOY.md`; set it (no trailing slash) when a custom domain goes live |

- [x] `VITE_CONTACT_EMAIL` is set **in the environment that runs `npm run build`** (local `.env` + GitHub Actions variable; add it to Vercel too if you build there). It is read at build time. For GitHub Actions add `env: VITE_CONTACT_EMAIL: ${{ vars.VITE_CONTACT_EMAIL }}` to the *Build* step of `.github/workflows/deploy.yml` and create the repository variable (Settings -> Secrets and variables -> Actions -> Variables). For Vercel set it under Environment Variables (Production and Preview).
- [ ] After deploying, open `/privacy`, `/terms` and `/help` and confirm the contact line is visible.
- [ ] All Worker secrets present: `npx wrangler secret list`.
- [ ] `npm run migrate` ran against production **before** the Worker deploy.

## 2. Public origin, canonical URL and sitemap

Done in code. `vite.config.js` reads `VITE_SITE_URL` (default: the single-Worker URL from `docs/DEPLOY.md`) and, at build time, fills `<link rel="canonical">`, `og:url`, the absolute `og:image` / `twitter:image` and the JSON-LD `url` in `index.html`, writes `sitemap.xml` (public pages plus one `/games/<id>` per live game) and appends the `Sitemap:` line to `robots.txt`.

- [ ] Confirm the default origin is really the address you launch on. If not, set `VITE_SITE_URL` (repository variable and `.env`) and rebuild: nothing else needs editing.
- [ ] Validate sharing: paste the URL into the Facebook Sharing Debugger, the LinkedIn Post Inspector and WhatsApp; check the 1200x630 image (`public/og-image.png`, regenerate if the brand changes) renders.
- [ ] If the site lives on a custom domain: add it to `[[routes]]` in `wrangler.toml`, to the Google OAuth **Authorised JavaScript origins**, and (split mode) to `ALLOWED_ORIGINS` and the `connect-src` of `vercel.json`.

## 3. Google OAuth consent screen

- [ ] Google Cloud console -> APIs & Services -> **OAuth consent screen**: app name `GameHub`, user support email (a monitored mailbox), developer contact email, app logo (`public/icons/icon-512.png`).
- [ ] **App domain**: home page `https://ORIGIN/`, privacy policy `https://ORIGIN/privacy`, terms of service `https://ORIGIN/terms`; add the domain under *Authorised domains* and verify it in Search Console if Google asks.
- [ ] Scopes: only the defaults (`openid`, `email`, `profile`). Nothing sensitive, so no verification review is needed beyond branding.
- [ ] **Publishing status = In production** (otherwise only listed test users can sign in).
- [ ] **Authorised JavaScript origins** contain every origin that serves the app (see `README.md` -> Google OAuth setup). No redirect URIs are needed.
- [ ] Sign in from a clean browser profile on the production origin (desktop and phone).

## 4. PWA and store assets

Already in the repo: `public/manifest.webmanifest` (name, short name, shortcuts for Browse / Join a table / Friends, `display_override`, categories), icons (192 and 512, maskable 192 and 512, `apple-touch-icon.png`, `favicon.svg`, 48 px PNG, notification badge), `public/sw.js` (push + offline page; never caches `/api`, `/ws` or app code), `public/offline.html`, `public/og-image.png`.

- [ ] Lighthouse (Chrome DevTools, mobile) on the production URL: installable, no manifest warnings, Performance and Accessibility in the green.
- [ ] Install test: Android Chrome ("Install app"), desktop Chrome / Edge, iPhone Safari (Share -> Add to Home Screen). Launch from the icon; check the status bar, the safe areas and the three shortcuts (long-press the icon).
- [ ] Offline test: install, go offline (airplane mode), open the app: the branded "You are offline" page appears, and returns you to GameHub by itself when the connection is back.
- [ ] **Manifest `screenshots`** are intentionally absent: add real ones only (taken from production, no fake data), `1280x720` wide and `750x1334` narrow, then reference them from `manifest.webmanifest` (`"form_factor": "wide"` / `"narrow"`) for the richer Chrome install dialog.
- [ ] Push (optional): generate VAPID keys, set the three secrets, enable notifications from Profile on a real phone, send an invite.
- [ ] If you ever publish to an app store (TWA / PWABuilder), you need the privacy policy URL from section 3 and a `/.well-known/assetlinks.json`; neither exists yet.

## 5. Security and headers

- [ ] `https://ORIGIN/` returns the headers of `public/_headers` (`curl -sI https://ORIGIN/`): `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `Strict-Transport-Security`.
- [ ] Open the browser console on `/`, `/login`, a lobby and a game: **no CSP violations** (the CSP is enforced; it allows only Google Identity Services, same-origin assets and `wss:`). A new third-party script, font or image host must be added to the policy first.
- [ ] `/api/health` returns `{ "ok": true, "db": true }`.
- [ ] Secrets rotated if they were ever pasted anywhere (see `README.md` -> Security notes).

## 6. Monitoring and operations

- [ ] Uptime monitor on `https://ORIGIN/api/health` (UptimeRobot, Better Stack, Cloudflare Health Checks), alerting to a real inbox or phone.
- [ ] Cloudflare: Workers Logs are enabled (`[observability]`), know where to find them (Workers -> gamestudio-marketplace -> Logs, or `npx wrangler tail`). Add an alert for elevated 5xx.
- [ ] Neon: alerts for storage and compute limits, connection errors; confirm backups / point-in-time restore on the plan you use.
- [ ] Cloudflare plan limits reviewed (Workers requests, Durable Object duration and storage) for the expected audience.
- [ ] No client-side error reporting exists; decide whether to add one (it would also need a Privacy page and CSP update).
- [ ] Rollback rehearsed: `npx wrangler deployments list` then `npx wrangler rollback <id>`.

## 7. Content check

- [ ] Read `/about`, `/help`, `/privacy`, `/terms` once, on a phone, signed out and signed in.
- [ ] Every live game's manifest: tagline, description, players, duration, `ageRating` (if set) are accurate. Coming-soon games are clearly marked; delete teasers you do not intend to build.
- [ ] No placeholder names, ratings, counts or testimonials anywhere (the storefront rule is real data only).

## 8. Smoke test

Routes (all must render inside the hub shell with no console errors and no horizontal scroll at 360, 390, 768 and 1280 px, in both themes):

| URL | Expect |
|---|---|
| `/` | storefront home |
| `/games`, `/search?q=tycoon` | catalogue, search results |
| `/games/hyderabad-tycoon` | listing with Create table |
| `/games/ludo-lanes` | coming-soon listing |
| `/about`, `/help`, `/privacy`, `/terms` | page with sticky table of contents (>= 900 px); Help search finds "code" and "install" |
| `/help#install-app` | opens and scrolls to that answer |
| `/privacy#cookies` | scrolls to the section |
| `/join`, `/join/ABC234` | join screen / friendly "no such table" |
| `/leaderboard`, `/friends`, `/profile`, `/shop`, `/login` | each renders; signed-out ones prompt for sign-in |
| `/nope` | hub 404 |
| `/robots.txt`, `/manifest.webmanifest`, `/offline.html`, `/og-image.png` | 200 with the right content type |

Scripted check of the static parts against any deployment:

```bash
ORIGIN=https://your-origin.example
for p in / /games /about /help /privacy /terms /robots.txt /manifest.webmanifest /offline.html /offline.js /og-image.png /sw.js /icons/icon-512.png; do
  printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$ORIGIN$p")"
done
curl -s "$ORIGIN/api/health"; echo
curl -s "$ORIGIN/manifest.webmanifest" | node -e "JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('manifest is valid JSON')"
curl -sI "$ORIGIN/" | grep -i -E 'content-security-policy|x-frame|nosniff|referrer-policy'
```

Manual end-to-end (two browsers or a phone and a laptop):

1. Browser A: Play as guest, open Hyderabad Tycoon, 2 players, Create table. Copy the room code.
2. Browser B: Have a code? -> enter the code -> joins as a guest. The seat count updates in A within a second.
3. A: Start. Play a few turns. Kill B's network for 10 seconds: B reconnects and sees the same state.
4. Sign in with Google in a third profile; add a friend by friend code; send and accept an invite.
5. Finish a game: result screen, profile stats, leaderboard shows the signed-in player only.
6. Claim the daily reward (once per IST day); spend coins in the Shop.
7. Install the app on a phone; open `/privacy` from the footer; go offline and reload.
