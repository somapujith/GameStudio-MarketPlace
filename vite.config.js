import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const r = (p) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), p);
// Several dev servers can run side by side: `API_PORT=8791 vite --port 5181` proxies to that Worker.
const API_PORT = process.env.API_PORT || '8787';

// The public origin (canonical URL, og:url, absolute share images, sitemap). Defaults to the single-Worker URL that
// docs/DEPLOY.md recommends; set VITE_SITE_URL (no trailing slash) when a custom domain goes live.
const DEFAULT_SITE_URL = 'https://gamestudio-marketplace.somapujith.workers.dev';
const PUBLIC_PAGES = ['/', '/games', '/about', '/help', '/privacy', '/terms'];

const cleanOrigin = (v) => String(v || '').trim().replace(/\/+$/, '');

/** Live game ids, read from each src/games/<id>/manifest.js (the `_soon` teasers are not indexed). */
function liveGameIds() {
  const root = r('src/games');
  const ids = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    const file = path.join(root, d.name, 'manifest.js');
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    // The manifest's own top-level `id` (two-space indent), either a literal or the GAME_ID constant next to it.
    let id = /^ {2}id:[ ]*'([a-z0-9-]+)'/m.exec(src)?.[1];
    if (!id && /^ {2}id:[ ]*GAME_ID(?![A-Za-z0-9_])/m.test(src)) {
      const c = path.join(root, d.name, 'constants.js');
      if (fs.existsSync(c)) id = /GAME_ID[ ]*=[ ]*'([a-z0-9-]+)'/.exec(fs.readFileSync(c, 'utf8'))?.[1];
    }
    if (id && /^ {2}status:[ ]*'live'/m.test(src)) ids.push(id);
  }
  return ids;
}

/** Fills __SITE_URL__ in index.html, and writes sitemap.xml + the robots.txt `Sitemap:` line into the build. */
function siteUrlPlugin() {
  let site = DEFAULT_SITE_URL;
  let outDir = 'dist';
  return {
    name: 'gamehub-site-url',
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, 'VITE_');
      site = cleanOrigin(process.env.VITE_SITE_URL || env.VITE_SITE_URL) || DEFAULT_SITE_URL;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: (html) => html.split('__SITE_URL__').join(site),
    closeBundle() {
      // Only after a real build (the dev server never calls this).
      if (!fs.existsSync(outDir)) return;
      const urls = [...PUBLIC_PAGES, ...liveGameIds().map((id) => `/games/${id}`)];
      const lastmod = new Date().toISOString().slice(0, 10);
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.map((u) => `  <url><loc>${site}${u === '/' ? '/' : u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n') +
        '\n</urlset>\n';
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), xml);
      const robots = path.join(outDir, 'robots.txt');
      if (fs.existsSync(robots)) {
        const txt = fs.readFileSync(robots, 'utf8').replace(/\n*$/, '\n');
        fs.writeFileSync(robots, `${txt}Sitemap: ${site}/sitemap.xml\n`);
      }
    },
  };
}

/**
 * Tiffin Centre's 3D code is split into chunks so the solo home loads only the small shell (src/games/tiffin-centre/TiffinGame.jsx) and the heavy
 * parts load in parallel / on demand: three.js, the scene core, the models by family, the audio and the dialogue lines. Tiffin-only groups: nothing
 * else in the app is touched (rolldown's advancedChunks; `test` matches the module path).
 */
const TIFFIN_CHUNKS = [
  // React core first, so the shared runtime is not folded into a Tiffin-only chunk (that made every page preload the Tiffin audio chunk)
  { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 60 },
  // the hub's own sound libraries are used by the whole app: keep them out of the Tiffin audio chunk
  { name: 'hub-sound', test: /[\\/]src[\\/]lib[\\/](soundscape[\\/]|sfx\.js|haptics\.js|storage\.js)/, priority: 55 },
  // the game card (manifest) needs the small catalogue on every page: keep it out of the heavy chunks
  { name: 'tiffin-catalog', test: /[\\/]shared[\\/]tiffin-centre[\\/]catalog\.js/, priority: 56 },
  { name: 'tiffin-three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 50 },
  { name: 'tiffin-audio', test: /[\\/]src[\\/]games[\\/]tiffin-centre[\\/]audio[\\/]/, priority: 40 },
  { name: 'tiffin-dialogue', test: /[\\/]shared[\\/]tiffin-centre[\\/]dialogue[\\/]/, priority: 40 },
  { name: 'tiffin-people', test: /[\\/]tiffin-centre[\\/]models[\\/](face|facegen|hair|skin|bodies|limbs|clothes|customers|avatar|person|viewmodel|expressions|fabric|characters-index|charquality|baked|merge)[^\\/]*$/, priority: 30 },
  { name: 'tiffin-models', test: /[\\/]tiffin-centre[\\/]models[\\/]/, priority: 20 },
  { name: 'tiffin-scene', test: /[\\/]src[\\/]games[\\/]tiffin-centre[\\/]scene[\\/]/, priority: 20 },
];

export default defineConfig({
  plugins: [react(), siteUrlPlugin()],
  resolve: { alias: { '@shared': r('shared'), '@': r('src') } },
  server: {
    host: true,
    port: 5173,
    // `npm run dev` (Vite) + `npx wrangler dev` (Worker on :8787) side by side
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
      '/ws': { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rolldownOptions: {
      output: {
        advancedChunks: { groups: TIFFIN_CHUNKS },
      },
    },
  },
  test: {
    include: ['shared/**/*.test.js', 'worker/**/*.test.js', 'src/**/*.test.js'],
    environment: 'node',
    // the game simulations (bots, fuzz, whole tutorials) are heavy: 5 s flaked whenever the machine was busy
    testTimeout: 30000,
  },
});
