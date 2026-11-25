import { describe, expect, it } from 'vitest';
import {
  LINES, PERSONAS, PERSONA_IDS, KINDS, CATEGORIES, HERO_CATEGORIES, PASSENGER_CATEGORIES, NPC_CATEGORIES, PASSENGER_PERSONAS, PLACES, getLine, hasTelugu, placeKey, ttsRequest,
} from './voiceLines.js';

const TELUGU_ONLY = /^[ఀ-౿\sA-Za-z0-9.,!?'"()\-…]+$/; // Telugu block + plain Latin/digits/punctuation (English words in Telugu script are fine)

describe('voice line catalogue', () => {
  it('has 80-160 lines with unique, file-safe ids', () => {
    expect(LINES.length).toBeGreaterThanOrEqual(80);
    expect(LINES.length).toBeLessThanOrEqual(160);
    const ids = LINES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]{3,40}$/);
  });

  it('defines every persona once, with a brief, colour and voice hints, and no real-person reference', () => {
    expect(PERSONA_IDS.sort()).toEqual(['driver_angry', 'elder_man', 'elder_woman', 'man_rusher', 'mega_hero', 'student', 'tourist', 'woman_mid', 'woman_young']);
    for (const p of Object.values(PERSONAS)) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.brief.length).toBeGreaterThan(40);
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.voice.imagine).toBeTruthy();
      expect(p.speech.rate).toBeGreaterThan(0.4);
      // briefs describe a voice, never "like <someone>"
      expect(p.brief).not.toMatch(/\b(sounds? like|voice of|in the style of|impersonat)/i);
    }
    expect(PERSONAS.mega_hero.brief).toMatch(/original fictional/i);
  });

  it('every line is complete: persona, category, Telugu script, roman, English', () => {
    for (const l of LINES) {
      expect(PERSONAS[l.persona], l.id).toBeTruthy();
      expect(CATEGORIES, l.id).toContain(l.category);
      expect(l.te?.trim(), l.id).toBeTruthy();
      expect(l.roman?.trim(), l.id).toBeTruthy();
      expect(l.en?.trim(), l.id).toBeTruthy();
      expect(hasTelugu(l.te), `${l.id} has no Telugu`).toBe(true);
      expect(l.te, `${l.id} has characters outside the Telugu block`).toMatch(TELUGU_ONLY);
      expect(hasTelugu(l.roman), `${l.id} roman must be Latin`).toBe(false);
      expect(hasTelugu(l.en)).toBe(false);
      // short lines only (1-4 seconds of speech)
      expect([...l.te].length, l.id).toBeLessThanOrEqual(70);
    }
  });

  it('keeps hero lines on the hero and passenger lines off it', () => {
    for (const l of LINES) {
      expect(l.category.startsWith('hero_'), l.id).toBe(l.persona === 'mega_hero');
    }
  });

  it('has hail lines for exactly the six customer kinds, each hail line tagged with a kind', () => {
    for (const l of LINES.filter((x) => x.category === 'hail')) expect(KINDS, l.id).toContain(l.kind);
    for (const k of KINDS) {
      const hails = LINES.filter((l) => l.category === 'hail' && l.kind === k);
      expect(hails.length, k).toBeGreaterThanOrEqual(2);
    }
    expect(KINDS).toEqual(['regular', 'rusher', 'elder', 'women', 'tourist', 'student']);
    // the elderly speak in the slow old tone
    expect(PERSONAS.elder_man.voice.speed).toBeLessThan(0.9);
    expect(PERSONAS.elder_woman.voice.speed).toBeLessThan(0.9);
  });

  it('covers every passenger category and every hero milestone, with variants so it never repeats', () => {
    for (const c of PASSENGER_CATEGORIES) expect(LINES.filter((l) => l.category === c).length, c).toBeGreaterThanOrEqual(4);
    for (const c of HERO_CATEGORIES) expect(LINES.filter((l) => l.category === c).length, c).toBeGreaterThanOrEqual(2);
    expect(HERO_CATEGORIES).toEqual(expect.arrayContaining([
      'hero_first_fare', 'hero_streak', 'hero_earn_1000', 'hero_earn_5000', 'hero_drift', 'hero_jump', 'hero_night', 'hero_rain', 'hero_fuel', 'hero_workshop', 'hero_garage', 'hero_escape', 'hero_caught',
    ]));
    for (const c of NPC_CATEGORIES) expect(LINES.filter((l) => l.category === c && l.persona === 'driver_angry').length, c).toBeGreaterThanOrEqual(3);
  });

  it('gives every passenger persona a crash reaction and a thank-you (nobody is silent at the important moments)', () => {
    for (const p of PASSENGER_PERSONAS) {
      for (const c of ['complaint_crash', 'thanks', 'missed', 'boarding', 'hail']) {
        expect(LINES.some((l) => l.persona === p && l.category === c), `${p} / ${c}`).toBe(true);
      }
    }
  });

  it('includes the required signature lines', () => {
    const roman = LINES.map((l) => l.roman.toLowerCase()).join('|');
    for (const s of ['babu auto!', 'ooy auto babu, ikkada aapu!', 'auto... babu... aapu babu', 'auto auto!', 'charminar ki teesukellu babu', 'mellaga po babu',
      'ayyo!', 'thondaraga po babu, train ayipotundi!', 'dhanyavadalu babu', 'chala baaga nadipav babu']) {
      expect(roman, s).toContain(s);
    }
  });

  it('boarding destination lines name a poi id that exists in the city', () => {
    const POIS = ['charminar', 'mecca', 'station', 'paradise', 'cyber', 'birla', 'golconda', 'airport', 'garage', 'stadium', 'hospital', 'irani'];
    for (const l of LINES.filter((x) => x.dest)) {
      expect(l.category).toBe('boarding');
      expect(POIS).toContain(l.dest);
    }
  });

  it('builds a provider request from a line (Telugu text, persona brief, no secrets)', () => {
    const req = ttsRequest(getLine('hail_eld_m1'));
    expect(req).toMatchObject({ lang: 'te', persona: 'elder_man', text: getLine('hail_eld_m1').te });
    expect(req.style.brief).toBe(PERSONAS.elder_man.brief);
    expect(JSON.stringify(req)).not.toMatch(/key|token|secret/i);
  });
});

