import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFS, PREFS_KEY, createPrefsStore, nextOption, normalizePrefs, readPrefs, SUB_OPTIONS, voiceAvailable, voiceNotice } from './prefs.js';

const memory = (seed) => {
  const data = new Map(seed ? [[PREFS_KEY, JSON.stringify(seed)]] : []);
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
};

describe('prefs', () => {
  it('uses the documented key and the default: Auto, native + English, voices on', () => {
    expect(PREFS_KEY).toBe('jalebi.tiffin.prefs.v1');
    expect(DEFAULT_PREFS).toEqual({ lang: 'auto', subs: 'both', voices: true });
  });
  it('repairs anything stored', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ lang: 'klingon', subs: 7, voices: 'yes' })).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ lang: 'te', subs: 'roman', voices: false })).toEqual({ lang: 'te', subs: 'roman', voices: false });
  });
  it('reads and writes through storage, and tells subscribers', () => {
    const st = memory({ lang: 'hi' });
    const store = createPrefsStore(st);
    expect(store.get().lang).toBe('hi');
    let n = 0;
    const off = store.subscribe(() => (n += 1));
    store.set({ subs: 'english' });
    store.set({ subs: 'english' }); // no change: no notice
    expect(n).toBe(1);
    expect(JSON.parse(st.data.get(PREFS_KEY))).toEqual({ lang: 'hi', subs: 'english', voices: true });
    off();
    store.set({ voices: false });
    expect(n).toBe(1);
  });
  it('survives broken or missing storage', () => {
    expect(readPrefs({ getItem: () => 'not json' })).toEqual(DEFAULT_PREFS);
    expect(readPrefs({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_PREFS);
    const store = createPrefsStore({ getItem: () => null, setItem: () => { throw new Error('full'); } });
    expect(store.set({ lang: 'dk' }).lang).toBe('dk');
    expect(createPrefsStore(null).get()).toEqual(DEFAULT_PREFS);
  });
  it('cycles options', () => {
    expect(nextOption(SUB_OPTIONS, 'both')).toBe('native');
    expect(nextOption(SUB_OPTIONS, 'english')).toBe('both');
  });
});

describe('voice availability', () => {
  it('asks whichever accessor the audio object has, and says null when it cannot tell', () => {
    expect(voiceAvailable(null, 'te')).toBeNull();
    expect(voiceAvailable({}, 'te')).toBeNull();
    expect(voiceAvailable({ isSpeechAvailable: (l) => l === 'hi' }, 'te')).toBe(false);
    expect(voiceAvailable({ speech: { isAvailable: (l) => l === 'te' } }, 'te')).toBe(true);
    expect(voiceAvailable({ isAvailable: () => true }, 'te')).toBe(true);
  });
  it('notice: names the missing language, stays quiet when voices are off or unknown', () => {
    const noTelugu = { isSpeechAvailable: (l) => l !== 'te' };
    expect(voiceNotice({ lang: 'auto', voices: true }, noTelugu)).toContain('No Telugu voice on this device');
    expect(voiceNotice({ lang: 'hi', voices: true }, noTelugu)).toBe('');
    expect(voiceNotice({ lang: 'te', voices: false }, noTelugu)).toBe('');
    expect(voiceNotice({ lang: 'te', voices: true }, {})).toBe('');
    expect(voiceNotice({ lang: 'mixed', voices: true }, { isSpeechAvailable: () => false })).toContain('No Hindi voice on this device');
    expect(voiceNotice({ lang: 'dk', voices: true }, { isSpeechAvailable: (l) => l === 'te' })).toContain('No Hindi voice');
  });
});
