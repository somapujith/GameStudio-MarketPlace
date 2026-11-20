// The landing decisions as a popup card over the board, the way the buy popup is for a district:
//   [ icon · "You landed on Metro Interchange"                    24s ]    header band in the vehicle's colours + the decision ring
//   Ride the Metro to MMTS Express for ₹35,000?
//   [ Metro ·····🚇·········· MMTS ]  a little route strip: the vehicle rides the dotted line (transform-only)
//   You'd have ₹1,080,000 left · what happens next
//   [ Stay here ]  [ Ride · ₹35,000 ]
// Traffic Jam: three big rows (Use chai / Pay the fine / Wait it out). It only exists for MY decision (decisionModel.decisionOf).
// Esc / a tap on the scrim only HIDES it: the decision stays pending, the action row shows the same choices, and a pill reopens it.
// Focus stays inside the card; Enter presses the primary choice; the Space / Enter shortcut of the action row stands down while it is open.
//   <DecisionCard decision session fire onDismiss placement='phone'|'board' />
//   useDecisionCard(session, spec) -> { decision, show, hide, reopen: { label, icon, onClick } | null }
import { useEffect, useId, useRef, useState } from 'react';
import { TileIcon } from '@/components/art/index.js';
import { formatINR } from '@shared/format.js';
import { sfx } from '@/lib/sfx.js';
import { buzz } from '@/lib/haptics.js';
import Icon from '../ui/Icon.jsx';
import { hasOpenSheet } from '../ui/Sheet.jsx';
import { useClock } from '../turn/clock.js';
import { TILES } from '@shared/board.js';
import { decisionKeyAction, decisionOf, isCardShown, reopenOf } from './decisionModel.js';
import '@/styles/decision.css';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The decision card's state: the decision (or null), whether it is showing, and how to hide / bring it back. */
export function useDecisionCard(session, spec) {
  const decision = decisionOf(session, spec);
  const [hidden, setHidden] = useState('');
  const show = isCardShown(decision, hidden);
  const pill = reopenOf(decision, hidden);
  return {
    decision,
    show,
    hide: () => { if (decision) setHidden(decision.key); },
    reopen: pill ? { ...pill, onClick: () => setHidden('') } : null,
  };
}

/** "24s" in a ring around it, draining while MY clock runs (red at the warning). */
function Ring({ session }) {
  const info = useClock(session);
  if (!info || !info.mine) return null;
  const R = 15;
  const C = 2 * Math.PI * R;
  return (
    <span className={`dcard-ring${info.warn ? ' is-warn' : ''}`} role="timer" aria-label={`${info.secs} seconds left to decide`}>
      <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <circle className="dcard-ring__bg" cx="18" cy="18" r={R} />
        <circle className="dcard-ring__fg" cx="18" cy="18" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - info.frac)} transform="rotate(-90 18 18)" />
      </svg>
      <b>{info.secs}</b>
    </span>
  );
}

/** from-stop ... vehicle riding a dotted line ... to-stop */
function Route({ d }) {
  const from = TILES[d.from.id];
  const to = TILES[d.to.id];
  return (
    <div className={`dcard-route is-${d.vehicle}`} role="img" aria-label={d.route}>
      <span className="dcard-stop is-from">
        <TileIcon tile={from} size={38} />
        <b>{d.from.short}</b>
      </span>
      <span className="dcard-track" aria-hidden="true">
        <i className="dcard-rider"><TileIcon tile={from} size={28} /></i>
      </span>
      <span className="dcard-stop is-to">
        <TileIcon tile={to} size={38} />
        <b>{d.to.short}</b>
      </span>
    </div>
  );
}

function Glyph({ name }) {
  return name === 'chai' ? <TileIcon tile="chai" size={22} /> : <Icon name={name} size={20} />;
}

