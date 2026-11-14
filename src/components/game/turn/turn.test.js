import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DECISION_MS, WARN_MS, WARN_TEXT, clockInfo } from './clock.js';
import { ANIM_MS } from '@shared/timing.js';
import { roundBadgeInfo } from './RoundBadge.jsx';
import TurnBanner, { BANNER_INIT, bannerReducer, currentHandoff, handoffKey, handoffMs } from './TurnBanner.jsx';
import CardReveal, { cardAnnouncement, cardOf } from './CardReveal.jsx';
import { shouldRestoreFocus } from '../ui/Sheet.jsx';
import { bubbleSpeaker, placeBubble } from './SpeechBubble.jsx';
import { TIMER_LABEL, TimerBar, TimerRing, waitLabel } from './TurnTimer.jsx';
import { QUICK_EMOTES, EMOTE_INFO } from './emotes.js';
import { isConnected, modeLabel, roomPlayer, tableSummary } from './room.js';
import { normalizeClock } from '@/lib/session/useOnlineGame.js';
import GameView, { tradeDeadline } from '../GameView.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');

const players = [{ id: 'me', name: 'Nithin', color: '#ff4d6d' }, { id: 'rav', name: 'Ravi', color: '#3ddc97' }];
const sess = (extra = {}) => ({
  me: 'me',
  view: { phase: 'roll', turn: 0, round: 4, players, cfg: { maxRounds: 20 } },
  display: { phase: 'roll', turn: 0, round: 4, players, cfg: { maxRounds: 20 } },
  ...extra,
});

describe('clockInfo', () => {
  it('is null without a deadline', () => {
    expect(clockInfo(null, 'me')).toBeNull();
    expect(clockInfo({ deadline: null, waitingFor: ['me'] }, 'me')).toBeNull();
  });

  it('counts down from the 45 s decision timer, warns only me in the last 10 s', () => {
    const now = 1_000_000;
    const c = { deadline: now + 30_000, waitingFor: ['me'] };
    const a = clockInfo(c, 'me', now);
    expect(a.secs).toBe(30);
    expect(a.frac).toBeCloseTo(30_000 / DECISION_MS, 5);
    expect(a.mine).toBe(true);
    expect(a.warn).toBe(false);
    const b = clockInfo(c, 'me', now + 30_000 - WARN_MS + 1);
    expect(b.warn).toBe(true);
    expect(clockInfo(c, 'rav', now + 25_000).warn).toBe(false);
    expect(clockInfo(c, 'me', now + 40_000).leftMs).toBe(0);
  });

  it('drains over a longer window when the deadline includes the animation', () => {
    const now = 2_000_000;
    const c = { deadline: now + 52_000, waitingFor: ['rav'] };
    expect(clockInfo(c, 'me', now).frac).toBe(1);
    expect(clockInfo(c, 'me', now + 26_000).frac).toBeCloseTo(0.5, 5);
  });
});

describe('normalizeClock / tradeDeadline', () => {
  it('keeps a finite deadline and stringifies ids', () => {
    expect(normalizeClock({ deadline: 5, waitingFor: [7] })).toEqual({ deadline: 5, waitingFor: ['7'] });
    expect(normalizeClock({ deadline: null, waitingFor: [] })).toBeNull();
    expect(normalizeClock(undefined)).toBeNull();
  });

  it('passes the deadline to the trade sheet only when the clock waits on the answer', () => {
    const s = { view: { trade: { from: 'me', to: 'rav' } }, clock: { deadline: 99, waitingFor: ['rav'] } };
    expect(tradeDeadline(s)).toBe(99);
    expect(tradeDeadline({ ...s, clock: { deadline: 99, waitingFor: ['me'] } })).toBeUndefined();
    expect(tradeDeadline({ view: {}, clock: s.clock })).toBeUndefined();
  });
});

describe('<TimerRing> / <TimerBar>', () => {
  it('rings only the players the clock waits for', () => {
    const s = sess({ clock: { deadline: Date.now() + 20_000, waitingFor: ['rav'] } });
    expect(html(createElement(TimerRing, { session: s, playerId: 'rav' }, 'x'))).toContain('tt-ring is-on');
    expect(html(createElement(TimerRing, { session: s, playerId: 'me' }, 'x'))).not.toContain('is-on');
  });

  it('names who we wait for', () => {
    const s = sess();
    expect(waitLabel(s, { mine: true, waitingFor: ['me'] })).toBe('Your move');
    expect(waitLabel(s, { mine: false, waitingFor: ['rav'] })).toBe('Waiting for Ravi');
    expect(html(createElement(TimerBar, { session: sess() }))).toBe('');
  });

  it('is hidden once the game is over', () => {
    const s = sess({ clock: { deadline: Date.now() + 20_000, waitingFor: ['me'] } });
    s.view.phase = 'over';
    s.display.phase = 'over';
    expect(html(createElement(TimerBar, { session: s }))).toBe('');
  });
});

