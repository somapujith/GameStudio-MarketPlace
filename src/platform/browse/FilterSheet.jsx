// Phone filter sheet: slides up from the bottom, holds a draft of the filters, Apply commits it, Reset clears it.
// Modal behaviour: focus moves in and is restored, Tab is trapped, Escape and the scrim close, page scroll is locked.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FilterControls from './FilterControls.jsx';
import { DEFAULTS, applyFilters } from './filters.js';
import { CloseIcon } from './icons.jsx';

const EXIT_MS = 260;
const FOCUSABLE = 'a[href],button:not([disabled]),select,input,[tabindex]:not([tabindex="-1"])';

/** Keeps a sheet mounted long enough to play its exit; `shown` flips one frame after mount so the enter transitions. */
function usePresence(open) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);
  return { mounted, shown };
}

export default function FilterSheet({ open, state, games, onApply, onClose, returnFocusRef }) {
  const { mounted, shown } = usePresence(open);
  const [draft, setDraft] = useState(state);
  const sheetRef = useRef(null);
  const wasOpen = useRef(false);

  // every time it opens, start from the committed filters
  useEffect(() => {
    if (open) setDraft(state);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // focus in, scroll lock, focus back
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) returnFocusRef?.current?.focus?.({ preventScroll: true });
      wasOpen.current = false;
      return undefined;
    }
    wasOpen.current = true;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    const id = requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(id);
      root.style.overflow = prev;
    };
  }, [open, returnFocusRef]);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = [...(sheetRef.current?.querySelectorAll(FOCUSABLE) ?? [])];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!mounted) return null;
  const preview = applyFilters(games, draft).length;
  const dirty = draft.players !== DEFAULTS.players || draft.dur !== DEFAULTS.dur || draft.status !== DEFAULTS.status;

  // portal to <body>: the sheet must sit above the tab bar, which lives in a different stacking context
  return createPortal(
    <div className={`bw-sheetwrap st-scope ${shown ? 'is-open' : ''}`} onKeyDown={onKeyDown}>
      <div className="bw-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="bw-sheet" role="dialog" aria-modal="true" aria-labelledby="bw-sheet-title" tabIndex={-1}>
        <div className="bw-sheet__grip" aria-hidden="true" />
        <div className="bw-sheet__head">
          <h2 id="bw-sheet-title" className="bw-sheet__title">
            Filters
          </h2>
          <button type="button" className="bw-iconbtn" onClick={onClose} aria-label="Close filters">
            <CloseIcon />
          </button>
        </div>
        <div className="bw-sheet__body">
          <FilterControls state={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} idPrefix="bfs" showHints />
        </div>
        <div className="bw-sheet__foot">
          <button type="button" className="hub-btn hub-btn--ghost" disabled={!dirty} onClick={() => setDraft((d) => ({ ...d, players: DEFAULTS.players, dur: DEFAULTS.dur, status: DEFAULTS.status }))}>
            Reset
          </button>
          <button type="button" className="hub-btn hub-btn--primary bw-sheet__apply" onClick={() => onApply({ players: draft.players, dur: draft.dur, status: draft.status })}>
            {preview === 0 ? 'Apply (no matches)' : `Show ${preview} ${preview === 1 ? 'game' : 'games'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
