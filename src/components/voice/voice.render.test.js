// Markup + behaviour of the voice-line UI: the icons, the soundboard pads in every state, a press, the shop card, the settings.
import { createElement as h } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TigerIcon from './TigerIcon.jsx';
import CatIcon from './CatIcon.jsx';
import OldManIcon from './OldManIcon.jsx';
import VoiceIcon from './VoiceIcon.jsx';
import VoicePads, { VoiceToggle } from './VoicePads.jsx';
import { VoiceArt } from './VoiceShop.jsx';
import { pressVoice } from './voiceActions.js';
import { createSeen, newRemoteVoices, voiceEntryFromMessage, voiceItem } from './voiceModel.js';
import { voiceBus, voiceCooldown } from './voicePlayer.js';
import { DEFAULT_APP_SETTINGS, loadSettings, saveSettings } from '@/lib/storage.js';

const html = (node) => renderToStaticMarkup(node).replaceAll('<!-- -->', '');
const SHERU = voiceItem('voice-sheru-bhai');
const MEOW = voiceItem('voice-ladle-meow');
const OLD = voiceItem('voice-old-man');
const access = (over = {}) => ({ state: 'owned', signedIn: true, owned: new Set([SHERU.id]), reload: () => {}, ...over });
const session = (over = {}) => ({ me: 'me', connection: 'open', sendVoice: vi.fn(() => true), chat: [], ...over });

beforeEach(() => voiceCooldown.reset());

describe('icons', () => {
  it('the tiger is a flat aria-hidden svg at any size, with no filters', () => {
    for (const size of [20, 32, 48]) {
      const out = html(h(TigerIcon, { size }));
      expect(out).toContain('<svg');
      expect(out).toContain(`width="${size}"`);
      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain('data-tiger');
      expect(out).toContain('#f28c28'); // orange fur
      expect(out).not.toMatch(/filter|blur|<image/i);
    }
  });
  it('locked swaps the palette without a CSS filter', () => {
    const out = html(h(TigerIcon, { locked: true }));
    expect(out).toContain('is-locked');
    expect(out).not.toContain('#f28c28');
    expect(out).not.toMatch(/filter/i);
  });
  it('the cat is a flat aria-hidden svg too', () => {
    const out = html(h(CatIcon, { size: 40 }));
    expect(out).toContain('data-cat');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('#f5a3b5'); // pink ears and nose
    expect(out).not.toMatch(/filter|blur/i);
    expect(html(h(CatIcon, { locked: true }))).not.toContain('#f5a3b5');
  });
  it('the old man is flat, aria-hidden, white-haired, and greys out when locked', () => {
    const out = html(h(OldManIcon, { size: 28 }));
    expect(out).toContain('data-oldman');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('#f4f1ea');
    expect(out).not.toMatch(/filter|blur/i);
    expect(html(h(OldManIcon, { locked: true }))).not.toContain('#f4f1ea');
    expect(html(h(VoiceIcon, { item: OLD }))).toContain('data-oldman');
  });
  it('VoiceIcon looks the icon up by key and falls back to the emoji', () => {
    expect(html(h(VoiceIcon, { item: SHERU }))).toContain('data-tiger');
    expect(html(h(VoiceIcon, { item: MEOW }))).toContain('data-cat');
    const other = html(h(VoiceIcon, { item: { id: 'voice-x', icon: 'dragon', emoji: '🐲' } }));
    expect(other).toContain('🐲');
    expect(other).not.toContain('<svg');
    expect(html(h(VoiceIcon, { item: { id: 'voice-y' } }))).toContain('🔊');
  });
  it('the shop medallion shows the icon, and the lock only when locked', () => {
    expect(html(h(VoiceArt, { item: SHERU }))).not.toContain('vl-medal__lock');
    const locked = html(h(VoiceArt, { item: MEOW, locked: true }));
    expect(locked).toContain('vl-medal__lock');
    expect(locked).toContain('is-locked');
  });
});

