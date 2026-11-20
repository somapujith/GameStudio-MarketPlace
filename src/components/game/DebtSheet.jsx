// Debt phase: you owe more cash than you hold. The sheet shows the shortfall, a suggested way to cover it (sell
// upgrades first, then mortgage), every sell / mortgage option from session.options, then Pay, or declare
// bankruptcy. Not dismissible. Opens by itself for the debtor only.
import '@/styles/sheets.css';
import { useEffect, useRef, useState } from 'react';
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { wordsOf } from '@/lib/mapWords.js';
import Sheet from './ui/Sheet.jsx';
import Button from './ui/Button.jsx';
import Icon from './ui/Icon.jsx';
import Money from './ui/Money.jsx';
import ConfirmDialog from './ui/ConfirmDialog.jsx';
import PlayerToken from './ui/PlayerToken.jsx';
import { LevelPips } from './ui/TileChip.jsx';
import { levelNameOf, mortgageOf, tileAccent, upgradeCostOf, useHeld, useStateLike } from './ui/helpers.js';
import { bankruptcyText } from './ui/bankruptcy.js';

export const DEBT_REASONS = {
  rent: 'Rent', tax: 'Municipal charges', card: 'Card payment', fare: 'Fare', traffic: 'Traffic fine', event: 'City event',
  other: 'Payment',
};

/**
 * Cheapest-feeling way to raise `shortfall`: sell upgrades first (the district keeps earning), then mortgage.
 * Within a kind: the smallest single option that covers what is left, else the biggest one, repeated.
 * -> { picks: [{ kind:'sell'|'mortgage', tile, value }], covered, enough }
 */
export function debtPlan(shortfall, sells = [], mortgages = []) {
  const picks = [];
  let left = Math.max(0, shortfall);
  const pools = [
    sells.map((s) => ({ kind: 'sell', tile: s.tile, value: s.refund ?? Math.round(upgradeCostOf(TILES[s.tile]) / 2) })),
    mortgages.map((m) => ({ kind: 'mortgage', tile: m.tile, value: m.value ?? mortgageOf(TILES[m.tile]) })),
  ];
  for (const pool of pools) {
    const rest = [...pool];
    while (left > 0 && rest.length) {
      rest.sort((a, b) => a.value - b.value);
      const fit = rest.find((x) => x.value >= left);
      const pick = fit || rest[rest.length - 1];
      rest.splice(rest.indexOf(pick), 1);
      picks.push(pick);
      left -= pick.value;
    }
  }
  const covered = picks.reduce((n, p) => n + p.value, 0);
  return { picks, covered, enough: left <= 0 };
}

