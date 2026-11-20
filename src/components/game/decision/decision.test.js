// The landing-decision popup: the pure model (which decision, its strings and rules) and the markup of every card state.
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { buildActionSpec } from '../ActionBar.jsx';
import { contrastRatio } from '../PropertySheet.jsx';
import PhoneTable from '../phone/PhoneTable.jsx';
import DecisionCard from './DecisionCard.jsx';
import {
  THEMES, cashAfter, decisionCardOpen, decisionKeyAction, decisionOf, fareReason, isCardShown, reopenOf, routeLabel, vehicleOf,
} from './decisionModel.js';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const P = (id, name, extra = {}) => ({ id, name, color: '#ff4d6d', avatar: 0, piece: 'pearl', cash: 1115000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra });

/** A session on a transport stop (phase manage, offer in the state) or stuck in the jam (phase roll). */
function sess({ kind = 'ride', pos = 14, cash = 1115000, chai = 1, turn = 0, extraRoll = false, upgrade = [], fine = 25000, passStart = 200000 } = {}) {
  const ride = kind === 'ride';
  const fares = { 5: 25000, 14: 35000, 23: 45000 };
  const next = { 5: 14, 14: 23, 23: 5 };
  const players = [P('me', 'Nithin', { cash, pos: ride ? pos : 9, chai, stuck: !ride }), P('rav', 'Ravi', { pos: 3 })];
  const view = {
    phase: ride ? 'manage' : 'roll', turn, round: 7, turnCount: 30, extraRoll, players, owners: Array(TILES.length).fill(null), levels: Array(TILES.length).fill(0),
    mortgaged: [], pending: null, trade: null, dice: [4], cfg: { mode: 'standard', trafficFine: fine, passStart },
    ride: ride ? { player: 'me', from: pos, to: next[pos], fare: fares[pos] } : null,
  };
  const afford = ride && cash >= fares[pos];
  const options = ride
    ? { roll: extraRoll, endTurn: !extraRoll, ride: afford ? { to: next[pos], fare: fares[pos] } : null, upgrade }
    : { roll: true, payTraffic: cash >= fine ? fine : false, useChai: chai > 0 };
  return { me: 'me', view, display: { ...view }, options, busy: false, rolling: false, log: [], chat: [], connection: 'open', sendChat() {}, dispatch() {} };
}
const decide = (s) => decisionOf(s, buildActionSpec(s));

