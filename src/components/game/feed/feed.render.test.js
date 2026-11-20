import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import ActivityFeed from './ActivityFeed.jsx';
import FeedToasts from './FeedToasts.jsx';
import { LogSheet } from '../LogPanel.jsx';
import AttentionPulse from '../fx/AttentionPulse.jsx';
import { burstPath, swayPath } from '../fx/burst.js';

const html = (el) => renderToStaticMarkup(el);
const players = [
  { id: 'me', name: 'Nithin', color: '#ff4d6d' },
  { id: 'rav', name: 'Ravi', color: '#3ddc97' },
];
const tileId = TILES.findIndex((t) => t.type === 'property');
const now = Date.now();
const session = {
  me: 'me',
  display: { players },
  log: [
    { id: 1, text: 'Ravi rolled 4', tone: 'info', icon: '🎲', player: 'rav', at: now, ev: { type: 'dice', player: 'rav', values: [4] } },
    { id: 2, text: `Ravi landed on ${TILES[tileId].name}`, tone: 'info', icon: '🏠', player: 'rav', tile: tileId, at: now, ev: { type: 'land', player: 'rav', tile: tileId } },
    { id: 3, text: 'Ravi paid ₹32,000 rent to You', tone: 'good', icon: '🏠', player: 'rav', at: now, ev: { type: 'cash', player: 'rav', delta: -32000, reason: 'rent', other: 'me' } },
    { id: 4, text: 'You received ₹32,000', tone: 'good', icon: '💸', player: 'me', at: now, ev: { type: 'cash', player: 'me', delta: 32000, reason: 'whatever' } },
  ],
};

describe('<ActivityFeed>', () => {
  it('lists the story newest first with chips, merged roll + landing, and a silent log role', () => {
    const out = html(createElement(ActivityFeed, { session }));
    expect(out).toContain('aria-label="Activity"');
    expect(out).toContain('role="log"');
    expect(out).toContain('aria-live="off"');
    expect(out.indexOf('received')).toBeLessThan(out.indexOf('rent to'));
    expect(out).toContain('af-chip');
    expect(out).toContain('Ravi rolled 4 and landed on');
    expect(out).not.toContain('>Ravi rolled 4<'); // merged into one row
    expect(out).toContain(`Show ${TILES[tileId].name} on the board`); // the tappable row says what a tap does
  });
  it('shows my own money with a sign', () => {
    const out = html(createElement(ActivityFeed, { session }));
    expect(out).toContain('af__money is-in');
    expect(out).toContain('+₹32,000');
  });
  it('has a collapse button that reports its state', () => {
    const out = html(createElement(ActivityFeed, { session }));
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('Collapse activity feed');
  });
  it('an empty table says how the story starts', () => {
    expect(html(createElement(ActivityFeed, { session: { me: 'me', display: { players }, log: [] } }))).toContain('Your story starts with a roll.');
  });
  it('compact is a bare strip (no header) capped to max rows', () => {
    const out = html(createElement(ActivityFeed, { session, compact: true, max: 2 }));
    expect(out).not.toContain('af__head');
    expect(out.match(/<li /g)).toHaveLength(2);
  });
  it('the sheet variant is labelled as the game log and has no collapse header', () => {
    const out = html(createElement(ActivityFeed, { session, variant: 'sheet' }));
    expect(out).toContain('aria-label="Game log"');
    expect(out).not.toContain('af__fold');
  });
  it('survives a session with no log', () => {
    expect(() => html(createElement(ActivityFeed, { session: {} }))).not.toThrow();
  });
});

describe('<FeedToasts>', () => {
  it('renders nothing at first (the log at mount is not replayed) and is hidden from screen readers', () => {
    expect(html(createElement(FeedToasts, { session }))).toBe('');
  });
});

describe('<LogSheet>', () => {
  it('is closed without rendering the feed', () => {
    expect(html(createElement(LogSheet, { session, open: false, onClose: () => {} }))).toBe('');
  });
});

describe('<AttentionPulse>', () => {
  it('renders two rings by default, decorative only', () => {
    const out = html(createElement(AttentionPulse, {}));
    expect(out).toContain('aria-hidden="true"');
    expect(out.match(/ap__ring/g).length).toBeGreaterThanOrEqual(2);
    expect(out).not.toContain('ap__arrow');
  });
  it('can be an arrow with a placement and a tone', () => {
    const out = html(createElement(AttentionPulse, { variant: 'arrow', placement: 'bottom', tone: 'good' }));
    expect(out).toContain('ap__arrow--bottom');
    expect(out).toContain('ap--good');
    expect(out).not.toContain('ap__ring');
  });
  it('renders nothing when inactive', () => {
    expect(html(createElement(AttentionPulse, { active: false }))).toBe('');
  });
});

describe('burst physics', () => {
  it('particles start at the centre, fly out upwards and come back down with gravity', () => {
    const p = burstPath(0, 5, { radius: 40, gravity: 10, steps: 6 });
    expect(p).toHaveLength(7);
    expect(Math.abs(p[0].x)).toBe(0);
    expect(Math.abs(p[0].y)).toBe(0);
    expect(p[3].y).toBeLessThan(0);
    expect(p[6].o).toBe(0);
    const mid = burstPath(2, 5)[3];
    expect(Math.abs(mid.x)).toBeLessThan(10); // the middle particle goes (nearly) straight up
    expect(burstPath(0, 5)[6].x).toBeLessThan(0);
    expect(burstPath(4, 5)[6].x).toBeGreaterThan(0);
    expect(burstPath(0, 1)[3].y).toBeLessThan(0);
  });
  it('sways like a damped sine', () => {
    const s = swayPath(8, 8);
    expect(s).toHaveLength(9);
    expect(s[0]).toBe(0);
    expect(Math.max(...s.map(Math.abs))).toBeLessThanOrEqual(8);
  });
});
