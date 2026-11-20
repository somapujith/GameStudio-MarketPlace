import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import CameraHud, { HUD_BUTTONS } from './CameraHud.jsx';
import BoardCamera, { NARROW_MAX } from './CameraFocus.jsx';
import { announceFor, hudModel, tileLabelOf } from './cameraHudModel.js';
import { visibleRect } from './FxLayer.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const buttons = (out) => [...out.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);

describe('CameraHud markup', () => {
  it('has three real buttons with names, in the order out, in, whole board', () => {
    const out = html(createElement(CameraHud, { on: true, text: 'Sana is moving…' }));
    const list = buttons(out);
    expect(list).toHaveLength(3);
    expect(HUD_BUTTONS.map((b) => b.label)).toEqual(['Zoom out', 'Zoom in', 'Show whole board']);
    expect(list[0]).toContain('aria-label="Zoom out"');
    expect(list[1]).toContain('aria-label="Zoom in"');
    expect(list[2]).toContain('aria-label="Show whole board"');
    for (const b of list) {
      expect(b).toContain('type="button"');
      expect(b).toContain('class="bc-hud__btn');
    }
  });

  it('is a labelled group, marked as HUD so the board gestures leave it alone', () => {
    const out = html(createElement(CameraHud, { on: true }));
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Board camera"');
    expect(out).toContain('data-bc-hud');
  });

  it('shows only while zoomed and docks top or bottom', () => {
    expect(html(createElement(CameraHud, { on: true }))).toContain('data-on=""');
    expect(html(createElement(CameraHud, { on: false }))).not.toContain('data-on');
    expect(html(createElement(CameraHud, { edge: 'bottom' }))).toContain('data-edge="bottom"');
    expect(html(createElement(CameraHud, { edge: 'sideways' }))).toContain('data-edge="top"');
    expect(html(createElement(CameraHud, {}))).toContain('data-edge="top"');
  });

  it('prints the status line and the avatar token', () => {
    const out = html(createElement(CameraHud, { on: true, text: 'Landed on Madhapur', token: createElement('i', { id: 'tok' }) }));
    expect(out).toContain('Landed on Madhapur');
    expect(out).toContain('id="tok"');
    expect(html(createElement(CameraHud, { on: true, text: 'x' }))).not.toContain('bc-hud__token');
  });

  it('announces camera changes in a polite live region that is always there', () => {
    const off = html(createElement(CameraHud, { on: false }));
    expect(off).toMatch(/<p class="hg-sr" aria-live="polite" aria-atomic="true"[^>]*><\/p>/);
    const on = html(createElement(CameraHud, { on: true, announce: 'Zoomed in on Madhapur' }));
    expect(on).toContain('>Zoomed in on Madhapur</p>');
  });

  it('greys the zoom buttons out at their ends', () => {
    const [out, inn, fit] = buttons(html(createElement(CameraHud, { on: true, canIn: false, canOut: false })));
    expect(out).toContain('disabled');
    expect(inn).toContain('disabled');
    expect(fit).not.toContain('disabled');
  });

  it('draws icons that are hidden from screen readers', () => {
    const out = html(createElement(CameraHud, { on: true }));
    expect((out.match(/<svg[^>]*aria-hidden="true"/g) || []).length).toBe(3);
  });
});

describe('BoardCamera on the server and on wide boards', () => {
  it('renders the board untouched: no HUD, no camera attributes, no tab stop', () => {
    const out = html(createElement(BoardCamera, { session: null }, createElement('div', { id: 'board' })));
    expect(out).toContain('class="bc"');
    expect(out).toContain('id="board"');
    expect(out).toContain('data-camera="off"');
    expect(out).not.toContain('bc-hud');
    expect(out).not.toContain('tabindex');
    expect(out).not.toContain('style=');
  });

  it('uses the same width as the narrow-board tile labels', () => {
    expect(NARROW_MAX).toBe(520);
  });
});

