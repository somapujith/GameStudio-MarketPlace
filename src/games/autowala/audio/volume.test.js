// The master / effects / voices / music sliders, end to end on a fake Web Audio context: who is connected to which bus, what a saved
// level does to a context that starts late, and the browser-speech fallback (which is outside Web Audio).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class Node {
  constructor(kind) {
    this.kind = kind;
    this.to = [];
    this.from = []; // who connected into this node
    this.gain = { value: 1, setTargetAtTime: (v) => { this.gain.value = v; }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
    this.pan = { value: 0, setTargetAtTime() {} };
    this.frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} };
  }
  connect(n) { this.to.push(n); n.from.push(this); return n; }
  disconnect() { this.to = []; }
  start() {}
  stop() {}
}
class FakeAC {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sampleRate = 48000; this.destination = new Node('dest'); }
  createGain() { return new Node('gain'); }
  createDynamicsCompressor() { return new Node('comp'); }
  createBiquadFilter() { return new Node('filter'); }
  createStereoPanner() { return new Node('pan'); }
  createOscillator() { return new Node('osc'); }
  createBufferSource() { return new Node('src'); }
  createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
  resume() {}
  suspend() {}
}

let ctxMod;
let busMod;
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', { AudioContext: FakeAC, addEventListener() {}, removeEventListener() {} });
  ctxMod = await import('./ctx.js');
  busMod = await import('./sound-bus.js');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('master level', () => {
  it('a context that starts AFTER the slider was set starts at that level (it used to start at full)', () => {
    ctxMod.setMasterLevel(0.5);
    const a = ctxMod.getAudio();
    expect(a.master.gain.value).toBeCloseTo(0.4, 10);
  });

  it('follows the slider and the mute switch live, and un-muting restores the slider', () => {
    const a = ctxMod.getAudio();
    expect(a.master.gain.value).toBeCloseTo(0.8, 10);
    ctxMod.setMasterLevel(0.25);
    expect(a.master.gain.value).toBeCloseTo(0.2, 10);
    ctxMod.setMuted(true);
    expect(a.master.gain.value).toBe(0);
    ctxMod.setMasterLevel(1); // moving the slider while muted stays silent
    expect(a.master.gain.value).toBe(0);
    ctxMod.setMuted(false);
    expect(a.master.gain.value).toBeCloseTo(0.8, 10);
  });

  it('junk levels fall back to full and levels are clamped', () => {
    for (const bad of [NaN, undefined, null, '', 'x']) {
      ctxMod.setMasterLevel(0.3);
      ctxMod.setMasterLevel(bad);
      expect(ctxMod.getMasterLevel(), String(bad)).toBe(1);
    }
    ctxMod.setMasterLevel(7);
    expect(ctxMod.getMasterLevel()).toBe(1);
    ctxMod.setMasterLevel(-2);
    expect(ctxMod.getMasterLevel()).toBe(0);
  });
});

describe('the three category buses', () => {
  it('each has its own gain, feeds the master, and follows audio:volume live', () => {
    busMod.setBusLevels({ fx: 0.3, voice: 0.6, music: 0.9 });
    const b = busMod.getBuses();
    expect(b.fx.gain.value).toBeCloseTo(0.3, 10);
    expect(b.voice.gain.value).toBeCloseTo(0.6, 10);
    expect(b.music.gain.value).toBeCloseTo(0.9, 10);
    for (const k of ['fx', 'voice', 'music']) expect(b[k].to).toContain(b.master);
    busMod.setBusLevels({ fx: 0 });
    expect(b.fx.gain.value).toBe(0);
    expect(b.voice.gain.value).toBeCloseTo(0.6, 10); // the others did not move
  });

  it('the traffic horns and thuds play through the effects bus, not straight to the master', async () => {
    const { createTrafficAudio } = await import('../sim/traffic-audio.js');
    const camera = { position: { x: 0, z: 0 }, matrixWorld: { elements: new Float32Array(16).fill(0) } };
    const t = createTrafficAudio(camera);
    const b = busMod.getBuses();
    expect(t.honk(5, 0, 'car')).toBe(true);
    t.thud(5, 0, 0.8);
    // the horn voice and the thud chain end in the effects bus; only the three buses feed the master
    expect(b.fx.from.length).toBeGreaterThanOrEqual(2);
    expect(b.master.from.every((n) => [b.fx, b.voice, b.music].includes(n))).toBe(true);
  });
});

describe('the browser speech fallback (outside Web Audio)', () => {
  it('follows the voices slider and the master slider, and is silent when muted', () => {
    const { speechVolumeOf } = busMod;
    expect(speechVolumeOf(1, 1, 1)).toBe(1);
    expect(speechVolumeOf(1, 0.5, 0.5)).toBeCloseTo(0.25, 10);
    expect(speechVolumeOf(1, 0, 1)).toBe(0);
    expect(speechVolumeOf(1, 1, 0)).toBe(0);
    expect(speechVolumeOf(1, 1, 1, true)).toBe(0);
  });

  it('keeps the distance fade (never below 5% before the sliders) and survives junk', () => {
    const { speechVolumeOf } = busMod;
    expect(speechVolumeOf(0.4, 1, 1)).toBeCloseTo(0.4, 10);
    expect(speechVolumeOf(0, 1, 1)).toBeCloseTo(0.05, 10);
    expect(speechVolumeOf(NaN, 0.5, 1)).toBeCloseTo(0.5, 10);
    expect(speechVolumeOf(2, 'x', undefined)).toBe(1);
  });

  it('reads the live levels', () => {
    busMod.setBusLevels({ voice: 0.5 });
    ctxMod.setMasterLevel(0.5);
    expect(busMod.speechVolume(1)).toBeCloseTo(0.25, 10);
    ctxMod.setMuted(true);
    expect(busMod.speechVolume(1)).toBe(0);
  });
});