describe('soundboard pads', () => {
  it('owner of all three: three live pads with title and icon, never a link', () => {
    const out = html(h(VoicePads, { session: session(), access: access({ owned: new Set([SHERU.id, MEOW.id, OLD.id]) }) }));
    expect(out).toContain('aria-label="Play Old Man for everyone"');
    expect(out).toContain('data-oldman');
    expect(out).toContain('aria-label="Play Sheru Bhai for everyone"');
    expect(out).toContain('aria-label="Play Ladle Meow for everyone"');
    expect(out).toContain('data-tiger');
    expect(out).toContain('data-cat');
    expect(out).not.toContain('is-locked');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('Get it in the shop');
  });
  it('owns one line, not the other: one live pad, one locked pad with price and a new-tab shop link', () => {
    const out = html(h(VoicePads, { session: session(), access: access() }));
    expect(out).toContain('aria-label="Play Sheru Bhai for everyone"');
    expect(out).toMatch(/<a class="vl-pad is-locked" href="\/shop\?kind=voice" target="_blank" rel="noopener noreferrer"/);
    expect(out).toContain('Ladle Meow is locked. 800 coins. Get it in the shop (opens in a new tab)');
    expect(out).toContain('Old Man is locked. 600 coins.');
    expect(out).toContain('Get it in the shop');
    expect(out).not.toContain('Play Ladle Meow');
  });
  it('owns nothing: both pads locked with prices, a hint and a shop link', () => {
    const out = html(h(VoicePads, { session: session(), access: access({ state: 'locked', owned: new Set() }) }));
    expect(out.match(/is-locked/g).length).toBeGreaterThanOrEqual(2);
    expect(out).toContain('1,000');
    expect(out).toContain('800');
    expect(out).toContain('600');
    expect(out).toContain('Open the shop');
    expect(out).not.toContain('Play Sheru Bhai');
  });
  it('signed out: a sign-in hint and no pads', () => {
    const out = html(h(VoicePads, { session: session(), access: access({ state: 'signed-out', signedIn: false, owned: new Set() }) }));
    expect(out).toContain('Sign in to buy voice lines.');
    expect(out).not.toContain('vl-pad');
  });
  it('loading and offline have their own text; offline can retry', () => {
    expect(html(h(VoicePads, { session: session(), access: access({ state: 'loading', owned: new Set() }) }))).toContain('Checking your voice lines');
    const off = html(h(VoicePads, { session: session(), access: access({ state: 'offline', owned: new Set() }) }));
    expect(off).toContain('Could not check your voice lines.');
    expect(off).toContain('Try again');
    expect(off).not.toContain('vl-pad ');
  });
  it('cooldown: every owned pad is disabled together (a locked pad stays a link), shows the seconds and a draining bar', () => {
    voiceCooldown.start();
    const out = html(h(VoicePads, { session: session(), access: access({ owned: new Set([SHERU.id, MEOW.id]) }) }));
    expect(out.match(/is-cooling/g)).toHaveLength(2);
    expect(out.match(/vl-pad__cd/g)).toHaveLength(2);
    expect(out).toMatch(/Sheru Bhai, ready in [123] seconds/);
    expect(out).toMatch(/Ladle Meow, ready in [123] seconds/);
    expect(out.match(/disabled=""/g)).toHaveLength(2);
    expect(out).toContain('--vl-cd:3000ms');
  });
  it('a closed connection disables the pads', () => {
    const out = html(h(VoicePads, { session: session({ connection: 'closed' }), access: access() }));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*data-voice="voice-sheru-bhai"/);
  });
  it('the toggle next to the reactions is a labelled 44px-class button with aria-expanded', () => {
    const out = html(h(VoiceToggle, { open: false, onClick() {}, access: access(), popId: 'p' }));
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('aria-controls="p"');
    expect(out).toContain('aria-label="Voice lines: open the soundboard"');
    expect(html(h(VoiceToggle, { open: true, onClick() {}, access: access({ owned: new Set() }), popId: 'p' }))).toContain('get them in the shop');
  });
});

