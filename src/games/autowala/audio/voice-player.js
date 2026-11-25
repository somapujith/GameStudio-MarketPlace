// OWNER: voice agent. The playback side of the voices: loads index.json + the line files (static, same origin: CSP
// connect-src 'self'), decodes each once, plays through the shared Web Audio context (audio/ctx.js), positionally for
// customer voices, and degrades gracefully when a file is missing:
//   file -> (no file) speechSynthesis te-IN voice if the browser has one -> (none) a short chime + the subtitle only.
// Nothing here talks to any AI/voice API: the audio was generated offline by scripts/gen-voicelines.mjs.
import { getAudio, isMuted } from './ctx.js';
import { getBuses } from './sound-bus.js';
import { PERSONAS } from './voiceLines.js';
import { spatial, estimateMs } from './voice-math.js';

export const VOICE_BASE = '/audio/autowala/voices/';

const hasSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

export function createVoicePlayer({ base = VOICE_BASE, fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null, settings = () => ({}) } = {}) {
  let index = null; // { version, generated, lines: { id: { file, ms, persona } } }
  const buffers = new Map(); // id -> AudioBuffer | null (null = known missing / undecodable) | Promise
  const live = new Set();
  let teVoice;
  let disposed = false;

  const player = {
    /** Fetches index.json once. A 404 (no files generated yet) or an HTML fallback page is the normal "no audio" state. */
    async loadIndex() {
      if (!fetchFn) return null;
      try {
        const res = await fetchFn(`${base}index.json`, { cache: 'no-cache' });
        if (!res.ok || /html/i.test(res.headers?.get?.('content-type') || '')) return null;
        const json = await res.json();
        if (json && typeof json === 'object' && json.lines && typeof json.lines === 'object') index = json;
      } catch {
        /* offline or not JSON: no audio, subtitles only */
      }
      return index;
    },
    hasFile: (id) => !!index?.lines?.[id]?.file,
    fileCount: () => (index ? Object.keys(index.lines).length : 0),
    /** The audio length we expect for a line (the index's ms, else a text-length estimate). */
    expectedMs(line) {
      const ms = index?.lines?.[line.id]?.ms;
      return Number.isFinite(ms) && ms > 0 ? ms : estimateMs(line.te);
    },
    /** Fetch + decode one line (cached). Resolves to an AudioBuffer or null. */
    async buffer(id) {
      if (buffers.has(id)) return buffers.get(id);
      const entry = index?.lines?.[id];
      const a = getAudio();
      if (!entry?.file || !a || !fetchFn) return null;
      const job = (async () => {
        try {
          const res = await fetchFn(`${base}${encodeURIComponent(entry.file)}`);
          if (!res.ok || /html/i.test(res.headers?.get?.('content-type') || '')) return null;
          const data = await res.arrayBuffer();
          const buf = await a.ac.decodeAudioData(data);
          if (buf?.duration) entry.ms = Math.round(buf.duration * 1000); // the real length beats the generator's estimate
          return buf;
        } catch {
          return null;
        }
      })();
      buffers.set(id, job);
      const buf = await job;
      buffers.set(id, buf);
      return buf;
    },
    /** Warm the cache for these ids a little at a time (the hero lines), never blocking anything. */
    preload(ids) {
      let i = 0;
      const next = () => {
        if (disposed || i >= ids.length) return;
        const id = ids[i++];
        if (!player.hasFile(id)) return next();
        player.buffer(id).finally(() => setTimeout(next, 120));
      };
      next();
    },

    /**
     * Speak one line now. `pos` {x,z} + `listener` {x,z,rx,rz} make it positional. Calls `onEnd()` once when it is over (or
     * immediately for a silent subtitle). Resolves to { mode: 'file'|'speech'|'chime'|'silent', ms, stop() }.
     */
    async play(line, { pos = null, listener = null, onEnd = () => {} } = {}) {
      const cfg = settings();
      const quiet = isMuted() || cfg.sound === false || cfg.voice === false;
      let sp = pos && listener ? spatial(listener, pos) : null;
      const finishOnce = (() => {
        let done = false;
        return () => {
          if (!done) {
            done = true;
            onEnd();
          }
        };
      })();
      const handle = { mode: 'silent', ms: player.expectedMs(line), stop: finishOnce, update() {} };
      if (quiet) {
        setTimeout(finishOnce, Math.min(handle.ms, 2500));
        return handle;
      }
      const a = getAudio();
      const persona = PERSONAS[line.persona];
      const hero = line.persona === 'mega_hero';

      // build the output chain: [source] -> lowpass -> gain -> panner -> master (+ a slapback echo for the hero)
      const chain = (srcNode) => {
        if (!a) return null;
        const { ac } = a;
        const master = getBuses()?.voice ?? a.master; // the voices slider (sound agent's bus), else straight to master
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = sp ? sp.cutoff : 16000;
        const g = ac.createGain();
        const vol = hero ? 1.0 : line.category === 'complaint_crash' ? 0.95 : 0.85;
        g.gain.value = vol * (sp ? sp.gain : 1);
        const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
        if (pan) pan.pan.value = sp ? sp.pan : 0;
        srcNode.connect(lp);
        lp.connect(g);
        const out = pan || g;
        if (pan) g.connect(pan);
        out.connect(master);
        let echo = null;
        if (hero) {
          const d = ac.createDelay(0.5);
          d.delayTime.value = 0.095;
          const fb = ac.createGain();
          fb.gain.value = 0.24;
          const wet = ac.createGain();
          wet.gain.value = 0.2;
          g.connect(d);
          d.connect(fb);
          fb.connect(d);
          d.connect(wet);
          wet.connect(master);
          echo = [d, fb, wet];
        }
        handle.update = (lis) => {
          if (!pos || !lis) return;
          sp = spatial(lis, pos);
          const t = ac.currentTime;
          g.gain.setTargetAtTime(vol * sp.gain, t, 0.05);
          if (pan) pan.pan.setTargetAtTime(sp.pan, t, 0.05);
          lp.frequency.setTargetAtTime(sp.cutoff, t, 0.1);
        };
        return { nodes: [lp, g, pan, ...(echo || [])].filter(Boolean) };
      };

      // 1) the recorded file
      if (a && player.hasFile(line.id)) {
        const buf = await player.buffer(line.id);
        if (buf && !disposed) {
          const src = a.ac.createBufferSource();
          src.buffer = buf;
          const c = chain(src);
          handle.mode = 'file';
          handle.ms = Math.round(buf.duration * 1000);
          let stopped = false;
          const cleanup = () => {
            if (stopped) return;
            stopped = true;
            live.delete(handle);
            try {
              src.disconnect();
              c.nodes.forEach((n) => n.disconnect());
            } catch {
              /* already disconnected */
            }
          };
          src.onended = () => {
            // the hero's echo tail rings out a moment after the last sample
            setTimeout(cleanup, hero ? 700 : 0);
            finishOnce();
          };
          handle.stop = () => {
            try {
              src.stop();
            } catch {
              /* not started */
            }
            cleanup();
            finishOnce();
          };
          src.start();
          live.add(handle);
          return handle;
        }
      }

      // 2) the browser's own Telugu voice, when it has one
      const synth = hasSpeech() ? window.speechSynthesis : null;
      if (synth) {
        if (teVoice === undefined) {
          const pick = () => synth.getVoices().find((v) => /^te([-_]|$)/i.test(v.lang)) || null;
          teVoice = pick();
          if (!teVoice) synth.addEventListener?.('voiceschanged', () => { teVoice = pick() || null; }, { once: true });
        }
        if (teVoice) {
          const u = new SpeechSynthesisUtterance(line.te);
          u.voice = teVoice;
          u.lang = teVoice.lang;
          u.pitch = persona?.speech?.pitch ?? 1;
          u.rate = persona?.speech?.rate ?? 1;
          u.volume = sp ? Math.max(0.05, sp.gain) : 1;
          const guard = setTimeout(finishOnce, handle.ms * 2 + 2000);
          u.onend = u.onerror = () => {
            clearTimeout(guard);
            live.delete(handle);
            finishOnce();
          };
          handle.mode = 'speech';
          handle.stop = () => {
            clearTimeout(guard);
            try {
              synth.cancel();
            } catch {
              /* ignore */
            }
            live.delete(handle);
            finishOnce();
          };
          live.add(handle);
          try {
            synth.speak(u);
          } catch {
            handle.stop();
          }
          return handle;
        }
      }

      // 3) a short chime (a gold arpeggio for the hero), then a silent subtitle
      if (a) {
        const { ac } = a;
        const notes = hero ? [523.25, 659.25, 783.99] : persona?.speech?.pitch > 1.1 ? [784, 988] : [587.33, 698.46];
        const tone = ac.createGain();
        const c = chain(tone);
        const t0 = ac.currentTime + 0.01;
        notes.forEach((f, i) => {
          const o = ac.createOscillator();
          o.type = hero ? 'triangle' : 'sine';
          o.frequency.value = f;
          const e = ac.createGain();
          e.gain.setValueAtTime(0, t0 + i * 0.09);
          e.gain.linearRampToValueAtTime(0.16, t0 + i * 0.09 + 0.012);
          e.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.09 + 0.2);
          o.connect(e);
          e.connect(tone);
          o.start(t0 + i * 0.09);
          o.stop(t0 + i * 0.09 + 0.22);
        });
        handle.mode = 'chime';
        setTimeout(() => {
          try {
            tone.disconnect();
            c.nodes.forEach((n) => n.disconnect());
          } catch {
            /* ignore */
          }
        }, 600);
      }
      setTimeout(finishOnce, Math.min(handle.ms, 3000));
      return handle;
    },

    stopAll() {
      for (const h of [...live]) h.stop();
      live.clear();
    },
    dispose() {
      disposed = true;
      player.stopAll();
      if (hasSpeech()) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
    },
  };
  return player;
}
