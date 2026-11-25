// Put a line into the subtitle bar. The voice agent owns audio/voices.js and ui/Subtitles.jsx; the bar renders any `voice:line`
// event that has a Telugu text, so the fares system emits one for its own lines (no audio file: text only, mode 'text').
import { KIND_COLOR, fmt, pickLine } from './fare-lines.js';

export const lineMs = (te = '', en = '') => Math.max(2200, Math.min(5600, 1500 + (te.length + en.length) * 34));

/** A speaker saying a line object { en, te }. */
export function sayLine(ctx, { id, speaker, kind = 'regular', line, driver = false }) {
  if (!line || !line.te) return false;
  const color = KIND_COLOR[driver ? 'driver' : kind] || '#fff';
  ctx.emit('voice:line', {
    id, text: line.te, te: line.te, roman: '', en: line.en,
    persona: driver ? 'driver' : kind, personaName: speaker, speaker, color, hero: false, ms: lineMs(line.te, line.en), mode: 'text',
  });
  return true;
}

/** Pick a catalogue line by key and say it: sayKey(ctx, 'accept', { speaker, kind, n, vars }). */
export function sayKey(ctx, key, { speaker, kind = 'regular', n = 0, vars = {}, driver = false } = {}) {
  const line = fmt(pickLine(key, driver ? 'any' : kind, n), vars);
  return sayLine(ctx, { id: `fare:${key}:${kind}`, speaker, kind, line, driver });
}
