// The Snatch UI: pure helpers (countdown, who can snatch, captions), the pop-up in each of its states (eligible / locked /
// passive / gone), the token chips, the contested tile on the board, the action row and the status line.
// Rendering is server-side (no DOM): the countdown, the spring and the exit are exercised in the browser harness.
import { createElement as h } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createGame } from '@shared/index.js';
import { TILES } from '@shared/board.js';
import { LUCK_CARDS } from '@shared/cards.js';
import { cardMs } from '@shared/timing.js';
import { CARD_ART, EventCardArt } from '@/components/art/EventCardArt.jsx';
import { cardAnnouncement, cardOf } from './turn/CardReveal.jsx';
import { buildActionSpec } from './ActionBar.jsx';
import { statusLine } from './ControlPanel.jsx';
import Board from './Board.jsx';
import PlayerPods from './PlayerPods.jsx';
import PhonePlayers from './phone/PhonePlayers.jsx';
import SnatchPopup, { usePresence } from './SnatchPopup.jsx';
import SnatchChip, { BUMP_MS, snatchChipLabel } from './ui/SnatchChip.jsx';
import {
  SNATCH_MS_DEFAULT, snatchAnnouncement, snatchBannerText, snatchChipsOn, snatchClockFrom, snatchCount, snatchEligibilityText,
  snatchEndMs, snatchFraction, snatchInfo, snatchLength, snatchLive, snatchOpenMs, snatchSeconds, snatchUsedMs, snatchWhoLabel,
} from './snatch.js';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');

/** A 3-player game (me, Ravi, Zoya) with an open snatch window on tile 29 (Madhapur, ₹3,20,000). */
function windowSession({ me = 'me', buyer = 'b1', eligible = ['me', 'c2'], claims = [], options = {}, tokens = {}, patch = {}, ms = 5000 } = {}) {
  const view = createGame({ players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }, { id: 'c2', name: 'Zoya' }], seed: 3 });
  view.players.forEach((p) => { p.snatches = tokens[p.id] ?? 1; });
  view.owners[29] = buyer;
  view.phase = 'snatch';
  view.turn = view.players.findIndex((p) => p.id === buyer);
  view.pending = { type: 'snatch', tile: 29, buyer, price: 320000, eligible, claims, ms, returnPhase: 'manage' };
  Object.assign(view, patch);
  return { me, view, display: view, options, busy: false, dispatch() {}, roomPlayers: [], log: [], chat: [], connection: 'open' };
}

