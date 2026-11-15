# Deploying GameHub

Two supported ways to run it. Pick one; the code is the same.

## 1. Single Worker URL (zero config, recommended)

The Cloudflare Worker serves the SPA (`dist/`) **and** the API (`/api/*`) **and** the WebSockets (`/ws/*`) on one origin,
for example `https://gamestudio-marketplace.somapujith.workers.dev`. Cookies, CSRF checks and WebSockets all work as
they always have. Nothing extra to set.

```
npx wrangler secret put DATABASE_URL      # Neon connection string
npx wrangler secret put JWT_SECRET        # e.g. openssl rand -base64 48
npx wrangler secret put GOOGLE_CLIENT_ID  # optional: Google sign-in (guests work without it)
npm run migrate                           # BEFORE the first deploy of a schema change (uses .dev.vars: production DB)
npm run deploy                            # = npm run build && wrangler deploy
```

## 2. Split: SPA on Vercel, API on the Worker (optional cross-origin mode)

Vercel only serves static files (no `/api`, no WebSockets), so the SPA talks to the Worker across origins. Browsers
(iOS Safari, Firefox) block third-party cookies, so this mode does **not** use cookies: sign-in returns the session
token, the SPA keeps it in `localStorage` (`hyd_token`) and sends `Authorization: Bearer`. WebSockets cannot carry
headers, so before every (re)connect the SPA calls `POST /api/ws-ticket` and opens `wss://<worker>/ws/...?ticket=<60 s JWT>`.

| Where | Setting | Value |
|---|---|---|
| Worker (`wrangler.toml` `[vars]`, non-secret) | `ALLOWED_ORIGINS` | comma-separated exact origins, e.g. `https://gamestudio-lac.vercel.app` (no `*`, no paths) |
| Worker secrets | `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID` | as above |
| Vercel -> Settings -> Environment Variables (**Production and Preview**) | `VITE_API_ORIGIN` | the Worker origin, no trailing slash: `https://gamestudio-marketplace.somapujith.workers.dev` |
| Vercel build | Build command / Output | `npm run build` / `dist` (also in `vercel.json`) |
| Google Cloud console -> OAuth client -> **Authorised JavaScript origins** | add | `https://gamestudio-lac.vercel.app` (guests work without this; only Google sign-in needs it) |

`VITE_API_ORIGIN` is read at **build time**: change it, then redeploy on Vercel. Unset = same-origin behaviour.

Notes
- Vercel Preview deployments have their own origin (`https://<project>-<hash>-<team>.vercel.app`); add each one you want
  to use to `ALLOWED_ORIGINS` (exact match only), or test only on Production.
- `vercel.json` sets the SPA fallback (every non-file path such as `/lobby/ABC234`, `/play/...`, `/games/...` -> `index.html`),
  `no-cache` for `/sw.js`, immutable caching for `/assets/*`, and the security headers. Its CSP `connect-src` allows
  `https://*.workers.dev` and `wss:`. If the Worker is on a **custom domain**, add `https://<that-domain>` to `connect-src` in `vercel.json`.
- The service worker (`public/sw.js`) has no `fetch` handler, so it never touches API or WebSocket traffic; push
  subscription calls go through the same bearer-authenticated API client.
- Security: the token is only handed out when the request `Origin` is in `ALLOWED_ORIGINS` **and** differs from the
  Worker's own origin; the same-origin response is unchanged and the cookie stays HttpOnly. Cookie-authenticated
  requests from any other foreign origin are still refused (403); an allowlisted origin may only change state with a
  valid bearer token (or the rate-limited public sign-in endpoints). WebSocket upgrades with an `Origin` header must be
  the Worker's own origin or allowlisted.

## Deploy order

1. **Migration first**: `npm run migrate` (additive SQL against the production DB).
2. **Worker**: `npm run deploy` (it also carries the new `ALLOWED_ORIGINS` var).
3. **SPA**: push to Vercel (with `VITE_API_ORIGIN` set). Deploying the SPA before the Worker would give a 403 on sign-in.

## LAN / Wi-Fi play (local development)

Run the local stack (never point it at production):

```
docker compose up -d            # Postgres :5433 + Neon HTTP proxy :4444
npm run migrate:staging
npm run worker:staging          # Worker on 127.0.0.1:8787, reads .dev.vars.staging
npm run dev:lan                 # Vite on 0.0.0.0:5173; prints the "Network:" URLs
```

Other devices on the same Wi-Fi open `http://<PC LAN IPv4>:5173` (find it with `ipconfig`). The Vite dev server proxies
`/api` and `/ws` (WebSocket upgrade included) to the local Worker, so the page, API and sockets are one origin and
nothing else is needed. Notes:
- **Windows firewall**: the first time, allow inbound TCP 5173 for `node.exe` (Windows Security prompt: "Allow access" on
  Private networks), or add a rule: *Windows Defender Firewall -> Advanced settings -> Inbound Rules -> New Rule -> Port
  -> TCP 5173 -> Allow -> Private profile only*. The Worker (8787) stays on loopback and needs no rule.
- Use the IP address, not a hostname (Vite blocks unknown hostnames; IPs are allowed). Guests work over plain http;
  Google sign-in does not (Google rejects raw IP origins).
- Port in use? `vite --port 5181` plus `API_PORT=8791` proxies to a Worker on that port.

## Troubleshooting

- **Browser console: CORS error / `No 'Access-Control-Allow-Origin'`** -> the SPA origin is not in the Worker's
  `ALLOWED_ORIGINS` (exact scheme + host, no trailing slash, no wildcard), or the Worker was not redeployed after editing
  it. Preview deployments have different origins.
- **Sign-in returns 403 "Cross-origin request refused"** -> same cause (origin not allowlisted), or the SPA was built
  with a wrong `VITE_API_ORIGIN`.
- **401 after deploy / "session expired"** -> `JWT_SECRET` changed or the stored token is stale. The SPA clears it on
  401; sign in again. On the single-Worker URL, clear the `hyd_session` cookie.
- **WebSocket 403 / closes immediately** -> the page `Origin` is not the Worker's own or allowlisted. Close code 4001
  means the ticket was missing/expired (the SPA fetches a fresh one on every reconnect; check the device clock and that
  `POST /api/ws-ticket` returns 200).
- **404 on `/api/...` at the Vercel URL** -> the SPA was built without `VITE_API_ORIGIN` (it called Vercel itself).
  Set the variable and redeploy.
- **Stale app after a deploy** -> hard-reload; `/sw.js` and `index.html` are served `no-cache`. Unregister the
  service worker in DevTools -> Application if a very old build lingers.
- **`/lobby/ABC234` is a 404 on refresh (Vercel)** -> `vercel.json` was not deployed; the rewrite is required.
