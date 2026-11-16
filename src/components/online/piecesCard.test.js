// "Choose your piece" (the lobby's first card), the seat's piece line and the guest login form order.
// Server-side render (node env): effects do not run, so these cover first renders and what the markup promises.
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes, StaticRouter } from 'react-router-dom';

const room = vi.hoisted(() => ({
  state: null,
}));

vi.mock('@/components/art/index.js', () => ({
  Avatar: ({ preset }) => h('span', { 'data-avatar': preset }),
  AVATAR_PRESETS: Array.from({ length: 12 }, (_, id) => ({ id, label: `Avatar ${id}` })),
  Logo: () => h('span', { 'data-logo': true }),
  Scene: () => h('span', { 'data-scene': true }),
}));
// the lobby page reads the room from the socket hook: hand it a room instead of opening a socket
vi.mock('@/components/online/useRoomConnection.js', () => {
  const useRoomConnection = () => room.state;
  return { useRoomConnection, default: useRoomConnection };
});

const { AuthContext } = await import('@/lib/auth.jsx');
const { default: Login } = await import('@/pages/Login.jsx');
const { default: Lobby } = await import('@/pages/Lobby.jsx');
const { default: Seat } = await import('./Seat.jsx');
const { default: PiecePicker } = await import('@/platform/game/PiecePicker.jsx');
const { pieceChoices, pieceStatus } = await import('./lobbyModel.js');

const PIECES = [
  { id: 'pearl', name: 'Pearl' },
  { id: 'auto', name: 'Auto-rickshaw' },
  { id: 'handi', name: 'Biryani handi' },
  { id: 'chai', name: 'Irani chai glass' },
  { id: 'bat', name: 'Cricket bat' },
  { id: 'camera', name: 'Film camera' },
];
const PLAYERS = [
  { id: 'me', name: 'Gita', avatar: 2, piece: 'pearl' },
  { id: 'b', name: 'Bela', avatar: 3, piece: 'auto' },
  { id: 'c', name: 'Chandu', avatar: 5, piece: 'bat' },
];
const card = (opts = {}, players = PLAYERS, pending = null) => {
  const { choices } = pieceChoices(PIECES, players, 'me', pending);
  return renderToString(h(PiecePicker, { choices, color: '#3ddc97', onPick() {}, variant: 'classic', ...opts }));
};

describe('Choose your piece: the card says what to do', () => {
  it('has a clear title and the tap-an-icon line', () => {
    const html = card();
    expect(html).toContain('>Choose your piece<');
    expect(html).toContain('Tap an icon to pick it');
    expect(html).toContain('it is your piece on the board');
    expect(html).toContain('<h2'); // a real heading, labelled for the radio group
    expect(html).toContain('aria-labelledby="xl-pieces-h"');
  });

  it('one radio per piece, in the game order, each with a 60px picture (the tap target is far bigger than 44px)', () => {
    const html = card();
    expect((html.match(/role="radio"/g) || []).length).toBe(6);
    expect(html.indexOf('Pearl')).toBeLessThan(html.indexOf('Auto-rickshaw'));
    expect(html.indexOf('Cricket bat')).toBeLessThan(html.indexOf('Film camera'));
    expect(html).toContain('width="60"'); // PieceArt size: 60px >= 56px
    expect(html).toContain('xl-pieces--top');
  });
});