describe('countdown numbers', () => {
  it('seconds round UP so the last second still shows 1, never 0 before the end', () => {
    expect(snatchSeconds(5000)).toBe(5);
    expect(snatchSeconds(4001)).toBe(5);
    expect(snatchSeconds(4000)).toBe(4);
    expect(snatchSeconds(1)).toBe(1);
    expect(snatchSeconds(0)).toBe(0);
    expect(snatchSeconds(-50)).toBe(0);
    expect(snatchSeconds(undefined)).toBe(0);
  });

  it('the fraction drains from 1 to 0 and is clamped', () => {
    expect(snatchFraction(5000, 5000)).toBe(1);
    expect(snatchFraction(2500, 5000)).toBe(0.5);
    expect(snatchFraction(0, 5000)).toBe(0);
    expect(snatchFraction(9000, 5000)).toBe(1);
    expect(snatchFraction(-1, 5000)).toBe(0);
    expect(snatchFraction(100, 0)).toBe(0);
  });

  it('the window is the server length, else five seconds', () => {
    expect(SNATCH_MS_DEFAULT).toBe(5000);
    expect(snatchLength(undefined)).toBe(5000);
    expect(snatchLength(0)).toBe(5000);
    expect(snatchLength('x')).toBe(5000);
    expect(snatchLength(7000)).toBe(7000);
  });

  it('snatchClockFrom: where the countdown stands after a time, and when it is done', () => {
    const info = snatchInfo(windowSession());
    expect(snatchClockFrom(info, 0)).toMatchObject({ totalMs: 5000, remainingMs: 5000, fraction: 1, seconds: 5, done: false });
    expect(snatchClockFrom(info, 2600)).toMatchObject({ remainingMs: 2400, seconds: 3, done: false });
    expect(snatchClockFrom(info, 4999)).toMatchObject({ seconds: 1, done: false });
    expect(snatchClockFrom(info, 5000)).toMatchObject({ remainingMs: 0, fraction: 0, seconds: 0, done: true });
    expect(snatchClockFrom(info, 99999).done).toBe(true);
    expect(snatchClockFrom(info, -10).remainingMs).toBe(5000);
  });

  it('a page that reloads mid-window resumes where the server is (pending.remainingMs), never past the ends', () => {
    const s = windowSession();
    expect(snatchUsedMs(snatchInfo(s))).toBe(0);
    s.view.pending.remainingMs = 1200;
    expect(snatchUsedMs(snatchInfo(s))).toBe(3800);
    expect(snatchClockFrom(snatchInfo(s), 3800)).toMatchObject({ remainingMs: 1200, seconds: 2, done: false });
    s.view.pending.remainingMs = 9999;
    expect(snatchUsedMs(snatchInfo(s))).toBe(0);
    s.view.pending.remainingMs = 0;
    expect(snatchUsedMs(snatchInfo(s))).toBe(5000);
    expect(snatchUsedMs(null)).toBe(0);
  });

  it('the first render shows the full window exactly, whatever the machine load (no clock reading between the two timestamps)', () => {
    for (let i = 0; i < 20; i++) {
      const out = html(h(SnatchPopup, { session: windowSession(), placement: 'phone' }));
      expect(out).toContain('--f:1.0000');
      expect(out).toContain('class="sn-secs">5<');
    }
  });

  it('the pop-up is wanted only while the window is open AND the countdown has not run out', () => {
    const info = snatchInfo(windowSession());
    expect(snatchLive(info, snatchClockFrom(info, 1000))).toBe(true);
    expect(snatchLive(info, snatchClockFrom(info, 5000))).toBe(false);
    expect(snatchLive(null, null)).toBe(false);
    expect(snatchLive(info, null)).toBe(true);
  });

  it('the presenter pauses follow the shared table, with a fallback', () => {
    expect(snatchOpenMs()).toBeGreaterThan(0);
    expect(snatchOpenMs()).toBeLessThan(1000);
    expect(snatchEndMs()).toBeGreaterThanOrEqual(1500);
  });
});

describe('snatchInfo', () => {
  it('reads the open window from the LATEST state: tile, price, buyer, length, who may press', () => {
    const info = snatchInfo(windowSession());
    expect(info).toMatchObject({
      tileId: 29, price: 320000, ms: 5000, buyerId: 'b1', buyerName: 'Ravi', meBought: false, eligible: true, pressed: false, canPress: true, tokens: 1,
      eligibleIds: ['me', 'c2'], eligibleNames: ['You', 'Zoya'],
    });
    expect(info.tile.name).toBe('Madhapur');
    expect(info.key).toMatch(/:29:b1$/);
  });

  it('is null outside a snatch window or for a malformed one', () => {
    expect(snatchInfo(null)).toBeNull();
    expect(snatchInfo({ view: null })).toBeNull();
    expect(snatchInfo(windowSession({ patch: { phase: 'manage' } }))).toBeNull();
    expect(snatchInfo(windowSession({ patch: { pending: { type: 'buy', tile: 29, price: 1 } } }))).toBeNull();
  });

  it('pressed = my press is in the claims or the server says snatched; either way the button is locked', () => {
    expect(snatchInfo(windowSession({ claims: ['me'] }))).toMatchObject({ pressed: true, canPress: false, eligible: true });
    expect(snatchInfo(windowSession({ options: { snatched: true } }))).toMatchObject({ pressed: true, canPress: false });
    expect(snatchInfo(windowSession({ options: { snatch: { tile: 29, ms: 5000 } } }))).toMatchObject({ pressed: false, canPress: true });
  });

  it('the buyer, a player without a button, a bankrupt player and a spectator cannot press', () => {
    expect(snatchInfo(windowSession({ me: 'b1' }))).toMatchObject({ eligible: false, canPress: false, meBought: true, buyerName: 'You' });
    expect(snatchInfo(windowSession({ eligible: ['c2'] }))).toMatchObject({ eligible: false, canPress: false });
    const broke = windowSession();
    broke.view.players.find((p) => p.id === 'me').bankrupt = true;
    expect(snatchInfo(broke)).toMatchObject({ eligible: false, canPress: false });
    expect(snatchInfo(windowSession({ me: 'ghost' }))).toMatchObject({ eligible: false, canPress: false });
  });

  it('a bankrupt eligible player is dropped from the names, and a reload can resume from the server clock', () => {
    const s = windowSession({ eligible: ['me', 'c2'] });
    s.view.players.find((p) => p.id === 'c2').bankrupt = true;
    expect(snatchInfo(s).eligibleIds).toEqual(['me']);
    const resumed = windowSession({ patch: {} });
    resumed.view.pending.remainingMs = 1200;
    expect(snatchInfo(resumed).remainingMs).toBe(1200);
  });

  it('uses options.snatch.ms (what the engine computed for me) before pending.ms', () => {
    expect(snatchInfo(windowSession({ options: { snatch: { tile: 29, ms: 3000 } } })).ms).toBe(3000);
    expect(snatchInfo(windowSession({ ms: 7000 })).ms).toBe(7000);
    expect(snatchInfo(windowSession({ ms: undefined })).ms).toBe(5000);
  });
});

