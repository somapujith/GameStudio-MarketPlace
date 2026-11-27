// Rupees. `ctx.economy` is the only way money moves: fares and tips `add`, the workshop and the pump `spend`.
// Every change is saved to the profile and announced on the event bus as 'wallet' { wallet, delta, reason }.
export function createEconomy(ctx) {
  const p = ctx.profile;
  const session = { earned: 0, spent: 0, fares: 0, tips: 0, workshop: 0 }; // this sitting only (the run API reports these); workshop = the part of `spent` that was shop purchases

  const change = (delta, reason) => {
    p.data.wallet = Math.max(0, Math.round(p.data.wallet + delta));
    p.save();
    ctx.emit('wallet', { wallet: p.data.wallet, delta, reason });
  };

  const economy = {
    get wallet() {
      return p.data.wallet;
    },
    session,
    canAfford: (n) => Number.isFinite(n) && n >= 0 && p.data.wallet >= Math.round(n),
    /** Earn money. `kind`: 'fare' | 'tip' | 'bonus' | 'refund'. Returns the new wallet. */
    add(amount, reason = 'fare', kind = 'fare') {
      const n = Math.round(amount);
      if (!(n > 0)) return p.data.wallet;
      p.data.totalEarned += kind === 'refund' ? 0 : n;
      if (kind !== 'refund') {
        session.earned += n;
        if (kind === 'fare') session.fares += n;
        if (kind === 'tip') session.tips += n;
        if (kind === 'fare') p.data.bestFare = Math.max(p.data.bestFare, n); // a tip or a quest bonus is not a fare
      }
      change(n, reason);
      return p.data.wallet;
    },
    /** Spend money; false (and nothing changes) when the player cannot afford it. */
    spend(amount, reason = 'purchase') {
      const n = Math.round(amount);
      if (!Number.isFinite(n) || n < 0 || p.data.wallet < n) return false;
      if (n === 0) return true;
      session.spent += n;
      if (reason === 'workshop') session.workshop += n;
      change(-n, reason);
      return true;
    },
  };
  return economy;
}
