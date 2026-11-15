import { describe, expect, it } from 'vitest';
import { BOARD_SIZE } from '@shared/board.js';
import { ANIM_MS, LONG_TRIP } from '@shared/timing.js';
import { AUTO_MAX_SCALE } from './cameraMath.js';
import { CAMERA, CAMERA_MODES, cameraDirective, cameraModeOf, createDirector, landHoldMs, situationKey, situationOf, smoothFor } from './cameraPolicy.js';

const P = (id, pos, extra = {}) => ({ id, name: id.toUpperCase(), pos, color: '#fff', motion: null, ...extra });

/** A session shaped like useOnlineGame's, with the presenter's display next to the authoritative view. */
function mk({ turn = 0, players, display = {}, view = {}, ...rest } = {}) {
  const ps = players || [P('me', 3), P('sana', 14)];
  return {
    me: 'me',
    busy: false,
    rolling: false,
    options: {},
    card: null,
    handoff: null,
    bubble: null,
    result: null,
    view: { phase: 'roll', turn, players: ps.map((p) => ({ ...p })), pending: null, trade: null, debt: null, ...view },
    display: { phase: 'roll', turn, players: ps, landing: null, moving: null, trade: null, debt: null, ...display },
    ...rest,
  };
}
const sit = (session, ctx = {}) => situationOf(session, { mode: 'auto', reduced: false, speed: 1, ...ctx });
const shot = (session, ctx) => cameraDirective(sit(session, ctx));

describe('settings', () => {
  it('knows the three modes and falls back to auto', () => {
    expect(CAMERA_MODES).toEqual(['auto', 'manual', 'off']);
    expect(cameraModeOf('manual')).toBe('manual');
    expect(cameraModeOf('off')).toBe('off');
    expect(cameraModeOf(undefined)).toBe('auto');
    expect(cameraModeOf('wild')).toBe('auto');
  });
});

describe('policy table: modes where the automatic camera does not act', () => {
  it("'off' means no camera at all", () => {
    expect(shot(mk(), { mode: 'off' }).kind).toBe('off');
  });
  it("'manual' never moves by itself, whatever is happening", () => {
    const moving = mk({ display: { moving: 'me' }, players: [P('me', 5)] });
    expect(shot(moving, { mode: 'manual' })).toMatchObject({ kind: 'none', reason: 'manual' });
    expect(shot(mk({ display: { landing: 4 } }), { mode: 'manual' }).kind).toBe('none');
  });
  it('reduced motion turns the automatic camera off (manual zoom still works elsewhere)', () => {
    const moving = mk({ display: { moving: 'me' }, players: [P('me', 5)] });
    expect(shot(moving, { reduced: true })).toMatchObject({ kind: 'none', reason: 'reduced-motion' });
    expect(shot(mk({ display: { landing: 4 } }), { reduced: true }).kind).toBe('none');
  });
});

describe('policy table: overview', () => {
  it('my turn, waiting for Roll', () => {
    expect(shot(mk({ options: { roll: true } }))).toMatchObject({ kind: 'overview', reason: 'idle' });
  });
  it("another player's idle wait", () => {
    expect(shot(mk({ turn: 1 }))).toMatchObject({ kind: 'overview', reason: 'idle' });
  });
  it('the die tumbling: the centre panel must stay visible', () => {
    expect(shot(mk({ busy: true, rolling: true }))).toMatchObject({ kind: 'overview', reason: 'rolling' });
  });
  it('the die settled and the number sinking in, before the pawn moves', () => {
    expect(shot(mk({ busy: true, display: { dice: [4] } })).kind).toBe('overview');
  });
  it.each([
    ['auction', { view: { phase: 'auction' } }],
    ['trade', { view: { trade: { from: 'me', to: 'sana' } } }],
    ['trade (presenter display)', { display: { trade: { from: 'me', to: 'sana' } } }],
    ['debt', { view: { phase: 'debt' } }],
    ['card reveal', { card: { player: 'me', deck: 'luck', title: 'Lucky' } }],
    ['turn hand-off banner', { handoff: { player: 'sana', round: 2 } }],
    ['game over', { view: { phase: 'over' } }],
    ['game over (result)', { result: { winner: 'me' } }],
    ['city event announcement', { busy: true, bubble: { id: 1, type: 'city_event', text: 'Rush hour' } }],
  ])('%s: the whole board', (_name, patch) => {
    const d = shot(mk(patch));
    expect(d.kind).toBe('overview');
    expect(d.reason).toMatch(/^overlay:/);
  });
  it('an overlay wins over a pawn that is still moving or a landing', () => {
    expect(shot(mk({ card: { title: 'x' }, display: { moving: 'me', landing: 3 } })).kind).toBe('overview');
    expect(shot(mk({ view: { phase: 'auction' }, display: { landing: 3 } })).kind).toBe('overview');
  });
  it('a city event announcement does not hide a pawn that is walking', () => {
    const s = mk({ busy: true, bubble: { type: 'city_event' }, display: { moving: 'me' }, players: [P('me', 5)] });
    expect(shot(s).kind).toBe('follow');
  });
});

