// The cosmetic catalogue contract (shared/cosmetics.js), voice lines included.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COSMETICS, COSMETIC_KINDS, EQUIPPABLE_KINDS, FREE_COSMETICS, RARITIES, FINISHES, rarityRank, VOICE_LIMITS, VOICE_COOLDOWN_MS, VOICE_BURST,
  cosmeticById, cleanEquipped, voiceLines, isVoiceId, voiceSrc,
} from './cosmetics.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

describe('catalogue', () => {
  it('has unique ids, known kinds, non-negative integer prices', () => {
    const ids = COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COSMETICS) {
      expect(COSMETIC_KINDS).toContain(c.kind);
      expect(Number.isInteger(c.price) && c.price >= 0).toBe(true);
      expect(RARITIES).toContain(c.rarity);
    }
  });

  it('every `finish` is one the art knows for that kind, and colours are well formed', () => {
    for (const c of COSMETICS) {
      if (c.finish !== undefined) expect(FINISHES[c.kind] || []).toContain(c.finish);
      if (c.colors) {
        expect(c.colors.length).toBe(c.kind === 'dice' || c.kind === 'board' ? 3 : 2);
        for (const col of c.colors) expect(col).toMatch(/^#[0-9a-f]{6}$/i);
      }
      if (c.glow !== undefined) expect(c.glow).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('every finish key is used by at least one item (no dead art)', () => {
    for (const [kind, keys] of Object.entries(FINISHES)) {
      for (const k of keys) expect(COSMETICS.some((c) => c.kind === kind && c.finish === k)).toBe(true);
    }
  });

  it('legendary items are the expensive ones; rarityRank orders the tiers', () => {
    expect(RARITIES).toEqual(['common', 'rare', 'epic', 'legendary']);
    expect(rarityRank('legendary')).toBeGreaterThan(rarityRank('epic'));
    expect(rarityRank('nope')).toBe(0);
    const cheapestLegendary = Math.min(...COSMETICS.filter((c) => c.rarity === 'legendary').map((c) => c.price));
    const priciestEpic = Math.max(...COSMETICS.filter((c) => c.rarity === 'epic').map((c) => c.price));
    expect(cheapestLegendary).toBeGreaterThan(priciestEpic);
  });

  it('has the metal, gem and glass dice a player expects', () => {
    const dice = COSMETICS.filter((c) => c.kind === 'dice').map((c) => c.id);
    for (const id of ['dice-gold', 'dice-silver', 'dice-chrome', 'dice-rosegold', 'dice-bronze', 'dice-ruby', 'dice-emerald', 'dice-crystal', 'dice-obsidian', 'dice-holo', 'dice-jade']) expect(dice).toContain(id);
    expect(COSMETICS.filter((c) => c.kind === 'trail').length).toBeGreaterThanOrEqual(8);
    expect(COSMETICS.filter((c) => c.kind === 'board').length).toBeGreaterThanOrEqual(6);
  });

  it('voice is an owned-only kind: listed, but not equippable', () => {
    expect(COSMETIC_KINDS).toContain('voice');
    expect(EQUIPPABLE_KINDS).toEqual(['frame', 'dice', 'trail', 'board', 'title']);
    expect(cleanEquipped({ voice: 'voice-sheru-bhai', frame: 'frame-lake' })).toEqual({ frame: 'frame-lake' });
  });
});

describe('voice lines', () => {
  it('Sheru Bhai: a paid, rare, tiger-marked item with a playable file', () => {
    const v = cosmeticById('voice-sheru-bhai');
    expect(v).toMatchObject({
      kind: 'voice', name: 'Sheru Bhai', rarity: 'rare', icon: 'tiger', emoji: '🐯', src: '/audio/voice/sheru-bhai.mp3',
    });
    expect(v.caption).toBeTruthy();
    expect(v.caption.length).toBeLessThanOrEqual(40);
    expect(FREE_COSMETICS).not.toContain(v.id);
  });

  it('Ladle Meow: a paid, rare, cat-marked item, a little cheaper than Sheru Bhai', () => {
    const v = cosmeticById('voice-ladle-meow');
    expect(v).toMatchObject({
      kind: 'voice', name: 'Ladle Meow', rarity: 'rare', price: 700, icon: 'cat', emoji: '🐱', src: '/audio/voice/ladle-meow.mp3',
    });
    expect(v.price).toBeLessThan(cosmeticById('voice-sheru-bhai').price);
    expect(v.caption.length).toBeLessThanOrEqual(40);
    expect(voiceLines().map((c) => c.id)).toEqual(['voice-sheru-bhai', 'voice-ladle-meow', 'voice-old-man']);
    expect(new Set(voiceLines().map((c) => c.src)).size).toBe(voiceLines().length);
  });

  it('Old Man: a short, cheaper rare line with a neutral name, path and caption', () => {
    const v = cosmeticById('voice-old-man');
    expect(v).toMatchObject({
      kind: 'voice', name: 'Old Man', rarity: 'rare', price: 500, icon: 'oldman', emoji: '👴', src: '/audio/voice/old-man.mp3', caption: 'Oye!',
    });
    expect(v.price).toBeLessThan(cosmeticById('voice-ladle-meow').price);
    expect(v.durationMs).toBe(2590);
    // the public strings stay neutral: no real person's name and no strong language from the original filename
    expect(JSON.stringify(v)).not.toMatch(/amitabh|bachan|bh-da|aag|maa/i);
  });

  it('every voice line has a positive integer price, a sane duration and a src that exists under public/', () => {
    expect(voiceLines().length).toBeGreaterThan(0);
    for (const v of voiceLines()) {
      expect(Number.isInteger(v.price) && v.price > 0).toBe(true);
      expect(Number.isInteger(v.durationMs) && v.durationMs >= 500 && v.durationMs <= 15_000).toBe(true);
      expect(v.src).toMatch(/^\/audio\/voice\/[a-z0-9-]+\.mp3$/);
      expect(fs.existsSync(path.join(PUBLIC, v.src))).toBe(true);
      expect(fs.statSync(path.join(PUBLIC, v.src)).size).toBeLessThan(600 * 1024);
    }
  });

  it('helpers: voiceLines, isVoiceId, voiceSrc', () => {
    expect(voiceLines().every((c) => c.kind === 'voice')).toBe(true);
    expect(isVoiceId('voice-sheru-bhai')).toBe(true);
    for (const bad of ['frame-lake', 'voice-nope', '', null, undefined, 5, {}, ['voice-sheru-bhai']]) expect(isVoiceId(bad)).toBe(false);
    expect(voiceSrc('voice-sheru-bhai')).toBe('/audio/voice/sheru-bhai.mp3');
    expect(voiceSrc('frame-lake')).toBeNull();
    expect(voiceSrc('x')).toBeNull();
  });

  it('soundboard limits', () => {
    expect(VOICE_LIMITS).toEqual({ cooldownMs: 3000, burst: 3, burstWindowMs: 10_000, perGame: 60, roomMax: 6, roomWindowMs: 5000 });
    expect(VOICE_COOLDOWN_MS).toBe(3000);
    expect(VOICE_BURST).toBe(3);
  });
});
