import { describe, expect, it, vi } from 'vitest';
import { FIT, clampCam, toTransform } from './cameraMath.js';
import { createCameraController, smoothDamp } from './cameraController.js';

const W = 390;

/** A controller on a fake frame loop: `run(ms)` plays 16 ms frames. */
function rig() {
  let t = 1000;
  let queue = [];
  let ids = 0;
  const applied = [];
  const zoomEvents = [];
  const settles = [];
  const ctrl = createCameraController({
    apply: (f) => applied.push(f),
    onZoomChange: (z) => zoomEvents.push(z),
    onSettle: (c) => settles.push(c),
    raf: (fn) => {
      ids += 1;
      queue.push({ id: ids, fn });
      return ids;
    },
    caf: (id) => {
      queue = queue.filter((q) => q.id !== id);
    },
    now: () => t,
  });
  ctrl.setSize(W, W);
  applied.length = 0;
  const frame = (dt = 16) => {
    t += dt;
    const q = queue;
    queue = [];
    q.forEach((x) => x.fn(t));
  };
  const run = (ms, dt = 16) => {
    for (let at = 0; at < ms; at += dt) frame(dt);
  };
  return { ctrl, applied, zoomEvents, settles, frame, run, pending: () => queue.length };
}

describe('smoothDamp', () => {
  it('arrives without overshooting and with zero velocity', () => {
    let x = 0;
    let v = 0;
    let max = 0;
    for (let i = 0; i < 400; i += 1) {
      [x, v] = smoothDamp(x, 1, v, 0.3, 0.016);
      max = Math.max(max, x);
    }
    expect(max).toBeLessThanOrEqual(1);
    expect(x).toBeCloseTo(1, 4);
    expect(Math.abs(v)).toBeLessThan(1e-3);
  });

  it('starts gently: the first frame covers far less than a straight line would', () => {
    const [x] = smoothDamp(0, 1, 0, 0.3, 0.016);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.02);
  });
});

describe('camera controller: gliding to a target', () => {
  it('eases to the target, monotonically, then settles exactly and stops asking for frames', () => {
    const r = rig();
    const target = clampCam({ s: 1.8, cx: 0.3, cy: 0.7 });
    r.ctrl.setTarget(target, { smooth: 0.26 });
    expect(r.pending()).toBe(1);
    const scales = [];
    for (let i = 0; i < 120 && r.pending(); i += 1) {
      r.frame();
      scales.push(r.applied[r.applied.length - 1].s);
    }
    expect(r.pending()).toBe(0);
    for (let i = 1; i < scales.length; i += 1) expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1] - 1e-9);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.8 + 1e-9);
    const last = r.applied[r.applied.length - 1];
    expect(last.moving).toBe(false);
    expect(last.s).toBeCloseTo(1.8, 6);
    const want = toTransform(target, W);
    expect(last.tx).toBeCloseTo(want.tx, 4);
    expect(last.ty).toBeCloseTo(want.ty, 4);
    expect(r.settles).toHaveLength(1);
    expect(r.ctrl.isMoving()).toBe(false);
    // everything but the last write was marked as moving (the wrapper promotes the layer only then)
    expect(r.applied.slice(0, -1).every((f) => f.moving)).toBe(true);
  });

  it('never lets the board edge into the frame on the way, even towards a corner', () => {
    const r = rig();
    r.ctrl.setTarget(clampCam({ s: 2.4, cx: 0, cy: 1 }), { smooth: 0.3 });
    r.run(1500);
    expect(r.applied.length).toBeGreaterThan(10);
    for (const f of r.applied) {
      expect(f.tx).toBeLessThanOrEqual(1e-6);
      expect(f.ty).toBeLessThanOrEqual(1e-6);
      expect(f.tx + f.s * W).toBeGreaterThanOrEqual(W - 1e-6);
      expect(f.ty + f.s * W).toBeGreaterThanOrEqual(W - 1e-6);
    }
  });

  it('retargets mid-flight without a jump (a follow target moves every step)', () => {
    const r = rig();
    r.ctrl.setTarget(clampCam({ s: 1.8, cx: 0.3, cy: 0.5 }), { smooth: 0.26 });
    r.run(160);
    const before = r.ctrl.getCam();
    r.ctrl.setTarget(clampCam({ s: 1.8, cx: 0.4, cy: 0.5 }), { smooth: 0.26 });
    r.frame();
    const after = r.ctrl.getCam();
    expect(Math.abs(after.cx - before.cx)).toBeLessThan(0.05);
    expect(Math.abs(after.s - before.s)).toBeLessThan(0.1);
    r.run(2000);
    expect(r.ctrl.getCam().cx).toBeCloseTo(0.4, 3);
  });

  it('jumps at once when told to (reduced motion, rotation)', () => {
    const r = rig();
    r.ctrl.setTarget({ s: 2, cx: 0.4, cy: 0.4 }, { instant: true });
    expect(r.pending()).toBe(0);
    expect(r.ctrl.getCam()).toEqual({ s: 2, cx: 0.4, cy: 0.4 });
    expect(r.applied[r.applied.length - 1].moving).toBe(false);
    expect(r.settles).toHaveLength(1);
    r.ctrl.setTarget({ s: 2, cx: 0.4, cy: 0.4 }, { instant: true }); // no change, no write
    expect(r.applied).toHaveLength(1);
  });

  it('does nothing when asked for where it already is', () => {
    const r = rig();
    r.ctrl.setTarget(FIT, { smooth: 0.4 });
    expect(r.pending()).toBe(0);
    expect(r.applied).toHaveLength(0);
  });

  it('reports crossing the zoomed threshold once each way', () => {
    const r = rig();
    r.ctrl.setTarget({ s: 2, cx: 0.5, cy: 0.5 }, { smooth: 0.2 });
    r.run(1200);
    expect(r.zoomEvents).toEqual([true]);
    r.ctrl.setTarget(FIT, { smooth: 0.2 });
    r.run(1500);
    expect(r.zoomEvents).toEqual([true, false]);
    expect(r.ctrl.getCam()).toEqual(FIT);
  });

  it('re-clamps when the board is resized', () => {
    const r = rig();
    r.ctrl.setTarget({ s: 2, cx: 0.25, cy: 0.5 }, { instant: true });
    r.ctrl.setSize(300, 300);
    const last = r.applied[r.applied.length - 1];
    expect(last.tx).toBeCloseTo(300 / 2 - 0.25 * 2 * 300, 6);
  });
});