export default function DebtSheet({ session }) {
  const { view, options: o, me, busy } = session;
  const state = useStateLike(session);
  const debt = view?.debt && view.debt.player === me ? view.debt : null;
  const inDebt = view?.phase === 'debt' && !!debt;
  const [latched, setLatched] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const lists = useRef({ mortgage: [], sell: [] });

  useEffect(() => {
    if (!inDebt) { setLatched(false); setConfirm(false); } else if (o?.debt) setLatched(true);
  }, [inDebt, o?.debt]);

  if (inDebt && o?.debt) lists.current = { mortgage: o.mortgage || [], sell: o.sellBuilding || [] };
  const open = inDebt && (!!o?.debt || latched);

  const heldAmount = useHeld(debt ? debt.amount : null) ?? 0;
  const heldCreditor = useHeld(debt ? debt.creditor ?? '__bank__' : null);
  const heldReason = useHeld(debt ? debt.reason ?? 'other' : null) ?? 'other';
  const creditorId = heldCreditor === '__bank__' ? null : heldCreditor;
  const creditor = creditorId ? state.players.find((p) => p.id === creditorId) : null;
  const mine = view?.players?.find((p) => p.id === me);
  const cash = mine?.cash ?? 0;
  const shortfall = Math.max(0, heldAmount - cash);
  const canPay = !busy && cash >= heldAmount;
  const mortgages = lists.current.mortgage;
  const sells = lists.current.sell;
  const raisable = mortgages.reduce((n, m) => n + (m.value ?? 0), 0) + sells.reduce((n, s) => n + (s.refund ?? 0), 0);
  const pct = heldAmount > 0 ? Math.min(100, Math.round((cash / heldAmount) * 100)) : 100;
  const plan = debtPlan(shortfall, sells, mortgages);
  const suggested = new Set(plan.picks.map((p) => `${p.kind}:${p.tile}`));
  // the exact rule for THIS debt: the bank takes everything, the creditor is paid only what is owed (up to the assets' worth)
  const bankruptRule = inDebt ? bankruptcyText(view, me) : '';

  const row = (tileId, kind, label, value, onClick) => {
    const tile = TILES[tileId];
    if (!tile) return null;
    const { color } = tileAccent(tile);
    const level = state.levels?.[tileId] || 0;
    const tip = suggested.has(`${kind}:${tileId}`);
    return (
      <li key={`${kind}${tileId}`} className={`hg-debt-row${tip ? ' is-suggested' : ''}`} style={{ '--tc': color }}>
        <span className="hg-debt-tile">
          <i className="hg-tilechip-dot" />
          <span>
            <b>{tile.name}</b>
            <small>
              {tile.type === 'property'
                ? <><LevelPips level={level} color={color} tile={tile} /> {kind === 'sell' ? `${levelNameOf(tile, level)} to ${levelNameOf(tile, level - 1)}` : levelNameOf(tile, level)}</>
                : `Price ${formatINR(tile.price)}`}
              {tip ? <em className="hg-debt-tip">Suggested</em> : null}
            </small>
          </span>
        </span>
        <Button variant={tip ? 'gold' : 'dark'} size="sm" disabled={busy} onClick={onClick}>{label} +{formatINR(value)}</Button>
      </li>
    );
  };

  return (
    <>
      <Sheet
        open={open}
        dismissible={false}
        onClose={() => {}}
        ariaLabel="You owe money"
        className="hg-debt"
        desktop="modal"
        header={(
          <div className="hg-debt-band" data-drag="">
            <span className="hg-debt-ico"><Icon name="warn" size={30} /></span>
            <div>
              <p className="hg-kicker">{(heldReason === 'tax' && !wordsOf().isDefault ? wordsOf().municipalCorner : DEBT_REASONS[heldReason]) || DEBT_REASONS.other} due</p>
              <h2>You owe {formatINR(heldAmount)}</h2>
              <p className="hg-debt-to">
                to {creditor ? (
                  <span className="hg-debt-who"><PlayerToken player={creditor} size={20} />{creditor.name}</span>
                ) : (
                  <span className="hg-debt-who"><Icon name="bank" size={16} /> the bank</span>
                )}
              </p>
            </div>
          </div>
        )}
        footer={(
          <>
            {bankruptRule ? <p className="hg-hint is-warn hg-debt-rule"><Icon name="warn" size={14} /> <span>{bankruptRule}</span></p> : null}
            <div className="hg-debt-actions">
              <Button variant="rose" size="sm" onClick={() => setConfirm(true)} disabled={busy}>Declare bankruptcy</Button>
              <Button variant="gold" size="lg" disabled={!canPay} onClick={() => session.dispatch({ type: 'PAY_DEBT' })}>
                Pay {formatINR(heldAmount)}
              </Button>
            </div>
          </>
        )}
      >
        <div className="hg-debt-meter" role="group" aria-label="Cash against debt">
          <div className="hg-debt-nums">
            <span>Your cash <b><Money value={cash} /></b></span>
            <span className={`hg-debt-short ${shortfall > 0 ? 'is-bad' : 'is-good'}`}>
              {shortfall > 0 ? <>Short by <b><Money value={shortfall} /></b></> : <><Icon name="check" size={16} /> Covered</>}
            </span>
          </div>
          <div className="hg-debt-bar" role="progressbar" aria-valuemin={0} aria-valuemax={heldAmount} aria-valuenow={Math.min(cash, heldAmount)}>
            <i style={{ '--f': (Math.max(0, Math.min(100, Number(pct) || 0)) / 100).toFixed(3) }} className={shortfall > 0 ? '' : 'is-ok'} />
          </div>
          {shortfall > 0 ? (
            plan.enough ? (
              <p className="hg-debt-plan">
                <Icon name="info" size={14} />
                <span>
                  To cover it: {plan.picks.map((p, i) => (
                    <span key={`${p.kind}${p.tile}`}>
                      {i ? ', ' : ''}{p.kind === 'sell' ? `sell the ${levelNameOf(TILES[p.tile], (state.levels?.[p.tile] || 0))} on` : 'mortgage'} <b>{TILES[p.tile]?.name}</b>
                    </span>
                  ))} (raises {formatINR(plan.covered)}).
                </span>
              </p>
            ) : (
              <p className="hg-hint is-warn">
                <Icon name="warn" size={14} />
                <span>Everything you can sell or mortgage raises {formatINR(raisable)}: not enough to cover {formatINR(shortfall)}.</span>
              </p>
            )
          ) : (
            <p className="hg-hint is-ok"><Icon name="check" size={14} /> <span>You can pay now, or keep raising cash first.</span></p>
          )}
        </div>

        {sells.length ? (
          <>
            <h3 className="hg-h3">Sell an upgrade <small>(half its cost back, the district keeps earning)</small></h3>
            <ul className="hg-debt-list">
              {sells.map((s) => row(s.tile, 'sell', 'Sell', s.refund ?? Math.round(upgradeCostOf(TILES[s.tile]) / 2), () => session.dispatch({ type: 'SELL_BUILDING', tile: s.tile })))}
            </ul>
          </>
        ) : null}

        {mortgages.length ? (
          <>
            <h3 className="hg-h3">Mortgage a district <small>(keep it, but it earns no rent)</small></h3>
            <ul className="hg-debt-list">
              {mortgages.map((m) => row(m.tile, 'mortgage', 'Mortgage', m.value ?? mortgageOf(TILES[m.tile]), () => session.dispatch({ type: 'MORTGAGE', tile: m.tile })))}
            </ul>
          </>
        ) : null}

        {!mortgages.length && !sells.length ? (
          <p className="hg-empty">Nothing left to sell or mortgage.</p>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirm && open}
        title="Declare bankruptcy?"
        text={`${inDebt ? bankruptcyText(view, me, { sure: true }) : 'You are leaving the game: the bank takes ALL your cash and districts.'} Your districts go back to the bank, free for anyone to buy. This cannot be undone.`}
        confirmLabel="Declare bankruptcy"
        cancelLabel="Keep hustling"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); session.dispatch({ type: 'RESIGN' }); }}
      />
    </>
  );
}
