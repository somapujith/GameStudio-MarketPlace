import { describe, expect, it } from 'vitest';
import { basePersona, chooseVoice, estimateMs, hashString, moodPriority, normalizeLang, parseVoiceLang, speechParams } from './speechVoices.js';

const v = (lang, extra = {}) => ({ name: `${lang}-${Object.keys(extra).join('')}`, lang, localService: true, default: false, ...extra });

describe('normalizeLang / parseVoiceLang', () => {
  it('accepts only te, hi, dk', () => {
    expect(normalizeLang('te')).toBe('te');
    expect(normalizeLang(' HI ')).toBe('hi');
    expect(normalizeLang('dk')).toBe('dk');
    expect(normalizeLang('en')).toBeNull();
    expect(normalizeLang(null)).toBeNull();
    expect(normalizeLang(5)).toBeNull();
  });
  it('reads underscores, 3-letter codes and regions', () => {
    expect(parseVoiceLang('te_IN')).toEqual({ family: 'te', region: 'in' });
    expect(parseVoiceLang('hin-IND')).toEqual({ family: 'hi', region: 'in' });
    expect(parseVoiceLang('tel')).toEqual({ family: 'te', region: '' });
    expect(parseVoiceLang('')).toEqual({ family: '', region: '' });
  });
});

describe('chooseVoice', () => {
  it('returns null for no voices, junk input or an unknown language', () => {
    expect(chooseVoice([], 'te')).toBeNull();
    expect(chooseVoice(null, 'te')).toBeNull();
    expect(chooseVoice([v('te-IN')], 'en')).toBeNull();
    expect(chooseVoice([null, {}, { lang: 5 }], 'hi')).toBeNull();
  });
  it('never picks a voice of another language', () => {
    const voices = [v('en-IN'), v('ta-IN'), v('ur-IN'), v('hi-IN')];
    expect(chooseVoice(voices, 'te')).toBeNull();
    expect(chooseVoice(voices, 'hi').lang).toBe('hi-IN');
  });
  it('speaks Dakhni with the Hindi voice', () => {
    const hi = v('hi-IN');
    expect(chooseVoice([v('te-IN'), hi], 'dk')).toBe(hi);
    expect(chooseVoice([v('te-IN')], 'dk')).toBeNull();
  });
  it('prefers te-IN but takes any te voice', () => {
    const other = v('te');
    const inn = v('te-IN');
    expect(chooseVoice([other, inn], 'te')).toBe(inn);
    expect(chooseVoice([other], 'te')).toBe(other);
  });
  it('prefers a local voice over a network voice, even over the exact region', () => {
    const remoteIN = v('hi-IN', { localService: false });
    const localOther = v('hi', { localService: true });
    expect(chooseVoice([remoteIN, localOther], 'hi')).toBe(localOther);
    expect(chooseVoice([remoteIN, v('hi-IN', { localService: true })], 'hi').localService).toBe(true);
    expect(chooseVoice([remoteIN], 'hi')).toBe(remoteIN); // a network voice is still better than none
  });
  it('uses the platform default as the tie-break, then the first', () => {
    const a = v('te-IN');
    const b = v('te-IN', { default: true });
    expect(chooseVoice([a, b], 'te')).toBe(b);
    expect(chooseVoice([a, v('te-IN')], 'te')).toBe(a);
  });
  it('understands android style tags', () => {
    expect(chooseVoice([{ lang: 'hi_IN', localService: true }], 'hi')).toBeTruthy();
    expect(chooseVoice([{ lang: 'tel-IND', localService: true }], 'te')).toBeTruthy();
  });
});

