import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COSMETICS, FINISHES } from '@shared/cosmetics.js';
import { boardThemeFinish, equippedBoardTheme } from './boardTheme.js';

const boards = COSMETICS.filter((c) => c.kind === 'board');

describe('boardThemeFinish', () => {
  it('maps every board item to its finish', () => {
    expect(boards.length).toBe(FINISHES.board.length);
    for (const b of boards) expect(boardThemeFinish(b.id), b.id).toBe(b.finish);
  });

  it('is null for none, unknown ids and non-strings', () => {
    for (const v of [undefined, null, '', 'board-nope', 0, 7, {}, [], true]) expect(boardThemeFinish(v), String(v)).toBeNull();
  });

  it('is null for an item of another kind, even one with a finish', () => {
    const other = COSMETICS.find((c) => c.kind !== 'board' && c.finish);
    expect(other).toBeTruthy();
    expect(boardThemeFinish(other.id)).toBeNull();
    expect(boardThemeFinish('frame-sandstone')).toBeNull();
    expect(boardThemeFinish('dice-ivory')).toBeNull();
  });
});

describe('equippedBoardTheme', () => {
  const goldleaf = 'board-goldleaf';

  it("reads the local player's equipped board from session.cosmetics", () => {
    const session = { me: 'p1', cosmetics: { p1: { board: goldleaf }, p2: { board: 'board-lake' } } };
    expect(equippedBoardTheme(session)).toBe('goldleaf');
  });

  it("never reads another player's board (the theme is local only)", () => {
    expect(equippedBoardTheme({ me: 'p1', cosmetics: { p2: { board: goldleaf } } })).toBeNull();
    expect(equippedBoardTheme({ me: 'p1', cosmetics: { p1: {}, p2: { board: goldleaf } } })).toBeNull();
  });

  it('falls back to the room player cosmetics (the {t:"room"} message), like the other cosmetics', () => {
    const session = { me: 'p1', roomPlayers: [{ id: 'p1', cosmetics: { board: 'board-marble' } }] };
    expect(equippedBoardTheme(session)).toBe('marble');
  });

  it('accepts a numeric seat id', () => {
    expect(equippedBoardTheme({ me: 2, cosmetics: { 2: { board: 'board-grid' } } })).toBe('grid');
  });

  it('is null with no session, no seat, no board, an unknown id or the wrong kind', () => {
    expect(equippedBoardTheme(null)).toBeNull();
    expect(equippedBoardTheme({})).toBeNull();
    expect(equippedBoardTheme({ me: '', cosmetics: { '': { board: goldleaf } } })).toBeNull();
    expect(equippedBoardTheme({ me: 'p1', cosmetics: {} })).toBeNull();
    expect(equippedBoardTheme({ me: 'p1', cosmetics: { p1: { board: 'board-nope' } } })).toBeNull();
    expect(equippedBoardTheme({ me: 'p1', cosmetics: { p1: { board: 'frame-nizam' } } })).toBeNull();
  });
});

describe('GameView wiring (read from the source: GameView is too heavy to render in a unit test)', () => {
  const src = readFileSync(fileURLToPath(new URL('./GameView.jsx', import.meta.url)), 'utf8');

  it('imports the stylesheet and the resolver', () => {
    expect(src).toMatch(/import ['"][^'"]*styles\/board-themes\.css['"]/);
    expect(src).toMatch(/import \{ equippedBoardTheme \} from ['"]\.\/boardTheme\.js['"]/);
  });

  it('sets data-board-theme on the .hg-game root only from the resolved finish (undefined = no attribute)', () => {
    expect(src).toContain('const boardTheme = equippedBoardTheme(session)');
    expect(src).toContain('data-board-theme={boardTheme ?? undefined}');
    const root = src.slice(src.indexOf('className={`hg-game'), src.indexOf('<h1 className="hg-sr">'));
    expect(root).toContain('data-board-theme=');
    expect(src.match(/data-board-theme=/g)).toHaveLength(1);
  });
});