describe('Choose your piece: selected, taken, disabled', () => {
  it('my piece is the one checked radio: ticked, marked "Yours", the only tab stop', () => {
    const html = card();
    expect((html.match(/aria-checked="true"/g) || []).length).toBe(1);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Pearl"/);
    expect(html).toContain('is-mine');
    expect(html).toContain('>Yours<');
    expect(html).toContain('xl-piece__check');
    expect((html.match(/tabindex="0"/g) || []).length).toBe(1);
    expect(html).toContain('You are the Pearl');
  });

  it('a piece somebody else holds is disabled, greyed and names its owner on the tile and for a screen reader', () => {
    const html = card();
    expect(html).toContain('aria-label="Auto-rickshaw, taken by Bela"');
    expect(html).toContain('aria-label="Cricket bat, taken by Chandu"');
    expect((html.match(/is-taken/g) || []).length).toBe(2);
    expect((html.match(/disabled=""/g) || []).length).toBe(2); // exactly the two taken ones
    expect(html).toContain('xl-piece__ownername">Bela<');
    expect(html).toContain('xl-piece__ownername">Chandu<');
    expect(html).toContain('data-avatar="3"'); // the owner's character
    expect(html).toContain('Greyed-out pieces are taken');
    // a free piece can be picked: a hint, not disabled
    expect(html).toMatch(/aria-checked="false"[^>]*aria-label="Biryani handi"[^>]*>/);
    expect(html).not.toMatch(/aria-label="Biryani handi"[^>]*disabled/);
    expect(html).toContain('Tap to pick');
  });

  it('while the connection is down every piece is disabled (nothing is "taken" because of it)', () => {
    const html = card({ disabled: true });
    expect((html.match(/disabled=""/g) || []).length).toBe(6);
    expect((html.match(/is-taken/g) || []).length).toBe(2);
  });

  it('nothing picked yet: says so, and the first free piece is the tab stop', () => {
    const players = [{ id: 'me', name: 'Gita', avatar: 2 }, { id: 'b', name: 'Bela', avatar: 3, piece: 'pearl' }];
    const html = card({}, players);
    expect(html).toContain('Pick a piece to play with');
    expect((html.match(/aria-checked="true"/g) || []).length).toBe(0);
    expect(html).toMatch(/tabindex="0"[^>]*>(?:(?!<button)[\s\S])*?Auto-rickshaw/);
    expect(html).toContain('aria-label="Pearl, taken by Bela"');
  });

  it('a pick the server has not confirmed yet shows as mine at once, and the card is busy', () => {
    const html = card({ pending: true }, PLAYERS, 'chai');
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Irani chai glass"/);
    expect(html).toContain('You are the Irani chai glass');
  });

  it('shows who is choosing: their character and name beside the status', () => {
    const html = card({ me: { name: 'Gita', avatar: 7 } });
    expect(html).toContain('data-avatar="7"');
    expect(html).toContain('<b>Gita</b>');
    expect(card()).not.toContain('xl-pieces__avatar'); // no `me`, no character row
  });

  it('nothing to choose from renders nothing', () => {
    expect(renderToString(h(PiecePicker, { choices: [], onPick() {} }))).toBe('');
    expect(renderToString(h(PiecePicker, { choices: undefined, onPick() {} }))).toBe('');
  });
});

describe('pieceStatus', () => {
  it('names my piece, counts the taken ones', () => {
    const { choices } = pieceChoices(PIECES, PLAYERS, 'me');
    expect(pieceStatus(choices)).toMatchObject({ status: 'You are the Pearl', free: 4, taken: 2 });
    expect(pieceStatus(choices).mine.id).toBe('pearl');
  });
  it('asks for a pick when there is none, and survives junk', () => {
    const { choices } = pieceChoices(PIECES, [{ id: 'me' }], 'me');
    expect(pieceStatus(choices)).toMatchObject({ mine: null, status: 'Pick a piece to play with', free: 6, taken: 0 });
    expect(pieceStatus(undefined)).toMatchObject({ mine: null, free: 0, taken: 0 });
  });
});

describe('Seat: the chosen piece is named, next to the character', () => {
  const p = { id: 'a', name: 'Anil', avatar: 4, connected: true };
  it('a seat with a piece shows its picture and name; the avatar badge stays', () => {
    const html = renderToString(h(Seat, { player: { ...p, piece: 'auto' }, piece: { id: 'auto', name: 'Auto-rickshaw' }, piecesOn: true, color: '#ff4d6d' }));
    expect(html).toContain('sr-seat__pieceline');
    expect(html).toContain('>Auto-rickshaw<');
    expect(html).toContain('Piece: Auto-rickshaw'); // the screen-reader text of the badge
    expect(html).toContain('data-avatar="4"');
    expect(html).not.toContain('No piece yet');
  });
  it('a game with pieces and a player who has none yet says so; a game without pieces shows nothing', () => {
    expect(renderToString(h(Seat, { player: p, piecesOn: true }))).toContain('No piece yet');
    expect(renderToString(h(Seat, { player: p }))).not.toContain('sr-seat__pieceline');
  });
});

