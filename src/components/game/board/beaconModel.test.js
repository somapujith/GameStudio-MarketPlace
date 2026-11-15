import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, GRID, TILES } from '@shared/board.js';
import { cornerOf, sideOf } from '../fx/geometry.js';
import { HIGHLIGHT_SCALE, firstName, highlightScale, initialOf, inkOn, pawnZ, tagAnchor, tagLabel, tagPlacement } from './beaconModel.js';

const ids = TILES.map((t) => t.id);

describe('tagPlacement: the name tag never leaves the board', () => {
  it('flips below the pawn on the whole top row (corners included), above everywhere else', () => {
    for (const id of ids) {
      const corner = cornerOf(id);
      const top = corner ? corner === 'tl' || corner === 'tr' : sideOf(id) === 'top';
      expect(tagPlacement(id).v).toBe(top ? 'below' : 'above');
    }
    expect(ids.filter((id) => tagPlacement(id).v === 'below')).toHaveLength(GRID);
  });

  it('puts every top-row tile below, the bottom row above, START / the corners as expected', () => {
    expect(tagPlacement(0)).toEqual({ v: 'above', h: 'start' }); // START, bottom-left
    expect(tagPlacement(9)).toEqual({ v: 'below', h: 'start' }); // top-left
    expect(tagPlacement(18)).toEqual({ v: 'below', h: 'end' }); // top-right
    expect(tagPlacement(27)).toEqual({ v: 'above', h: 'end' }); // bottom-right
  });

  it('shifts the wide tag inwards on the side columns and keeps it centred along the top and bottom', () => {
    for (const id of ids) {
      if (cornerOf(id)) continue;
      const side = sideOf(id);
      expect(tagPlacement(id).h).toBe(side === 'left' ? 'start' : side === 'right' ? 'end' : 'center');
    }
    expect(BOARD_SIZE).toBe(ids.length);
  });

  it('anchors the pointer on the pawn: 22% / 50% / 78% along the tag', () => {
    expect([tagAnchor('start'), tagAnchor('center'), tagAnchor('end')]).toEqual([0.22, 0.5, 0.78]);
    expect(tagAnchor('nonsense')).toBe(0.5);
  });
});

describe('tagLabel: what the tag says', () => {
  it('says YOU when the active player is me, on the desktop pill and the phone pin alike', () => {
    expect(tagLabel({ name: 'Nithin', isMe: true })).toEqual({ kind: 'you', text: 'YOU' });
    expect(tagLabel({ name: 'Nithin', isMe: true, disc: true, hasAvatar: true })).toEqual({ kind: 'you', text: 'YOU' });
  });

  it('shows the first name on the desktop, the avatar (or the initial) on the phone', () => {
    expect(tagLabel({ name: 'Ravi Teja' })).toEqual({ kind: 'name', text: 'Ravi' });
    expect(tagLabel({ name: 'Ravi', disc: true, hasAvatar: true })).toEqual({ kind: 'avatar', text: 'R' });
    expect(tagLabel({ name: 'ravi', disc: true })).toEqual({ kind: 'initial', text: 'R' });
    expect(tagLabel({ name: '', disc: true })).toEqual({ kind: 'initial', text: '?' });
    expect(tagLabel({ name: '   ' }).text).toBe('Player');
  });

  it('cuts a long name so the pill stays small', () => {
    expect(firstName('Venkatasubrahmanyam')).toBe('Venkatas…');
    expect(Array.from(firstName('Venkatasubrahmanyam')).length).toBe(9);
    expect(firstName('Subrahmanyeswara Rao', 6)).toBe('Subra…');
    expect(firstName('Asha')).toBe('Asha');
    expect(firstName(null)).toBe('');
    expect(initialOf('émile')).toBe('É');
  });
});

describe('scale, stacking and ink', () => {
  it('draws the active piece 1.35x on the desktop board and 1.5x on the phone discs', () => {
    expect(highlightScale(false)).toBe(1.35);
    expect(highlightScale(true)).toBe(1.5);
    expect(HIGHLIGHT_SCALE.phone).toBeGreaterThan(HIGHLIGHT_SCALE.desktop);
  });

  it('stacks the active pawn above every other, whatever the crowd slot', () => {
    for (let slot = 0; slot < 6; slot++) expect(pawnZ({ isTurn: true, slot })).toBeGreaterThan(pawnZ({ isTurn: false, slot: 5 }));
    expect(pawnZ({ isTurn: false, slot: 2 })).toBe(12);
    expect(pawnZ()).toBe(10);
  });

  it('picks white ink on the saturated colours and dark ink on the light ones', () => {
    expect(inkOn('#ff4d6d')).toBe('#ffffff');
    expect(inkOn('#e63946')).toBe('#ffffff');
    expect(inkOn('#c77dff')).toBe('#1a1438');
    expect(inkOn('#ffd23f')).toBe('#1a1438');
    expect(inkOn('#3ddc97')).toBe('#1a1438');
    expect(inkOn('#4cc9f0')).toBe('#1a1438');
    expect(inkOn('#fff')).toBe('#1a1438');
    expect(inkOn('rebeccapurple')).toBe('#ffffff'); // not a hex: the safe default
    expect(inkOn(undefined)).toBe('#ffffff');
  });
});
