import { describe, it, expect } from 'vitest';
import { KEY_HELP, LOOK, createGesture, dragToLook, isTurned, lookKeyIntent, stepInertia } from './look.js';

const key = (k, o = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe('drag to look', () => {
  it('turns by 0.004 rad per pixel: right looks right, drag down looks down', () => {
    const l = dragToLook(100, 0);
    expect(l.dYaw).toBeCloseTo(0.4, 5);
    expect(l.dPitch).toBeCloseTo(0, 5);
    expect(dragToLook(0, 50).dPitch).toBeLessThan(0);
    expect(dragToLook(0, -50).dPitch).toBeGreaterThan(0);
  });
});

describe('gesture classifier', () => {
  const down = (g, o = {}) => g.down({ x: 200, y: 300, t: 0, pointerType: 'touch', viewportWidth: 400, ...o });

  it('a press that barely moves is a TAP at the pressed point', () => {
    const g = createGesture();
    down(g);
    expect(g.move({ x: 203, y: 302, t: 40 })).toBeNull();
    expect(g.up({ t: 120 })).toEqual({ type: 'tap', x: 200, y: 300 });
  });

  it('moving past the slop is a DRAG that looks; the first look carries the whole distance', () => {
    const g = createGesture();
    down(g);
    const r = g.move({ x: 230, y: 300, t: 30 });
    expect(r.look.dYaw).toBeCloseTo(30 * LOOK.sens, 5);
    const r2 = g.move({ x: 250, y: 300, t: 60 });
    expect(r2.look.dYaw).toBeCloseTo(20 * LOOK.sens, 5);
    expect(g.dragging).toBe(true);
    const up = g.up({ t: 70 });
    expect(up.type).toBe('drag');
    expect(up.vYaw).toBeGreaterThan(0); // a flick keeps turning
  });

  it('a pause before release kills the flick; a long still press is neither tap nor drag', () => {
    const g = createGesture();
    down(g);
    g.move({ x: 260, y: 300, t: 30 });
    expect(g.up({ t: 400 })).toEqual({ type: 'drag', vYaw: 0, vPitch: 0 });
    down(g, { t: 1000 });
    expect(g.up({ t: 1000 + LOOK.touchTapMs + 50 })).toBeNull();
  });

  it('edge swipes turn the head faster than a drag from the middle', () => {
    const mid = createGesture();
    down(mid);
    const a = mid.move({ x: 230, y: 300, t: 30 }).look.dYaw;
    const edge = createGesture();
    edge.down({ x: 6, y: 300, t: 0, pointerType: 'touch', viewportWidth: 400 });
    const b = edge.move({ x: 36, y: 300, t: 30 }).look.dYaw;
    expect(b).toBeCloseTo(a * LOOK.edgeBoost, 5);
  });

  it('a press on the edge that does not move is still a tap; a right-button press only ever looks', () => {
    const e = createGesture();
    e.down({ x: 6, y: 300, t: 0, pointerType: 'touch', viewportWidth: 400 });
    expect(e.up({ t: 80 })).toEqual({ type: 'tap', x: 6, y: 300 });
    const r = createGesture();
    r.down({ x: 100, y: 100, t: 0, pointerType: 'mouse', button: 2, viewportWidth: 400 });
    expect(r.move({ x: 102, y: 100, t: 20 }).look.dYaw).toBeGreaterThan(0);
    expect(r.up({ t: 30 }).type).toBe('drag');
  });

  it('mouse slop is tighter than touch slop, and cancel forgets the press', () => {
    const m = createGesture();
    m.down({ x: 0, y: 0, t: 0, pointerType: 'mouse', viewportWidth: 400 });
    expect(m.move({ x: 10, y: 0, t: 10 })).not.toBeNull();
    const t = createGesture();
    t.down({ x: 100, y: 100, t: 0, pointerType: 'touch', viewportWidth: 400 });
    expect(t.move({ x: 110, y: 100, t: 10 })).toBeNull();
    t.cancel();
    expect(t.active).toBe(false);
    expect(t.up({ t: 20 })).toBeNull();
  });
});

describe('a finger rests longer than a click', () => {
  it('a still touch up to touchTapMs is a tap, a mouse press that long is not', () => {
    const t = createGesture();
    t.down({ x: 50, y: 60, t: 0, pointerType: 'touch', viewportWidth: 400 });
    expect(t.up({ t: LOOK.touchTapMs - 20 })).toEqual({ type: 'tap', x: 50, y: 60 });
    const slow = createGesture();
    slow.down({ x: 50, y: 60, t: 0, pointerType: 'touch', viewportWidth: 400 });
    expect(slow.up({ t: LOOK.touchTapMs + 50 })).toBeNull(); // a long press: no action, no look
    const m = createGesture();
    m.down({ x: 50, y: 60, t: 0, pointerType: 'mouse', viewportWidth: 400 });
    expect(m.up({ t: LOOK.tapMs + 100 })).toBeNull();
    expect(LOOK.touchTapMs).toBeGreaterThan(LOOK.tapMs);
  });
});

describe('inertia', () => {
  it('decays and stops', () => {
    let v = { vYaw: 2, vPitch: 0 };
    let total = 0;
    let frames = 0;
    for (; frames < 600; frames += 1) {
      const r = stepInertia(v, 1 / 60);
      total += r.dYaw;
      v = r.v;
      if (r.done) break;
    }
    expect(frames).toBeLessThan(600);
    expect(total).toBeGreaterThan(0.1);
    expect(total).toBeLessThan(2 / LOOK.friction + 0.1);
    expect(v).toEqual({ vYaw: 0, vPitch: 0 });
  });
});

describe('look keys (E acts, Z/X look, A/D walk)', () => {
  it('Z and X turn left and right, Shift+arrows turn and tilt, V recentres', () => {
    expect(lookKeyIntent(key('z')).dYaw).toBeLessThan(0);
    expect(lookKeyIntent(key('x')).dYaw).toBeGreaterThan(0);
    expect(lookKeyIntent(key('ArrowLeft', { shiftKey: true })).dYaw).toBeLessThan(0);
    expect(lookKeyIntent(key('ArrowRight', { shiftKey: true })).dYaw).toBeGreaterThan(0);
    expect(lookKeyIntent(key('ArrowUp', { shiftKey: true })).dPitch).toBeGreaterThan(0);
    expect(lookKeyIntent(key('ArrowDown', { shiftKey: true })).dPitch).toBeLessThan(0);
    expect(lookKeyIntent(key('v'))).toBe('recentre');
  });
  it('leaves the walking and working keys alone', () => {
    for (const k of ['a', 'd', 'e', ' ', 'c', 'ArrowLeft', 'ArrowRight', 'q']) expect(lookKeyIntent(key(k))).toBeNull();
    expect(lookKeyIntent(key('z', { ctrlKey: true }))).toBeNull();
  });
  it('prints the same scheme it implements', () => {
    const text = JSON.stringify(KEY_HELP);
    expect(text).toContain('Shift + arrows');
    expect(KEY_HELP.keyboard.find((r) => r.keys.includes('E'))).toBeTruthy();
    expect(KEY_HELP.keyboard.find((r) => r.keys.includes('Z') && r.keys.includes('X'))).toBeTruthy();
    expect(KEY_HELP.touch.length).toBeGreaterThan(3);
  });
});

describe('isTurned', () => {
  it('is false near centre and true once the head has turned', () => {
    expect(isTurned({ yaw: 0.05, pitch: 0 })).toBe(false);
    expect(isTurned({ yaw: 0.5, pitch: 0 })).toBe(true);
    expect(isTurned({ yaw: 0, pitch: -0.4 })).toBe(true);
    expect(isTurned(null)).toBe(false);
  });
});