describe('policy table: moving pawn', () => {
  const walking = (pos, extra = {}) => mk({ busy: true, players: [P('me', pos), P('sana', 14)], display: { moving: 'me' }, ...extra });

  it('follows a walking pawn at 1.8x on the tile it is on', () => {
    expect(shot(walking(5))).toEqual({ kind: 'follow', tile: 5, scale: CAMERA.FOLLOW, reason: 'moving' });
    expect(CAMERA.FOLLOW).toBe(1.8);
  });
  it("follows another player's pawn the same way (the holds are what is shorter, see the director)", () => {
    const s = mk({ turn: 1, busy: true, players: [P('me', 3), P('sana', 20)], display: { moving: 'sana' } });
    expect(shot(s)).toMatchObject({ kind: 'follow', tile: 20, scale: 1.8 });
    expect(sit(s).quick).toBe(true);
  });
  it('uses a lower scale for a long trip (more than LONG_TRIP squares)', () => {
    const start = 2;
    const dest = (start + LONG_TRIP + 1) % BOARD_SIZE;
    const s = walking(4, { view: { players: [P('me', dest), P('sana', 14)] } });
    const long = sit(s, { moveFrom: start });
    expect(long.tripLen).toBe(LONG_TRIP + 1);
    expect(cameraDirective(long)).toMatchObject({ kind: 'follow', scale: CAMERA.FOLLOW_LONG, reason: 'moving-long' });
    expect(CAMERA.FOLLOW_LONG).toBe(1.4);
    const edge = sit(walking(4, { view: { players: [P('me', (start + LONG_TRIP) % BOARD_SIZE), P('sana', 14)] } }), { moveFrom: start });
    expect(cameraDirective(edge).scale).toBe(CAMERA.FOLLOW); // exactly LONG_TRIP is still a normal trip
  });
  it('handles a trip that wraps past START', () => {
    const s = walking(1, { view: { players: [P('me', 3), P('sana', 14)] } });
    expect(sit(s, { moveFrom: 34 }).tripLen).toBe(5);
  });
  it('pans straight to the destination of a teleport', () => {
    const s = mk({ busy: true, players: [P('me', 27, { motion: 'teleport' })], display: { moving: 'me' } });
    expect(shot(s)).toMatchObject({ kind: 'pan', tile: 27, reason: 'teleport' });
  });
  it('pans to where an Auto / Metro / MMTS ride ends, not along the track', () => {
    const s = mk({ busy: true, players: [P('me', 6, { motion: 'ride' })], display: { moving: 'me' }, view: { players: [P('me', 14)] } });
    expect(shot(s)).toMatchObject({ kind: 'pan', tile: 14, reason: 'ride' });
  });
  it('ignores a move of a bankrupt or unplaced pawn', () => {
    expect(shot(mk({ players: [P('me', 5, { bankrupt: true })], display: { moving: 'me' } })).kind).toBe('overview');
    expect(shot(mk({ players: [P('me', undefined)], display: { moving: 'me' } })).kind).toBe('overview');
  });
});