describe('the words', () => {
  it('who can snatch it', () => {
    expect(snatchWhoLabel(snatchInfo(windowSession({ me: 'b1', eligible: ['c2'] })))).toBe('Zoya can snatch it!');
    expect(snatchWhoLabel(snatchInfo(windowSession({ me: 'b1', eligible: ['me', 'c2'] })))).toBe('Asha and Zoya can snatch it!');
    expect(snatchWhoLabel(snatchInfo(windowSession({ eligible: ['me', 'c2'] })))).toBe('You and Zoya can snatch it!');
    expect(snatchWhoLabel(snatchInfo(windowSession({ eligible: [] })))).toBe('Nobody can snatch it');
    expect(snatchWhoLabel(null)).toBe('');
  });

  it('the passive banner names the buyer, the district and who can snatch it', () => {
    expect(snatchBannerText(snatchInfo(windowSession({ me: 'b1', eligible: ['c2'] })))).toBe('You bought Madhapur: Zoya can snatch it!');
    expect(snatchBannerText(snatchInfo(windowSession({ me: 'c2', eligible: ['c2', 'me'] })))).toBe('Ravi bought Madhapur: You and Asha can snatch it!');
    expect(snatchBannerText(null)).toBe('');
  });

  it('what the eligible player is told: the district is free, the buyer already paid', () => {
    expect(snatchEligibilityText(snatchInfo(windowSession()))).toBe('Madhapur for free: Ravi already paid ₹3,20,000');
    expect(snatchEligibilityText(snatchInfo(windowSession({ claims: ['me'] })))).toMatch(/^Locked in/);
    expect(snatchEligibilityText(snatchInfo(windowSession({ me: 'b1' })))).toBe('You bought Madhapur. Others may snatch it');
    expect(snatchEligibilityText(snatchInfo(windowSession({ eligible: ['c2'] })))).toBe('Ravi bought Madhapur. You have no Snatch button');
  });

  it('the screen-reader line says the window is open for N seconds', () => {
    expect(snatchAnnouncement(snatchInfo(windowSession()))).toBe('Snatch window open for 5 seconds. Press Snatch to take Madhapur for free');
    expect(snatchAnnouncement(snatchInfo(windowSession({ ms: 1000 })))).toMatch(/^Snatch window open for 1 second\./);
    expect(snatchAnnouncement(snatchInfo(windowSession({ claims: ['me'] })))).toBe('Snatch window open for 5 seconds. Snatch locked in');
    expect(snatchAnnouncement(snatchInfo(windowSession({ me: 'b1', eligible: ['c2'] })))).toBe('Snatch window open for 5 seconds. You bought Madhapur: Zoya can snatch it!');
    expect(snatchAnnouncement(null)).toBe('');
  });
});