describe('pressing a pad', () => {
  it('sends {t:voice,id} once, starts the shared cooldown and plays locally at once', () => {
    const s = session();
    const heard = [];
    const off = voiceBus.on((e) => heard.push(e));
    expect(pressVoice({ session: s, access: access(), id: SHERU.id })).toEqual({ ok: true, reason: null });
    expect(s.sendVoice).toHaveBeenCalledWith(SHERU.id);
    expect(heard).toEqual([{ from: 'me', id: SHERU.id, local: true }]);
    expect(voiceCooldown.left()).toBeGreaterThan(2900);
    // the cooldown is shared by every pad: the second line has to wait too
    const second = pressVoice({ session: s, access: access({ owned: new Set([SHERU.id, MEOW.id]) }), id: MEOW.id });
    expect(second.reason).toBe('cooldown');
    expect(s.sendVoice).toHaveBeenCalledTimes(1);
    off();
  });
  it('a line I do not own is never sent or played', () => {
    const s = session();
    const heard = [];
    const off = voiceBus.on((e) => heard.push(e));
    expect(pressVoice({ session: s, access: access(), id: MEOW.id }).reason).toBe('not-owned');
    expect(pressVoice({ session: s, access: access({ signedIn: false }), id: SHERU.id }).reason).toBe('signed-out');
    expect(pressVoice({ session: session({ connection: 'closed' }), access: access(), id: SHERU.id }).reason).toBe('offline');
    expect(s.sendVoice).not.toHaveBeenCalled();
    expect(heard).toEqual([]);
    expect(voiceCooldown.left()).toBe(0);
    off();
  });
  it('a send that fails (socket gone) neither plays nor starts the cooldown', () => {
    const s = session({ sendVoice: vi.fn(() => false) });
    expect(pressVoice({ session: s, access: access(), id: SHERU.id }).ok).toBe(false);
    expect(voiceCooldown.left()).toBe(0);
  });
});

describe('two clients, one broadcast', () => {
  it('both receive it, the sender plays once (locally), the other plays on receipt, unknown ids are ignored', () => {
    const wire = { t: 'voice', from: 'a', id: SHERU.id, ts: 1000, seq: 1 };
    const entry = voiceEntryFromMessage(wire);
    // client B (not the sender)
    const seenB = createSeen();
    expect(newRemoteVoices([entry], null, 'b', seenB)).toEqual([{ from: 'a', id: SHERU.id }]);
    // client A (the sender): its press already emitted a local event; the echo adds nothing
    const seenA = createSeen();
    expect(newRemoteVoices([entry], null, 'a', seenA)).toEqual([]);
    // a spectator hears it too
    expect(newRemoteVoices([entry], null, 'spectator', createSeen())).toHaveLength(1);
    // a replay of the same broadcast does not play twice
    expect(newRemoteVoices([entry], null, 'b', seenB)).toEqual([]);
    expect(voiceEntryFromMessage({ ...wire, id: 'voice-unknown' })).toBeNull();
  });
});

describe('chat history lines', () => {
  it('EmoteBar prints the voice line with its icon and the reactions row gets the soundboard toggle', async () => {
    const { default: EmoteBar } = await import('../game/EmoteBar.jsx');
    const s = session({ chat: [{ id: 'v1', from: 'rav', text: '', voice: MEOW.id }], roomPlayers: [], view: { players: [{ id: 'rav', name: 'Ravi', color: '#3ddc97' }] } });
    const out = html(h(EmoteBar, { session: s }));
    expect(out).toContain('Voice lines: ');
    expect(out).toContain('aria-label="React: Mass!"');
  });
  it('the phone Message shows a voice line instead of a wave', async () => {
    const { Message } = await import('../game/phone/PhoneChatBar.jsx');
    const s = session({ view: { players: [{ id: 'rav', name: 'Ravi', color: '#3ddc97' }] } });
    const out = html(h(Message, { session: s, message: { id: 'v1', from: 'rav', text: '', voice: SHERU.id } }));
    expect(out).toContain('Sheru Bhai');
    expect(out).toContain('data-tiger');
    expect(out).not.toContain('👋');
    expect(html(h(Message, { session: s, message: { id: 'v2', from: 'rav', text: '', voice: 'voice-hax' } }))).toContain('👋');
  });
});

