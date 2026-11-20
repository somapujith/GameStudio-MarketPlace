// Markup of the night-market polish: the in-play callout and ink on the tile faces, the caption headline + detail, the target
// micro-bar, the buy card's affordability line and countdown, and the "Rolling…" button.
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { buildActionSpec } from '../ActionBar.jsx';
import PhoneTopBar from './PhoneTopBar.jsx';
import PhoneActions from './PhoneActions.jsx';
import PhoneCentre from './PhoneCentre.jsx';
import BuyCard from './BuyCard.jsx';
import PhoneTileFace from './PhoneTileFace.jsx';
import { buyCardData } from './phoneModel.js';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const P = (id, name, extra = {}) => ({ id, name, color: '#ff4d6d', avatar: 0, piece: 'pearl', cash: 820000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra });
const ALL = [P('me', 'Nithin', { cash: 1115000 }), P('rav', 'Ravi', { color: '#3ddc97', cash: 2000000 }), P('sana', 'Sana', { color: '#4cc9f0' })];

function sess({ turn = 0, options = { roll: true }, extra = {}, view = {}, cfg = {} } = {}) {
  const players = ALL;
  const v = {
    phase: 'roll', turn, round: 7, players, owners: Array(TILES.length).fill(null), levels: Array(TILES.length).fill(0), mortgaged: [], pending: null, trade: null, dice: [4],
    cfg: { mode: 'standard', maxRounds: 20, targetWorth: 5000000, ...cfg }, ...view,
  };
  return { me: 'me', view: v, display: { ...v }, options, busy: false, rolling: false, log: [], chat: [], connection: 'open', sendChat() {}, dispatch() {}, ...extra };
}
const actionsOf = (s) => ({ spec: buildActionSpec(s), fire: () => () => {} });
const district = { tile: TILES[29], group: { color: '#4f7cff' } };

describe('the tile in play (callout)', () => {
  it('names itself with its price while the mover stands on it, and is hidden from screen readers', () => {
    const out = html(h(PhoneTileFace, { ...district, active: true }));
    expect(out).toContain('class="pt__call" aria-hidden="true"');
    expect(out).toContain('<b>MADHAPUR</b>');
    expect(out).toContain('<i>₹3.2L</i>');
  });

  it('an owned district quotes its rent with a dot in the owner colour; a mortgaged one says so', () => {
    const owned = html(h(PhoneTileFace, { ...district, active: true, owned: true, ownerColor: '#ff4d6d', rent: 32000, level: 1 }));
    expect(owned).toContain('Rent ₹32k');
    expect(owned).toContain('<u style="background:#ff4d6d">');
    const mort = html(h(PhoneTileFace, { ...district, active: true, owned: true, ownerColor: '#ff4d6d', mortgaged: true }));
    expect(mort).toContain('Mortgaged');
    expect(mort).not.toContain('Rent ');
  });

  it('light tiles name themselves too; no callout when nobody stands there', () => {
    expect(html(h(PhoneTileFace, { tile: TILES[0], active: true }))).toContain('<b>START</b>');
    expect(html(h(PhoneTileFace, { ...district }))).not.toContain('pt__call');
    expect(html(h(PhoneTileFace, { ...district, active: false }))).not.toContain('pt__call');
  });

  it('the face and the callout are siblings (the face clips to the tile, the callout floats outside it)', () => {
    const out = html(h(PhoneTileFace, { ...district, active: true }));
    expect(out.indexOf('class="pt pt--prop"')).toBeLessThan(out.indexOf('class="pt__call"'));
    expect(out.match(/<\/span><span class="pt__call"/)).not.toBeNull();
  });
});

describe('tile face details', () => {
  it('prints which ink the name has (light or dark) so the text shadow can fit it', () => {
    expect(html(h(PhoneTileFace, { ...district }))).toMatch(/data-ink="(light|dark)"/);
  });

  it('only an owned, un-mortgaged district gets the owner ribbon', () => {
    expect(html(h(PhoneTileFace, { ...district, owned: true, ownerColor: '#ff4d6d' }))).toContain('data-owned=""');
    expect(html(h(PhoneTileFace, { ...district }))).not.toContain('data-owned');
    expect(html(h(PhoneTileFace, { ...district, owned: true, ownerColor: '#ff4d6d', mortgaged: true }))).not.toContain('data-owned');
  });

  it('the first render lights the pips of the level without popping them', () => {
    const out = html(h(PhoneTileFace, { ...district, owned: true, ownerColor: '#ff4d6d', level: 2 }));
    expect(out).toContain('class="is-on"');
    expect(out).not.toContain('is-new');
  });
});