export default function DecisionCard({ decision, session = null, fire, onDismiss, placement = 'phone' }) {
  const ref = useRef(null);
  const titleId = useId();
  const bodyId = useId();
  const d = decision;

  /* focus: into the card on open (the primary choice, never while somebody types), back to where it was on close; Tab stays inside */
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const prev = document.activeElement;
    const typing = prev && (prev.tagName === 'INPUT' || prev.tagName === 'TEXTAREA' || prev.isContentEditable);
    if (!typing) (el.querySelector('[data-autofocus]') || el.querySelector(FOCUSABLE) || el).focus({ preventScroll: true });
    return () => { if (prev && prev.isConnected && prev !== document.body) prev.focus?.({ preventScroll: true }); };
  }, []);

  const choose = (choice) => {
    try { sfx.play('click'); } catch { /* sound is optional */ }
    buzz('tap');
    if (choice?.action) fire?.(choice.action)();
    else onDismiss?.();
  };

  const primary = d?.primary;
  const primaryRef = useRef(null);
  primaryRef.current = primary && !primary.disabled ? primary : null;
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  /* Esc / Enter even when focus has drifted out of the card (a sheet on top owns its own keys) */
  useEffect(() => {
    const onKey = (e) => {
      if (hasOpenSheet()) return;
      const t = e.target;
      const isButton = !!t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.getAttribute?.('role') === 'button');
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) return;
      const act = decisionKeyAction(e, { isButton, canPrimary: !!primaryRef.current });
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      if (act === 'dismiss') dismissRef.current?.();
      else chooseRef.current(primaryRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const list = [...ref.current.querySelectorAll(FOCUSABLE)];
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0];
    const last = list[list.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };

  if (!d) return null;
  const t = d.theme;
  const ride = d.kind === 'ride';
  const why = ride ? d.reason : d.choices.map((c) => c.reason).find(Boolean);

  return (
    <div className={`dcard-root is-${placement}`} onKeyDown={onKeyDown}>
      <div className="dcard-scrim" onClick={onDismiss} aria-hidden="true" />
      <section
        ref={ref}
        className={`dcard is-${d.kind} is-${d.vehicle}${ride && !d.canAfford ? ' is-poor' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-decision-card={d.kind}
        tabIndex={-1}
        style={{ '--band': t.from, '--band2': t.to, '--bink': t.ink, '--bpill': t.pill }}
      >
        <header className="dcard-head">
          <span className="dcard-art" aria-hidden="true">
            <TileIcon tile={ride ? TILES[d.from.id] : 'traffic'} size={44} />
          </span>
          <div className="dcard-titles">
            <small>{d.kicker}</small>
            <h2 id={titleId}>{d.title}</h2>
          </div>
          {session ? <Ring session={session} /> : null}
        </header>

        <p id={bodyId} className="dcard-body">{d.body}</p>

        {ride ? (
          <>
            <Route d={d} />
            <p className="dcard-left">
              {d.canAfford
                ? <>You&rsquo;d have <b>{formatINR(d.left)}</b> left</>
                : <>You have <b>{formatINR(d.cash)}</b></>}
              <span className="dcard-fare"> · fare <b>{formatINR(d.fare)}</b></span>
            </p>
            <p className="dcard-hint">{d.hint}</p>
            <div className="dcard-actions">
              <button type="button" className="dcard-btn dcard-stay" onClick={() => choose(d.stay)} data-autofocus={d.canAfford ? undefined : ''}>
                {d.stay.label}
              </button>
              <button
                type="button"
                className="dcard-btn dcard-go"
                onClick={() => choose(d.primary)}
                disabled={d.primary.disabled}
                data-autofocus={d.canAfford ? '' : undefined}
              >
                {d.primary.label}
              </button>
            </div>
            <p className="dcard-note">{d.stay.note}</p>
            {why ? <p className="dcard-why" role="status">{why}</p> : null}
          </>
        ) : (
          <>
            <ul className="dcard-opts" aria-label="Your choices">
              {d.choices.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    className={`dcard-opt is-${c.key} tone-${c.tone}`}
                    onClick={() => choose(c)}
                    disabled={c.disabled}
                    data-autofocus={c.key === d.primary.key ? '' : undefined}
                    aria-label={`${c.label}. ${c.sub}`}
                  >
                    <span className="dcard-opt__ic" aria-hidden="true"><Glyph name={c.icon} /></span>
                    <span className="dcard-opt__txt">
                      <b>{c.label}</b>
                      <small>{c.sub}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {why ? <p className="dcard-why" role="status">{why}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
