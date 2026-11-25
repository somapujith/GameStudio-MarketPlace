// Tiffin Centre: the books of the stall (docs/TIFFIN_CENTRE_PLAN.md section 3b). Pure helpers over the engine state.
//
//   revenue  = the bills collected (sum of customer totals)           money  = revenue + tips   (cash in hand: only ever grows, the HUD's number)
//   tips     = tips, combo bonuses, extras, the inspector's reward
//   cost     = what the stall spent: ingredients (opening stock when it is cooked, prepared / bought stock when it is made),
//              gas cylinders and food-safety fines. Never negative.
//   waste    = the part of `cost` that went in the bin: burnt and discarded dishes, souring batter. waste <= cost.
//   profit   = money - cost                                          STARS and the co-op rank use profit.
//
// Costs are multiples of 0.25 (portion sizes are quarters), so the sums are exact in binary floating point; they are still rounded to 2 places.
import { DISHES, INGREDIENTS } from './catalog.js';

const r2 = (n) => Math.round(n * 100) / 100;

/** Rupees of ingredients in one dish (its `uses` at the unit costs). */
export function dishCost(dishId) {
  const d = DISHES[dishId];
  if (!d || !d.uses) return 0;
  let c = 0;
  for (const item of Object.keys(d.uses)) c += d.uses[item] * INGREDIENTS[item].cost;
  return r2(c);
}

/** Food cost as a fraction of the selling price (a healthy stall: 0.25-0.4). */
export const foodCostFrac = (dishId) => (DISHES[dishId] ? dishCost(dishId) / DISHES[dishId].price : 0);

export const profitOf = (s) => (Number.isFinite(s.money) ? s.money : 0) - (Number.isFinite(s.cost) ? s.cost : 0);

/** Re-derive `profit` after money or cost changed. */
export function book(s) {
  s.profit = r2(profitOf(s));
}

/** Money spent. `waste` = also count it as wasted (a subset of cost). */
export function spend(s, amount, waste = false) {
  if (typeof amount !== 'number' || !(amount > 0) || !Number.isFinite(amount)) return;
  s.cost = r2((s.cost || 0) + amount);
  if (waste) s.waste = r2((s.waste || 0) + amount);
  book(s);
}

/** Part of an earlier spend that went in the bin (burnt dish, discarded dish, sour batter that was already paid for). */
export function wasteOnly(s, amount) {
  if (typeof amount !== 'number' || !(amount > 0) || !Number.isFinite(amount)) return;
  s.waste = r2(Math.min((s.waste || 0) + amount, s.cost || 0));
}

/** A customer paid: revenue (the bill) and tips (everything on top). */
export function earn(s, bill, tip) {
  s.revenue = (s.revenue || 0) + bill;
  s.tips += tip;
  s.money += bill + tip;
  book(s);
}

/** Tips that belong to nobody in particular (the inspector's reward): cash in hand, not a player's `earned`. */
export function bonus(s, amount) {
  s.tips += amount;
  s.money += amount;
  book(s);
}

export const CARRY_SHARE = 0.5; // unused stock that was paid for is half-recovered next morning (it is used again, or sold back)

/** The shift is over: half the value of paid-for stock still on the shelf comes back off the costs (once). */
export function carryOver(s) {
  if (!s.cfg.stock || s.carry) return;
  let credit = 0;
  for (const item of Object.keys(s.stock || {})) credit += (s.stock[item] || 0) * INGREDIENTS[item].cost;
  credit = r2(Math.min(Math.min(s.pre || 0, credit) * CARRY_SHARE, s.cost || 0));
  s.carry = credit;
  s.cost = r2((s.cost || 0) - credit);
  s.waste = r2(Math.min(s.waste || 0, s.cost));
  book(s);
}

/** The numbers every result screen needs, rounded for display. */
export function summary(s) {
  const cost = Math.round(s.cost || 0);
  return {
    revenue: Math.round(s.revenue || 0),
    tips: Math.round(s.tips || 0),
    money: s.money,
    cost,
    waste: Math.round(s.waste || 0),
    fines: Math.round(s.fines || 0),
    carry: Math.round(s.carry || 0),
    profit: s.money - cost,
  };
}