describe('camera controller: a finger on the board', () => {
  it('writes the dragged camera once per frame however often drag() is called', () => {
    const r = rig();
    r.ctrl.setTarget({ s: 2, cx: 0.5, cy: 0.5 }, { instant: true });
    r.applied.length = 0;
    for (let i = 0; i < 10; i += 1) r.ctrl.drag({ s: 2, cx: 0.5 - i * 0.01, cy: 0.5 });
    expect(r.applied).toHaveLength(0); // nothing until the frame
    r.frame();
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].moving).toBe(true);
    expect(r.applied[0].tx).toBeCloseTo(toTransform({ s: 2, cx: 0.41, cy: 0.5 }, W).tx, 6);
    expect(r.pending()).toBe(0);
  });

  it('settles where it is when the finger lifts slowly', () => {
    const r = rig();
    r.ctrl.setTarget({ s: 2, cx: 0.5, cy: 0.5 }, { instant: true });
    r.ctrl.drag({ s: 2, cx: 0.4, cy: 0.5 });
    r.frame();
    r.ctrl.release({ vx: 10, vy: 0 });
    expect(r.ctrl.isMoving()).toBe(false);
    expect(r.applied[r.applied.length - 1].moving).toBe(false);
  });

  it('coasts after a flick of a zoomed board, slows down and stops at the edge', () => {
    const r = rig();
    r.ctrl.setTarget({ s: 2, cx: 0.5, cy: 0.5 }, { instant: true });
    r.ctrl.drag({ s: 2, cx: 0.5, cy: 0.5 });
    r.frame();
    r.ctrl.release({ vx: 900, vy: 0 }); // finger flicked right: the view moves left over the board
    expect(r.ctrl.isMoving()).toBe(true);
    const xs = [];
    for (let i = 0; i < 400 && r.pending(); i += 1) {
      r.frame();
      xs.push(r.ctrl.getCam().cx);
    }
    expect(r.pending()).toBe(0);
    expect(xs[0]).toBeLessThan(0.5);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1] + 1e-12);
    expect(xs[xs.length - 1]).toBeGreaterThanOrEqual(0.25 - 1e-9); // never past the board edge
    expect(r.ctrl.isMoving()).toBe(false);
  });

  it('does not coast under reduced motion, nor from the whole board', () => {
    const a = rig();
    a.ctrl.setTarget({ s: 2, cx: 0.5, cy: 0.5 }, { instant: true });
    a.ctrl.release({ vx: 900, vy: 0 }, { inertia: false });
    expect(a.ctrl.isMoving()).toBe(false);
    const b = rig();
    b.ctrl.release({ vx: 900, vy: 0 });
    expect(b.ctrl.isMoving()).toBe(false);
  });

  it('freezes a glide where it is when a finger lands on it', () => {
    const r = rig();
    r.ctrl.setTarget({ s: 2, cx: 0.3, cy: 0.5 }, { smooth: 0.4 });
    r.run(200);
    const here = r.ctrl.getCam();
    expect(here.s).toBeGreaterThan(1);
    expect(here.s).toBeLessThan(2);
    r.ctrl.freeze();
    expect(r.ctrl.isMoving()).toBe(false);
    expect(r.ctrl.getCam()).toEqual(here);
    r.run(500);
    expect(r.ctrl.getCam()).toEqual(here);
  });

  it('stops all work after dispose', () => {
    const r = rig();
    const spy = vi.fn();
    r.ctrl.setTarget({ s: 2, cx: 0.5, cy: 0.5 }, { smooth: 0.3 });
    r.ctrl.dispose();
    r.applied.length = 0;
    r.run(500);
    expect(r.applied).toHaveLength(0);
    spy();
  });
});