describe('round badge + hand-off', () => {
  it('shows "Round 4 / 20", just "Round 4" in classic, and flags the final round', () => {
    expect(roundBadgeInfo(sess()).text).toBe('Round 4 / 20');
    const classic = sess();
    classic.display.cfg = { maxRounds: null };
    expect(roundBadgeInfo(classic).text).toBe('Round 4');
    expect(roundBadgeInfo(classic).pct).toBeNull();
    const fin = sess();
    fin.display.round = 20;
    expect(roundBadgeInfo(fin).final).toBe(true);
  });

  it('derives the hand-off from the display, or takes the presenter one', () => {
    const d = currentHandoff(sess());
    expect(d).toEqual({ player: 'me', round: 4, isFinal: false });
    expect(handoffKey(d)).toBe('me:4');
    const p = currentHandoff(sess({ handoff: { player: 'rav', round: 20, isFinal: true } }));
    expect(p).toEqual({ player: 'rav', round: 20, isFinal: true });
    const over = sess();
    over.display.phase = 'over';
    expect(currentHandoff(over)).toBeNull();
  });
});

describe('card reveal', () => {
  it('reads session.card, else the card bubble', () => {
    const c = cardOf({ card: { player: 'me', deck: 'drama', title: 'Shaadi ka season!', text: 'Pay 50,000.', kind: 'bad', cardId: 'shaadi' } });
    expect(c).toMatchObject({ deck: 'drama', deckName: 'City Drama', title: 'Shaadi ka season!', kind: 'bad', player: 'me' });
    const b = cardOf({ bubble: { id: 3, type: 'card', card: { title: 'An investor is impressed!', text: '+1,00,000', kind: 'good', deck: 'luck' } } });
    expect(b).toMatchObject({ deck: 'luck', deckName: 'Nawabi Luck', kind: 'good' });
    expect(cardOf({ bubble: { id: 4, type: 'rent', text: 'x' } })).toBeNull();
    expect(cardOf({ card: null })).toBeNull();
  });
});

describe('speech bubbles', () => {
  it('places the bubble above the avatar, clamped to the screen, or below near the top', () => {
    const above = placeBubble({ left: 10, top: 400, width: 40, height: 40, bottom: 440 }, 360, 800);
    expect(above.below).toBe(false);
    expect(above.left).toBe(above.half + 12);
    expect(above.tail).toBeLessThan(0);
    expect(above.bottom).toBe(800 - 400 + 10);
    const below = placeBubble({ left: 160, top: 40, width: 40, height: 40, bottom: 80 }, 360, 800);
    expect(below.below).toBe(true);
    expect(below.top).toBe(90);
    expect(placeBubble(null, 360, 800).below).toBe(true);
  });

  it('speaks for the bubble player, else the newest log line, else the player on turn', () => {
    expect(bubbleSpeaker(sess({ bubble: { id: 1, player: 'rav' } }))).toBe('rav');
    expect(bubbleSpeaker(sess({ bubble: { id: 1 }, log: [{ id: 1, player: 'rav' }] }))).toBe('rav');
    expect(bubbleSpeaker(sess({ bubble: { id: 1 }, log: [] }))).toBe('me');
    expect(bubbleSpeaker(sess({ bubble: null }))).toBeNull();
  });
});

describe('emotes + room', () => {
  it('has six quick reactions from the server whitelist', () => {
    expect(QUICK_EMOTES).toHaveLength(6);
    const server = ['emote_mass', 'emote_cheer', 'emote_shock', 'emote_laugh', 'emote_thanks', 'emote_hurry', 'emote_taunt'];
    for (const e of QUICK_EMOTES) expect(server).toContain(e.id);
    expect(Object.keys(EMOTE_INFO).sort()).toEqual([...server].sort());
  });

  it('reads presence from the room players (unknown = connected)', () => {
    const s = { roomPlayers: [{ id: 7, connected: false }, { id: 'me', connected: true }] };
    expect(roomPlayer(s, '7').id).toBe(7);
    expect(isConnected(s, '7')).toBe(false);
    expect(isConnected(s, 'me')).toBe(true);
    expect(isConnected(s, 'nobody')).toBe(true);
    expect(isConnected({}, 'me')).toBe(true);
  });

  it('labels the modes', () => {
    expect(modeLabel({ mode: 'quick' })).toBe('Quick Chai Break');
    expect(tableSummary({ mode: 'standard', maxRounds: 20, dice: 'fair' })).toBe('Standard City Hustle · 20 rounds · Fair die');
    expect(tableSummary({ mode: 'classic', maxRounds: null })).toBe('Classic Long Game · Until one is left · Lucky die');
  });
});

