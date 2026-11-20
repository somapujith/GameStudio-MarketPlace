// The guided tour: a dimmed screen with one spotlight and one card at a time (Next / Back / Skip, progress, keyboard).
//
//   <Tour tourId="game" steps={[{ id, target: '[data-tour="roll"]', title, body, placement?, phone?, when?, padding?, interactive? }]}
//         open onClose={(reason) => ...} onFinish={() => ...} />
//
// Extra (optional) props: `phone` (boolean, default: viewport narrower than 600px) picks the `phone` overrides of each step,
// `paused` hides the overlay but keeps the place (the caller shows <TourPausedPill>), `onStep(step, index)` is told of each
// step, `labels` replaces the button texts. Steps whose target is missing / hidden or whose `when()` is false are skipped.
// The dim layer is ONE svg path with a rounded hole (cheap in software rendering: no filters, no blur, no box-shadow);
// geometry is re-measured once per frame with a cheap equality check and only changes re-render. Motion is transform + opacity.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { holdShortcuts } from '@/components/game/ui/Sheet.jsx';
import { useSettings } from '@/lib/storage.js';
import {
  applyLayout, measure, nextIndex, padRect, placeCard, prevIndex, progressOf, resolveStep, sameRect, spotlightPath,
} from './tourModel.js';
import '@/styles/tour.css';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const MISS_FRAMES = 24; // ~0.4 s without the target before the step is skipped
const DEFAULT_LABELS = { next: 'Next', back: 'Back', skip: 'Skip tour', done: 'Done', step: (n, t) => `Step ${n} of ${t}` };

const stop = (e) => e.stopPropagation();

function viewportNow() {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  const de = document.documentElement;
  return { width: Math.round(de.clientWidth || window.innerWidth), height: Math.round(window.innerHeight || de.clientHeight) };
}

