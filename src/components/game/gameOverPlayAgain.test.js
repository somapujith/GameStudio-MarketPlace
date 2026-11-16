// The game-over screen online: "Play again with everyone" + the "Add as friends" list; without a room (tests, previews) the old Rematch button.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '@shared/index.js';
import { worthParts } from './ui/helpers.js';

vi.mock('./ui/Sheet.jsx', () => ({
  default: ({ header, children, footer, title }) => createElement('div', null, title ? createElement('h2', null, title) : null, header, children, footer),
  hasOpenSheet: () => false,
}));
vi.mock('@/components/art/index.js', () => ({
  Avatar: () => null,
  TileIcon: () => null,
  BuildingArt: () => null,
  PieceArt: ({ piece }) => createElement('i', { 'data-piece': piece }),
  AvatarFrame: ({ children }) => createElement('b', null, typeof children === 'function' ? children(40) : children),
  TitleChip: () => null,
}));
// the platform pieces are tested on their own: here they are markers, with the props they were given
vi.mock('@/components/online/PlayAgain.jsx', () => ({
  default: ({ room, gameId, gameLabel, variant, showSummary, renderButton }) =>
    createElement('div', { 'data-again': room.code, 'data-game': gameId, 'data-label': gameLabel, 'data-variant': variant, 'data-summary': String(showSummary) }, renderButton({ onClick() {}, label: 'Play again with everyone', disabled: false, busy: false })),
  PostGameFriends: ({ players, meId }) => createElement('div', { 'data-friends': players.map((p) => p.id).join(','), 'data-me': meId }),
}));

const { default: GameOverModal } = await import('./GameOverModal.jsx');

const base = () => {
  const v = createGame({ players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }], seed: 3 });
  v.phase = 'over';
  v.winner = 'b1';
  v.winReason = 'rounds';
  v.round = 20;
  return v;
};
const resultOf = (v) => ({
  winner: v.winner,
  reason: v.winReason,
  rounds: v.round,
  standings: [
    { id: 'b1', name: 'Ravi', avatar: 0, cash: 1, worth: worthParts(v, 'b1').total, rank: 1 },
    { id: 'me', name: 'Asha', avatar: 0, cash: 1, worth: worthParts(v, 'me').total, rank: 2 },
  ],
  me: { won: false, rank: 2 },
});
const render = (session) => renderToStaticMarkup(createElement(GameOverModal, { session, onExit() {} }));

describe('GameOverModal online', () => {
  const v = base();
  const room = { code: 'OLD234', gameId: 'hyderabad-tycoon', players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }] };
  const session = { me: 'me', view: v, display: null, options: {}, busy: false, dispatch() {}, result: resultOf(v), room, restart() {} };

  it('shows the gold "Play again with everyone" instead of Rematch, for the room that just finished', () => {
    const out = render(session);
    expect(out).toContain('data-again="OLD234"');
    expect(out).toContain('data-game="hyderabad-tycoon"');
    expect(out).toContain('data-variant="over"');
    expect(out).toContain('data-summary="false"');
    expect(out).toContain('hg-btn--gold');
    expect(out).toContain('Play again with everyone');
    expect(out).not.toContain('Rematch');
    expect(out).toContain('Back to lobby');
  });

  it('lists the match players to add as friends, with my id so the list hides me', () => {
    const out = render(session);
    expect(out).toContain('data-friends="me,b1"');
    expect(out).toContain('data-me="me"');
  });

  it('without a room it keeps the plain Rematch button and no friend list', () => {
    const out = render({ ...session, room: undefined });
    expect(out).toContain('Rematch');
    expect(out).not.toContain('data-again');
    expect(out).not.toContain('data-friends');
  });
});