describe('angry drivers and places', () => {
  it('keeps the road-rage tone comic: no slurs, no threats of violence', () => {
    const banned = /\b(kill|murder|die|dead|beat you|hit you|break your|bastard|bloody|idiot|stupid|fool|damn|hell|shut up)\b/i;
    for (const l of LINES.filter((x) => x.persona === 'driver_angry')) {
      expect(`${l.roman} ${l.en}`, l.id).not.toMatch(banned);
    }
  });

  it('maps a customer place to a key, and every hail place line uses a known one', () => {
    expect(placeKey({ name: 'Bawarchi' })).toBe('bawarchi');
    expect(placeKey({ name: 'Paradise Biryani', brand: 'Paradise' })).toBe('paradise');
    expect(placeKey({ brand: 'OYO' })).toBe('oyo');
    expect(placeKey({ name: 'Delhi Mithai Wala' })).toBe('delhi_mithai');
    expect(placeKey({ station: 'Ameerpet Metro' })).toBe('metro');
    expect(placeKey({ name: 'Somewhere' })).toBe(null);
    expect(placeKey(null)).toBe(null);
    const placed = LINES.filter((l) => l.place);
    expect(placed.length).toBeGreaterThanOrEqual(6);
    for (const l of placed) {
      expect(l.category).toBe('hail');
      expect(PLACES).toContain(l.place);
      expect(KINDS).toContain(l.kind);
    }
    for (const p of PLACES) expect(placed.some((l) => l.place === p), p).toBe(true);
  });
});
