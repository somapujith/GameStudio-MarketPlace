// Tiffin Centre player preferences: spoken language, subtitle style, voices on/off. One small store shared by the HUD quick toggles,
// the pause menu and the dialogue hook, persisted in localStorage under `jalebi.tiffin.prefs.v1`.
import { useSyncExternalStore } from 'react';

export const PREFS_KEY = 'jalebi.tiffin.prefs.v1';

/** What the customers speak: Auto lets the dialogue director choose per customer kind; the others force one language. */
export const LANG_OPTIONS = [
  { id: 'auto', label: 'Auto', hint: 'A mix that suits each customer' },
  { id: 'te', label: 'తెలుగు', hint: 'Telugu' },
  { id: 'hi', label: 'हिन्दी', hint: 'Hindi' },
  { id: 'dk', label: 'Hyderabadi', hint: 'Dakhni Hindi-Urdu' },
  { id: 'mixed', label: 'Mixed', hint: 'All three at the same stall' },
];
/** Subtitle style: native script + a small English gloss (default), native only, Roman letters, or English only. */
export const SUB_OPTIONS = [
  { id: 'both', label: 'Native + English' },
  { id: 'native', label: 'Native script' },
  { id: 'roman', label: 'Roman letters' },
  { id: 'english', label: 'English' },
];
export const DEFAULT_PREFS = Object.freeze({ lang: 'auto', subs: 'both', voices: true });

const LANG_IDS = LANG_OPTIONS.map((o) => o.id);
const SUB_IDS = SUB_OPTIONS.map((o) => o.id);

/** Anything stored (or nothing) -> a complete, valid prefs object. */
export function normalizePrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    lang: LANG_IDS.includes(r.lang) ? r.lang : DEFAULT_PREFS.lang,
    subs: SUB_IDS.includes(r.subs) ? r.subs : DEFAULT_PREFS.subs,
    voices: typeof r.voices === 'boolean' ? r.voices : DEFAULT_PREFS.voices,
  };
}

const defaultStorage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function readPrefs(storage = defaultStorage()) {
  try {
    const s = storage?.getItem(PREFS_KEY);
    return normalizePrefs(s ? JSON.parse(s) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** A prefs store: get / set(patch) / subscribe. Reads storage lazily and never throws (private mode, blocked storage). */
export function createPrefsStore(storage) {
  let cur = null;
  const subs = new Set();
  const store = {
    get() {
      if (!cur) cur = readPrefs(storage === undefined ? defaultStorage() : storage);
      return cur;
    },
    set(patch) {
      const next = normalizePrefs({ ...store.get(), ...(patch || {}) });
      if (next.lang === cur.lang && next.subs === cur.subs && next.voices === cur.voices) return cur;
      cur = next;
      try {
        (storage === undefined ? defaultStorage() : storage)?.setItem(PREFS_KEY, JSON.stringify(cur));
      } catch {
        /* storage full or blocked: the choice still holds for this visit */
      }
      subs.forEach((fn) => fn());
      return cur;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** Test helper: forget the cached value so the next get() reads storage again. */
    reload() {
      cur = null;
    },
  };
  return store;
}

export const prefsStore = createPrefsStore();
const SERVER = { ...DEFAULT_PREFS };

/** [prefs, setPrefs(patch)] backed by the shared store. */
export function usePrefs() {
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.get, () => SERVER);
  return [prefs, prefsStore.set];
}

/** The next value after `current` in a list of option ids (for a cycle button). */
export function nextOption(list, current) {
  const i = list.findIndex((o) => o.id === current);
  return list[(i + 1) % list.length].id;
}

/**
 * Is there a voice for this language on this device? true | false | null (unknown: the audio object has no way to tell yet).
 * Reads whichever of the audio object's accessors exists: audio.isSpeechAvailable(lang), audio.speech.isAvailable(lang),
 * audio.isAvailable(lang).
 */
export function voiceAvailable(audio, lang) {
  if (!audio) return null;
  try {
    const candidates = [[audio, audio.isSpeechAvailable], [audio.speech, audio.speech?.isAvailable], [audio, audio.isAvailable]];
    for (const [self, fn] of candidates) {
      if (typeof fn !== 'function') continue;
      const r = fn.call(self, lang);
      if (typeof r === 'boolean') return r;
    }
  } catch {
    /* fall through */
  }
  return null;
}

const VOICE_NAMES = { te: 'Telugu', hi: 'Hindi' };
/**
 * The line shown by the Voices switch when a language the customers will speak has no voice on this device ('' when all is well, voices
 * are off, or the audio object cannot tell). Hyderabadi (Dakhni) is spoken with the Hindi voice.
 */
export function voiceNotice(prefs, audio) {
  if (!prefs?.voices) return '';
  const need = prefs.lang === 'te' ? ['te'] : prefs.lang === 'hi' || prefs.lang === 'dk' ? ['hi'] : ['te', 'hi'];
  const missing = need.filter((l) => voiceAvailable(audio, l) === false);
  if (!missing.length) return '';
  return `${missing.map((l) => `No ${VOICE_NAMES[l]} voice on this device`).join('. ')}. Subtitles still show every line.`;
}
