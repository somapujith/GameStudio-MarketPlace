// The results screen shows everybody's equipped look: frame + title + loadout chips on the podium, and frame + title + chips
// on the rows for rank 4 and below (also for a player who already left); a legendary winner gets the gold rim.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '@shared/index.js';
import { worthParts } from './ui/helpers.js';

vi.mock('./ui/Sheet.jsx', () => ({
  default: ({ header, children, footer, title }) => createElement('div', null, title ? createElement('h2', null, title) : null, header, children, footer),
  hasOpenSheet: () => false,
}));
// strict art mock (like the other sheet tests): frames and titles are markers with their props; the loadout chips use the real cosmetics art
vi.mock('@/components/art/index.js', () => ({
  Avatar: () => null,
  TileIcon: () => null,
  BuildingArt: () => null,
  PieceArt: ({ piece }) => createElement('i', { 'data-piece': piece }),
  AvatarFrame: ({ frame, size, children }) => createElement('b', { 'data-frame': frame, 'data-fsize': size }, typeof children === 'function' ? children(size) : children),
  TitleChip: ({ title, size }) => createElement('em', { 'data-title': title, 'data-tsize': size }),
}));
vi.mock('@/components/online/PlayAgain.jsx', () => ({
  default: () => createElement('div', { 'data-again': '1' }),
  PostGameFriends: () => createElement('div', { 'data-friends': '1' }),
}));

const { default: GameOverModal } = await import('./GameOverModal.jsx');

const IDS = ['me', 'b1', 'c2', 'd3', 'e4'];
const NAMES = { me: 'Asha', b1: 'Ravi', c2: 'Zoya', d3: 'Dev', e4: 'Esha' };
const game = () => {
  const v = createGame({ players: IDS.map((id) => ({ id, name: NAMES[id] })), seed: 3 });
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
  standings: IDS.map((id, i) => ({ id: IDS[(i + 1) % IDS.length], name: NAMES[IDS[(i + 1) % IDS.length]], avatar: 0, cash: 1, worth: worthParts(v, IDS[(i + 1) % IDS.length]).total, rank: i + 1 })),
  me: { won: false, rank: 5 },
});
// rank order is b1, c2, d3, e4, me
const sess = (cosmetics, extra = {}) => {
  const v = game();
  return { me: 'me', view: v, display: null, options: {}, busy: false, dispatch() {}, result: resultOf(v), cosmetics, ...extra };
};
const render = (session) => renderToStaticMarkup(createElement(GameOverModal, { session, onExit() {} }));
const rest = (html) => html.slice(html.indexOf('mo-over-rest'), html.indexOf('mo-over-rest') + 4000);

const LOOK = {
  b1: { frame: 'frame-aurora', title: 'title-kingpin', dice: 'dice-gold', trail: 'trail-flame', board: 'board-goldleaf' },
  c2: { frame: 'frame-lake', title: 'title-biryani', dice: 'dice-cyber' },
  d3: { title: 'title-chai' },
  e4: { frame: 'frame-nizam', title: 'title-charminar', trail: 'trail-coins', board: 'board-marble' },
  me: { title: 'title-hitec', dice: 'dice-ivory' },
};

describe('GameOverModal: everybody\'s look', () => {
  const html = render(sess(LOOK));

  it('podium: frame, title and the loadout row for each of the top three, the winner bigger', () => {
    const pod = html.slice(html.indexOf('mo-podium'), html.indexOf('mo-over-legend'));
    expect(pod).toContain('data-frame="frame-aurora"');
    expect(pod).toContain('data-frame="frame-lake"');
    expect(pod).toContain('data-title="title-kingpin"');
    expect(pod).toContain('data-title="title-biryani"');
    expect(pod).toContain('data-title="title-chai"');
    expect(pod).toContain('data-tsize="md"'); // the winner
    expect(pod).toContain('data-tsize="sm"');
    expect(pod).toContain('lo--row');
    for (const name of ['Solid Gold', 'Dragon Flame', 'Golconda Gilded', 'Cyberabad Neon']) expect(pod).toContain(`<span class="lo-chip__name">${name}</span>`);
    expect(pod).toContain('--lo-px:24px'); // the winner's chips are larger
    expect(pod).toContain('--lo-px:20px');
    expect(pod).not.toContain('Charminar'); // rank 4 is not on the podium
  });

  it('ranks 4+ show a framed avatar, the title chip and small chips (a title no longer needs a podium place)', () => {
    const r = rest(html);
    expect(r).toContain('data-frame="frame-nizam"');
    expect(r).toContain('data-title="title-charminar"');
    expect(r).toContain('data-title="title-hitec"');
    expect(r).toContain('aria-label="Cracker Sparks"'.replace('Cracker Sparks', 'Gold Coin Shower'));
    expect(r).toContain('aria-label="Royal Marble"');
    expect(r).toContain('aria-label="Ivory"');
    expect(r).toContain('--lo-px:16px');
    expect(r).not.toContain('lo-chip__name'); // the names are for the podium
  });

  it('a legendary winner gets the gold rim class, on the winner only', () => {
    expect(html.match(/mo-pod p\d[^"]*is-legend/g)).toEqual(['mo-pod p1 is-legend']);
    expect(render(sess({ ...LOOK, b1: { title: 'title-chai', dice: 'dice-gold' } }))).toContain('mo-pod p1 is-legend'); // a legendary dice counts
    const plain = render(sess({ ...LOOK, b1: { frame: 'frame-nizam', title: 'title-chai' }, c2: { frame: 'frame-aurora' } }));
    expect(plain).not.toContain('is-legend'); // a legendary runner-up does not
  });

  it('players who left (no longer in the room) keep their look: it comes from session.cosmetics', () => {
    const out = render(sess(LOOK, { room: { code: 'ABCD', gameId: 'hyderabad-tycoon', players: [{ id: 'me' }, { id: 'b1' }] } }));
    expect(out).toContain('data-title="title-charminar"'); // e4 is not in room.players
    expect(out).toContain('data-frame="frame-nizam"');
  });

  it('reads the room snapshot too, and a player with nothing equipped adds nothing', () => {
    const out = render(sess(undefined, { room: { code: 'ABCD', gameId: 'hyderabad-tycoon', players: [{ id: 'b1', cosmetics: { title: 'title-golconda', dice: 'dice-ruby' } }] } }));
    expect(out).toContain('data-title="title-golconda"');
    expect(out).toContain('Ruby Gem');
    const none = render(sess({}));
    expect(none).not.toContain('data-title');
    expect(none).not.toMatch(/class="lo lo--/); // no chip row
    expect(none).not.toContain('lo-rest__cos'); // and no empty wrapper
    expect(none).not.toContain('is-legend');
    expect(none).toContain('mo-pod p1'); // the screen itself is unchanged
  });

  it('keeps the play-again footer and the friends list', () => {
    const out = render(sess(LOOK, { room: { code: 'ABCD', gameId: 'hyderabad-tycoon', players: [] } }));
    expect(out).toContain('data-again="1"');
    expect(out).toContain('data-friends="1"');
    expect(out).toContain('Back to lobby');
  });
});