describe('policy table: landing and decisions', () => {
  it('holds on the landed tile at 2.2x', () => {
    expect(shot(mk({ busy: true, display: { landing: 3 } }))).toEqual({ kind: 'land', tile: 3, scale: CAMERA.LAND, reason: 'landing' });
    expect(CAMERA.LAND).toBe(2.2);
  });
  it('frames my buy prompt at 2.0x while I decide', () => {
    const s = mk({ options: { buy: true, skipBuy: true }, view: { phase: 'buy', pending: { type: 'buy', tile: 3, price: 70000 } } });
    expect(shot(s)).toEqual({ kind: 'decision', tile: 3, scale: CAMERA.DECISION, reason: 'decision' });
    expect(CAMERA.DECISION).toBe(2.0);
  });
  it('also frames a prompt I cannot afford (skip only)', () => {
    const s = mk({ options: { skipBuy: true }, view: { pending: { type: 'buy', tile: 8, price: 1 } } });
    expect(shot(s)).toMatchObject({ kind: 'decision', tile: 8 });
  });
  it('leaves the board alone when the prompt is a card over it (the portrait phone table): the card has the name and price', () => {
    const s = mk({ options: { buy: true, skipBuy: true }, view: { pending: { type: 'buy', tile: 3, price: 70000 } } });
    expect(shot(s, { decisionCard: true })).toMatchObject({ kind: 'overview', reason: 'idle' });
    expect(shot(s, { decisionCard: false }).kind).toBe('decision');
  });
  it('does not frame anything while the presenter is still playing (options are blank then)', () => {
    const s = mk({ busy: true, options: { buy: true }, view: { pending: { type: 'buy', tile: 3, price: 1 } } });
    expect(shot(s).kind).toBe('overview');
  });
  it('an upgrade choice is not framed: there is no single tile to look at', () => {
    expect(shot(mk({ options: { endTurn: true, upgrade: [1, 3, 6] } })).kind).toBe('overview');
  });
  it('never zooms for something that does not change the board (chat, a log line, a wait)', () => {
    for (const patch of [{ bubble: { id: 1, type: 'cash', text: 'paid' } }, { turn: 1, options: {} }, { busy: true, display: { lastCash: { id: 1 } } }]) {
      expect(shot(mk(patch)).kind).toBe('overview');
    }
  });
  it('never asks for more than 2.4x', () => {
    const all = [
      mk({ busy: true, players: [P('me', 5)], display: { moving: 'me' } }),
      mk({ busy: true, display: { landing: 3 } }),
      mk({ options: { buy: true }, view: { pending: { type: 'buy', tile: 3 } } }),
    ];
    for (const s of all) expect(shot(s).scale).toBeLessThanOrEqual(AUTO_MAX_SCALE);
    expect(Math.max(CAMERA.FOLLOW, CAMERA.FOLLOW_LONG, CAMERA.LAND, CAMERA.DECISION)).toBeLessThanOrEqual(AUTO_MAX_SCALE);
  });
});

describe('situation', () => {
  it('is safe on an empty session', () => {
    expect(() => sit(null)).not.toThrow();
    expect(cameraDirective(sit(null)).kind).toBe('overview');
    expect(cameraDirective(sit({}) ).kind).toBe('overview');
  });
  it('changes its key exactly when the answer could change', () => {
    const a = situationKey(sit(mk({ busy: true, players: [P('me', 5)], display: { moving: 'me' } })));
    const b = situationKey(sit(mk({ busy: true, players: [P('me', 6)], display: { moving: 'me' } })));
    const same = situationKey(sit(mk({ busy: true, players: [P('me', 5)], display: { moving: 'me' } })));
    expect(a).toBe(same);
    expect(a).not.toBe(b);
    expect(situationKey(sit(mk(), { mode: 'off' }))).not.toBe(situationKey(sit(mk())));
  });
});