/** Reduced motion in every form the app knows: OS preference, the Settings switch, `:root[data-motion='reduced']`. */
function useTourReducedMotion() {
  const [settings] = useSettings();
  const [sys, setSys] = useState(() => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  useEffect(() => {
    let m;
    try { m = window.matchMedia?.('(prefers-reduced-motion: reduce)'); } catch { m = null; }
    if (!m) return undefined;
    const on = () => setSys(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  const root = typeof document !== 'undefined' && document.documentElement?.dataset?.motion === 'reduced';
  return !!(sys || settings?.reducedMotion || root);
}

export function Tour(props) {
  if (typeof document === 'undefined' || !props.open || !Array.isArray(props.steps)) return null;
  return createPortal(<TourLayer {...props} />, document.body);
}

export function TourLayer({
  tourId, steps, onClose, onFinish, onStep, phone, paused = false, labels,
}) {
  const L = { ...DEFAULT_LABELS, ...(labels || {}) };
  const rm = useTourReducedMotion();
  const [vp, setVp] = useState(viewportNow);
  const isPhone = phone ?? vp.width < 600;
  const opts = useMemo(() => ({ phone: !!isPhone }), [isPhone]);
  const ok = useCallback((s) => !!resolveStep(s, opts), [opts]);
  const [index, setIndex] = useState(() => nextIndex(steps, -1, ok));
  const [rect, setRect] = useState(null); // the target's rect now (null: centred card)
  const [card, setCard] = useState({ w: 340, h: 220 });
  const [prog, setProg] = useState(() => progressOf(steps, index, ok));
  const rectRef = useRef(null);
  const cardRef = useRef(null);
  const nextRef = useRef(null);
  const rootRef = useRef(null);
  const live = useRef({ steps, onClose, onFinish, onStep, opts, ok, index });
  live.current = { steps, onClose, onFinish, onStep, opts, ok, index };
  const uid = useId();
  const titleId = `${uid}-t`;
  const bodyId = `${uid}-b`;

  const step = index >= 0 ? applyLayout(steps[index], isPhone) : null;
  const interactive = !!step?.interactive;

  /* nothing can be shown on this screen: close quietly (not remembered) */
  useEffect(() => { if (index < 0) onClose?.('empty'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((i) => {
    rectRef.current = null;
    setRect(null);
    setIndex(i);
    setProg(progressOf(live.current.steps, i, live.current.ok));
  }, []);
  const advance = useCallback(() => {
    const { steps: ss, index: at, ok: isOk, onFinish: fin } = live.current;
    const n = nextIndex(ss, at, isOk);
    if (n < 0) fin?.(); else go(n);
  }, [go]);
  const retreat = useCallback(() => {
    const { steps: ss, index: at, ok: isOk } = live.current;
    const p = prevIndex(ss, at, isOk);
    if (p >= 0) go(p);
  }, [go]);
  const skip = useCallback(() => live.current.onClose?.('skip'), []);

  /* tell the caller which step is up */
  useEffect(() => {
    if (index >= 0) live.current.onStep?.(steps[index], index);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  /* viewport changes: resize, orientation, the on-screen keyboard / browser bars */
  useEffect(() => {
    const on = () => setVp((v) => {
      const n = viewportNow();
      return n.width === v.width && n.height === v.height ? v : n;
    });
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, []);

  /* follow the target: one rAF loop, one getBoundingClientRect per frame, a state update only when the rect changed */
  useEffect(() => {
    if (paused || index < 0) return undefined;
    let raf = 0;
    let alive = true;
    let miss = 0;
    let frame = 0;
    let scrolled = false;
    const tick = () => {
      if (!alive) return;
      frame += 1;
      const { steps: ss, index: at, opts: o, ok: isOk } = live.current;
      const r = resolveStep(ss[at], o);
      if (!r) {
        miss += 1;
        if (miss > MISS_FRAMES) { advance(); return; }
      } else {
        miss = 0;
        let next = null;
        if (r.el) {
          let m = measure(r.el);
          if (!scrolled) {
            scrolled = true;
            const v = viewportNow();
            if (m.y < 0 || m.x < 0 || m.y + m.h > v.height || m.x + m.w > v.width) {
              try { r.el.scrollIntoView({ block: 'center', inline: 'nearest' }); m = measure(r.el); } catch { /* keep the rect */ }
            }
          }
          next = m;
        }
        if (!sameRect(rectRef.current, next)) { rectRef.current = next; setRect(next); }
      }
      if (frame % 30 === 0) {
        const p = progressOf(ss, at, isOk);
        setProg((q) => (q.pos === p.pos && q.total === p.total ? q : p));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [paused, index, advance, vp.width, vp.height]);

  /* a scroll anywhere (capture: nested scrollers too) re-measures at once */
  useEffect(() => {
    if (paused) return undefined;
    const on = () => {
      const { steps: ss, index: at, opts: o } = live.current;
      const r = ss[at] && resolveStep(ss[at], o);
      if (r?.el) {
        const m = measure(r.el);
        if (!sameRect(rectRef.current, m)) { rectRef.current = m; setRect(m); }
      }
    };
    window.addEventListener('scroll', on, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', on, true);
  }, [paused]);

  /* the card's own size */
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const read = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setCard((c) => (c.w === w && c.h === h ? c : { w, h }));
    };
    read();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [paused, index, vp.width]);

  /* modal behaviour: the table's Space / Enter / S shortcuts stand down; focus goes in, is kept in, and comes back */
  useEffect(() => {
    if (paused) return undefined;
    const release = holdShortcuts(rootRef.current || document.body);
    const prev = document.activeElement;
    nextRef.current?.focus({ preventScroll: true });
    const onFocusIn = (e) => {
      const c = cardRef.current;
      if (!c || c.contains(e.target)) return;
      if (live.current.steps[live.current.index]?.interactive) return; // the player is meant to use the spotlighted control
      nextRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      release();
      document.removeEventListener('focusin', onFocusIn);
      if (prev && prev !== document.body && prev.isConnected) { try { prev.focus({ preventScroll: true }); } catch { /* ignore */ } }
    };
  }, [paused]);

  useEffect(() => {
    if (paused) return undefined;
    const onKey = (e) => {
      const c = cardRef.current;
      const onButton = !!c && c.contains(e.target) && e.target.tagName === 'BUTTON';
      e.stopPropagation(); // nothing else on the page hears a key while the tour is up
      if (e.key === 'Escape') { e.preventDefault(); skip(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); advance(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); retreat(); return; }
      if ((e.key === 'Enter') && !onButton) { e.preventDefault(); advance(); return; }
      if (e.key === 'Tab' && c) {
        const items = [...c.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const a = document.activeElement;
        if (e.shiftKey && (a === first || !c.contains(a))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (a === last || !c.contains(a))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [paused, advance, retreat, skip]);

  if (paused || index < 0 || !step) return null;

  const pad = Number.isFinite(step.padding) ? step.padding : 8;
  const hole = rect ? padRect(rect, pad) : null;
  const geo = placeCard(hole, card, vp, hole ? step.placement : 'center');
  const last = nextIndex(steps, index, ok) < 0;
  const hasPrev = prevIndex(steps, index, ok) >= 0;
  const total = Math.max(prog.total, 1);
  const pos = Math.min(prog.pos, total - 1);
  const dots = total <= 10;
  const bodyText = typeof step.body === 'string' ? step.body : '';

  return (
    <div
      ref={rootRef}
      className="tour-root"
      data-tour-id={tourId}
      data-rm={rm ? '' : undefined}
      data-center={hole ? undefined : ''}
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stop}
    >
      <svg className="tour-dim" viewBox={`0 0 ${vp.width} ${vp.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d={spotlightPath(hole, vp)} fillRule="evenodd" />
      </svg>
      {hole ? (
        <>
          <div
            className="tour-ring"
            key={`ring-${index}`}
            style={{ width: hole.w, height: hole.h, transform: `translate3d(${hole.x}px, ${hole.y}px, 0)` }}
            aria-hidden="true"
          />
          {interactive ? null : (
            <div className="tour-block" style={{ width: hole.w, height: hole.h, transform: `translate3d(${hole.x}px, ${hole.y}px, 0)` }} aria-hidden="true" />
          )}
        </>
      ) : null}
      <p className="tour-sr" aria-live="polite" aria-atomic="true">
        {`${L.step(pos + 1, total)}. ${step.title}. ${bodyText}`}
      </p>
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-placement={geo.placement}
        data-step={step.id}
        style={{ transform: `translate3d(${geo.left}px, ${geo.top}px, 0)`, maxHeight: Math.max(120, vp.height - 24), maxWidth: Math.max(240, vp.width - 24) }}
      >
        <div className="tour-card__in" key={`step-${index}`}>
          <div className="tour-top">
            <span className="tour-count">{L.step(pos + 1, total)}</span>
            <button type="button" className="tour-x" onClick={skip} aria-label={L.skip} title={L.skip}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <h2 id={titleId} className="tour-title">{step.title}</h2>
          <div id={bodyId} className="tour-body">{step.body}</div>
          {step.extra ? <div className="tour-extra">{step.extra}</div> : null}
          <div className={`tour-progress${dots ? ' is-dots' : ' is-bar'}`} aria-hidden="true">
            {dots
              ? Array.from({ length: total }, (_, i) => <i key={i} className={i === pos ? 'is-on' : i < pos ? 'is-done' : ''} />)
              : <b style={{ transform: `scaleX(${(pos + 1) / total})` }} />}
          </div>
          <div className="tour-actions">
            <button type="button" className="tour-btn tour-btn--ghost" onClick={skip}>{L.skip}</button>
            <span className="tour-actions__gap" />
            {hasPrev ? <button type="button" className="tour-btn tour-btn--dark" onClick={retreat}>{L.back}</button> : null}
            <button type="button" className="tour-btn tour-btn--gold" ref={nextRef} onClick={advance} data-autofocus>{last ? L.done : L.next}</button>
          </div>
        </div>
        {geo.arrow ? (
          <i
            className="tour-arrow"
            data-edge={geo.arrow.edge}
            style={geo.arrow.edge === 'top' || geo.arrow.edge === 'bottom' ? { left: geo.arrow.offset } : { top: geo.arrow.offset }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The small "Tour paused" pill shown while the tour is minimised (it is my turn to act, a sheet is open ...). Always on screen
 * and never over the action bar: it sits at the top edge. Render it yourself next to <Tour paused>.
 */
export function TourPausedPill({ onResume, onSkip, canResume = true, text = 'Tour paused', resume = 'Resume', skip = 'End tour' }) {
  const rm = useTourReducedMotion();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="tour-pill" role="status" data-rm={rm ? '' : undefined}>
      <span className="tour-pill__txt">{text}</span>
      <button type="button" className="tour-pill__btn is-main" onClick={canResume ? onResume : undefined} disabled={!canResume}>{resume}</button>
      <button type="button" className="tour-pill__btn" onClick={onSkip} aria-label={skip} title={skip}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>,
    document.body,
  );
}

/** The invite shown once, non-blocking: "New here? Take a quick tour" [Start] [Not now]. Rendered by the caller where it fits. */
export function TourInvite({
  title = 'New here?', text = 'Take a one-minute tour of the table.', start = 'Start tour', later = 'Not now', onStart, onLater, className = '',
}) {
  return (
    <aside className={`tour-invite ${className}`.trim()} aria-label={title}>
      <div className="tour-invite__txt">
        <b>{title}</b>
        <span>{text}</span>
      </div>
      <div className="tour-invite__btns">
        <button type="button" className="tour-btn tour-btn--gold" onClick={onStart}>{start}</button>
        <button type="button" className="tour-btn tour-btn--ghost" onClick={onLater}>{later}</button>
      </div>
    </aside>
  );
}

export default Tour;
