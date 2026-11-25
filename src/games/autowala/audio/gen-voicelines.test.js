// The offline generator pipeline, with the mock provider and a fake fetch: no network, no real key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  audioMs, costNote, countChars, createImagineProvider, createMockProvider, findAudioUrl, parseArgs, planFiles, run, selectLines,
} from '../../../../scripts/gen-voicelines.mjs';
import { LINES } from './voiceLines.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-voices-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const collect = () => {
  const out = [];
  return { out, log: (s) => out.push(String(s)) };
};
const fewLines = LINES.filter((l) => ['hero_first_1', 'hail_eld_m1', 'hail_reg_m1', 'crash_w'].includes(l.id));
const noSleep = async () => {};

describe('args and plan', () => {
  it('parses the documented options and refuses keys on the command line', () => {
    const a = parseArgs(['--provider', 'mock', '--only', 'mega_hero,hail_eld_m1', '--force', '--dry-run', '--concurrency', '5']);
    expect(a).toMatchObject({ provider: 'mock', only: ['mega_hero', 'hail_eld_m1'], force: true, dryRun: true, concurrency: 5 });
    expect(parseArgs([]).provider).toBe('imagine');
    expect(parseArgs(['--api-key', 'abc']).errors.join(' ')).toMatch(/never accepted as arguments/);
    expect(parseArgs(['--key=abc']).errors.length).toBe(1);
    expect(parseArgs(['--bogus']).errors[0]).toMatch(/Unknown argument/);
  });

  it('selects by persona, id or category and counts characters', () => {
    expect(selectLines(LINES, ['mega_hero']).every((l) => l.persona === 'mega_hero')).toBe(true);
    expect(selectLines(LINES, ['hail_eld_m1']).map((l) => l.id)).toEqual(['hail_eld_m1']);
    expect(selectLines(LINES, null).length).toBe(LINES.length);
    expect(countChars([{ line: { te: 'ఆటో!' } }])).toBe(4);
  });

  it('plans new / skip / force from what is on disk', () => {
    fs.writeFileSync(path.join(dir, 'hail_eld_m1.mp3'), 'x');
    const p = planFiles({ lines: fewLines, dir });
    expect(p.find((x) => x.line.id === 'hail_eld_m1').status).toBe('skip');
    expect(p.filter((x) => x.status === 'new').length).toBe(fewLines.length - 1);
    expect(planFiles({ lines: fewLines, dir, force: true }).find((x) => x.line.id === 'hail_eld_m1').status).toBe('force');
  });

  it('costNote only gives a figure when the operator supplies a rate', () => {
    expect(costNote(2000, {})).toMatch(/publish no text-to-speech price/);
    expect(costNote(2000, { IMAGINE_COST_PER_1K_CHARS: '0.5' })).toMatch(/1\.00/);
  });
});

