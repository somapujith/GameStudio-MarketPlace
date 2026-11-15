// The simple phone table shows connection strength too: bars beside the name, the "Offline" / "Reconnecting…" pill under the avatar.
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { netStats } from '@/lib/netStats.js';
import PhonePlayers from './PhonePlayers.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const P = (id, name, extra = {}) => ({ id, name, color: '#ff4d6d', avatar: 0, piece: 'pearl', cash: 820000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra });
const ALL = [P('me', 'Nithin'), P('rav', 'Ravi'), P('sana', 'Sana'), P('arj', 'Arjun')];

function sess(n, roomPlayers, turn = 0) {
  const players = ALL.slice(0, n);
  const v = { phase: 'roll', turn, round: 7, players, owners: Array(TILES.length).fill(null), levels: Array(TILES.length).fill(0), mortgaged: [], pending: null, trade: null, dice: [4], cfg: { mode: 'standard', maxRounds: 20 } };
  return { me: 'me', view: v, display: { ...v }, options: {}, busy: false, rolling: false, log: [], chat: [], connection: 'open', sendChat() {}, dispatch() {}, roomPlayers };
}
const cellOf = (out, id) => out.split('<li ').slice(1).find((x) => x.includes(`data-fx-player="${id}"`));
const lit = (cell) => (cell.match(/sg__bar is-on/g) || []).length;

afterEach(() => netStats.reset());

describe('PhonePlayers: connection strength', () => {
  const room = [
    { id: 'me', connected: true, net: { q: 2, rtt: 300 } },
    { id: 'rav', connected: true, net: { q: 4, rtt: 40 } },
    { id: 'sana', connected: true, net: { q: null, rtt: null } },
  ];

  it('bars beside every name replace the old presence dot; levels follow the room', () => {
    const out = html(h(PhonePlayers, { session: sess(3, room) }));
    expect(out).not.toContain('pp__dot');
    expect(lit(cellOf(out, 'rav'))).toBe(4);
    expect(cellOf(out, 'rav')).toMatch(/<span class="pp__name"><span class="sg sg--sm sg--ok sg--l4 pp__sig"/);
    expect(cellOf(out, 'sana')).toContain('sg--measuring');
    expect(cellOf(out, 'rav')).toMatch(/aria-label="Ravi, [^"]*connection excellent, 4 of 4 bars/);
  });

  it('your own cell uses your live measurement', () => {
    expect(lit(cellOf(html(h(PhonePlayers, { session: sess(3, room) })), 'me'))).toBe(2);
    netStats.setStatus('open');
    netStats.setRtt(60);
    expect(lit(cellOf(html(h(PhonePlayers, { session: sess(3, room) })), 'me'))).toBe(4);
  });

  it('a player who is gone: grey bars, the red pill in the slot under the avatar (instead of the turn pill), words on the card', () => {
    const gone = room.map((r) => (r.id === 'rav' ? { ...r, connected: false } : r));
    const out = html(h(PhonePlayers, { session: sess(3, gone, 1) })); // it is Ravi's turn
    const rav = cellOf(out, 'rav');
    expect(rav).toContain('sg--offline');
    expect(rav).toMatch(/<span class="pp__slot"><span class="sg__pill sg__pill--offline" aria-hidden="true">Offline<\/span><\/span>/);
    expect(rav).not.toContain('pp__turn');
    expect(rav).toMatch(/aria-label="Ravi, [^"]*offline/);
    expect(rav).not.toContain('Reconnecting');
  });

  it('your own socket retrying shows "Reconnecting…" in the slot and amber bars', () => {
    netStats.setStatus('reconnecting');
    const me = cellOf(html(h(PhonePlayers, { session: sess(2, room.slice(0, 2)) })), 'me');
    expect(me).toContain('sg--reconnecting');
    expect(me).toContain('>Reconnecting…<');
    expect(me).toMatch(/aria-label="Nithin \(you\)[^"]*reconnecting/);
  });

  it('nothing for a player who is out', () => {
    const s = sess(2, room.slice(0, 2));
    s.display.players = s.display.players.map((p) => (p.id === 'rav' ? { ...p, bankrupt: true } : p));
    expect(cellOf(html(h(PhonePlayers, { session: s })), 'rav')).not.toContain('sg__bars');
  });
});
