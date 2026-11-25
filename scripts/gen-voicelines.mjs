#!/usr/bin/env node
// Autowala voice lines: generates the static audio files OFFLINE from the catalogue in
// src/games/autowala/audio/voiceLines.js and writes public/audio/autowala/voices/<id>.<ext> + index.json.
// The shipped game never calls a voice API: it only fetches these static files (CSP connect-src 'self').
//
//   node scripts/gen-voicelines.mjs [--provider imagine|mock] [--only <persona|id>[,..]] [--force] [--dry-run]
//                                   [--concurrency 3] [--out <dir>]
//
// The API key is read ONLY from the environment variable IMAGINE_API_KEY (never an argument, never printed, never written).
// In PowerShell, for one command:   $env:IMAGINE_API_KEY='...'; node scripts/gen-voicelines.mjs --provider imagine
// Swapping the TTS: add one provider factory below (createXProvider) with `generate({ text, lang, persona, style }) ->
// { bytes: Uint8Array, ext: 'mp3' | 'wav' | ... }` and register it in PROVIDERS. See docs/AUTOWALA_VOICES.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, PERSONAS, ttsRequest } from '../src/games/autowala/audio/voiceLines.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = path.join(ROOT, 'public', 'audio', 'autowala', 'voices');
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm'];

// ---------------------------------------------------------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const o = { provider: 'imagine', only: null, force: false, dryRun: false, concurrency: 3, out: null, help: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--provider') o.provider = String(val() || '');
    else if (a === '--only') o.only = String(val() || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--force') o.force = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--concurrency') o.concurrency = Math.max(1, Math.min(8, parseInt(val(), 10) || 3));
    else if (a === '--out') o.out = String(val() || '');
    else if (a === '--help' || a === '-h') o.help = true;
    else if (/^--(api-?)?key\b/i.test(a) || /^--token\b/i.test(a)) o.errors.push('API keys are never accepted as arguments (they would land in shell history). Use the IMAGINE_API_KEY environment variable.');
    else o.errors.push(`Unknown argument: ${a}`);
  }
  return o;
}

const HELP = `Usage: node scripts/gen-voicelines.mjs [options]
  --provider imagine|mock   TTS provider (default imagine; mock writes tiny placeholder wav files, no network)
  --only <persona|id>,..    only these personas (e.g. mega_hero) or line ids
  --force                   regenerate files that already exist
  --dry-run                 print the plan, character count and cost note; write nothing, call nothing
  --concurrency <n>         parallel requests (default 3, max 8)
  --out <dir>               output folder (default public/audio/autowala/voices)
Key: set IMAGINE_API_KEY in the environment (never as an argument).`;

// ---------------------------------------------------------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------------------------------------------------------
export function selectLines(lines, only) {
  if (!only?.length) return [...lines];
  const set = new Set(only);
  return lines.filter((l) => set.has(l.persona) || set.has(l.id) || set.has(l.category));
}

/** The existing audio file for an id in `dir` (any known extension), or null. */
export function findExisting(dir, id, fsApi = fs) {
  for (const ext of AUDIO_EXTS) {
    const f = `${id}.${ext}`;
    if (fsApi.existsSync(path.join(dir, f))) return f;
  }
  return null;
}

/** [{ line, status: 'new' | 'skip' | 'force', existing }] for the selected lines. */
export function planFiles({ lines, dir, force = false, fsApi = fs }) {
  return lines.map((line) => {
    const existing = findExisting(dir, line.id, fsApi);
    return { line, existing, status: existing ? (force ? 'force' : 'skip') : 'new' };
  });
}

export const countChars = (items) => items.reduce((n, it) => n + [...(it.line?.te ?? it.te ?? '')].length, 0);

/** Pricing is NOT documented for TTS (see docs/AUTOWALA_VOICES.md): only an operator-supplied rate gives a figure. */
export function costNote(chars, env = {}) {
  const rate = Number(env.IMAGINE_COST_PER_1K_CHARS);
  if (Number.isFinite(rate) && rate > 0) return `estimated cost: ${((chars / 1000) * rate).toFixed(2)} (at IMAGINE_COST_PER_1K_CHARS=${rate} per 1000 characters)`;
  return 'cost: the imagine.art docs publish no text-to-speech price; check GET https://api.imagine.art/v1/cost or your dashboard (or set IMAGINE_COST_PER_1K_CHARS for an estimate)';
}