describe('Your piece (compact, the default): one scrolling row', () => {
  const compact = (opts = {}, players = PLAYERS, pending = null) => {
    const { choices } = pieceChoices(PIECES, players, 'me', pending);
    return renderToString(h(PiecePicker, { choices, color: '#3ddc97', onPick() {}, ...opts }));
  };

  it('is the default look: an eyebrow label, one radiogroup labelled by it, one radio per piece in game order', () => {
    const html = compact();
    expect(html).toContain('>Your piece<');
    expect(html).toContain('st-eyebrow');
    expect(html).toContain('lr-pieces__row');
    expect(html).not.toContain('xl-pieces--top');
    expect((html.match(/role="radio"/g) || []).length).toBe(6);
    expect(html.indexOf('Pearl')).toBeLessThan(html.indexOf('Film camera'));
    const group = /role="radiogroup" aria-labelledby="([^"]+)"/.exec(html)[1];
    expect(html).toContain(`id="${group}"`);
    expect(html).toContain('xl-pieces__head'); // the guest tour points at it
  });

  it('mine is the one checked radio and the only tab stop; the status says so', () => {
    const html = compact();
    expect((html.match(/aria-checked="true"/g) || []).length).toBe(1);
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Pearl"/);
    expect((html.match(/tabindex="0"/g) || []).length).toBe(1);
    expect(html).toContain('lr-piece__check');
    expect(html).toContain('You are the Pearl');
  });

  it('taken pieces are disabled, dimmed and name who has them', () => {
    const html = compact();
    expect(html).toContain('aria-label="Auto-rickshaw, taken by Bela"');
    expect((html.match(/is-taken/g) || []).length).toBe(2);
    expect((html.match(/disabled=""/g) || []).length).toBe(2);
    expect(html).toContain('lr-piece__ownername">Bela<');
    expect(html).toContain('data-avatar="3"');
  });

  it('while the socket is down every piece is disabled; a pending pick is mine at once and the card is busy', () => {
    expect((compact({ disabled: true }).match(/disabled=""/g) || []).length).toBe(6);
    const html = compact({ pending: true }, PLAYERS, 'chai');
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Irani chai glass"/);
  });

  it('nothing picked yet: the first free piece is the tab stop; nothing to choose from renders nothing', () => {
    const html = compact({}, [{ id: 'me', name: 'Gita', avatar: 2 }, { id: 'b', name: 'Bela', avatar: 3, piece: 'pearl' }]);
    expect(html).toContain('Pick a piece to play with');
    expect(html).toMatch(/tabindex="0"[^>]*>(?:(?!<button)[\s\S])*?Auto-rickshaw/);
    expect(renderToString(h(PiecePicker, { choices: [], onPick() {} }))).toBe('');
  });
});

// ---- the lobby page: the piece card is the first thing under the table header ---------------------------------------

const base = {
  user: null,
  loading: false,
  configured: false,
  googleClientId: null,
  reachable: true,
  authError: null,
  clearAuthError() {},
  signingIn: false,
  loginWithGoogle: async () => null,
  loginGuest: async () => null,
  logout: async () => {},
  refresh: async () => null,
  reloadConfig: async () => false,
  updateProfile: async () => null,
  subscribe: () => () => {},
  userSocketStatus: 'closed',
};
const guest = { id: 'me', name: 'Gita', avatar: 2, friendCode: 'HYD-7K2Q', isGuest: true, level: 1, xp: 0, coins: 0, stats: {} };

function lobbyHtml(over = {}) {
  room.state = {
    room: {
      code: 'ABC234',
      gameId: 'hyderabad-tycoon',
      status: 'lobby',
      hostId: 'me',
      maxPlayers: 4,
      settings: { mode: 'standard' },
      players: PLAYERS.map((q) => ({ ...q, connected: true })),
      ...over,
    },
    connection: 'open',
    link: { attempt: 0, since: null, everOpen: true },
    fatal: null,
    error: null,
    errorId: 0,
    send: () => true,
    pickPiece: () => true,
    leave() {},
    retry() {},
  };
  return renderToString(
    h(MemoryRouter, { initialEntries: ['/lobby/ABC234'] }, h(AuthContext.Provider, { value: { ...base, user: guest } }, h(Routes, null, h(Route, { path: '/lobby/:code', element: h(Lobby) })))),
  );
}

