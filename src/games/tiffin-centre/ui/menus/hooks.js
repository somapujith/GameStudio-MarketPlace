// Tiffin Centre menus: small hooks (reduced motion, count-up, dialog focus management).
import { useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function readReduced() {
  try {
    return document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** True when the OS or the hub's own setting (html[data-motion=reduced]) asks for less motion. SSR renders as "motion on". */
export function useMotionReduced() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(readReduced());
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(readReduced());
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Ease a number up from 0 to `target` over `ms` (jumps straight there when `instant`). Returns the rounded value being shown. */
export function useCountUp(target, { ms = 1200, delay = 300, instant = false } = {}) {
  const [v, setV] = useState(instant ? target : 0);
  useEffect(() => {
    if (instant || !(target > 0)) {
      setV(target);
      return undefined;
    }
    let raf = 0;
    let t0 = 0;
    const timer = setTimeout(() => {
      const step = (t) => {
        if (!t0) t0 = t;
        const k = Math.min(1, (t - t0) / ms);
        setV(Math.round(target * (1 - (1 - k) ** 3)));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, ms, delay, instant]);
  return v;
}

/**
 * Modal-ish behaviour for a full-screen menu layer: moves focus in (to [data-autofocus] or the first control), keeps Tab inside,
 * calls onEscape on Esc (and stops it reaching the game), and puts focus back where it was when the layer closes.
 * Call with the root ref and `active` (true while the layer is shown).
 */
export function useDialog(ref, { active = true, onEscape } = {}) {
  const esc = useRef(onEscape);
  esc.current = onEscape;
  useEffect(() => {
    if (!active) return undefined;
    const opener = document.activeElement;
    const root = ref.current;
    const first = root?.querySelector('[data-autofocus]') || root?.querySelector(FOCUSABLE);
    (first || root)?.focus?.({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape' && esc.current) {
        e.preventDefault();
        e.stopPropagation();
        esc.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const nodes = [...ref.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!nodes.length) {
        e.preventDefault();
        return;
      }
      const a = nodes[0];
      const z = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === a || !ref.current.contains(document.activeElement))) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (document.activeElement === z || !ref.current.contains(document.activeElement))) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

/** Arrow-key navigation for a role="radiogroup" (same pattern as the hub's radioKeyNav). */
export function radioKeys(e) {
  if (e.target?.getAttribute?.('role') !== 'radio') return;
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step && e.key !== 'Home' && e.key !== 'End') return;
  const radios = [...e.currentTarget.querySelectorAll('[role="radio"]:not(:disabled)')];
  const cur = radios.indexOf(e.target);
  if (!radios.length || cur < 0) return;
  let next = cur;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = radios.length - 1;
  else next = (cur + step + radios.length) % radios.length;
  e.preventDefault();
  radios[next].focus();
  radios[next].click();
}
