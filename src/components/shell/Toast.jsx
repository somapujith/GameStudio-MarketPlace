/**
 * App-wide toasts (one stack for the whole app; <ToastProvider> is mounted once in App.jsx).
 *
 *   const toast = useToast();
 *   toast('Saved');                                                   // info
 *   toast('Friend code copied', { tone: 'success' });
 *   toast("Couldn't join", { tone: 'error', action: { label: 'Retry', onClick: retry } });
 *   toast('+250 coins', { tone: 'gold', icon: 'gift', duration: 4000 });
 *   const id = toast('Working…', { duration: 0 });  toast.dismiss(id);   // duration 0 = until dismissed
 *   toast.success(msg, opts) · toast.error(msg, opts) · toast.info(msg, opts) · toast.gold(msg, opts)
 *
 * Options (all optional):
 *   tone      'info' | 'success' | 'error' | 'gold'   (aliases kept for older callers: 'good' = success, 'bad' = error)
 *   variant   same as tone
 *   icon      shell Icon name (icons.jsx); defaults per tone
 *   duration  ms before it leaves (default 3400; errors 5200; with an action 6000; 0 = sticky)
 *   action    { label, onClick }  a button inside the toast; clicking it runs onClick then dismisses
 *   id        reuse an id to replace an existing toast in place (e.g. 'net' for a connection notice)
 * Returns the toast id. `toast` is a stable function (safe in effect deps). Without a provider it is a no-op.
 * At most 3 are stacked (the oldest leaves first); tap a toast to dismiss it. The auto-dismiss countdown pauses
 * while the pointer is over a toast or focus is inside it (so its action is reachable by keyboard) and resumes on leave. Enter/exit animate with
 * transform/opacity and collapse to a fade under reduced motion. Announced via aria-live="polite".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import '@/styles/x-shell.css';

const ToastCtx = createContext(null);

const MAX = 3;
const EXIT_MS = 220;
const TONES = { info: 'info', success: 'good', good: 'good', error: 'bad', bad: 'bad', gold: 'gold', warn: 'bad', warning: 'bad' };
const ICONS = { good: 'check', bad: 'close', info: 'info', gold: 'sparkle' };

/** Normalised tone class: 'info' | 'good' | 'bad' | 'gold' (exported for tests/adapters). */
export function toneOf(t) {
  return TONES[t] || 'info';
}

function noopToast() {
  return null;
}
noopToast.dismiss = () => {};
noopToast.success = noopToast;
noopToast.error = noopToast;
noopToast.info = noopToast;
noopToast.gold = noopToast;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Map());
  // auto-dismiss bookkeeping per live toast: { due, left } (left = ms remaining while paused)
  const clocks = useRef(new Map());

  const clearTimer = (id) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  };

  const remove = useCallback((id) => {
    clearTimer(id);
    clocks.current.delete(id);
    setItems((l) => l.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id) => {
      clearTimer(id);
      clocks.current.delete(id);
      setItems((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      timers.current.set(id, setTimeout(() => remove(id), EXIT_MS));
    },
    [remove],
  );

  const toast = useMemo(() => {
    const show = (message, opts = {}) => {
      if (message === undefined || message === null || message === '') return null;
      const o = typeof opts === 'string' ? { tone: opts } : opts || {};
      const tone = toneOf(o.tone || o.variant);
      const id = o.id ?? `t${++seq.current}`;
      const action = o.action && typeof o.action.onClick === 'function' && o.action.label ? { label: String(o.action.label), onClick: o.action.onClick } : null;
      const duration = Number.isFinite(Number(o.duration)) ? Number(o.duration) : action ? 6000 : tone === 'bad' ? 5200 : 3400;
      const item = { id, message: typeof message === 'string' ? message : String(message), tone, icon: o.icon, action };
      clearTimer(id);
      setItems((l) => {
        const at = l.findIndex((t) => t.id === id);
        if (at >= 0) return l.map((t, i) => (i === at ? item : t));
        const live = l.filter((t) => !t.leaving);
        const next = [...l, item];
        // too many: the oldest live ones leave (animated)
        const over = live.length + 1 - MAX;
        if (over > 0) {
          const drop = new Set(live.slice(0, over).map((t) => t.id));
          drop.forEach((d) => {
            clearTimer(d);
            clocks.current.delete(d);
            timers.current.set(d, setTimeout(() => remove(d), EXIT_MS));
          });
          return next.map((t) => (drop.has(t.id) ? { ...t, leaving: true } : t));
        }
        return next;
      });
      clocks.current.delete(id);
      if (duration > 0) {
        clocks.current.set(id, { due: Date.now() + duration, left: null });
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      }
      return id;
    };
    show.dismiss = dismiss;
    show.success = (m, o) => show(m, { ...(o || {}), tone: 'success' });
    show.error = (m, o) => show(m, { ...(o || {}), tone: 'error' });
    show.info = (m, o) => show(m, { ...(o || {}), tone: 'info' });
    show.gold = (m, o) => show(m, { ...(o || {}), tone: 'gold' });
    return show;
  }, [dismiss, remove]);

  /** Hold a toast's countdown (pointer over it / focus inside it). */
  const pause = useCallback((id) => {
    const c = clocks.current.get(id);
    if (!c || c.left !== null) return;
    clearTimer(id);
    c.left = Math.max(0, c.due - Date.now());
  }, []);

  /** Restart the held countdown with what was left (at least a short beat so it never vanishes on leave). */
  const resume = useCallback(
    (id) => {
      const c = clocks.current.get(id);
      if (!c || c.left === null) return;
      const left = Math.max(c.left, 1200);
      c.left = null;
      c.due = Date.now() + left;
      timers.current.set(id, setTimeout(() => dismiss(id), left));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="hh-toasts xs-toasts" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div
            key={t.id}
            className={`hh-toast hh-toast--${t.tone} xs-toast${t.leaving ? ' is-leaving' : ''}${t.action ? ' has-action' : ''}`}
            onClick={() => dismiss(t.id)}
            onPointerEnter={() => pause(t.id)}
            onPointerLeave={(e) => {
              if (!e.currentTarget.contains(document.activeElement)) resume(t.id);
            }}
            onFocus={() => pause(t.id)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget) && !e.currentTarget.matches(':hover')) resume(t.id);
            }}
            data-nosfx
          >
            <Icon name={t.icon || ICONS[t.tone] || 'info'} size={18} />
            <span className="xs-toast__msg">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="xs-toast__action"
                onClick={(e) => {
                  e.stopPropagation();
                  try {
                    t.action.onClick();
                  } finally {
                    dismiss(t.id);
                  }
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="xs-toast__close"
              aria-label="Dismiss"
              data-nosfx
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
            >
              <Icon name="close" size={14} strokeWidth={2.4} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** `toast(message, opts?) -> id` plus `.success/.error/.info/.gold/.dismiss`. A no-op outside the provider. */
export function useToast() {
  return useContext(ToastCtx) || noopToast;
}

export default ToastProvider;
