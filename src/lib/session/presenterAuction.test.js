// The presenter hands the bidding screen its reveal: `auctionResult` carries the auction_end event for as long as the
// presenter holds it (ANIM_MS.auctionEnd), with how long that is, then clears.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANIM_MS } from '@shared/timing.js';
import { createPresenterCore } from './usePresenter.js';

afterEach(() => vi.useRealTimers());

const N = 36;
const state = () => ({
  players: [
    { id: 'me', name: 'Asha', color: '#ff4d6d', piece: 'auto', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, laps: 0 },
    { id: 'other', name: 'Bala', color: '#3ddc97', piece: 'pearl', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, laps: 0 },
  ],
  owners: Array(N).fill(null), levels: Array(N).fill(0), mortgaged: Array(N).fill(false),
  turn: 0, round: 1, dice: [0], phase: 'manage', cfg: { mode: 'standard', maxRounds: 20 }, event: null, ride: null,
});

function setup({ speed } = {}) {
  vi.useFakeTimers();
  const played = [];
  const core = createPresenterCore({
    meId: 'me',
    initialState: state(),
    speed,
    deps: { loadSettings: () => ({ reducedMotion: false }), sfx: { play: (n) => played.push(n) }, describeEvent: () => null, playCardClip: () => true, buzz: () => {} },
  });
  return { core, played };
}

const END = { type: 'auction_end', tile: 31, winner: 'other', amount: 230000, bids: { me: 150000, other: 230000 }, order: ['other', 'me'], tie: false, reason: 'decline' };

describe('presenter: auction result', () => {
  it('starts empty', () => {
    const { core } = setup();
    expect(core.getSnapshot().auctionResult).toBeNull();
    core.dispose();
  });

  it('holds the result (event + id + how long) while the hammer falls, then clears', async () => {
    const { core, played } = setup();
    core.enqueue([END], state());
    await vi.advanceTimersByTimeAsync(10);
    const r = core.getSnapshot().auctionResult;
    expect(r).toMatchObject({ type: 'auction_end', tile: 31, winner: 'other', amount: 230000, order: ['other', 'me'], tie: false });
    expect(r.id).toMatch(/^ar\d+$/);
    expect(r.ms).toBe(ANIM_MS.auctionEnd);
    expect(played).toContain('sold');
    await vi.advanceTimersByTimeAsync(ANIM_MS.auctionEnd + 50);
    expect(core.getSnapshot().auctionResult).toBeNull();
    core.dispose();
  });

  it('the hold length follows the playback speed', async () => {
    const { core } = setup({ speed: 2 });
    core.enqueue([END], state());
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().auctionResult.ms).toBe(ANIM_MS.auctionEnd / 2);
    core.dispose();
  });

  it('a reconnect snapshot drops it', async () => {
    const { core } = setup();
    core.enqueue([END], state());
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().auctionResult).not.toBeNull();
    core.reset(state());
    expect(core.getSnapshot().auctionResult).toBeNull();
    core.dispose();
  });

  it('an auction with no winner is held the same way (the "sold" sound stays out of it)', async () => {
    const { core, played } = setup();
    core.enqueue([{ ...END, winner: null, amount: 0, bids: { me: 0, other: 0 }, order: ['me', 'other'] }], state());
    await vi.advanceTimersByTimeAsync(10);
    expect(core.getSnapshot().auctionResult.winner).toBeNull();
    expect(played).not.toContain('sold');
    core.dispose();
  });
});