// ---------------------------------------------------------------------------------------------------------------------------
// audio length estimates (no dependencies)
// ---------------------------------------------------------------------------------------------------------------------------
const MP3_KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Length in ms of generated audio: wav from its header, mp3 from its first frame's bitrate; null when unknown. */
export function audioMs(bytes, ext) {
  try {
    const b = bytes;
    if (ext === 'wav' && b.length > 44) {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const byteRate = dv.getUint32(28, true);
      return byteRate ? Math.round(((b.length - 44) / byteRate) * 1000) : null;
    }
    if (ext === 'mp3') {
      let p = 0;
      if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) p = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
      for (; p + 4 < b.length; p++) {
        if (b[p] === 0xff && (b[p + 1] & 0xe0) === 0xe0) {
          const ver = (b[p + 1] >> 3) & 3; // 3 = MPEG1
          const layer = (b[p + 1] >> 1) & 3; // 1 = layer III
          const br = (b[p + 2] >> 4) & 15;
          if (layer !== 1 || br === 0 || br === 15 || ver === 1) continue;
          const kbps = (ver === 3 ? MP3_KBPS_V1 : MP3_KBPS_V2)[br];
          return Math.round(((b.length - p) * 8) / kbps);
        }
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}
const guessMs = (text) => Math.min(4500, Math.max(900, [...text].length * 75));

// ---------------------------------------------------------------------------------------------------------------------------
// providers: generate({ text, lang, persona, style }) -> { bytes, ext }
// ---------------------------------------------------------------------------------------------------------------------------
export class ProviderError extends Error {
  constructor(message, { retryable = true, fatal = false, retryAfterMs = 0 } = {}) {
    super(message);
    this.retryable = retryable;
    this.fatal = fatal;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Placeholder audio for tests and dry pipelines: a short, quiet 8 kHz 8-bit mono wav blip (a few KB). No network. */
export function createMockProvider() {
  return {
    name: 'mock',
    async generate({ text }) {
      const rate = 8000;
      const n = Math.round((rate * guessMs(text)) / 1000 / 2); // half the estimate: placeholders stay tiny
      const pcm = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const env = Math.min(1, i / 400) * Math.min(1, (n - i) / 400);
        pcm[i] = 128 + Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 10 * env);
      }
      const head = new Uint8Array(44);
      const dv = new DataView(head.buffer);
      const w = (o, s) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
      w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
      w(36, 'data'); dv.setUint32(40, n, true);
      const bytes = new Uint8Array(44 + n);
      bytes.set(head, 0);
      bytes.set(pcm, 44);
      return { bytes, ext: 'wav' };
    },
  };
}

const AUDIO_URL_RE = /\.(mp3|wav|ogg|m4a|aac)(\?|$)/i;
/** Finds the generated audio URL in a finished generation. UNVERIFIED shape: images live in `images[].url` (documented); audio is guessed. */
export function findAudioUrl(data) {
  const seen = new Set();
  const walk = (v, key = '') => {
    if (!v || seen.has(v)) return null;
    if (typeof v === 'string') return /^https?:\/\//i.test(v) && (AUDIO_URL_RE.test(v) || /audio|voice|speech/i.test(key)) ? v : null;
    if (typeof v !== 'object') return null;
    seen.add(v);
    for (const [k, x] of Object.entries(v)) {
      const hit = walk(x, /^url$/i.test(k) ? key : k);
      if (hit) return hit;
    }
    return null;
  };
  return walk(data);
}

/**
 * imagine.art adapter.  VERIFIED (docs.imagine.art/api/*, read 2026-11-25): base https://api.imagine.art/v1, `Authorization: Bearer <key>`,
 * generations are async: POST /<kind>/generate {model, input} -> 202 {id, data.status:'pending'}, poll GET /generations/{id}/status until
 * data.status is 'completed' | 'failed', 429 carries Retry-After, output URLs are signed CDN links.
 * UNVERIFIED (the public API docs list NO text-to-speech model): the TTS path (default /audio/generate), the model id (you must set
 * IMAGINE_TTS_MODEL), the `input` field names (text, voice, language, speed, emotion, pitch: rename/drop via IMAGINE_TTS_INPUT_MAP) and where
 * the audio URL sits in the finished generation (searched by findAudioUrl). Expect to adjust these once imagine.art publishes the TTS API.
 */
export function createImagineProvider({ env = process.env, fetchFn = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 3000, maxPolls = 100 } = {}) {
  const key = env.IMAGINE_API_KEY;
  if (!key) throw new ProviderError('IMAGINE_API_KEY is not set', { retryable: false, fatal: true });
  const base = String(env.IMAGINE_API_BASE || 'https://api.imagine.art/v1').replace(/\/+$/, '');
  const ttsPath = env.IMAGINE_TTS_PATH || '/audio/generate';
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let inputMap = {};
  try {
    inputMap = env.IMAGINE_TTS_INPUT_MAP ? JSON.parse(env.IMAGINE_TTS_INPUT_MAP) : {};
  } catch {
    throw new ProviderError('IMAGINE_TTS_INPUT_MAP is not valid JSON', { retryable: false, fatal: true });
  }

  const api = async (method, url, body) => {
    let res;
    try {
      res = await fetchFn(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      throw new ProviderError(`network error: ${err?.message || err}`);
    }
    if (res.status === 429) throw new ProviderError('rate limited (429)', { retryAfterMs: (Number(res.headers?.get?.('retry-after')) || 5) * 1000 });
    if ([400, 401, 402, 403, 404, 422].includes(res.status)) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j?.error?.message || j?.message || '';
      } catch {
        /* no body */
      }
      throw new ProviderError(`HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 160)}` : ''}`, { retryable: false, fatal: [401, 402, 403].includes(res.status) });
    }
    if (!res.ok) throw new ProviderError(`HTTP ${res.status}`);
    return res.json();
  };

  /** The `input` object sent to the model, with the field names renamed / dropped by IMAGINE_TTS_INPUT_MAP (null drops a field). */
  const buildInput = ({ text, lang, persona, style }) => {
    const voice = env[`IMAGINE_VOICE_${String(persona).toUpperCase()}`] || style?.voice?.imagine || PERSONAS[persona]?.voice?.imagine;
    const raw = { text, voice, language: lang, speed: style?.voice?.speed, emotion: style?.mood, pitch: style?.voice?.pitch };
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const name = k in inputMap ? inputMap[k] : k;
      if (name && v !== undefined && v !== null) out[name] = v;
    }
    return out;
  };

  return {
    name: 'imagine',
    buildInput,
    async generate(req) {
      const model = env.IMAGINE_TTS_MODEL;
      if (!model) throw new ProviderError('IMAGINE_TTS_MODEL is not set (the docs name no TTS model id; copy one from GET /models or the dashboard)', { retryable: false, fatal: true });
      const first = await api('POST', `${base}${ttsPath}`, { model, input: buildInput(req) });
      const id = first?.id ?? first?.data?.id;
      if (!id) throw new ProviderError('no generation id in the response', { retryable: false });
      let data = first?.data;
      for (let i = 0; i < maxPolls && data?.status !== 'completed'; i++) {
        if (data?.status === 'failed') throw new ProviderError('generation failed upstream');
        await sleep(pollMs);
        data = (await api('GET', `${base}/generations/${encodeURIComponent(id)}/status`))?.data;
      }
      if (data?.status !== 'completed') throw new ProviderError('timed out waiting for the generation');
      const url = findAudioUrl(data);
      if (!url) throw new ProviderError('finished, but no audio URL was found in the response (UNVERIFIED response shape)', { retryable: false });
      // The CDN link is signed: fetch it WITHOUT the API key.
      let res;
      try {
        res = await fetchFn(url);
      } catch (err) {
        throw new ProviderError(`download failed: ${err?.message || err}`);
      }
      if (!res.ok) throw new ProviderError(`download HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ct = res.headers?.get?.('content-type') || '';
      const ext = /wav/i.test(ct) ? 'wav' : /ogg/i.test(ct) ? 'ogg' : /mp4|m4a|aac/i.test(ct) ? 'm4a' : (AUDIO_URL_RE.exec(url)?.[1] || 'mp3').toLowerCase();
      return { bytes, ext };
    },
  };
}

export const PROVIDERS = { mock: createMockProvider, imagine: createImagineProvider };

// ---------------------------------------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------------------------------------
const redactor = (secret) => (s) => {
  const str = String(s);
  return secret && secret.length > 3 ? str.split(secret).join('***') : str;
};

async function withRetry(fn, { tries = 4, baseMs = 1000, sleep, log, label }) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err?.retryable === false || err?.fatal || i === tries - 1) break;
      const wait = Math.max(err?.retryAfterMs || 0, baseMs * 2 ** i);
      log(`  retry ${i + 1}/${tries - 1} for ${label} in ${Math.round(wait / 100) / 10}s (${err?.message || err})`);
      await sleep(wait);
    }
  }
  throw last;
}

