import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '@/lib/useScrollLock.js';
import { Icon } from './icons.jsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LEAVE_MS = 200; // keep in step with `.hh-modal.is-leaving` in x-shell.css

function motionReduced() {
  try {
    return document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return true;
  }
}

/**
 * Accessible dialog: portal, focus trap, Esc / backdrop to close, scroll lock (iOS-safe), focus restore.
 * Bottom sheet on phones, centred card on desktop. Closing plays a short exit (200 ms, transform + opacity) unless
 * motion is reduced; the dialog stays mounted for that moment but is inert (focus is already restored).
 */
export default function Modal({ open, onClose, title, children, actions, tone = 'default', dismissible = true, className = '' }) {
  const titleId = useId();
  const panel = useRef(null);
  const last = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useScrollLock(open); // iOS-safe, reference counted (src/lib/scrollLock.js)
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return undefined;
    }
    if (!mounted) return undefined;
    if (motionReduced()) {
      setMounted(false);
      return undefined;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return undefined;
    // Record the opener before the portal mounts: a child's native autoFocus runs before passive effects.
    last.current = document.activeElement;
    return () => last.current?.focus?.({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return undefined;
    const first = panel.current?.querySelector('[data-autofocus]') || panel.current?.querySelector(FOCUSABLE);
    (first || panel.current)?.focus?.();

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) {
        e.preventDefault();
        return;
      }
      const a = nodes[0];
      const z = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, mounted, dismissible]);

  if (!mounted) return null;
  return createPortal(
    <div className={`hh-modal${leaving && !open ? ' is-leaving' : ''}`} inert={!open || undefined} onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose?.()}>
      <div ref={panel} className={`hh-modal__panel hh-modal__panel--${tone} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <span className="hh-modal__grip" aria-hidden="true" />
        {dismissible && (
          <button type="button" className="hh-iconbtn hh-modal__close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        )}
        <h2 id={titleId} className="hh-modal__title">
          {title}
        </h2>
        <div className="hh-modal__body">{children}</div>
        {actions && <div className="hh-modal__actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
