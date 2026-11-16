// SSR renders of the play-again pieces in every state. The friend button and the auth/router hooks are faked: this is
// about what the block says, not about the friend store.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/social/AddFriendButton.jsx', () => ({
  default: ({ userId, name, compact }) => createElement('button', { 'data-add': userId, 'data-compact': compact ? '1' : '0' }, `add ${name}`),
}));
vi.mock('@/components/art/index.js', () => ({ Avatar: () => createElement('i', { className: 'avatar' }) }));
vi.mock('./usePlayAgain.js', () => ({ usePlayAgain: () => ({ plan: { friends: [{ id: 'a', name: 'Asha' }], others: [], expected: [], total: 1 }, status: 'idle', error: '', start() {} }) }));

const { default: PlayAgain, PlayAgainView, PostGameFriends, RematchBanner, againLabel } = await import('./PlayAgain.jsx');
const html = (el) => renderToStaticMarkup(el);
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('againLabel', () => {
  it('is short with nobody to bring back and says it is working', () => {
    expect(againLabel({ busy: false, total: 3 })).toBe('Play again with everyone');
    expect(againLabel({ busy: false, total: 0 })).toBe('Play again');
    expect(againLabel({ busy: true, total: 3 })).toBe('Setting up the table...');
  });
});

describe('PlayAgainView', () => {
  it('idle: one primary button, enabled, with the summary line', () => {
    const out = html(createElement(PlayAgainView, { summary: 'We will invite Asha.', label: 'Play again with everyone' }));
    expect(out).toContain('Play again with everyone');
    expect(out).toContain('ho-btn--primary');
    expect(out).not.toContain('disabled');
    expect(out).toContain('We will invite Asha.');
    expect(out).not.toContain('role="alert"');
  });

  it('working: the button is disabled and busy, and a live region says so (double taps cannot land)', () => {
    const out = html(createElement(PlayAgainView, { status: 'working', label: 'Setting up the table...' }));
    expect(out).toMatch(/<button[^>]*disabled/);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('Setting up your new table');
    expect(out).toContain('pa-spin');
  });

  it('error: an alert with the reason, the button is ready to retry, the summary steps aside', () => {
    const out = html(createElement(PlayAgainView, { status: 'error', error: 'Too many rooms', summary: 'We will invite Asha.' }));
    expect(out).toContain('role="alert"');
    expect(text(createElement(PlayAgainView, { status: 'error', error: 'Too many rooms' }))).toContain('Too many rooms. Tap the button to try again.');
    expect(out).not.toMatch(/<button[^>]*disabled/);
    expect(out).not.toContain('We will invite Asha.');
  });

  it('lets the game draw the button', () => {
    const seen = [];
    const out = html(
      createElement(PlayAgainView, {
        status: 'working',
        label: 'Go',
        variant: 'over',
        renderButton: (p) => {
          seen.push(p);
          return createElement('b', { className: 'game-btn' }, p.label);
        },
      }),
    );
    expect(out).toContain('game-btn');
    expect(out).toContain('pa-again--over');
    expect(out).not.toContain('ho-btn');
    expect(seen[0]).toMatchObject({ busy: true, disabled: true, label: 'Go' });
  });
});

describe('PlayAgain', () => {
  it('wires the hook to the view', () => {
    const out = html(createElement(PlayAgain, { room: { players: [] }, gameId: 'g', gameLabel: 'G' }));
    expect(out).toContain('Play again with everyone');
    expect(out).toContain('We will invite Asha.');
    expect(html(createElement(PlayAgain, { room: {}, gameLabel: 'G', showSummary: false }))).not.toContain('pa-summary');
  });
});

describe('PostGameFriends', () => {
  it('lists the other humans with a compact add-friend button each', () => {
    const out = html(createElement(PostGameFriends, { meId: 'me', players: [{ id: 'me', name: 'Me' }, { id: 'a', name: 'Asha', avatar: 2 }, { id: 'b', name: 'Ravi' }, { id: 'c', name: 'Dev', left: true }] }));
    expect(out).toContain('Add as friends');
    expect(out).toContain('data-add="a"');
    expect(out).toContain('data-add="b"');
    expect(out).toContain('data-compact="1"');
    expect(out).not.toContain('data-add="me"');
    expect(out).not.toContain('data-add="c"');
  });

  it('renders nothing when nobody else is there', () => {
    expect(html(createElement(PostGameFriends, { meId: 'me', players: [{ id: 'me', name: 'Me' }] }))).toBe('');
    expect(html(createElement(PostGameFriends, { meId: 'me' }))).toBe('');
  });
});

describe('RematchBanner', () => {
  const from = { code: 'OLD234', ids: ['a', 'b', 'c'] };

  it('waits calmly and counts who is back', () => {
    const out = text(createElement(RematchBanner, { from, meId: 'me', players: [{ id: 'me' }, { id: 'a' }] }));
    expect(out).toBe('Waiting for the last table to join... 1 of 3 back');
    expect(html(createElement(RematchBanner, { from, meId: 'me', players: [] }))).toContain('role="status"');
  });

  it('goes away when everyone is back, and without rematch state', () => {
    expect(html(createElement(RematchBanner, { from, meId: 'me', players: [{ id: 'me' }, { id: 'a' }, { id: 'b' }, { id: 'c' }] }))).toBe('');
    expect(html(createElement(RematchBanner, { from: null, meId: 'me', players: [] }))).toBe('');
  });
});
