// Test-only helper: a hand-built engine state (shape of docs/TIFFIN_CENTRE_PLAN.md section 3) so HUD tests do not need the engine.
export function mkState(over = {}) {
  const slot = (o = {}) => ({ st: 'empty', dish: null, t0: 0, readyAt: 0, burnAt: 0, by: null, ...o });
  const base = {
    v: 1,
    status: 'playing',
    level: 2,
    pace: 'normal',
    tick: 20,
    shiftTicks: 100,
    seed: 1,
    cfg: {
      tutorial: false,
      spots: 4,
      stations: ['tawa1', 'steamer1', 'chai1'],
      menu: ['dosa', 'masala_dosa', 'irani_chai', 'idly'],
      hour: [6, 9.5],
      noPatience: false,
      noPayExpiry: false,
    },
    players: {
      me: { id: 'me', name: 'Me', avatar: null, at: null, hands: [], served: 0, collected: 0, earned: 0, tips: 0 },
      u2: { id: 'u2', name: 'Anu', avatar: null, at: null, hands: [], served: 0, collected: 0, earned: 0, tips: 0 },
    },
    order: ['me', 'u2'],
    stations: {
      tawa1: { id: 'tawa1', kind: 'tawa', slots: [slot(), slot(), slot()] },
      steamer1: { id: 'steamer1', kind: 'steamer', slots: [slot(), slot(), slot(), slot()] },
      chai1: { id: 'chai1', kind: 'chai', slots: [slot(), slot()] },
    },
    customers: [],
    schedule: [],
    nextArrival: 30,
    money: 120,
    tips: 0,
    served: 0,
    lost: 0,
    unpaid: 0,
    combo: 0,
    lives: 5,
    stars: 0,
    emotes: [],
  };
  return { ...base, ...over, cfg: { ...base.cfg, ...(over.cfg || {}) } };
}

export const mkCustomer = (o = {}) => ({
  id: 1,
  name: 'Ravi anna',
  kind: 'office',
  look: 'shirt',
  spot: 0,
  st: 'waiting',
  order: ['dosa'],
  got: [],
  arrivedAt: 0,
  patience: 30,
  patienceMax: 40,
  patienceMaxed: 40,
  eatLeft: 0,
  payLeft: 0,
  total: 40,
  tip: 0,
  outcome: null,
  qs: [],
  leftAt: null,
  ...o,
});

export const mkSlot = (o) => ({ st: 'empty', dish: null, t0: 0, readyAt: 0, burnAt: 0, by: null, ...o });
