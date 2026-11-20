// Static deploy config for the split Vercel + Worker setup: vercel.json (SPA fallback, caching, security headers)
// and the Worker's ALLOWED_ORIGINS var. Kept next to the CSP test in security.test.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIS_CSP_REQUIREMENTS } from './security.js';
import { allowedOrigins } from './cors.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const vercel = JSON.parse(read('vercel.json'));

const headersFor = (source) => Object.fromEntries((vercel.headers.find((h) => h.source === source)?.headers || []).map((h) => [h.key, h.value]));

function parseCsp(csp) {
  const out = {};
  for (const part of csp.split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) out[name] = vals;
  }
  return out;
}

describe('vercel.json', () => {
  it('builds with `npm run build` into dist', () => {
    expect(vercel.buildCommand).toBe('npm run build');
    expect(vercel.outputDirectory).toBe('dist');
  });

  it('rewrites client routes to index.html but never real files, /assets, /api or /ws', () => {
    expect(vercel.rewrites).toHaveLength(1);
    const [{ source, destination }] = vercel.rewrites;
    expect(destination).toBe('/index.html');
    const re = new RegExp(`^${source}$`);
    for (const route of ['/', '/lobby/ABC234', '/play/ABC234', '/join/ABC234', '/games/hyderabad-tycoon', '/leaderboard', '/friends']) {
      expect(re.test(route), route).toBe(true);
    }
    for (const file of ['/assets/index-AbC123.js', '/assets/missing-chunk.js', '/sw.js', '/manifest.webmanifest', '/favicon.svg', '/icons/hub-192.svg', '/sfx/roll.mp3', '/api/me', '/ws/user']) {
      expect(re.test(file), file).toBe(false);
    }
  });

  it('serves the service worker uncached and with root scope, and hashed assets immutable for a year', () => {
    expect(headersFor('/sw.js')).toEqual({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    expect(headersFor('/assets/(.*)')['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('mirrors the security headers of public/_headers', () => {
    const all = headersFor('/(.*)');
    expect(all['X-Content-Type-Options']).toBe('nosniff');
    expect(all['X-Frame-Options']).toBe('DENY');
    expect(all['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(all['Permissions-Policy']).toContain('camera=()');
    expect(all['Strict-Transport-Security']).toContain('max-age=');
  });

  it('CSP keeps Google sign-in working and lets the SPA reach the Worker over https and wss', () => {
    const csp = parseCsp(headersFor('/(.*)')['Content-Security-Policy']);
    for (const [directive, needed] of Object.entries(GIS_CSP_REQUIREMENTS)) {
      for (const origin of needed) expect(csp[directive], `${directive} must allow ${origin}`).toContain(origin);
    }
    expect(csp['connect-src']).toEqual(expect.arrayContaining(["'self'", 'https://*.workers.dev', 'wss:']));
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(JSON.stringify(csp)).not.toContain('unsafe-eval');
  });

  it('the CSP of the Worker-served bundle (public/_headers) is not weakened by the split mode', () => {
    expect(read('public/_headers')).toContain("connect-src 'self' https://accounts.google.com wss:");
  });
});

describe('wrangler.toml', () => {
  it('declares the allowed SPA origins as a non-secret var', () => {
    const m = /^ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m.exec(read('wrangler.toml'));
    expect(m, 'ALLOWED_ORIGINS must be set in [vars]').toBeTruthy();
    expect([...allowedOrigins({ ALLOWED_ORIGINS: m[1] })]).toContain('https://gamestudio-lac.vercel.app');
    expect(m[1]).not.toContain('*');
  });
});
