import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/shell/Toast.jsx';
import { Icon } from '@/components/shell/icons.jsx';
import '@/styles/online.css'; // kept: importers relied on this side effect before the adapter

/**
 * Thin adapter over the app-wide shell toast (`src/components/shell/Toast.jsx`), so every screen has ONE toast look.
 *   const { push, node } = useToasts();   push('Copied', 'good');   return <>…{node}</>;
 * tone: 'info' | 'good' | 'bad' | 'gold' (anything else counts as 'info').
 * `node` is null under the shell's <ToastProvider>; without a provider (tests, isolated harnesses) it renders a
 * local stack with the same `hh-toast` markup, so callers never need to care.
 */

const TONES = new Set(['info', 'good', 'bad', 'gold']);
export const TOAST_MS = { info: 3000, good: 3000, gold: 3400, bad: 5200 };

/** (text, tone) -> the shell's `toast(message, { tone, duration })` arguments, or null for empty text. Pure. */
export function toastArgs(text, tone = 'info') {
  if (text == null || text === '' || text === false) return null;
  const t = TONES.has(tone) ? tone : tone === 'warn' || tone === 'error' ? 'bad' : 'info';
  return [String(text), { tone: t, duration: TOAST_MS[t] }];
}

const ICONS = { good: 'check', bad: 'close', info: 'info', gold: 'sparkle' };

export function useToasts() {
  const shell = useToast();
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const timers = useRef(new Set());

  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach((t) => clearTimeout(t));
      set.clear();
    };
  }, []);

  const dismiss = useCallback((id) => setItems((cur) => cur.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (text, tone = 'info') => {
      const args = toastArgs(text, tone);
      if (!args) return undefined;
      const id = shell(...args);
      if (id !== undefined) return id; // the shell provider took it
      // no <ToastProvider> above us: keep a local stack with the same look
      seq.current += 1;
      const localId = `l${seq.current}`;
      setItems((cur) => [...cur.slice(-2), { id: localId, text: args[0], tone: args[1].tone }]);
      const t = setTimeout(() => {
        timers.current.delete(t);
        dismiss(localId);
      }, args[1].duration);
      timers.current.add(t);
      return localId;
    },
    [shell, dismiss],
  );

  const node = items.length ? <ToastHost items={items} onDismiss={dismiss} /> : null;
  return { push, node };
}

/** The fallback stack (same markup as the shell's). `items`: [{ id, text, tone }]. */
export function ToastHost({ items, onDismiss }) {
  return (
    <div className="hh-toasts" role="status" aria-live="polite">
      {(items || []).map((t) => (
        <button key={t.id} type="button" className={`hh-toast hh-toast--${t.tone}`} onClick={() => onDismiss?.(t.id)} aria-label={`${t.text} (tap to dismiss)`} data-nosfx>
          <Icon name={ICONS[t.tone] || 'info'} size={18} />
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

export default useToasts;
