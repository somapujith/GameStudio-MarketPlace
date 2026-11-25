// Player settings (saved in profile.data.settings) and their live effects: sound on/off, the four volume levels, the Telugu labels
// switch, and the little menu click sound. Quality is saved too, but only takes effect on the next load (the renderer is built once).
import { getAudio, isMuted, setMuted } from '../../audio/ctx.js';
import { cycleQuality, masterGain, normalizeAudio } from './menuNav.js';

export function readSettings(game) {
  const s = game.ctx.profile.data.settings || {};
  return {
    quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : null,
    sound: s.sound !== false,
    audio: normalizeAudio(s.audio),
    teluguLabels: s.teluguLabels !== false,
  };
}

/** Push the saved sound settings into the shared audio graph (call after a user gesture so the context may start). */
export function applyAudio(game) {
  const s = readSettings(game);
  setMuted(!s.sound);
  const a = getAudio();
  if (a && a.master) a.master.gain.value = masterGain(s.audio.master, !s.sound);
  game.emit('audio:volume', { ...s.audio, muted: !s.sound });
}

export function applyLanguage(game) {
  const on = readSettings(game).teluguLabels;
  const root = typeof document !== 'undefined' ? document.querySelector('.aw') : null;
  if (root) root.classList.toggle('aw-no-te', !on);
}

/** Save a partial change ({ sound, audio:{...}, teluguLabels, quality }) and apply it. */
export function saveSettings(game, patch) {
  const p = game.ctx.profile;
  const cur = p.data.settings || (p.data.settings = {});
  if ('sound' in patch) cur.sound = !!patch.sound;
  if ('teluguLabels' in patch) cur.teluguLabels = !!patch.teluguLabels;
  if ('quality' in patch) cur.quality = patch.quality ?? null;
  if (patch.audio) cur.audio = normalizeAudio({ ...normalizeAudio(cur.audio), ...patch.audio });
  p.save();
  if ('sound' in patch || patch.audio) applyAudio(game);
  if ('teluguLabels' in patch) applyLanguage(game);
}

export const nextQuality = (game, dir = 1) => {
  const q = cycleQuality(readSettings(game).quality, dir);
  saveSettings(game, { quality: q });
  return q;
};

/** A tiny Web Audio blip for menu moves ('move'), selects ('ok') and backs ('back'). Silent when muted or audio is unavailable. */
export function blip(kind = 'move') {
  try {
    if (isMuted()) return;
    const a = getAudio();
    if (!a) return;
    const { ac, master } = a;
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime;
    const freq = kind === 'ok' ? [660, 990] : kind === 'back' ? [440, 330] : [520, 560];
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(freq[0], t);
    o.frequency.setValueAtTime(freq[1], t + 0.04);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.1);
  } catch {
    /* sound is optional */
  }
}