describe('settings', () => {
  it('"Voice lines" is on by default, persists, and the volume is clamped', () => {
    expect(DEFAULT_APP_SETTINGS.voiceLines).toBe(true);
    expect(DEFAULT_APP_SETTINGS.voiceVolume).toBe(1);
    expect(loadSettings().voiceLines).toBe(true);
    expect(saveSettings({ voiceLines: false }).voiceLines).toBe(false);
    expect(loadSettings().voiceLines).toBe(false);
    expect(saveSettings({ voiceVolume: 7 }).voiceVolume).toBe(1);
    expect(saveSettings({ voiceVolume: -2 }).voiceVolume).toBe(0);
    saveSettings({ voiceLines: true, voiceVolume: 1 });
  });
});

describe('shop card', () => {
  const card = async (item, props) => {
    const { ItemCard } = await import('../../pages/Shop.jsx');
    return html(
      h(MemoryRouter, null, h('ul', null, h(ItemCard, { item, i: 0, equipped: {}, selected: false, coins: 5000, signedIn: true, offline: false, busy: false, buying: false, fresh: false, avatar: 0, preview: { playingId: null, toggle() {} }, onSelect() {}, onBuy() {}, onEquip() {}, ...props }))),
    );
  };
  const base = (it, over = {}) => ({ ...it, owned: false, ...over });

  it('locked + affordable: the lock, the price and a Buy button, no Play', async () => {
    const out = await card(base(SHERU));
    expect(out).toContain('Sheru Bhai');
    expect(out).toContain('Locked');
    expect(out).toContain('1,000');
    expect(out).toContain('Buy Sheru Bhai for 1,000 coins');
    expect(out).toContain('vl-medal__lock');
    expect(out).not.toContain('aria-label="Play Sheru Bhai"');
    expect(out).not.toContain('Equip');
  });
  it("can't afford: says how many coins are still needed", async () => {
    const out = await card(base(SHERU), { coins: 400 });
    expect(out).toContain('Sheru Bhai: need 600 more coins');
    expect(out).toContain('Need 600 more');
  });
  it('owned: an Owned badge and a Play button (no Equip, no lock)', async () => {
    const out = await card(base(MEOW, { owned: true }));
    expect(out).toContain('Owned');
    expect(out).toContain('aria-label="Play Ladle Meow"');
    expect(out).toContain('data-cat');
    expect(out).not.toContain('vl-medal__lock');
    expect(out).not.toContain('Equip');
  });
  it('playing preview turns the button into Stop', async () => {
    const out = await card(base(MEOW, { owned: true }), { preview: { playingId: MEOW.id, toggle() {} } });
    expect(out).toContain('aria-label="Stop Ladle Meow"');
    expect(out).toContain('is-playing');
  });
  it('signed out: Sign in to buy, no price button and no Play', async () => {
    const out = await card(base(SHERU), { signedIn: false, coins: null });
    expect(out).toContain('Sign in to buy');
    expect(out).not.toContain('aria-label="Play');
    expect(out).not.toContain('Buy Sheru');
  });
});

describe('art', () => {
  it('CosmeticPreview draws a voice line instead of nothing', async () => {
    const { CosmeticPreview } = await import('../art/cosmetics.jsx');
    expect(html(h(CosmeticPreview, { item: SHERU, size: 64 }))).toContain('data-tiger');
    expect(html(h(CosmeticPreview, { item: MEOW.id, size: 64 }))).toContain('data-cat');
  });
});

describe('server render sanity', () => {
  it('the pads render with renderToString too (no hooks outside React)', () => {
    expect(renderToString(h(VoicePads, { session: session(), access: access() }))).toContain('vl-board');
  });
});