describe('pure helpers', () => {
  it('vehicle, route label, cash after and the engine reasons', () => {
    expect(vehicleOf(TILES[5])).toBe('auto');
    expect(vehicleOf(TILES[14])).toBe('metro');
    expect(vehicleOf(TILES[23])).toBe('mmts');
    expect(routeLabel(TILES[14], TILES[23])).toBe('Metro Interchange → MMTS Express');
    expect(cashAfter(1115000, 35000)).toBe(1080000);
    expect(cashAfter(10, 35000)).toBe(0);
    expect(fareReason(100000, 35000)).toBe('');
    expect(fareReason(20000, 35000)).toBe('The fare is ₹35,000. You need ₹15,000 more.');
    expect(fareReason(20000, 25000, 'fine')).toContain('Getting out costs ₹25,000');
  });

  it('every theme reads at AA with its ink on both ends of the band', () => {
    for (const [k, t] of Object.entries(THEMES)) {
      expect(contrastRatio(t.from, t.ink), `${k} from`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.to, t.ink), `${k} to`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('Esc hides, Enter presses the primary unless a button has focus; a hidden decision brings back a reopen pill', () => {
    expect(decisionKeyAction({ key: 'Escape' })).toBe('dismiss');
    expect(decisionKeyAction({ key: 'Enter' })).toBe('primary');
    expect(decisionKeyAction({ key: 'Enter' }, { isButton: true })).toBeNull();
    expect(decisionKeyAction({ key: 'Enter' }, { canPrimary: false })).toBeNull();
    expect(decisionKeyAction({ key: 'Enter', repeat: true })).toBeNull();
    expect(decisionKeyAction({ key: 'a' })).toBeNull();
    const d = decide(sess());
    expect(isCardShown(d, '')).toBe(true);
    expect(isCardShown(d, d.key)).toBe(false); // Esc: hidden, but the decision itself stays
    expect(isCardShown(d, 'ride:5:1:1')).toBe(true); // another stop / turn shows again
    expect(isCardShown(null, '')).toBe(false);
    expect(reopenOf(d, '')).toBeNull();
    expect(reopenOf(d, d.key)).toMatchObject({ label: 'Ride or stay?', icon: 'swap' });
    expect(decisionCardOpen()).toBe(false); // no document in node
  });
});

describe('which decision shows', () => {
  it('the ride offer on a transport stop, for me only, once nothing is animating', () => {
    expect(decide(sess())).toMatchObject({ kind: 'ride', vehicle: 'metro' });
    expect(decide(sess({ pos: 5 }))).toMatchObject({ kind: 'ride', vehicle: 'auto' });
    expect(decide(sess({ pos: 23 }))).toMatchObject({ kind: 'ride', vehicle: 'mmts' });
    expect(decide(sess({ turn: 1 }))).toBeNull(); // someone else's turn
    const busy = sess();
    busy.busy = true;
    expect(decide(busy)).toBeNull();
    const none = sess();
    none.view.ride = null;
    none.options.ride = null;
    expect(decide(none)).toBeNull();
    const snatch = sess();
    snatch.view.phase = 'snatch';
    snatch.options = { snatch: { tile: 3, ms: 5000 } };
    expect(decide(snatch)).toBeNull();
  });

  it('the Traffic Jam choices while stuck, never for a free jam without chai', () => {
    expect(decide(sess({ kind: 'traffic' }))).toMatchObject({ kind: 'traffic' });
    expect(decide(sess({ kind: 'traffic', turn: 1 }))).toBeNull();
    const free = sess({ kind: 'traffic', fine: 0, chai: 0 });
    free.options = { roll: true, payTraffic: false, useChai: false };
    expect(decide(free)).toBeNull();
  });

  it('nothing for the ordinary Roll, buy or end-turn rows', () => {
    const roll = sess({ kind: 'traffic' });
    roll.view.players[0].stuck = false;
    roll.options = { roll: true };
    expect(decide(roll)).toBeNull();
    const buy = sess();
    buy.options = { buy: true, skipBuy: true };
    buy.view.pending = { type: 'buy', tile: 3, price: 70000 };
    expect(decide(buy)).toBeNull();
  });
});

describe('ride decision', () => {
  it('affordable: headline, body, fare, cash left, primary and the Stay action', () => {
    const d = decide(sess());
    expect(d.title).toBe('You landed on Metro Interchange');
    expect(d.body).toBe('Ride the Metro to MMTS Express for ₹35,000?');
    expect(d.route).toBe('Metro Interchange → MMTS Express');
    expect(d).toMatchObject({ fare: 35000, cash: 1115000, left: 1080000, canAfford: true, reason: '' });
    expect(d.primary).toMatchObject({ label: 'Ride · ₹35,000', action: { type: 'RIDE' }, disabled: false });
    expect(d.stay).toMatchObject({ label: 'Stay here', action: { type: 'END_TURN' } });
    expect(d.hint).toContain('MMTS Express');
    expect(d.hint).toContain('finish your turn');
  });

  it('Auto Stand wording, and the MMTS ride says it passes START and pays the salary', () => {
    expect(decide(sess({ pos: 5 })).body).toBe('Take the auto to Metro Interchange for ₹25,000?');
    const m = decide(sess({ pos: 23 }));
    expect(m.body).toBe('Ride the MMTS to Auto Stand for ₹45,000?');
    expect(m.salary).toBe(200000);
    expect(m.hint).toContain('pass START and collect ₹2,00,000');
    expect(decide(sess({ pos: 14 })).salary).toBe(0);
    expect(decide(sess({ pos: 23, passStart: 0 })).hint).not.toContain('START');
  });

  it('unaffordable: the primary is disabled with the engine reason', () => {
    const d = decide(sess({ cash: 20000 }));
    expect(d.canAfford).toBe(false);
    expect(d.primary.disabled).toBe(true);
    expect(d.reason).toBe('The fare is ₹35,000. You need ₹15,000 more.');
    expect(d.stay.action).toEqual({ type: 'END_TURN' });
  });

  it('Stay only closes the card after a six (I roll again) or while an upgrade is still possible', () => {
    const six = decide(sess({ extraRoll: true }));
    expect(six.stay.action).toBeNull();
    expect(six.stay.note).toContain('roll again');
    expect(six.hint).toContain('roll again');
    const upg = decide(sess({ upgrade: [{ tile: 1 }] }));
    expect(upg.stay.action).toBeNull();
    expect(upg.stay.note).toContain('Manage your districts');
  });
});

describe('traffic decision', () => {
  it('with chai: chai, pay and wait, chai is the primary', () => {
    const d = decide(sess({ kind: 'traffic' }));
    expect(d.title).toBe('Stuck in Traffic Jam');
    expect(d.choices.map((c) => c.key)).toEqual(['chai', 'pay', 'wait']);
    expect(d.choices.map((c) => c.action.type)).toEqual(['USE_CHAI', 'PAY_TRAFFIC', 'ROLL']);
    expect(d.choices[1].label).toBe('Pay ₹25,000 fine');
    expect(d.choices[2].sub).toBe('You’ll roll again next turn');
    expect(d.primary.key).toBe('chai');
  });

  it('without chai there is no chai option; the fine is the primary', () => {
    const d = decide(sess({ kind: 'traffic', chai: 0 }));
    expect(d.choices.map((c) => c.key)).toEqual(['pay', 'wait']);
    expect(d.primary.key).toBe('pay');
  });

  it('cannot afford the fine: pay is disabled with the reason and waiting is the way out', () => {
    const d = decide(sess({ kind: 'traffic', chai: 0, cash: 5000 }));
    const pay = d.choices.find((c) => c.key === 'pay');
    expect(pay.disabled).toBe(true);
    expect(pay.reason).toContain('Getting out costs ₹25,000');
    expect(d.primary.key).toBe('wait');
  });

  it('uses the room fine', () => {
    expect(decide(sess({ kind: 'traffic', fine: 50000 })).choices[1].label).toBe('Pay ₹50,000 fine');
  });
});

describe('DecisionCard markup', () => {
  const card = (s, extra = {}) => html(h(DecisionCard, { decision: decide(s), fire: () => () => {}, onDismiss() {}, ...extra }));

  it('ride, affordable: dialog, route strip, cash left, two buttons, ride focused', () => {
    const out = card(sess());
    for (const c of ['role="dialog"', 'aria-modal="true"', 'data-decision-card="ride"', 'dcard-route', 'dcard-rider', 'dcard-scrim']) expect(out, c).toContain(c);
    expect(out).toContain('You landed on Metro Interchange');
    expect(out).toContain('Ride the Metro to MMTS Express for ₹35,000?');
    expect(out).toContain('left');
    expect(out).toContain('10,80,000');
    expect(out).toContain('Stay here');
    expect(out).toContain('Ride · ₹35,000');
    expect(out).toContain('aria-label="Metro Interchange → MMTS Express"');
    expect(out).not.toContain('dcard-why');
    expect(out).toMatch(/dcard-go"[^>]*data-autofocus/);
    expect(out).not.toContain('disabled');
  });

  it('ride, unaffordable: ride disabled, reason printed, Stay here takes the focus', () => {
    const out = card(sess({ cash: 20000 }));
    expect(out).toMatch(/dcard-go"[^>]*disabled/);
    expect(out).toContain('The fare is ₹35,000. You need ₹15,000 more.');
    expect(out).toMatch(/dcard-stay"[^>]*data-autofocus/);
    expect(out).toContain('You have <b>₹20,000</b>');
  });

  it('traffic with chai: three options', () => {
    const out = card(sess({ kind: 'traffic' }));
    expect(out).toContain('data-decision-card="traffic"');
    expect(out).toContain('Stuck in Traffic Jam');
    expect(out).toContain('Use chai');
    expect(out).toContain('Pay ₹25,000 fine');
    expect(out).toContain('Wait it out');
    expect(out).toContain('You’ll roll again next turn');
    expect((out.match(/class="dcard-opt /g) || []).length).toBe(3);
    expect(out).toMatch(/dcard-opt is-chai[^>]*data-autofocus/);
  });

  it('traffic without chai: no chai option', () => {
    const out = card(sess({ kind: 'traffic', chai: 0 }));
    expect(out).not.toContain('Use chai');
    expect((out.match(/class="dcard-opt /g) || []).length).toBe(2);
  });

  it('traffic, cannot afford: the pay row is disabled and says why', () => {
    const out = card(sess({ kind: 'traffic', chai: 0, cash: 5000 }));
    expect(out).toMatch(/dcard-opt is-pay[^>]*disabled/);
    expect(out).toContain('Getting out costs');
  });

  it('shows the decision ring only while my clock runs', () => {
    const s = sess();
    expect(card(s)).not.toContain('dcard-ring');
    s.clock = { deadline: Date.now() + 30000, waitingFor: ['me'] };
    expect(card(s, { session: s })).toContain('dcard-ring');
    s.clock = { deadline: Date.now() + 30000, waitingFor: ['rav'] };
    expect(card(s, { session: s })).not.toContain('dcard-ring');
  });

  it('renders nothing without a decision', () => {
    expect(html(h(DecisionCard, { decision: null }))).toBe('');
  });
});

describe('PhoneTable mounts the card', () => {
  const table = (s) => html(h(PhoneTable, { session: s, actions: { spec: buildActionSpec(s), fire: () => () => {} }, badges: {} }));

  it('the ride card is up automatically on a transport stop, and the duplicate ride pill is out of the row', () => {
    const out = table(sess());
    expect(out).toContain('data-decision-card="ride"');
    expect(out).not.toContain('pa-pill is-ride');
    expect(out).not.toContain('is-reopen');
  });

  it('the traffic card is up for a stuck player, not for somebody else', () => {
    expect(table(sess({ kind: 'traffic' }))).toContain('data-decision-card="traffic"');
    expect(table(sess({ kind: 'traffic', turn: 1 }))).not.toContain('data-decision-card');
  });

  it('no card on an ordinary turn', () => {
    const s = sess({ kind: 'traffic' });
    s.view.players[0].stuck = false;
    s.options = { roll: true };
    expect(table(s)).not.toContain('data-decision-card');
  });
});
