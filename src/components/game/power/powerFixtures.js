// Test helpers for the power-card hand (sessions shaped like the game's `session`). Not shipped: only tests import it.
export const P = (id, name, extra = {}) => ({ id, name, color: '#ff4d6d', avatar: 0, piece: 'pearl', cash: 1, pos: 0, stuck: false, bankrupt: false, ...extra });
export const hand = (...cards) => cards.map((c, i) => ({ uid: `c${i + 1}`, exp: 9, ...c }));

export function sessionWith({ hand: h = [], power, round = 7, turn = 0, played = false, cfgOn = true, rivals, me = {}, dispatch = () => {} } = {}) {
  const players = [P('me', 'Nithin', { hand: h, ...me }), ...(rivals || [P('rav', 'Ravi'), P('sana', 'Sana')])];
  const view = { phase: 'roll', round, turn, players, powerPlayed: played, cfg: { powerCards: cfgOn } };
  return { me: 'me', view, display: view, options: power === undefined ? {} : { power }, dispatch };
}
