// Autowala's hold on the shared sound while the orientation gate is up: the player's own mute choice and a not-yet-running context come back untouched.
import { describe, expect, it } from 'vitest';
import { createAudioHold } from './useOrientationHold.js';

function rig({ state = 'running', muted = false, noAudio = false } = {}) {
  const log = [];
  const ac = {
    state,
    suspend: () => (log.push('suspend'), Promise.resolve()),
    resume: () => (log.push('resume'), Promise.reject(new Error('needs a gesture'))), // a rejected promise must not escape
  };
  let m = muted;
  const audio = {
    getAudio: () => (noAudio ? null : { ac }),
    isMuted: () => m,
    setMuted: (v) => (log.push(`mute:${v}`), (m = v)),
  };
  return { log, hold: createAudioHold(audio), muted: () => m };
}

describe('createAudioHold', () => {
  it('mutes and suspends a running context, then restores both', () => {
    const r = rig();
    r.hold.hold();
    expect(r.hold.holding).toBe(true);
    expect(r.log).toEqual(['mute:true', 'suspend']);
    r.hold.release();
    expect(r.hold.holding).toBe(false);
    expect(r.log).toEqual(['mute:true', 'suspend', 'mute:false', 'resume']);
  });

  it("gives back the player's own mute choice (muted before stays muted after)", () => {
    const r = rig({ muted: true });
    r.hold.hold();
    r.hold.release();
    expect(r.muted()).toBe(true);
  });

  it('leaves a context that was never running alone (no resume outside a gesture, no autoplay warning)', () => {
    const r = rig({ state: 'suspended' });
    r.hold.hold();
    r.hold.release();
    expect(r.log).toEqual(['mute:true', 'mute:false']);
  });

  it('is idempotent both ways and tolerates a browser with no Web Audio', () => {
    const r = rig();
    r.hold.hold();
    r.hold.hold();
    r.hold.release();
    r.hold.release();
    expect(r.log).toEqual(['mute:true', 'suspend', 'mute:false', 'resume']);
    const none = rig({ noAudio: true });
    none.hold.hold();
    expect(none.hold.holding).toBe(false);
    none.hold.release();
    expect(none.log).toEqual([]);
  });
});