describe('director: timing', () => {
  const landing = (tile = 3, extra = {}) => sit(mk({ busy: true, display: { landing: tile }, ...extra }));
  const idle = (extra = {}) => sit(mk({ ...extra }));
  const walking = (pos) => sit(mk({ busy: true, players: [P('me', pos), P('sana', 14)], display: { moving: 'me' } }));
  const decision = () => sit(mk({ options: { buy: true, skipBuy: true }, view: { pending: { type: 'buy', tile: 3, price: 1 } } }));

  it('holds a landing for the presenter beat plus a little, even though the flag stays up', () => {
    const d = createDirector();
    const hold = ANIM_MS.land + CAMERA.LAND_PAD_MS;
    expect(landHoldMs(landing())).toBe(hold);
    let r = d.update(landing(), 1000);
    expect(r.directive.kind).toBe('land');
    expect(r.recheckIn).toBe(hold); // ask again when the hold is over
    r = d.update(landing(), 1000 + hold - 10);
    expect(r.directive.kind).toBe('land');
    r = d.update(landing(), 1000 + hold + 5);
    expect(r.directive.kind).toBe('overview'); // the landing flag is still up, the hold is not
  });

  it('keeps the hold when the presenter drops its landing flag early (its own beat is shorter than reading a name)', () => {
    const d = createDirector();
    const hold = ANIM_MS.land + CAMERA.LAND_PAD_MS;
    expect(d.update(landing(), 0).directive.kind).toBe('land');
    const flagGone = idle({ busy: false });
    expect(d.update(flagGone, 700).directive).toMatchObject({ kind: 'land', tile: 3 });
    expect(d.update(flagGone, hold - 20).directive.kind).toBe('land');
    expect(d.update(flagGone, hold + 10).directive.kind).toBe('overview');
  });

  it('starts a hold on the rising edge of the flag only, so a flag that stays up does not hold again', () => {
    const d = createDirector();
    const hold = ANIM_MS.land + CAMERA.LAND_PAD_MS;
    d.update(landing(), 0);
    expect(d.update(landing(), hold + 50).directive.kind).toBe('overview');
    expect(d.update(landing(), hold + 3000).directive.kind).toBe('overview'); // still the same flag: no new hold
    d.update(idle(), hold + 3100); // flag down
    expect(d.update(landing(), hold + 4000).directive.kind).toBe('land'); // the same tile landed on again later: a new hold
  });

  it('keeps following a pawn that has just stopped until the landing arrives a beat later', () => {
    const d = createDirector();
    expect(d.update(walking(5), 0).directive.kind).toBe('follow');
    const stopped = d.update(idle({ busy: true }), 1500); // "moving" dropped, "landing" not up yet
    expect(stopped.directive).toMatchObject({ kind: 'follow', tile: 5 });
    expect(stopped.recheckIn).toBeGreaterThan(0);
    expect(stopped.recheckIn).toBeLessThanOrEqual(CAMERA.GRACE_MS + 1);
    const landed = d.update(landing(5), 1526);
    expect(landed.directive).toMatchObject({ kind: 'land', tile: 5 }); // straight from the follow shot, no trip out
  });

  it('goes back out once the grace has passed and nothing landed (a move cut short)', () => {
    const d = createDirector();
    d.update(walking(5), 0);
    expect(d.update(idle({ busy: true }), 1500).directive.kind).toBe('follow');
    expect(d.update(idle({ busy: true }), 1500 + CAMERA.GRACE_MS + 5).directive.kind).toBe('overview');
  });

  it("keeps another player's landing shorter (the presenter plays it trimmed)", () => {
    const quick = sit(mk({ turn: 1, busy: true, display: { landing: 3 } }));
    expect(quick.quick).toBe(true);
    expect(landHoldMs(quick)).toBeLessThan(landHoldMs(landing()));
    expect(landHoldMs(quick)).toBe(ANIM_MS.land * CAMERA.QUICK_LAND + CAMERA.LAND_PAD_MS);
  });

  it('scales the holds with the playback speed', () => {
    const fast = { ...landing(), speed: 2 };
    expect(landHoldMs(fast)).toBe((ANIM_MS.land + CAMERA.LAND_PAD_MS) / 2);
    expect(smoothFor({ kind: 'follow' }, 2)).toBeCloseTo(smoothFor({ kind: 'follow' }, 1) / 2, 6);
  });

  it('holds a zoom for at least MIN_HOLD_MS before going back to the overview', () => {
    const d = createDirector();
    expect(d.update(walking(5), 0).directive.kind).toBe('follow');
    const early = d.update(idle(), 120);
    expect(early.directive.kind).toBe('follow'); // too soon
    expect(early.recheckIn).toBeGreaterThanOrEqual(CAMERA.MIN_HOLD_MS - 120);
    expect(early.recheckIn).toBeLessThanOrEqual(CAMERA.MIN_HOLD_MS - 120 + 1);
    expect(d.update(idle(), CAMERA.MIN_HOLD_MS + 5).directive.kind).toBe('overview');
  });

  it('allows at most one change of shot per DEBOUNCE_MS', () => {
    const d = createDirector();
    expect(d.update(walking(5), 0).directive.kind).toBe('follow');
    const fast = d.update(landing(6), 100); // follow -> land after 100 ms: deferred
    expect(fast.directive.kind).toBe('follow');
    expect(fast.recheckIn).toBeGreaterThan(0);
    expect(fast.recheckIn).toBeLessThanOrEqual(CAMERA.DEBOUNCE_MS - 100 + 1);
    const later = d.update(landing(6), CAMERA.DEBOUNCE_MS + 1);
    expect(later.directive).toMatchObject({ kind: 'land', tile: 6 });
  });

  it('counts tracking a walking pawn as one shot, not a change per step', () => {
    const d = createDirector();
    d.update(walking(5), 0);
    for (let i = 1; i <= 8; i += 1) {
      const r = d.update(walking(5 + i), i * 60);
      expect(r.directive).toMatchObject({ kind: 'follow', tile: 5 + i });
      expect(r.recheckIn).toBeNull();
    }
  });

  it('stays framed on my decision, then keeps the frame while the purchase plays, then goes back', () => {
    const d = createDirector();
    expect(d.update(decision(), 0).directive).toMatchObject({ kind: 'decision', tile: 3 });
    // Buy pressed: options are gone, nothing else has taken over
    const tail = d.update(idle({ busy: true }), 2000);
    expect(tail.directive.kind).toBe('decision');
    expect(tail.recheckIn).toBe(CAMERA.TAIL_MS);
    expect(d.update(idle({ busy: true }), 2000 + CAMERA.TAIL_MS - 50).directive.kind).toBe('decision');
    expect(d.update(idle({ busy: true }), 2000 + CAMERA.TAIL_MS + 5).directive.kind).toBe('overview');
  });

  it('does not keep a decision frame when an overlay takes over (SKIP -> auction)', () => {
    const d = createDirector();
    d.update(decision(), 0);
    const r = d.update(sit(mk({ view: { phase: 'auction' } })), 2000);
    expect(r.directive.kind).toBe('overview');
  });

  it('applies mode switches at once, with no debounce', () => {
    const d = createDirector();
    d.update(walking(5), 0);
    expect(d.update({ ...walking(5), mode: 'off' }, 10).directive.kind).toBe('off');
    expect(d.update({ ...walking(5), reduced: true }, 20).directive.kind).toBe('none');
  });

  it('runs a whole turn: roll, walk, land, decide, buy, back', () => {
    const d = createDirector();
    const kinds = [];
    const at = (s, t) => kinds.push(d.update(s, t).directive.kind);
    at(sit(mk({ busy: true, rolling: true })), 0); // dice tumbling
    at(idle({ busy: true }), 1200); // number shown
    at(walking(4), 2300);
    at(walking(5), 2600);
    at(walking(6), 2900);
    at(landing(6), 3300); // the landing beat
    at(decision(), 4000); // snapped to the new state: Buy / skip; the landing hold is still running
    at(decision(), 3300 + ANIM_MS.land + CAMERA.LAND_PAD_MS + 20); // the hold's own recheck: now the prompt frames the tile
    at(idle({ busy: true }), 6500); // Buy pressed: the frame stays for the purchase
    at(idle({ busy: true }), 8000);
    expect(kinds).toEqual(['overview', 'overview', 'follow', 'follow', 'follow', 'land', 'land', 'decision', 'decision', 'overview']);
  });
});
