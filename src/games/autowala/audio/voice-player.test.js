// The voice player's one hook into a global: the browser's speechSynthesis outlives the game, so a listener left on it keeps the whole game alive.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoicePlayer } from './voice-player.js';

const line = { id: 'test.line', te: 'నమస్తే', en: 'Namaste' };

function fakeSynth(voices = []) {
  const listeners = new Set();
  return {
    listeners,
    getVoices: () => voices,
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: vi.fn((type, fn) => listeners.delete(fn)),
    cancel: vi.fn(),
    speak: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('voice player and speechSynthesis', () => {
  it('waits for the voice list with one listener, and dispose() takes it off the global again', async () => {
    vi.useFakeTimers();
    const synth = fakeSynth();
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', function Utterance() {});
    const player = createVoicePlayer({ fetchFn: null });
    await player.play(line); // no recorded file, no Telugu voice yet: the player waits for 'voiceschanged'
    expect(synth.listeners.size).toBe(1);
    await player.play(line);
    expect(synth.listeners.size).toBe(1); // asked once, not once per line
    player.dispose();
    expect(synth.listeners.size).toBe(0);
  });

  it('adds no listener when a Telugu voice is already there', async () => {
    vi.useFakeTimers();
    const synth = fakeSynth([{ lang: 'te-IN', name: 'Telugu' }]);
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', function Utterance() {});
    const player = createVoicePlayer({ fetchFn: null });
    await player.play(line);
    expect(synth.listeners.size).toBe(0);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    player.dispose();
  });

  it('uses the voice that arrives later and forgets the listener', async () => {
    vi.useFakeTimers();
    const voices = [];
    const synth = fakeSynth(voices);
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', function Utterance() {});
    const player = createVoicePlayer({ fetchFn: null });
    await player.play(line);
    expect(synth.speak).not.toHaveBeenCalled();
    voices.push({ lang: 'te-IN', name: 'Telugu' });
    for (const fn of [...synth.listeners]) fn(); // the browser fires 'voiceschanged' once the list is loaded
    await player.play(line);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    player.dispose();
    expect(synth.removeEventListener).not.toHaveBeenCalled(); // the fired listener cleared itself (the browser's `once`), nothing pending to remove
  });
});