describe('what the HUD says', () => {
  const P = (id, name, pos, extra = {}) => ({ id, name, pos, color: '#fff', ...extra });
  const mk = ({ turn = 0, display = {}, view = {}, ...rest } = {}) => {
    const players = [P('me', 'Nithin', 3), P('sana', 'Sana Rao', 14)];
    return {
      me: 'me',
      busy: false,
      rolling: false,
      options: {},
      view: { turn, players, pending: null, ...view },
      display: { turn, players, landing: null, moving: null, ...display },
      ...rest,
    };
  };
  const madhapur = TILES.find((t) => t.name === 'Madhapur');

  it('names the tile', () => {
    expect(madhapur).toBeTruthy();
    expect(tileLabelOf(madhapur.id)).toBe('Madhapur');
    expect(tileLabelOf(-1)).toBe('');
    expect(tileLabelOf(null)).toBe('');
  });

  it('says whose turn it is', () => {
    expect(hudModel(mk()).text).toBe('Your turn');
    expect(hudModel(mk({ turn: 1 })).text).toBe("Sana's turn");
    expect(hudModel(mk({ turn: 1 })).player.id).toBe('sana');
  });

  it('says who is moving, landing, rolling or deciding', () => {
    expect(hudModel(mk({ turn: 1, display: { moving: 'sana' } })).text).toBe('Sana is moving…');
    expect(hudModel(mk({ display: { moving: 'me' } })).text).toBe('You are moving…');
    expect(hudModel(mk({ turn: 1, rolling: true })).text).toBe('Sana is rolling…');
    const landed = hudModel(mk({ turn: 1, display: { landing: madhapur.id } }));
    expect(landed.text).toBe('Landed on Madhapur');
    expect(landed.tile).toBe(madhapur.id);
    const buy = hudModel(mk({ options: { buy: true }, view: { pending: { type: 'buy', tile: madhapur.id } } }));
    expect(buy.text).toBe('Buy Madhapur?');
  });

  it('is safe on a session with nobody in it', () => {
    expect(hudModel(null)).toEqual({ player: null, text: '', tile: null });
  });

  it('words the announcements for a screen reader', () => {
    expect(announceFor(true, madhapur.id)).toBe('Zoomed in on Madhapur');
    expect(announceFor(true, null)).toBe('Zoomed in');
    expect(announceFor(false, madhapur.id)).toBe('Board overview');
  });
});

describe('coin flights while the board is zoomed', () => {
  const view = { left: 10, top: 100, right: 400, bottom: 490, width: 390, height: 390 };
  it('leaves an endpoint that is inside the view alone (clipped to the view)', () => {
    const r = { left: 100, top: 200, right: 160, bottom: 260, width: 60, height: 60 };
    expect(visibleRect(r, view)).toEqual({ left: 100, top: 200, width: 60, height: 60 });
  });
  it('clips a box that spills out of the view', () => {
    const r = { left: -200, top: 300, right: 100, bottom: 700, width: 300, height: 400 };
    expect(visibleRect(r, view)).toEqual({ left: 10, top: 300, width: 90, height: 190 });
  });
  it('puts an endpoint that is entirely off-screen on the nearest visible spot of the board', () => {
    const r = { left: -600, top: 900, right: -500, bottom: 1000, width: 100, height: 100 };
    const v = visibleRect(r, view);
    expect(v.left + v.width / 2).toBeGreaterThanOrEqual(view.left);
    expect(v.left + v.width / 2).toBeLessThanOrEqual(view.right);
    expect(v.top + v.height / 2).toBeGreaterThanOrEqual(view.top);
    expect(v.top + v.height / 2).toBeLessThanOrEqual(view.bottom);
    expect(v.width).toBeGreaterThan(0);
  });
  it('does nothing without a camera', () => {
    const r = { left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2 };
    expect(visibleRect(r, null)).toBe(r);
  });
});