export const KEY_HELP = `IMAGINE_API_KEY is not set.
Set it for ONE command in PowerShell (it lives only in this session; nothing is written to disk):
  $env:IMAGINE_API_KEY='...'; node scripts/gen-voicelines.mjs --provider imagine
Afterwards you can clear it with:  Remove-Item Env:IMAGINE_API_KEY
Try the pipeline without a key:  node scripts/gen-voicelines.mjs --provider mock --dry-run`;

/**
 * The whole job, injectable for tests. Returns the process exit code.
 * io: { env, fetchFn, sleep, log (line) => void, fsApi, lines, providerFactory }
 */
export async function run(argv, io = {}) {
  const env = io.env ?? process.env;
  const secret = env.IMAGINE_API_KEY || '';
  const redact = redactor(secret);
  const out = io.log ?? ((s) => process.stdout.write(`${s}\n`));
  const log = (s) => out(redact(s));
  const sleep = io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const fsApi = io.fsApi ?? fs;
  const allLines = io.lines ?? LINES;

  const args = parseArgs(argv);
  if (args.help) return log(HELP), 0;
  if (args.errors.length) return args.errors.forEach((e) => log(e)), log(HELP), 2;
  const factory = io.providerFactory?.[args.provider] ?? PROVIDERS[args.provider];
  if (!factory) return log(`Unknown provider "${args.provider}". Available: ${Object.keys(PROVIDERS).join(', ')}`), 2;

  const dir = path.resolve(args.out || io.outDir || DEFAULT_OUT);
  const selected = selectLines(allLines, args.only);
  if (!selected.length) return log(`No lines match --only ${args.only?.join(',')}.`), 2;
  const plan = planFiles({ lines: selected, dir, force: args.force, fsApi });
  const todo = plan.filter((p) => p.status !== 'skip');
  const chars = countChars(todo);
  log(`Voice lines: ${allLines.length} in the catalogue, ${selected.length} selected, ${todo.length} to generate, ${plan.length - todo.length} already on disk (skipped; use --force).`);
  log(`Characters to synthesise: ${chars}. Provider: ${args.provider}. Output: ${dir}`);
  if (args.provider === 'imagine') log(costNote(chars, env));

  if (args.dryRun) {
    for (const p of plan) log(`  ${p.status.padEnd(5)} ${p.line.persona.padEnd(12)} ${p.line.id}  ${p.line.roman}`);
    log('Dry run: nothing was generated or written.');
    return 0;
  }
  if (args.provider === 'imagine' && !secret) return log(KEY_HELP), 1;

  let provider;
  try {
    provider = factory({ env, fetchFn: io.fetchFn ?? globalThis.fetch, sleep });
  } catch (err) {
    log(`Cannot start provider ${args.provider}: ${err?.message || err}`);
    return 1;
  }

  fsApi.mkdirSync(dir, { recursive: true });
  const results = new Map(); // id -> { file, ms, persona }
  const failed = [];
  let fatal = null;
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !fatal) {
      const item = todo[next++];
      const { line } = item;
      try {
        const { bytes, ext } = await withRetry(() => provider.generate(ttsRequest(line)), { sleep, log, label: line.id });
        if (item.existing && item.existing !== `${line.id}.${ext}`) fsApi.rmSync(path.join(dir, item.existing), { force: true });
        const file = `${line.id}.${ext}`;
        fsApi.writeFileSync(path.join(dir, file), bytes);
        results.set(line.id, { file, ms: audioMs(bytes, ext) ?? guessMs(line.te), persona: line.persona });
        log(`  ok   ${line.id} (${bytes.length} bytes)`);
      } catch (err) {
        failed.push(line.id);
        log(`  FAIL ${line.id}: ${err?.message || err}`);
        if (err?.fatal) fatal = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, todo.length) || 1 }, worker));

  // index.json: what is on disk now (keeps entries of files this run skipped, drops entries whose file is gone)
  const indexFile = path.join(dir, 'index.json');
  let old = {};
  try {
    old = JSON.parse(fsApi.readFileSync(indexFile, 'utf8'))?.lines || {};
  } catch {
    old = {};
  }
  const lines = {};
  for (const line of allLines) {
    const fresh = results.get(line.id);
    if (fresh) {
      lines[line.id] = fresh;
      continue;
    }
    const file = findExisting(dir, line.id, fsApi);
    if (!file) continue;
    const prev = old[line.id];
    let ms = prev?.file === file ? prev.ms : null;
    if (!ms) {
      try {
        ms = audioMs(new Uint8Array(fsApi.readFileSync(path.join(dir, file))), path.extname(file).slice(1));
      } catch {
        ms = null;
      }
    }
    lines[line.id] = { file, ms: ms ?? guessMs(line.te), persona: line.persona };
  }
  fsApi.writeFileSync(indexFile, `${JSON.stringify({ version: 1, generated: new Date().toISOString(), lines }, null, 2)}\n`);
  log(`Wrote ${results.size} file(s); index.json lists ${Object.keys(lines).length} line(s).${failed.length ? ` ${failed.length} failed: ${failed.join(', ')}` : ''}`);
  if (fatal) log(`Stopped early: ${fatal.message}`);
  return failed.length || fatal ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${String(err?.message || err).split(process.env.IMAGINE_API_KEY || '\u0000').join('***')}\n`);
      process.exit(1);
    },
  );
}
