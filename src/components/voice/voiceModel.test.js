// Voice lines, the pure rules: whitelist, message parsing, who may press, cooldown, concurrency, echo dedupe.
import { describe, expect, it } from 'vitest';
import {
  MAX_CONCURRENT, VOICE_COOLDOWN_MS, accessHint, admitClip, clipMs, cooldownLeft, cooldownSeconds, createCooldown, createSeen,
  newRemoteVoices, ownedVoiceIds, pressGate, speakerLine, voiceEmoji, voiceEntryFromMessage, voiceIconKey, voiceItem, voiceItems, voiceUrl,
} from './voiceModel.js';

const SHERU = 'voice-sheru-bhai';
const MEOW = 'voice-ladle-meow';
const OLD = 'voice-old-man';

describe('catalogue whitelist', () => {
  it('knows the three lines and nothing else', () => {
    expect(voiceItems().map((i) => i.id)).toEqual([SHERU, MEOW, OLD]);
    expect(voiceItem(OLD).name).toBe('Old Man');
    expect(voiceItem(SHERU).name).toBe('Sheru Bhai');
    expect(voiceItem(MEOW).name).toBe('Ladle Meow');
    for (const bad of ['voice-nope', 'frame-pearl', '', null, undefined, 7, {}, ['voice-sheru-bhai']]) expect(voiceItem(bad)).toBeNull();
  });
  it('only ever resolves same-origin clips under /audio/voice/', () => {
    expect(voiceUrl(voiceItem(SHERU))).toBe('/audio/voice/sheru-bhai.mp3');
    expect(voiceUrl({ src: 'https://evil.example/x.mp3' })).toBeNull();
    expect(voiceUrl({ src: '/audio/voice/../../x.mp3' })).toBeNull();
    expect(voiceUrl({ src: '//evil.example/audio/voice/x.mp3' })).toBeNull();
    expect(voiceUrl(null)).toBeNull();
  });
  it('icon keys and emoji fall back sensibly', () => {
    expect(voiceIconKey(voiceItem(SHERU))).toBe('tiger');
    expect(voiceIconKey(voiceItem(MEOW))).toBe('cat');
    expect(voiceIconKey(voiceItem(OLD))).toBe('oldman');
    expect(voiceEmoji({ id: 'voice-old-man' })).toBe('👴');
    expect(voiceEmoji({ id: 'voice-sheru-bhai' })).toBe('🐯');
    expect(voiceEmoji({ id: 'voice-ladle-meow' })).toBe('🐱');
    expect(voiceEmoji({ id: 'voice-x' })).toBe('🔊');
  });
  it('prints the caption line as "emoji Name: Title" and clamps the clip length', () => {
    expect(speakerLine('Ravi', voiceItem(SHERU))).toBe('🐯 Ravi: Sheru Bhai');
    expect(speakerLine('Sana', voiceItem(MEOW))).toBe('🐱 Sana: Ladle Meow');
    expect(clipMs(voiceItem(SHERU))).toBe(8300);
    expect(clipMs({})).toBe(3000);
    expect(clipMs({ durationMs: 99999 })).toBe(15000);
  });
});

describe('voiceEntryFromMessage (the socket handler)', () => {
  it('turns a broadcast into a history entry keyed by (from, id, seq)', () => {
    const e = voiceEntryFromMessage({ t: 'voice', from: 'p1', id: SHERU, ts: 123, seq: 4 });
    expect(e).toEqual({ id: `v:p1:${SHERU}:s4`, from: 'p1', text: '', voice: SHERU, ts: 123 });
    expect(voiceEntryFromMessage({ from: 'p1', id: MEOW, ts: 9 }).id).toBe(`v:p1:${MEOW}:t9`);
  });
  it('ignores unknown ids, a missing speaker and junk', () => {
    expect(voiceEntryFromMessage({ from: 'p1', id: 'voice-hax', seq: 1 })).toBeNull();
    expect(voiceEntryFromMessage({ from: 'p1', id: '/audio/voice/x.mp3', seq: 1 })).toBeNull();
    expect(voiceEntryFromMessage({ id: SHERU, seq: 1 })).toBeNull();
    expect(voiceEntryFromMessage({ from: {}, id: SHERU })).toBeNull();
    expect(voiceEntryFromMessage(null)).toBeNull();
    expect(voiceEntryFromMessage('voice')).toBeNull();
  });
  it('never carries a src from the wire into the entry', () => {
    const e = voiceEntryFromMessage({ from: 'p1', id: SHERU, seq: 1, src: 'https://evil/x.mp3' });
    expect(JSON.stringify(e)).not.toContain('evil');
  });
});

