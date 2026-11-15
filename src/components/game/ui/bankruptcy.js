// What going bankrupt (or resigning) does, in words, with the exact numbers of the engine (shared/engine.js
// bankruptcyPayouts / estateValue: the bank takes ALL cash and districts, the creditor is paid ONLY the debt, by the bank,
// up to what the assets were worth). Pure: takes the authoritative `view`.
import { bankruptcyPayouts, estateValue, owedPayments } from '@shared/engine.js';
import { formatINR } from '@shared/format.js';

/** The engine reads owners / levels / mortgaged / players / debt; a thin view (tests, spectators) gets safe blanks. */
function safeState(view) {
  if (!view || !Array.isArray(view.players)) return null;
  return {
    ...view,
    owners: Array.isArray(view.owners) ? view.owners : [],
    levels: Array.isArray(view.levels) ? view.levels : [],
    mortgaged: Array.isArray(view.mortgaged) ? view.mortgaged : [],
  };
}

/**
 * -> { estate, owed, paid, payouts: [{ to, name, amount }], capped, bank }
 *   estate   cash + the bank's mortgage value of every unmortgaged district + the sell-back value of every upgrade
 *   owed     what the player still owes to PEOPLE (not the bank), the sum of their open debts
 *   paid     what the bank would pay those creditors if the player went bankrupt right now
 *   capped   the assets are worth less than the debt: the creditor gets less than they are owed
 *   bank     the player's debt is to the bank (or they owe nothing): nobody is paid
 */
export function bankruptcySummary(view, playerId) {
  const state = safeState(view);
  if (!state || !state.players.some((p) => p.id === playerId)) return { estate: 0, owed: 0, paid: 0, payouts: [], capped: false, bank: true };
  const nameOf = (id) => state.players.find((p) => p.id === id)?.name || 'Another player';
  const payouts = bankruptcyPayouts(state, playerId).map((r) => ({ ...r, name: nameOf(r.to) }));
  const owedList = owedPayments(state, playerId).filter((o) => {
    const c = o.to ? state.players.find((p) => p.id === o.to) : null;
    return c && !c.bankrupt && c.id !== playerId;
  });
  const owed = owedList.reduce((n, o) => n + o.amount, 0);
  const paid = payouts.reduce((n, r) => n + r.amount, 0);
  return { estate: estateValue(state, playerId), owed, paid, payouts, capped: paid < owed, bank: owedList.length === 0 };
}

const list = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '');

/**
 * The plain-words rule for this player, for the debt sheet and the resign dialogs.
 *   "If you go bankrupt, the bank takes ALL your cash and districts. Sana is paid the ₹1,40,000 you owe (up to what your assets are worth)."
 */
export function bankruptcyText(view, playerId, { sure = false } = {}) {
  const s = bankruptcySummary(view, playerId);
  // `sure`: the confirm dialog, after the decision ("You go bankrupt: ..." instead of "If you go bankrupt, ...")
  const head = sure ? 'You are leaving the game: the bank takes ALL your cash and districts.' : 'If you go bankrupt, the bank takes ALL your cash and districts.';
  if (s.bank) return `${head} Nobody else is paid.`;
  if (!s.payouts.length) return `${head} You have nothing left to pay with, so nobody is paid.`;
  const who = list(s.payouts.map((r) => `${r.name} ${s.payouts.length > 1 ? 'is paid ' : ''}${formatINR(r.amount)}`));
  if (s.payouts.length === 1) {
    const r = s.payouts[0];
    return s.capped
      ? `${head} ${r.name} is paid ${formatINR(r.amount)} of the ${formatINR(s.owed)} you owe (up to what your assets are worth).`
      : `${head} ${r.name} is paid the ${formatINR(r.amount)} you owe (up to what your assets are worth).`;
  }
  return `${head} ${who}${s.capped ? ` of the ${formatINR(s.owed)} you owe` : ''} (up to what your assets are worth).`;
}
