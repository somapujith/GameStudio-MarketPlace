import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '@/lib/useScrollLock.js';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]';

/**
 * Confirm modal for admin actions. It restates the action (`title`, e.g. "Give 500 coins to Rio?") and any detail
 * (`body`), optionally asks for a typed word (`typeToConfirm="GIVE"`) before the confirm button unlocks.
 * `children` adds fields (a reason) to the body; `confirmDisabled` keeps the button locked until they are valid.
 * Esc / backdrop cancel (not while busy), focus starts on Cancel (or the typed field), Tab stays inside,
 * focus returns to the opener on close.
 */
export default function ConfirmAction({ open, title, body, confirmLabel = 'Confirm', danger = false, busy = false, typeToConfirm = '', confirmDisabled = false, children, onConfirm, onCancel }) {
  const titleId = useId();
  const bodyId = useId();
  const typeId = useId();
  const boxRef = useRef(null);
  const cancelRef = useRef(null);
  const typeRef = useRef(null);
  const [typed, setTyped] = useState('');
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const cancelFn = useRef(onCancel);
  cancelFn.current = onCancel;
  useScrollLock(open);

  useEffect(() => {
    if (!open) return undefined;
    setTyped('');
    const prev = document.activeElement;
    (typeToConfirm ? typeRef.current : boxRef.current?.querySelector('[data-autofocus]') || cancelRef.current)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!busyRef.current) cancelFn.current?.();
      } else if (e.key === 'Tab' && boxRef.current) {
        const f = [...boxRef.current.querySelectorAll(FOCUSABLE)];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus();
    };
  }, [open, typeToConfirm]);

  if (!open || typeof document === 'undefined') return null;
  const locked = confirmDisabled || (!!typeToConfirm && typed.trim().toUpperCase() !== typeToConfirm.toUpperCase());

  return createPortal(
    <div className="adm-modal" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel?.()}>
      <div className={`adm-modal__box${danger ? ' is-danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={body ? bodyId : undefined} ref={boxRef}>
        <div className="adm-modal__head">
          <h2 id={titleId} className="adm-modal__title">
            {title}
          </h2>
        </div>
        <div className="adm-modal__body">
          {body ? (
            <div id={bodyId} className="adm-modal__text">
              {body}
            </div>
          ) : null}
          {children}
          {typeToConfirm ? (
            <div className="adm-field">
              <label className="adm-label" htmlFor={typeId}>
                Type <b>{typeToConfirm}</b> to confirm
              </label>
              <input
                id={typeId}
                ref={typeRef}
                className="adm-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !locked && !busy) onConfirm?.();
                }}
              />
            </div>
          ) : null}
        </div>
        <div className="adm-modal__actions">
          <button type="button" className="adm-btn adm-btn--ghost" ref={cancelRef} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`adm-btn ${danger ? 'adm-btn--danger' : 'adm-btn--primary'}`} onClick={onConfirm} disabled={busy || locked}>
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