describe('turn banner hide logic', () => {
  const ho = (player, round = 4, isFinal = false) => ({ player, round, isFinal });

  it('lives as long as the presenter hand-off (ANIM_MS.turn / finalRound at the playback speed)', () => {
    expect(handoffMs(false, 1)).toBe(ANIM_MS.turn);
    expect(handoffMs(true, 1)).toBe(ANIM_MS.finalRound);
    expect(handoffMs(false, 2)).toBe(Math.round(ANIM_MS.turn / 2));
    expect(handoffMs(false, 0.5)).toBe(Math.round(ANIM_MS.turn / 0.75)); // never slower than 0.75x
  });

  it('shows each hand-off once, and a remount (same key) is a no-op that keeps what is shown', () => {
    const a = bannerReducer(BANNER_INIT, { type: 'handoff', handoff: ho('me'), me: 'me', speed: 1 });
    expect(a.shown).toMatchObject({ key: 'me:4', mine: true, final: false, ms: ANIM_MS.turn });
    // StrictMode re-runs the effect with the same key: state is unchanged (the hide timer is re-armed from `shown`)
    expect(bannerReducer(a, { type: 'handoff', handoff: ho('me'), me: 'me', speed: 1 })).toBe(a);
    const b = bannerReducer(a, { type: 'handoff', handoff: ho('rav'), me: 'me', speed: 1 });
    expect(b.shown).toMatchObject({ key: 'rav:4', mine: false });
  });

  it('hides on expiry of its own key and as soon as the presenter clears the hand-off', () => {
    const a = bannerReducer(BANNER_INIT, { type: 'handoff', handoff: ho('me'), me: 'me', speed: 1 });
    expect(bannerReducer(a, { type: 'expire', key: 'me:4' }).shown).toBeNull();
    expect(bannerReducer(a, { type: 'expire', key: 'old:3' })).toBe(a); // a stale timer never hides a newer banner
    const c = bannerReducer(a, { type: 'cleared' });
    expect(c.shown).toBeNull();
    expect(c.last).toBe('me:4'); // the same hand-off is not shown again afterwards
    expect(bannerReducer(c, { type: 'handoff', handoff: ho('me'), me: 'me', speed: 1 }).shown).toBeNull();
  });

  it('adds "Final round!" once', () => {
    const a = bannerReducer(BANNER_INIT, { type: 'handoff', handoff: ho('rav', 20, true), me: 'me', speed: 1 });
    expect(a.shown).toMatchObject({ final: true, ms: ANIM_MS.finalRound });
    const b = bannerReducer(a, { type: 'handoff', handoff: ho('me', 21, true), me: 'me', speed: 1 });
    expect(b.shown).toMatchObject({ final: false, mine: true });
  });

  it('renders nothing on the server (shown only after the effect)', () => {
    expect(html(createElement(TurnBanner, { session: sess() }))).toBe('');
  });
});

describe('screen-reader announcements', () => {
  it('reads a card as "<deck>: <title>. <text>"', () => {
    const c = cardOf({ card: { deck: 'luck', title: 'An investor is impressed!', text: '+1,00,000', kind: 'good' } });
    expect(cardAnnouncement(c)).toBe('Nawabi Luck: An investor is impressed!. +1,00,000');
    expect(cardAnnouncement(cardOf({ card: { deck: 'drama', title: 'Rain!', text: '' } }))).toBe('City Drama: Rain!.');
    expect(cardAnnouncement(null)).toBe('');
    expect(WARN_TEXT).toBe('10 seconds left');
  });

  it('the card reveal has no live region of its own', () => {
    const s = sess({ card: { deck: 'luck', title: 'T', text: 'x' } });
    expect(html(createElement(CardReveal, { session: s }))).not.toContain('aria-live');
  });

  it('the timer keeps one fixed label while it ticks', () => {
    const s = sess({ clock: { deadline: Date.now() + 20_000, waitingFor: ['me'] } });
    const out = html(createElement(TimerBar, { session: s }));
    expect(out).toContain('role="timer"');
    expect(out).toContain(`aria-label="${TIMER_LABEL}"`);
    expect(out).not.toMatch(/aria-label="[^"]*seconds/);
  });

  it('the table renders one empty polite live region', () => {
    const s = sess({ options: {}, log: [], dispatch: () => {} });
    const out = html(createElement(GameView, { session: s, onExit: () => {} }));
    const m = out.match(/<p class="hg-sr" aria-live="polite" aria-atomic="true" data-testid="table-live">([^<]*)<\/p>/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('');
    expect(out.match(/data-testid="table-live"/g)).toHaveLength(1);
    expect(out).toContain("role=\"log\" aria-live=\"off\""); // the inline panel log stays silent
  });

  it('sheets give focus back unless they were opened with a mouse', () => {
    expect(shouldRestoreFocus('keyboard')).toBe(true);
    expect(shouldRestoreFocus('touch')).toBe(true);
    expect(shouldRestoreFocus('pen')).toBe(true);
    expect(shouldRestoreFocus('mouse')).toBe(false);
  });
});