describe('the caption', () => {
  it('a big headline over a small detail; the screen reader gets the whole sentence once', () => {
    const s = sess();
    const out = html(h(PhoneCentre, { session: s, spec: buildActionSpec(s) }));
    expect(out).toContain('<span class="cp-sr">Your turn — roll!</span>');
    expect(out).toContain('<span class="pc-cap__h" aria-hidden="true">Your turn</span>');
    expect(out).toContain('<span class="pc-cap__d" aria-hidden="true">Roll!</span>');
    expect(out).toContain('data-detail=""');
    expect(out).toContain('role="status"');
  });

  it('a one-part caption has no detail line', () => {
    const s = sess({ turn: 1, options: {} });
    const out = html(h(PhoneCentre, { session: s, spec: buildActionSpec(s) }));
    expect(out).toContain('Ravi is playing…');
    expect(out).not.toContain('pc-cap__d');
  });
});

describe('the target micro-bar in the top bar', () => {
  it('shows my progress with a plain-words label when the table has a target', () => {
    const s = sess();
    const out = html(h(PhoneTopBar, { session: s, spec: buildActionSpec(s) }));
    expect(out).toContain('class="ph-goal');
    expect(out).toMatch(/aria-label="You are at \d+% of the target/);
    expect(out).toContain('ph-goal__mine');
    expect(out).toContain('ph-goal__rival');
  });

  it('is left out when the table has no target', () => {
    const s = sess({ cfg: { targetWorth: null } });
    expect(html(h(PhoneTopBar, { session: s, spec: buildActionSpec(s) }))).not.toContain('ph-goal');
  });
});

describe('BuyCard: affordability and the countdown', () => {
  const data = (o = {}) => buyCardData(TILES[29], { cash: 1115000, price: 320000, ...o });
  const clocked = (waiting = 'me') => sess({ extra: { clock: { deadline: Date.now() + 25000, waitingFor: [waiting] } } });

  it('says what is left after buying when I can afford it, and the staggered children carry their index', () => {
    const out = html(h(BuyCard, { data: data() }));
    expect(out).toContain('You can afford it · <b>₹7,95,000</b> left after buying');
    expect(out).toContain('style="--i:0"');
    expect(out).toContain('style="--i:2"');
  });

  it('no affordability line when I cannot afford it (the shortfall line stays)', () => {
    const out = html(h(BuyCard, { data: data({ cash: 20000 }) }));
    expect(out).not.toContain('bcard-afford');
    expect(out).toContain('Need ₹3,00,000 more to buy this');
  });

  it('a countdown in the corner and a draining bar while MY clock runs; nothing for somebody else\'s', () => {
    const mine = html(h(BuyCard, { data: data(), session: clocked('me') }));
    expect(mine).toContain('role="timer"');
    expect(mine).toMatch(/class="bcard-count"[^>]*>\d+s</);
    expect(mine).toContain('bcard-bar');
    const theirs = html(h(BuyCard, { data: data(), session: clocked('rav') }));
    expect(theirs).not.toContain('bcard-count');
    expect(html(h(BuyCard, { data: data() }))).not.toContain('bcard-count');
  });
});

describe('PhoneActions: the Rolling… state', () => {
  const render = (s) => {
    const a = actionsOf(s);
    return html(h(PhoneActions, { session: s, spec: a.spec, fire: a.fire, badges: {} }));
  };

  it('while the dice are in the air the button says Rolling… with a tumbling die, not three dots', () => {
    const out = render(sess({ options: {}, extra: { busy: true, rolling: true } }));
    expect(out).toContain('is-rolling');
    expect(out).toContain('Rolling…');
    expect(out).toContain('aria-label="Rolling the dice"');
    expect(out).toContain('pa-die');
    expect(out).not.toContain('pa-dots');
  });

  it('busy without a roll keeps the quiet dots; the idle ROLL button keeps its exact classes', () => {
    const busy = render(sess({ options: {}, extra: { busy: true, rolling: false } }));
    expect(busy).toContain('pa-dots');
    expect(busy).not.toContain('is-rolling');
    expect(render(sess())).toContain('class="pa-primary is-roll tone-gold"');
  });
});
