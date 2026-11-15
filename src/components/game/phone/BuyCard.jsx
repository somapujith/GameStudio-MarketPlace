// The purchase decision as a popup card in the middle of the board (inside the board frame, a scrim behind it):
//   [ district name on the collection colour ]
//   Price | Rent | Mortgage value
//   the three businesses (Stall / Shop / Trading Hub ...) as little buildings with the rent each one pays
//   "Each upgrade costs ₹X"      "Pass and it goes to a sealed auction"
//   [ PASS ]   [ BUY ₹70,000 ]
// It only appears for MY decision (spec.kind 'buy', or 'skip' when I cannot afford it: BUY is then disabled with the reason).
// Focus stays inside the card; Esc / a tap on the scrim only HIDES it (the decision stays pending: the bottom button still
// reads BUY, and the tile chip in the middle brings the card back).
import { useEffect, useId, useRef } from 'react';
import { formatINR, compactINR } from '@shared/format.js';
import { BuildingArt } from '@/components/art/index.js';
import { mixHex } from '../PropertySheet.jsx';
import { sfx } from '@/lib/sfx.js';
import { useClock } from '../turn/clock.js';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** "24s" in the corner of the card and a slim bar draining along its foot, only while MY clock runs (red at the warning). */
function Countdown({ session }) {
  const info = useClock(session);
  if (!info || !info.mine) return null;
  return (
    <>
      <span className={`bcard-count${info.warn ? ' is-warn' : ''}`} role="timer" aria-label="Time left to decide">{info.secs}s</span>
      <span className={`bcard-bar${info.warn ? ' is-warn' : ''}`} aria-hidden="true"><i style={{ transform: `scaleX(${info.frac})` }} /></span>
    </>
  );
}

export default function BuyCard({ data, session = null, onBuy, onPass, onDismiss }) {
  const ref = useRef(null);
  const titleId = useId();

  /* focus: into the card on open (the safest button), back to where it was on close; Tab stays inside */
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const prev = document.activeElement;
    (el.querySelector('[data-autofocus]') || el).focus({ preventScroll: true });
    return () => { if (prev && prev.isConnected && prev !== document.body) prev.focus?.({ preventScroll: true }); };
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDismiss?.();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = [...ref.current.querySelectorAll(FOCUSABLE)];
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };

  if (!data) return null;
  const t = data.tones;
  const slab = mixHex(data.color, '#241a5c', 0.5);
  const click = (fn) => () => { try { sfx.play('click'); } catch { /* optional */ } fn?.(); };

  return (
    <div className="bcard-root" onKeyDown={onKeyDown}>
      <div className="bcard-scrim" onClick={onDismiss} aria-hidden="true" />
      <section
        ref={ref}
        className="bcard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ '--band': t.from, '--band2': t.to, '--bink': t.ink, '--bpill': t.pill }}
      >
        <header className="bcard-head">
          <small>{data.collection}</small>
          <h2 id={titleId}>{data.name}</h2>
          {session ? <Countdown session={session} /> : null}
        </header>

        <dl className="bcard-stats">
          <div><dt>Price</dt><dd>{formatINR(data.price)}</dd></div>
          <div><dt>Rent</dt><dd>{formatINR(data.rent)}</dd></div>
          <div><dt>Mortgage</dt><dd>{formatINR(data.mortgage)}</dd></div>
        </dl>

        <ul className="bcard-levels" aria-label="Rent by business">
          {data.levels.map((l) => (
            <li key={l.level} aria-label={`${l.name}: rent ${formatINR(l.rent)}`} style={{ '--i': l.level }}>
              <span className="bcard-levels__art" aria-hidden="true">
                <BuildingArt theme={data.theme} group={data.group} level={l.level} color={data.color} size={56} slab={slab} />
              </span>
              <b>{compactINR(l.rent)}</b>
              <small>{l.name}</small>
            </li>
          ))}
        </ul>

        <p className="bcard-cost">Each upgrade costs <b>{formatINR(data.upgradeCost)}</b></p>
        <p className="bcard-note">{data.passNote}</p>

        {data.canBuy && data.cash != null ? (
          <p className="bcard-afford">You can afford it · <b>{formatINR(data.left)}</b> left after buying</p>
        ) : null}

        <div className="bcard-actions">
          <button type="button" className="bcard-btn bcard-pass" onClick={click(onPass)}>PASS</button>
          <button type="button" className="bcard-btn bcard-buy" onClick={click(onBuy)} disabled={!data.canBuy} data-autofocus={data.canBuy ? '' : undefined}>
            BUY<span> {formatINR(data.price)}</span>
          </button>
        </div>
        {!data.canBuy ? <p className="bcard-why" role="status">{data.reason} to buy this</p> : null}
      </section>
    </div>
  );
}
