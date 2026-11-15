// Connection strength in the player pods: opponents from the room's `net`, you from your own live measurement.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { netStats } from '@/lib/netStats.js';
import PlayerPods from './PlayerPods.jsx';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const N = TILES.length;
const P = (id, name, extra = {}) => ({ id, name, avatar: 0, color: '#3ddc97', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra });

function mkSession(players, { me = players[0].id, turn = 0, roomPlayers = [] } = {}) {
  const view = {
    phase: 'roll', turn, round: 3, turnCount: 5, extraRoll: false, players,
    owners: Array(N).fill(null), levels: Array(N).fill(0), mortgaged: Array(N).fill(false),
    cfg: { mode: 'standard', maxRounds: 20 }, pending: null, trade: null, debt: null, event: null, dice: [],
  };
  const display = { players, owners: view.owners, levels: view.levels, mortgaged: view.mortgaged, turn, round: 3, dice: [], phase: 'roll', cfg: view.cfg };
  return { mode: 'online', me, view, display, options: {}, log: [], dispatch: () => {}, clock: null, roomPlayers };
}

const podOf = (out, id) => out.split('<li ').slice(1).find((x) => x.includes(`data-fx-player="${id}"`));
const lit = (pod) => (pod.match(/sg__bar is-on/g) || []).length;
const players = [P('me', 'Nithin'), P('rav', 'Ravi'), P('sana', 'Sana'), P('arj', 'Arjun')];

afterEach(() => netStats.reset());

describe('pods: connection strength', () => {
  const room = [
    { id: 'me', connected: true, net: { q: 1, rtt: 900 } },
    { id: 'rav', connected: true, net: { q: 4, rtt: 40 } },
    { id: 'sana', connected: true, net: { q: 2, rtt: 300 } },
    { id: 'arj', connected: true, net: { q: null, rtt: null } },
  ];
  const render = (extra = {}, props = {}) => html(createElement(PlayerPods, { session: mkSession(players, { me: 'me', roomPlayers: room, ...extra }), layout: 'wide', ...props }));

  it('every opponent pod shows its bars: lit count and colour class follow the room\'s level', () => {
    const out = render();
    expect(lit(podOf(out, 'rav'))).toBe(4);
    expect(podOf(out, 'rav')).toContain('sg--l4');
    expect(lit(podOf(out, 'sana'))).toBe(2);
    expect(podOf(out, 'sana')).toContain('sg--l2');
    expect(podOf(out, 'sana')).toContain('aria-label="Connection: fair, 2 of 4 bars, about 300 ms"');
  });

  it('a connected player who has not reported yet shows the dim measuring bars, not a wrong colour', () => {
    const arj = podOf(render(), 'arj');
    expect(arj).toContain('sg--measuring');
    expect(lit(arj)).toBe(0);
    expect(arj).not.toContain('sg__pill');
  });

  it('the bars sit in the name row, next to the name, and the card says it in words', () => {
    const rav = podOf(render(), 'rav');
    expect(rav).toMatch(/<span class="hg-pod__name">.*sg--l4.*<\/span><span class="hg-pod__sub">/);
    expect(rav).toMatch(/aria-label="Ravi, [^"]*connection excellent, 4 of 4 bars/);
    expect(rav).toContain('data-fx-player="rav"'); // the coin / bubble anchor is untouched
  });

  it('your own pod uses YOUR measurement the moment it exists, not the server\'s older echo', () => {
    expect(lit(podOf(render(), 'me'))).toBe(1); // idle: shown like everybody else (the room says 1 bar)
    netStats.setStatus('open');
    netStats.setRtt(50);
    const me = podOf(render(), 'me');
    expect(lit(me)).toBe(4);
    expect(me).toContain('sg--l4');
  });

  it('your own socket retrying: grey bars and the amber "Reconnecting…" pill, your turn mark stays', () => {
    netStats.setStatus('reconnecting');
    const out = render({ turn: 0 });
    const me = podOf(out, 'me');
    expect(me).toContain('sg--reconnecting');
    expect(me).toContain('Reconnecting…');
    expect(lit(me)).toBe(0);
    expect(me).toContain('>Turn<'); // an auto-played turn is coming, but it is still your turn
    expect(me).toMatch(/aria-label="Nithin \(you\)[^"]*reconnecting/);
    expect(podOf(out, 'rav')).not.toContain('Reconnecting…'); // others are unaffected by YOUR trouble
  });

  it('while your socket is first connecting you are just "measuring"', () => {
    netStats.setStatus('connecting');
    expect(podOf(render(), 'me')).toContain('sg--measuring');
  });

  it('an opponent the room marks gone: grey bars + "Offline" pill, whatever `net` says; the turn mark is hidden', () => {
    const gone = room.map((r) => (r.id === 'rav' ? { ...r, connected: false } : r));
    const out = html(createElement(PlayerPods, { session: mkSession(players, { me: 'me', turn: 1, roomPlayers: gone }), layout: 'wide' }));
    const rav = podOf(out, 'rav');
    expect(rav).toContain('sg--offline');
    expect(rav).toContain('>Offline<');
    expect(lit(rav)).toBe(0);
    expect(rav).not.toContain('>Turn<');
    expect(rav).toContain('is-offline');
  });

  it('net.q 0 (no live socket, still inside the 30 s grace) already shows "Offline"', () => {
    const q0 = room.map((r) => (r.id === 'sana' ? { ...r, net: { q: 0, rtt: null } } : r));
    const sana = podOf(render({ roomPlayers: q0 }), 'sana');
    expect(sana).toContain('>Offline<');
  });

  it('shows no bars for a player who is out, nor against an older server without `net`', () => {
    const out = html(createElement(PlayerPods, { session: mkSession([P('me', 'Nithin'), P('rav', 'Ravi', { bankrupt: true, cash: 0 })], { me: 'me', roomPlayers: [{ id: 'me', connected: true }, { id: 'rav', connected: true, net: { q: 4, rtt: 30 } }] }), layout: 'wide' }));
    expect(podOf(out, 'rav')).not.toContain('sg__bars');
    expect(podOf(out, 'me')).not.toContain('sg__bars');
  });

  it('phone cards and the wallet bar carry the same component (pill included)', () => {
    const gone = room.map((r) => (r.id === 'sana' ? { ...r, connected: false } : r));
    const s = mkSession(players, { me: 'me', roomPlayers: gone });
    const others = html(createElement(PlayerPods, { session: s, layout: 'phone', mode: 'others' }));
    expect(lit(podOf(others, 'rav'))).toBe(4);
    expect(podOf(others, 'sana')).toContain('>Offline<');
    netStats.setStatus('open');
    netStats.setRtt(150);
    const wallet = html(createElement(PlayerPods, { session: s, layout: 'phone', mode: 'me' }));
    expect(wallet).toContain('data-cell="wallet"');
    expect(lit(wallet)).toBe(3);
    expect(wallet).toContain('sg--sm');
  });
});
