import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_SIZE } from '@shared/board.js';
import { Board } from '../Board.jsx';
import Pawn from '../Pawn.jsx';
import PhoneBoardContext from '../phone/PhoneBoardContext.js';

const base = { id: 'a', name: 'Asha Rao', color: '#ff4d6d', piece: 'auto', pos: 5, avatar: 3 };
const desk = (props) => renderToString(h(Pawn, { ...base, ...props }));
const phone = (props) => renderToString(h(PhoneBoardContext.Provider, { value: true }, h(Pawn, { ...base, ...props })));
const css = (f) => readFileSync(new URL(`../../../styles/${f}`, import.meta.url), 'utf8');

describe('the pawn whose turn it is, on the desktop board', () => {
  it('gets the beacon (two rings), a name pill with the first name and "current turn" in its label', () => {
    const out = desk({ isTurn: true });
    expect(out).toContain('is-turn');
    expect(out).toContain('hb-pawn__beacon');
    expect(out.match(/<i><\/i>/g)).toHaveLength(2);
    expect(out).toMatch(/hb-pawn__pill">Asha</);
    expect(out).toContain('current turn');
    expect(out).not.toContain('hb-pawn__pin');
  });

  it('says YOU on a gold-white tag and ring when it is me', () => {
    const out = desk({ isTurn: true, isMe: true });
    expect(out).toContain('is-turn is-me');
    expect(out).toMatch(/hb-pawn__pill">YOU</);
    expect(out).toContain('is-you');
    expect(css('pawnbeacon.css')).toMatch(/\.hb-pawn\.is-me \.hb-pawn__beacon \{ --bk: #fff1b0/);
  });

  it('draws nothing extra for the other pawns, and no "you" styling off turn', () => {
    const out = desk({ isMe: true });
    for (const c of ['hb-pawn__beacon', 'hb-pawn__tag', 'is-turn', 'is-me', 'current turn']) expect(out).not.toContain(c);
  });

  it('keeps the active pawn on top and carries the tag inside the pawn (so it moves with it)', () => {
    const out = desk({ isTurn: true, slot: 3, count: 4 });
    expect(out).toContain('z-index:30');
    expect(out.indexOf('class="hb-pawn is-')).toBeLessThan(out.indexOf('hb-pawn__tag'));
    expect(out.indexOf('hb-pawn__tag')).toBeLessThan(out.lastIndexOf('</div>'));
    expect(desk({ slot: 3, count: 4 })).toContain('z-index:13');
  });

  it('flips the tag below the pawn on the top row and above on the others', () => {
    expect(desk({ isTurn: true, pos: 12 })).toContain('hb-pawn__tag is-below');
    expect(desk({ isTurn: true, pos: 9 })).toContain('hb-pawn__tag is-below is-h-start');
    expect(desk({ isTurn: true, pos: 30 })).toContain('hb-pawn__tag is-above is-h-center');
    expect(desk({ isTurn: true, pos: 1 })).toContain('is-above is-h-start');
  });

  it('cuts a long name', () => {
    expect(desk({ isTurn: true, name: 'Venkatasubrahmanyam Rao' })).toContain('Venkatas…');
  });

  it('works for every piece', () => {
    for (const piece of ['pearl', 'auto', 'handi', 'chai', 'bat', 'camera']) {
      const out = desk({ isTurn: true, piece });
      expect(out).toContain('hb-pawn__piece');
      expect(out).toContain('hb-pawn__beacon');
    }
  });
});

describe('the pawn whose turn it is, on the phone table', () => {
  it('gets a teardrop pin with the avatar, no pill', () => {
    const out = phone({ isTurn: true });
    expect(out).toContain('hb-pawn__pin');
    expect(out).toContain('hb-pawn__drop');
    expect(out).toContain('hb-pawn__ava');
    expect(out).toContain('is-avatar');
    expect(out).not.toContain('hb-pawn__pill');
    expect(out).toContain('current turn');
  });

  it('falls back to the initial without an avatar, and says YOU for me', () => {
    expect(phone({ isTurn: true, avatar: null })).toMatch(/is-initial[^>]*>.*<b>A<\/b>/);
    const me = phone({ isTurn: true, isMe: true });
    expect(me).toMatch(/<b>YOU<\/b>/);
    expect(me).toContain('is-you');
    expect(me).toContain('is-turn is-me');
  });

  it('flips the pin below the pawn on the top row', () => {
    expect(phone({ isTurn: true, pos: 12 })).toContain('is-below is-h-center');
    expect(phone({ isTurn: true, pos: 25 })).toContain('is-above is-h-center');
  });

  it('draws the other discs as before', () => {
    const out = phone();
    expect(out).toContain('hb-pawn__disc');
    expect(out).not.toContain('hb-pawn__tag');
  });
});

describe('on the board', () => {
  const players = [
    { id: 'a', name: 'Asha', color: '#ff4d6d', piece: 'auto', pos: 0, avatar: 1 },
    { id: 'b', name: 'Bala', color: '#3ddc97', piece: 'pearl', pos: 0, avatar: 2 },
  ];
  const blank = () => ({ owners: Array(BOARD_SIZE).fill(null), levels: Array(BOARD_SIZE).fill(0), mortgaged: Array(BOARD_SIZE).fill(false) });
  const board = (turn, me, phase = 'roll') => renderToString(h(Board, { session: { me, display: { ...blank(), players, turn, phase } } }));

  it('gives only the turn player a tag: YOU when it is me, the name when it is someone else', () => {
    const mine = board(0, 'a');
    expect(mine.match(/hb-pawn__tag /g)).toHaveLength(1);
    expect(mine).toMatch(/hb-pawn__pill">YOU</);
    const theirs = board(1, 'a');
    expect(theirs.match(/hb-pawn__tag /g)).toHaveLength(1);
    expect(theirs).toMatch(/hb-pawn__pill">Bala</);
  });

  it('ends the highlight when the game is over', () => {
    expect(board(0, 'a', 'over')).not.toContain('hb-pawn__tag');
  });
});

describe('the styles', () => {
  const src = css('pawnbeacon.css');

  it('animates only the active pawn: the rings and the bob, transform + opacity only', () => {
    const frames = [...src.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)];
    expect(frames.map((m) => m[1]).sort()).toEqual(['hb-bk-bob', 'hb-bk-ring']);
    for (const [, , body] of frames) {
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]).filter((p) => !['from', 'to'].includes(p));
      expect(new Set(props)).toEqual(new Set(props.filter((p) => ['transform', 'opacity'].includes(p))));
    }
    expect(src.match(/will-change:/g)).toHaveLength(1);
    expect(src).toMatch(/\.hb-pawn\.is-turn \{[^}]*will-change: transform/);
  });

  it('stills the rings and the bob under every reduced-motion switch', () => {
    expect(src).toContain('@media (prefers-reduced-motion: reduce)');
    expect(src).toContain(":root[data-motion='reduced'] .hb-pawn__beacon i");
    expect(src).toContain('.hg-game[data-rm] .hb-pawn__tagbob');
  });

  it('grows the phone disc more than the desktop piece', () => {
    expect(src).toMatch(/\.hb-pawn\.is-turn \{\s*--k: 1\.35/);
    expect(src).toMatch(/\.ph \.hb-pawn\.is-turn \{\s*--k: 1\.5/);
  });
});