describe('personas', () => {
  it('hash is stable and spreads neighbouring ids', () => {
    expect(hashString('c1')).toBe(hashString('c1'));
    expect(hashString('c1')).not.toBe(hashString('c2'));
    expect(hashString('c1', 1)).not.toBe(hashString('c1', 2));
  });
  it('base pitch 0.8..1.25 and rate 0.9..1.1 for many ids, deterministic', () => {
    const pitches = new Set();
    for (let i = 0; i < 300; i++) {
      const p = basePersona(`c${i}`);
      expect(p.pitch).toBeGreaterThanOrEqual(0.8);
      expect(p.pitch).toBeLessThanOrEqual(1.25);
      expect(p.rate).toBeGreaterThanOrEqual(0.9);
      expect(p.rate).toBeLessThanOrEqual(1.1);
      expect(basePersona(`c${i}`)).toEqual(p);
      pitches.add(p.pitch.toFixed(2));
    }
    expect(pitches.size).toBeGreaterThan(20); // customers really sound different
  });
  it('mood: angry is faster, higher and louder than neutral; sad and sheepish are slower and lower; delighted is higher', () => {
    const n = speechParams('c7', 'neutral');
    const angry = speechParams('c7', 'angry');
    expect(angry.rate).toBeGreaterThan(n.rate);
    expect(angry.pitch).toBeGreaterThan(n.pitch);
    expect(angry.volume).toBeGreaterThan(n.volume);
    for (const m of ['sad', 'sheepish']) {
      const s = speechParams('c7', m);
      expect(s.rate).toBeLessThan(n.rate);
      expect(s.pitch).toBeLessThan(n.pitch);
      expect(s.volume).toBeLessThan(n.volume);
    }
    expect(speechParams('c7', 'delighted').pitch).toBeGreaterThan(n.pitch);
  });
  it('unknown or missing mood is neutral', () => {
    expect(speechParams('c7', 'zzz')).toEqual(speechParams('c7', 'neutral'));
    expect(speechParams('c7')).toEqual(speechParams('c7', 'neutral'));
  });
  it('kids sound higher, elders lower; the customer may be an id or an object', () => {
    const adult = speechParams({ id: 'c9', kind: 'office' }, 'neutral');
    expect(speechParams({ id: 'c9', kind: 'kid' }, 'neutral').pitch).toBeGreaterThan(adult.pitch);
    const old = speechParams({ id: 'c9', kind: 'uncle' }, 'neutral');
    expect(old.pitch).toBeLessThan(adult.pitch);
    expect(old.rate).toBeLessThan(adult.rate);
    expect(speechParams('c9', 'neutral')).toEqual(speechParams({ id: 'c9' }, 'neutral'));
  });
  it('stays inside what browsers accept', () => {
    for (let i = 0; i < 200; i++) {
      const p = speechParams({ id: `x${i}`, kind: i % 2 ? 'kid' : 'uncle' }, ['angry', 'furious', 'sad', 'delighted'][i % 4]);
      expect(p.pitch).toBeGreaterThanOrEqual(0.5);
      expect(p.pitch).toBeLessThanOrEqual(1.8);
      expect(p.rate).toBeGreaterThanOrEqual(0.7);
      expect(p.rate).toBeLessThanOrEqual(1.35);
      expect(p.volume).toBeLessThanOrEqual(1);
    }
  });
});

describe('priority and duration', () => {
  it('angry outranks impatient outranks the rest', () => {
    expect(moodPriority('angry')).toBeGreaterThan(moodPriority('impatient'));
    expect(moodPriority('impatient')).toBeGreaterThan(moodPriority('happy'));
    expect(moodPriority(undefined)).toBe(1);
  });
  it('estimateMs grows with the text, shrinks with the rate and stays bounded', () => {
    expect(estimateMs('ok', 1)).toBeGreaterThanOrEqual(500);
    expect(estimateMs('a'.repeat(60), 1)).toBeGreaterThan(estimateMs('a'.repeat(20), 1));
    expect(estimateMs('a'.repeat(60), 2)).toBeLessThan(estimateMs('a'.repeat(60), 1));
    expect(estimateMs('a'.repeat(100000), 1)).toBeLessThanOrEqual(12000);
    expect(Number.isFinite(estimateMs(undefined))).toBe(true);
  });
});