describe('ownership', () => {
  const shop = [{ id: SHERU, owned: true }, { id: MEOW, owned: false }, { id: 'frame-pearl', owned: true }, { id: 'voice-ghost', owned: true }];
  it('lists owned voice lines only, one owned and the other not', () => {
    expect(ownedVoiceIds(shop)).toEqual([SHERU]);
    expect(ownedVoiceIds([{ id: MEOW, owned: true }, { id: SHERU, owned: true }])).toEqual([SHERU, MEOW]);
    expect(ownedVoiceIds(null)).toEqual([]);
    expect(ownedVoiceIds([{ id: SHERU, owned: 'yes' }])).toEqual([]);
  });
  it('gates a press: signed out, not owned, offline, cooldown, ok', () => {
    const owned = new Set([SHERU]);
    const base = { signedIn: true, owned, id: SHERU, connected: true, cooldownLeft: 0 };
    expect(pressGate(base)).toEqual({ ok: true, reason: null });
    expect(pressGate({ ...base, signedIn: false }).reason).toBe('signed-out');
    expect(pressGate({ ...base, id: MEOW }).reason).toBe('not-owned'); // owns one line, not the other
    expect(pressGate({ ...base, id: 'voice-nope' }).reason).toBe('unknown');
    expect(pressGate({ ...base, connected: false }).reason).toBe('offline');
    expect(pressGate({ ...base, cooldownLeft: 1200 }).reason).toBe('cooldown');
    expect(pressGate({ ...base, owned: new Set() }).reason).toBe('not-owned');
  });
  it('has a hint for every state that has no pads', () => {
    expect(accessHint('signed-out')).toMatch(/Sign in/);
    expect(accessHint('locked')).toMatch(/shop/i);
    expect(accessHint('offline')).toMatch(/Could not/);
    expect(accessHint('owned')).toBe('');
  });
});

describe('cooldown (per player, shared by every pad)', () => {
  it('matches the server (3 s) and counts down', () => {
    expect(VOICE_COOLDOWN_MS).toBe(3000);
    let t = 1000;
    const cd = createCooldown({ now: () => t });
    expect(cd.left()).toBe(0);
    cd.start();
    expect(cd.left()).toBe(3000);
    t = 2000;
    expect(cd.left()).toBe(2000);
    expect(cooldownSeconds(cd.left())).toBe(2);
    t = 3999;
    expect(cooldownSeconds(cd.left())).toBe(1);
    t = 4000;
    expect(cd.left()).toBe(0);
    expect(cooldownSeconds(0)).toBe(0);
    expect(cooldownLeft(500, 100)).toBe(400);
    expect(cooldownLeft(50, 100)).toBe(0);
  });
  it('notifies subscribers and can be reset', () => {
    const cd = createCooldown({ now: () => 0 });
    let n = 0;
    const off = cd.subscribe(() => { n += 1; });
    cd.start();
    cd.reset();
    off();
    cd.start();
    expect(n).toBe(2);
    expect(cd.state().ms).toBe(3000);
  });
});

describe('concurrency', () => {
  it('restarts the same line, plays a different one, drops extras past the cap', () => {
    expect(MAX_CONCURRENT).toBe(3);
    expect(admitClip([], SHERU)).toBe('play');
    expect(admitClip([{ id: SHERU }], SHERU)).toBe('restart');
    expect(admitClip([{ id: SHERU }], MEOW)).toBe('play');
    expect(admitClip([{ id: 'a' }, { id: 'b' }, { id: 'c' }], MEOW)).toBe('drop');
    expect(admitClip([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a')).toBe('restart');
    expect(admitClip([{ id: 'a' }, { id: 'b' }], 'c', 2)).toBe('drop');
  });
});

describe('echo and replay dedupe', () => {
  it('createSeen is true the second time and forgets the oldest', () => {
    const s = createSeen(2);
    expect(s.seen('a')).toBe(false);
    expect(s.seen('a')).toBe(true);
    s.seen('b');
    s.seen('c');
    expect(s.seen('a')).toBe(false); // evicted
  });
  it('plays other players clips once, never my own echo', () => {
    const chat = [
      { id: 'c1', from: 'me', text: 'hi' },
      { id: 'v1', from: 'me', text: '', voice: SHERU }, // my echo
      { id: 'v2', from: 'rav', text: '', voice: MEOW },
      { id: 'v3', from: 'rav', text: '', voice: 'voice-ghost' }, // unknown
      { id: 'e1', from: 'rav', text: '', emote: 'emote_mass' },
    ];
    const seen = createSeen();
    expect(newRemoteVoices(chat, 'c1', 'me', seen)).toEqual([{ from: 'rav', id: MEOW }]);
    // the same list again (a re-render) plays nothing twice
    expect(newRemoteVoices(chat, 'c1', 'me', seen)).toEqual([]);
    // everything from the start when nothing was handled yet
    expect(newRemoteVoices(chat, null, 'me', createSeen())).toEqual([{ from: 'rav', id: MEOW }]);
    expect(newRemoteVoices(null, null, 'me', seen)).toEqual([]);
  });
});