describe('Lobby page: three zones, the icon choice sits in "Your setup"', () => {
  it('reads table -> invite -> setup (the phone order), with the piece and the rules inside the setup zone', () => {
    const html = lobbyHtml();
    const at = (s) => html.indexOf(s);
    expect(at('ls-table')).toBeGreaterThan(-1);
    expect(at('ls-table')).toBeLessThan(at('ls-side'));
    expect(at('ls-side')).toBeLessThan(at('ls-setup'));
    expect(at('Around the table')).toBeLessThan(at('aria-label="Start"')); // seats, then Start
    expect(at('aria-label="Start"')).toBeLessThan(at('id="sr-invite"')); // the invite panel is the second zone
    expect(at('id="sr-invite"')).toBeLessThan(at('Your setup'));
    expect(at('Your setup')).toBeLessThan(at('Your piece')); // the piece card belongs to the setup zone
    expect(at('Your piece')).toBeLessThan(at('sr-o-settings')); // then the rules
  });

  it('has one h1, a main landmark and the hooks the tours point at', () => {
    const html = lobbyHtml();
    expect((html.match(/<h1[ >]/g) || []).length).toBe(1);
    expect(html).toContain('<main');
    for (const hook of ['lobby-header', 'lobby-code', 'lobby-connection', 'lobby-pieces', 'lobby-start', 'lobby-seats', 'lobby-settings', 'lobby-invite', 'lobby-leave']) {
      expect(html, hook).toContain(`data-tour="${hook}"`);
    }
  });

  it('shows my character, the taken pieces and each seat\'s piece', () => {
    const html = lobbyHtml();
    expect(html).toContain('Auto-rickshaw, taken by Bela');
    expect(html).toContain('You are the Pearl');
    expect((html.match(/sr-seat__pieceline/g) || []).length).toBe(3); // one per player at the table
    expect(html).toContain('>Cricket bat<');
  });

  it('there is no piece card for a game without pieces', () => {
    const html = lobbyHtml({ gameId: 'no-such-game' });
    expect(html).not.toContain('Your piece');
  });
});

// ---- the guest login form -------------------------------------------------------------------------------------------

describe('Login: "Pick your character" comes before the name', () => {
  const page = () =>
    renderToString(
      h(StaticRouter, { location: '/login' }, h(AuthContext.Provider, { value: { ...base, configured: true, googleClientId: 'x.apps.googleusercontent.com' } }, h(Login))),
    );

  it('the character picker is above the name field, with the helper line', () => {
    const html = page();
    expect(html).toContain('Pick your character');
    expect(html).toContain('Choose your character');
    expect(html).toContain('you can change it later');
    const pick = html.indexOf('Pick your character');
    expect(pick).toBeGreaterThan(html.indexOf('Continue as guest')); // inside the guest form
    expect(pick).toBeLessThan(html.indexOf('id="sa-guest-name"'));
    expect(html.indexOf('Choose your character')).toBeLessThan(html.indexOf('id="sa-guest-name"'));
    expect(html.indexOf('Your name')).toBeGreaterThan(pick);
    // the last avatar is still above the name field
    expect(html.lastIndexOf('name="avatar"')).toBeLessThan(html.indexOf('id="sa-guest-name"'));
  });

  it('keeps the behaviour and the labels: 12 radios in one named group, one checked, the helper describes the group', () => {
    const html = page();
    expect((html.match(/name="avatar"/g) || []).length).toBe(12);
    expect((html.match(/type="radio"[^>]*checked=""|checked=""[^>]*type="radio"/g) || []).length).toBe(1);
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    expect(html).toContain('aria-describedby="sa-avatar-hint"');
    expect(html).toContain('id="sa-avatar-hint"');
    expect(html).toContain('Your name'); // the name field is still there
    expect(html).toContain('placeholder="e.g. Biryani Bhai"');
    expect(html).toContain('Continue as guest');
  });
});
