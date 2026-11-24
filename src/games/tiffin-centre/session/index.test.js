import { describe, expect, it } from 'vitest';

describe('session index', () => {
  it('loads and exports the whole public surface', async () => {
    const m = await import('./index.js');
    for (const name of ['createLocalSession', 'useRoomSession', 'useSession', 'getProgress', 'saveShiftResult', 'unlockedLevel', 'isTutorialDoneLocal', 'markTutorialDone', 'createRoomSessionCore']) {
      expect(typeof m[name], name).toBe('function');
    }
  });
});
