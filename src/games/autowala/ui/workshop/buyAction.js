// What the garage's big button and the purchase note say, as pure functions (tested in buyAction.test.js). `status` is rowStatus() from
// gameplay/workshop/menuModel.js, `res` is what ctx.workshop.buy() returned.
import { fmtRs } from '../../gameplay/workshop/shop.js';

const nb = (s) => String(s).replace(/ /g, ' '); // "Rs 140" never breaks between the unit and the number

/**
 * The button under the list for the highlighted row, or null when no row is highlighted.
 * -> { label, price, off, poor }   off: nothing to do (installed / maxed)   poor: the wallet cannot cover it (still pressable: the press says why)
 */
export function buyAction(row, status, wallet) {
  if (!row || !status) return null;
  if (status.price > 0 && status.can === false) {
    return { label: 'Need more', price: `${fmtRs(status.price - wallet)} short`, off: false, poor: true };
  }
  const label = row.type === 'input' ? 'Apply' : status.tone === 'installed' ? (row.type === 'toggle' ? 'Take off' : 'Installed') : status.tone === 'max' ? 'Maxed' : row.type === 'upgrade' ? 'Fit next level' : 'Install';
  const price = status.tone === 'price' || status.tone === 'locked' ? status.label : status.tone === 'owned' ? 'Owned' : '';
  return { label, price, off: status.tone === 'max' || (status.tone === 'installed' && row.type !== 'toggle'), poor: false };
}

/** The note shown in the foot after a buy attempt: { tone: 'good' | 'info' | 'bad', text }. `wasOn`: the row was a toggle that was fitted. */
export function purchaseNote(res, row, wasOn = false) {
  if (!res) return null;
  if (res.ok) {
    if (res.already) return { tone: 'info', text: 'Already fitted' };
    if (wasOn) return { tone: 'good', text: `Took off ${row?.name ?? 'it'}` };
    return { tone: 'good', text: `${res.price > 0 ? 'Installed' : 'Fitted'} ${res.name}${res.price > 0 ? `  -${nb(fmtRs(res.price))}` : ''}` };
  }
  if (res.code === 'funds') return { tone: 'bad', text: res.short > 0 ? `Not enough rupees: ${nb(fmtRs(res.short))} short` : 'Not enough rupees' };
  return { tone: 'bad', text: res.reason || 'That did not work' };
}