describe('pipeline with the mock provider', () => {
  it('writes the files and an index.json of the documented shape', async () => {
    const { out, log } = collect();
    const code = await run(['--provider', 'mock', '--out', dir], { lines: fewLines, log, env: {}, sleep: noSleep });
    expect(code).toBe(0);
    const files = fs.readdirSync(dir).sort();
    expect(files).toContain('index.json');
    for (const l of fewLines) expect(files).toContain(`${l.id}.wav`);
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    expect(idx.version).toBe(1);
    expect(new Date(idx.generated).toString()).not.toBe('Invalid Date');
    expect(Object.keys(idx.lines).sort()).toEqual(fewLines.map((l) => l.id).sort());
    for (const l of fewLines) {
      expect(idx.lines[l.id]).toEqual({ file: `${l.id}.wav`, ms: expect.any(Number), persona: l.persona });
      expect(idx.lines[l.id].ms).toBeGreaterThan(300);
    }
    expect(out.join('\n')).toMatch(/Characters to synthesise: \d+/);
  });

  it('skips existing files unless --force, and keeps their index entries', async () => {
    const { log } = collect();
    await run(['--provider', 'mock', '--out', dir], { lines: fewLines, log, env: {}, sleep: noSleep });
    const f = path.join(dir, 'hail_eld_m1.wav');
    fs.writeFileSync(f, Buffer.concat([fs.readFileSync(f), Buffer.from('MARK')]));
    const sizeBefore = fs.statSync(f).size;

    const second = collect();
    await run(['--provider', 'mock', '--out', dir], { lines: fewLines, log: second.log, env: {}, sleep: noSleep });
    expect(fs.statSync(f).size).toBe(sizeBefore); // untouched
    expect(second.out.join('\n')).toMatch(/0 to generate, 4 already on disk/);
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).lines).length).toBe(fewLines.length);

    await run(['--provider', 'mock', '--out', dir, '--force', '--only', 'hail_eld_m1'], { lines: fewLines, log, env: {}, sleep: noSleep });
    expect(fs.statSync(f).size).toBeLessThan(sizeBefore); // regenerated
  });

  it('--dry-run writes nothing and calls nothing', async () => {
    const { out, log } = collect();
    const code = await run(['--provider', 'mock', '--dry-run', '--out', dir], { lines: fewLines, log, env: {}, sleep: noSleep });
    expect(code).toBe(0);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(out.join('\n')).toMatch(/Dry run/);
  });

  it('--only limits the work, and the mock files are tiny', async () => {
    const { log } = collect();
    await run(['--provider', 'mock', '--only', 'mega_hero', '--out', dir], { lines: LINES, log, env: {}, sleep: noSleep });
    const wavs = fs.readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(wavs.length).toBe(LINES.filter((l) => l.persona === 'mega_hero').length);
    for (const f of wavs) expect(fs.statSync(path.join(dir, f)).size).toBeLessThan(20000);
    expect(audioMs(new Uint8Array(fs.readFileSync(path.join(dir, wavs[0]))), 'wav')).toBeGreaterThan(300);
  });

  it('retries a flaky provider with backoff, then gives up on a fatal error', async () => {
    const { out, log } = collect();
    let calls = 0;
    const waits = [];
    const flaky = () => ({ generate: async (r) => { if (++calls < 3) throw new Error('boom'); return createMockProvider().generate(r); } });
    const code = await run(['--provider', 'flaky', '--out', dir, '--concurrency', '1'], {
      lines: fewLines.slice(0, 1), log, env: {}, sleep: async (ms) => { waits.push(ms); }, providerFactory: { flaky },
    });
    expect(code).toBe(0);
    expect(calls).toBe(3);
    expect(waits).toEqual([1000, 2000]);

    const fatal = () => ({ generate: async () => { const e = new Error('HTTP 401'); e.fatal = true; throw e; } });
    const code2 = await run(['--provider', 'fatal', '--out', dir, '--force'], { lines: fewLines, log, env: {}, sleep: noSleep, providerFactory: { fatal } });
    expect(code2).toBe(1);
    expect(out.join('\n')).toMatch(/Stopped early/);
  });
});