describe('<SnatchPopup>', () => {
  const render = (session, placement) => html(h(SnatchPopup, { session, placement }));

  it('an eligible player gets a big SNATCH! button with the district, the price, the buttons held and the seconds', () => {
    const out = render(windowSession());
    expect(out).toContain('role="alertdialog"');
    expect(out).toContain('aria-modal="false"');
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    expect(out).toMatch(/aria-describedby="[^"]+"/);
    expect(out).toContain('data-mode="press"');
    expect(out).toContain('>SNATCH!<');
    expect(out).toContain('Madhapur · ₹3,20,000');
    expect(out).toContain('x1'); // ⚡ x1
    expect(out).toContain('class="sn-secs">5<');
    expect(out).toContain('class="sn-ring"');
    expect(out).toContain('--f:1.0000'); // a full ring at the start
    expect(out).toContain('Ravi bought it.');
    expect(out).toContain('Snatch Madhapur for free, ₹3,20,000, 5 seconds left');
    expect(out).toMatch(/<button[^>]*class="sn-btn"/);
    expect(out).not.toMatch(/<button[^>]*disabled/);
    expect(out).toContain('You and Zoya can snatch it!'); // the hidden line for assistive tech
  });

  it('is derived from the latest state: still there while the presenter is busy and options are blank', () => {
    const out = render(windowSession({ options: {}, patch: {} }), 'phone');
    expect(out).toContain('>SNATCH!<');
    const busy = windowSession();
    busy.busy = true;
    expect(render(busy)).toContain('>SNATCH!<');
  });

  it('once pressed (the server echoes options.snatched, or the claims carry me) the button is locked: "Locked in — waiting…"', () => {
    for (const s of [windowSession({ options: { snatched: true } }), windowSession({ claims: ['me'] })]) {
      const out = render(s);
      expect(out).toContain('data-mode="locked"');
      expect(out).toContain('Locked in — waiting…');
      expect(out).not.toContain('>SNATCH!<');
      expect(out).toMatch(/<button[^>]*class="sn-btn"[^>]*disabled=""|<button[^>]*disabled=""[^>]*class="sn-btn"/);
      expect(out).toContain('You pressed Snatch.');
      expect(out).toContain('Snatch locked in, waiting for the window to close');
    }
  });

  it('the buyer, a player without a button and a spectator get a passive banner with the countdown and no button', () => {
    const buyer = render(windowSession({ me: 'b1', eligible: ['c2'] }));
    expect(buyer).toContain('role="status"');
    expect(buyer).toContain('data-mode="watch"');
    expect(buyer).toContain('You bought Madhapur: Zoya can snatch it!');
    expect(buyer).toContain('class="sn-secs"');
    expect(buyer).toContain('class="sn-bar"');
    expect(buyer).not.toContain('<button');
    expect(buyer).not.toContain('alertdialog');
    const poor = render(windowSession({ eligible: ['c2'], tokens: { me: 0 } }));
    expect(poor).toContain('Ravi bought Madhapur: Zoya can snatch it!');
    expect(poor).not.toContain('<button');
    const spectator = render(windowSession({ me: 'ghost' }));
    expect(spectator).toContain('Ravi bought Madhapur: Asha and Zoya can snatch it!');
    expect(spectator).not.toContain('<button');
    const broke = windowSession();
    broke.view.players.find((p) => p.id === 'me').bankrupt = true;
    expect(render(broke)).not.toContain('<button');
  });

  it('it GOES OFF: nothing renders once the phase leaves snatch, or for a window that is not a snatch', () => {
    expect(render(windowSession({ patch: { phase: 'manage', pending: null } }))).toBe('');
    expect(render(windowSession({ patch: { phase: 'roll', pending: null } }))).toBe('');
    expect(render(windowSession({ patch: { pending: { type: 'auction', tile: 29 } } }))).toBe('');
    expect(render({ me: 'me', view: null })).toBe('');
  });

  it('the placement is a data attribute the CSS reads: phone = above the action row, board = near the board bottom', () => {
    expect(render(windowSession(), 'phone')).toContain('data-place="phone"');
    expect(render(windowSession(), 'board')).toContain('data-place="board"');
    expect(render(windowSession())).toContain('data-place="board"');
    expect(render(windowSession(), 'phone')).toContain('data-state="in"');
  });

  it('a window without a length counts five seconds', () => {
    expect(render(windowSession({ ms: undefined }))).toContain('class="sn-secs">5<');
  });

  it('usePresence is a function of (open, exitMs): open means in', () => {
    expect(typeof usePresence).toBe('function');
  });
});

