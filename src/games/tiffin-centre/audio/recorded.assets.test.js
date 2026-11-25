// The REAL recorded voice assets (public/audio/tiffin-voices) against the contract recorded.js and the dialogue lines rely on.
// The clips are produced separately: while a language has no manifest (or an empty one) its checks are skipped with a clear message.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LINES, LINE_BY_ID } from '@shared/tiffin-centre/dialogue/index.js';
import { createRecordedVoices } from './recorded.js';

const ROOT = path.resolve(process.cwd(), 'public/audio/tiffin-voices');
const LANGS = ['te', 'hi', 'dk'];

function readManifest(lang) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, `manifest.${lang}.json`), 'utf8'));
  } catch {
    return null;
  }
}

const found = LANGS.map((lang) => ({ lang, manifest: readManifest(lang) }));
const recordedLangs = found.filter((f) => f.manifest && f.manifest.lines && Object.keys(f.manifest.lines).length > 0);

describe('recorded voice assets', () => {
  if (recordedLangs.length === 0) {
    it.skip('SKIPPED: public/audio/tiffin-voices/manifest.<lang>.json are not there yet (or have no lines): the producers have not delivered', () => {});
    return;
  }
  for (const { lang } of found.filter((f) => !recordedLangs.includes(f))) {
    it.skip(`SKIPPED ${lang}: manifest.${lang}.json is missing or empty (the ${lang} clips have not been delivered yet)`, () => {});
  }

  for (const { lang, manifest } of recordedLangs) {
    describe(`manifest.${lang}.json`, () => {
      const entries = Object.entries(manifest.lines);

      it('has the documented shape', () => {
        expect(manifest.v).toBe(1);
        expect(manifest.lang).toBe(lang);
        expect(entries.length).toBeGreaterThan(0);
      });

      it('every line id is a real dialogue line of this language (not a templated one)', () => {
        const bad = [];
        for (const [id] of entries) {
          const line = LINE_BY_ID[id];
          if (!line) bad.push(`${id}: not in ALL_LINES`);
          else if (line.lang !== lang) bad.push(`${id}: belongs to ${line.lang}`);
          else if (/\{[a-z0-9]+\}/.test(line.text)) bad.push(`${id}: has a placeholder, a recording cannot match its text`);
        }
        expect(bad).toEqual([]);
        expect(ALL_LINES.length).toBeGreaterThan(0);
      });

      it('every entry points at a clip that exists, is not empty, and has a plausible length (300-12000 ms)', () => {
        const bad = [];
        for (const [id, e] of entries) {
          if (e.f !== `${lang}/${id}.mp3`) bad.push(`${id}: f is ${JSON.stringify(e.f)}`);
          const file = path.join(ROOT, String(e.f));
          let size = 0;
          try {
            size = fs.statSync(file).size;
          } catch {
            bad.push(`${id}: ${e.f} does not exist`);
            continue;
          }
          if (size < 1000) bad.push(`${id}: ${e.f} is only ${size} bytes`);
          if (!(Number.isFinite(e.ms) && e.ms >= 300 && e.ms <= 12000)) bad.push(`${id}: ms ${e.ms} outside 300-12000`);
          if (e.g !== undefined && e.g !== 'm' && e.g !== 'f') bad.push(`${id}: g ${e.g}`);
        }
        expect(bad).toEqual([]);
      });

      it('an mp3 file starts like an mp3 (ID3 tag or frame sync)', () => {
        const bad = [];
        for (const [id, e] of entries) {
          try {
            const head = fs.readFileSync(path.join(ROOT, e.f)).subarray(0, 3);
            const id3 = head.toString('latin1') === 'ID3';
            const sync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
            if (!id3 && !sync) bad.push(id);
          } catch {
            /* missing files are reported by the test above */
          }
        }
        expect(bad).toEqual([]);
      });

      it('recorded.js accepts every entry (has() is true for all of them)', async () => {
        const rec = createRecordedVoices({
          fetch: async (url) => {
            if (!url.endsWith(`manifest.${lang}.json`)) return { ok: false };
            return { ok: true, json: async () => manifest };
          },
          createAudio: () => ({ addEventListener() {} }),
          nav: {},
        });
        await rec.ensure(lang);
        const missing = entries.map(([id]) => id).filter((id) => !rec.has(id, lang));
        expect(missing).toEqual([]);
        expect(rec.hasLang(lang)).toBe(true);
      });
    });
  }
});