describe('key handling', () => {
  it('without IMAGINE_API_KEY it prints the PowerShell recipe and exits non-zero (nothing written)', async () => {
    const { out, log } = collect();
    const code = await run(['--provider', 'imagine', '--out', dir], { lines: fewLines, log, env: {}, sleep: noSleep });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain("$env:IMAGINE_API_KEY='...'; node scripts/gen-voicelines.mjs --provider imagine");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('a dry run needs no key', async () => {
    const { log } = collect();
    expect(await run(['--provider', 'imagine', '--dry-run', '--out', dir], { lines: fewLines, log, env: {}, sleep: noSleep })).toBe(0);
  });

  it('the key never appears in logs or files, and is sent only to the API host (not the CDN)', async () => {
    const SECRET = 'sk-test-SECRET-1234567890';
    const { out, log } = collect();
    const calls = [];
    const wav = (await createMockProvider().generate({ text: 'అ' })).bytes;
    const fetchFn = async (url, init = {}) => {
      calls.push({ url: String(url), auth: init.headers?.Authorization, method: init.method, body: init.body });
      if (String(url).startsWith('https://api.imagine.art/v1/audio/generate')) {
        return new Response(JSON.stringify({ status: 'success', id: 'g1', data: { id: 'g1', status: 'pending' } }), { status: 202 });
      }
      if (String(url).includes('/generations/g1/status')) {
        return new Response(JSON.stringify({ status: 'success', data: { id: 'g1', status: 'completed', audios: [{ url: 'https://cdn.example/out.wav?sig=1' }] } }));
      }
      if (String(url).startsWith('https://cdn.example/')) return new Response(wav, { headers: { 'content-type': 'audio/wav' } });
      return new Response('nope', { status: 404 });
    };
    const env = { IMAGINE_API_KEY: SECRET, IMAGINE_TTS_MODEL: 'tts-model-x' };
    const code = await run(['--provider', 'imagine', '--out', dir, '--concurrency', '1'], { lines: fewLines.slice(0, 2), log, env, fetchFn, sleep: noSleep });
    expect(code).toBe(0);
    expect(out.join('\n')).not.toContain(SECRET);
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f)).toString('latin1')).not.toContain(SECRET);
    const api = calls.filter((c) => c.url.startsWith('https://api.imagine.art/'));
    expect(api.length).toBeGreaterThanOrEqual(4);
    for (const c of api) expect(c.auth).toBe(`Bearer ${SECRET}`);
    for (const c of calls.filter((x) => x.url.startsWith('https://cdn.example/'))) expect(c.auth).toBeUndefined();
    const post = JSON.parse(calls.find((c) => c.method === 'POST').body);
    expect(post.model).toBe('tts-model-x');
    expect(post.input.language).toBe('te');
    expect(post.input.text).toMatch(/[ఀ-౿]/);
    expect(JSON.stringify(post)).not.toContain(SECRET);
  });

  it('redacts the key even if an error message contains it', async () => {
    const SECRET = 'sk-test-LEAKY-0987654321';
    const { out, log } = collect();
    const leaky = () => ({ generate: async () => { const e = new Error(`bad request with ${SECRET}`); e.retryable = false; throw e; } });
    await run(['--provider', 'leaky', '--out', dir], { lines: fewLines.slice(0, 1), log, env: { IMAGINE_API_KEY: SECRET }, sleep: noSleep, providerFactory: { leaky } });
    expect(out.join('\n')).not.toContain(SECRET);
    expect(out.join('\n')).toContain('***');
  });
});

describe('imagine adapter details', () => {
  it('needs a key and a TTS model id (the docs name none), and renames input fields via IMAGINE_TTS_INPUT_MAP', async () => {
    expect(() => createImagineProvider({ env: {} })).toThrow(/IMAGINE_API_KEY/);
    const p = createImagineProvider({ env: { IMAGINE_API_KEY: 'k-12345' }, fetchFn: async () => new Response('{}') });
    await expect(p.generate({ text: 'అ', lang: 'te', persona: 'student', style: {} })).rejects.toThrow(/IMAGINE_TTS_MODEL/);
    const mapped = createImagineProvider({ env: { IMAGINE_API_KEY: 'k-12345', IMAGINE_TTS_INPUT_MAP: '{"text":"prompt","emotion":null,"pitch":null}', IMAGINE_VOICE_STUDENT: 'Some Voice' } });
    const input = mapped.buildInput({ text: 'అ', lang: 'te', persona: 'student', style: { mood: 'happy', voice: { imagine: 'Casual Guy', speed: 1.1, pitch: 1 } } });
    expect(input).toEqual({ prompt: 'అ', voice: 'Some Voice', language: 'te', speed: 1.1 });
  });

  it('finds an audio url wherever the finished generation keeps it', () => {
    expect(findAudioUrl({ audios: [{ url: 'https://c/x.mp3' }] })).toBe('https://c/x.mp3');
    expect(findAudioUrl({ audio: { url: 'https://c/blob?sig=1' } })).toBe('https://c/blob?sig=1');
    expect(findAudioUrl({ images: [{ url: 'https://c/pic.png' }] })).toBe(null);
  });

  it('reads the length from wav headers and mp3 frames', async () => {
    const wav = (await createMockProvider().generate({ text: 'x'.repeat(20) })).bytes;
    expect(audioMs(wav, 'wav')).toBeGreaterThan(300);
    // MPEG1 layer III, 128 kbps: 16000 bytes = 1000 ms
    const mp3 = new Uint8Array(16000);
    mp3.set([0xff, 0xfb, 0x90, 0x00], 0);
    expect(audioMs(mp3, 'mp3')).toBe(1000);
    expect(audioMs(new Uint8Array(10), 'mp3')).toBe(null);
  });
});