describe('Snatch chips (the token count next to a piece)', () => {
  const room = (players, cfg = {}) => {
    const view = createGame({ players, seed: 5, settings: cfg });
    return { me: players[0].id, view, display: view, options: {}, dispatch() {}, roomPlayers: [], log: [], chat: [], connection: 'open', clock: null };
  };
  const two = [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }];

  it('the chip is a bolt and the count, dim at zero, and says so to assistive tech', () => {
    const one = html(h(SnatchChip, { count: 1 }));
    expect(one).toContain('class="sn-chip"');
    expect(one).toContain('role="img"');
    expect(one).toContain('aria-label="Snatch button: 1"');
    expect(one).toMatch(/<b[^>]*>1<\/b>/);
    const zero = html(h(SnatchChip, { count: 0 }));
    expect(zero).toContain('sn-chip is-zero');
    expect(zero).toContain('aria-label="Snatch buttons: 0"');
    expect(snatchChipLabel(2)).toBe('Snatch buttons: 2');
    expect(html(h(SnatchChip, { count: null }))).toBe('');
    expect(html(h(SnatchChip, { count: undefined }))).toBe('');
    expect(html(h(SnatchChip, { count: 1 }))).not.toContain('sn-chip__plus'); // no flourish on the first render
    expect(BUMP_MS).toBeGreaterThan(1000);
  });

  it('snatchCount / snatchChipsOn: hidden when the rule is off and nobody holds a button, shown otherwise', () => {
    expect(snatchCount({ snatches: 2 })).toBe(2);
    expect(snatchCount({ snatches: -1 })).toBe(0);
    expect(snatchCount({})).toBeNull();
    expect(snatchChipsOn(room(two))).toBe(true);
    expect(snatchChipsOn(room(two, { snatches: 0 }))).toBe(false);
    const off = room(two, { snatches: 0 });
    off.display.players[1].snatches = 1; // a card won a button at a table that started with none
    expect(snatchChipsOn(off)).toBe(true);
    const old = room(two);
    old.display.players.forEach((p) => { delete p.snatches; });
    expect(snatchChipsOn(old)).toBe(false); // a game without the rule has no chips at all
    expect(snatchChipsOn(null)).toBe(false);
  });

  it('the phone table draws a chip on every piece token (inside .pp__piece) and says it in the label', () => {
    const s = room(two);
    s.display.players[1].snatches = 2;
    const out = html(h(PhonePlayers, { session: s }));
    expect((out.match(/class="sn-chip/g) || []).length).toBe(2);
    expect(out).toMatch(/<span class="pp__piece">.*?class="sn-chip pp__sn"/);
    expect(out).toContain('2 Snatch buttons');
    expect(out).toContain('1 Snatch button');
  });

  it('...and none when the rule is off, for a player who is out, or in a game without it', () => {
    expect(html(h(PhonePlayers, { session: room(two, { snatches: 0 }) }))).not.toContain('sn-chip');
    const out = room(two);
    out.display.players[1].bankrupt = true;
    expect((html(h(PhonePlayers, { session: out })).match(/class="sn-chip/g) || []).length).toBe(1);
    const old = room(two);
    old.display.players.forEach((p) => { delete p.snatches; });
    expect(html(h(PhonePlayers, { session: old }))).not.toContain('sn-chip');
  });

  it('the desktop pods show the chip beside the name', () => {
    const s = room(two);
    const out = html(h(PlayerPods, { session: s, layout: 'wide' }));
    expect((out.match(/class="sn-chip hg-pod__sn"/g) || []).length).toBe(2);
    expect(out).toContain('1 Snatch button');
    expect(html(h(PlayerPods, { session: room(two, { snatches: 0 }), layout: 'wide' }))).not.toContain('sn-chip');
  });
});

describe('the contested district on the board', () => {
  const tileHtml = (session, tile = 29) => {
    const out = html(h(Board, { session }));
    const at = out.indexOf(`data-tile="${tile}"`);
    return out.slice(out.lastIndexOf('<button', at), out.indexOf('</button>', at));
  };

  it('pulses (ring + bolt + an accessible note) while the window is open, read from the latest state', () => {
    const s = windowSession();
    s.display = { ...s.view, phase: 'buy', pending: null }; // the delayed display has not caught up
    const mine = tileHtml(s);
    expect(mine).toContain('is-snatch');
    expect(mine).toContain('hb-tile__sn-ring');
    expect(mine).toContain('hb-tile__sn-badge');
    expect(mine).toContain('snatch window open');
    expect(tileHtml(s, 28)).not.toContain('is-snatch');
  });

  it('is plain again once the window is over', () => {
    expect(tileHtml(windowSession({ patch: { phase: 'manage', pending: null } }))).not.toContain('is-snatch');
  });

  it('a snatched district flashes briefly (display.snatchMark) and says it was just snatched', () => {
    const s = windowSession({ patch: { phase: 'manage', pending: null } });
    s.display = { ...s.view, snatchMark: { tile: 29, winner: 'me' } };
    const out = tileHtml(s);
    expect(out).toContain('is-snatched');
    expect(out).toContain('just snatched');
    expect(out).not.toContain('is-snatch ');
  });
});

describe('the action row and the status line during the window', () => {
  it('the row only says what is going on (the button is the pop-up\'s), even while the presenter is busy', () => {
    expect(buildActionSpec(windowSession())).toMatchObject({ kind: 'status', label: 'Snatch it now!', primary: null, upgrades: 0 });
    const busy = windowSession();
    busy.busy = true;
    expect(buildActionSpec(busy).label).toBe('Snatch it now!');
    expect(buildActionSpec(windowSession({ claims: ['me'] })).label).toBe('Snatch locked in…');
    expect(buildActionSpec(windowSession({ me: 'b1', eligible: ['c2'] })).label).toBe('Snatch window open…');
    expect(buildActionSpec(windowSession()).sr).toContain('Ravi bought Madhapur');
    expect(buildActionSpec(windowSession({ patch: { phase: 'manage', pending: null } })).label).not.toMatch(/Snatch/);
  });

  it('the status line follows', () => {
    expect(statusLine(windowSession(), null)).toMatchObject({ tone: 'mine', text: 'Snatch it now!' });
    expect(statusLine(windowSession({ me: 'b1', eligible: ['c2'] }), null)).toMatchObject({ tone: 'other', text: 'Snatch window open…' });
  });
});

describe('the board knows every tile id the window can name', () => {
  it('Madhapur is a district', () => {
    expect(TILES[29].type).toBe('property');
  });
});

describe('the Snatch cards in the card reveal', () => {
  const snatchCards = LUCK_CARDS.filter((c) => c.effect?.type === 'snatch');

  it('the engine has three of them, each with art, a text and a cap text', () => {
    expect(snatchCards.map((c) => c.id).sort()).toEqual(['snatch_broker', 'snatch_haggle', 'snatch_tip']);
    for (const c of snatchCards) {
      expect(CARD_ART[c.id], c.id).toBeTruthy();
      expect(c.text).toMatch(/Snatch button/);
      expect(c.capText).toBeTruthy();
    }
  });

  it('their art carries the bolt badge, except a card drawn at the cap (it pays money instead)', () => {
    const art = (props) => renderToStaticMarkup(h(EventCardArt, props));
    expect(art({ cardId: 'snatch_tip', kind: 'good' })).toContain('M3 -15 -10 3h8l-3 13 14-19h-8Z');
    expect(art({ cardId: 'snatch_tip', kind: 'good', capped: true })).not.toContain('M3 -15 -10 3h8l-3 13 14-19h-8Z');
    expect(art({ cardId: 'biryani_viral', kind: 'good' })).not.toContain('M3 -15 -10 3h8l-3 13 14-19h-8Z');
  });

  it('the reveal shows the card text as it is, the capped text included, and keeps the cap flag', () => {
    const [c] = snatchCards;
    const card = { player: 'me', deck: 'luck', title: c.title, text: c.capText, kind: c.kind, cardId: c.id, capped: true };
    expect(cardOf({ card })).toMatchObject({ title: c.title, text: c.capText, cardId: c.id, capped: true });
    expect(cardOf({ card: { ...card, capped: undefined } }).capped).toBe(false);
    expect(cardAnnouncement(cardOf({ card }))).toBe(`Nawabi Luck: ${c.title}. ${c.capText}`);
  });

  it('every Snatch card is held long enough to read, at the same time on the server and the client', () => {
    for (const c of snatchCards) {
      for (const text of [c.text, c.capText]) {
        const ms = cardMs({ title: c.title, text });
        expect(ms).toBeGreaterThanOrEqual(4000);
        expect(ms).toBeLessThanOrEqual(9000);
      }
    }
  });
});
