// Tutorial overlay: Chotu the stall helper speaks from a newspaper-chit bubble at the top centre (so the thumb dock stays free).
// The layer never blocks pointers outside the bubble. After the step's hint timer the bubble pulses and shows the hint line.
// The HUD publishes `--tc-hud-top` (the bottom edge of its top bands) on the game root so the bubble never covers the banner, the
// takings plate or the chalk board; "Hide" folds the bubble to a one-line chit when the player wants the whole stall back.
import { useEffect, useRef, useState } from 'react';
import { ChotuAvatar } from './art.jsx';
import { coachViewModel } from './menuModels.js';
import './menus.css';

const FOLD_MS = 8000;

/**
 * Props: { step: { id, text, te?, hint?, hintMs? }, index (0-based), total, onSkip(), onNext?() }
 * `onNext` is optional: show a Got it / Next button for steps that wait for a tap rather than for a game event.
 */
export default function CoachMark({ step, index = 0, total = 1, onSkip, onNext }) {
  const vm = coachViewModel(step, index, total);
  const [hinting, setHinting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [folded, setFolded] = useState(false);
  const nextRef = useRef(null);
  const skipRef = useRef(null);
  const keepRef = useRef(null);
  const wasAsking = useRef(false);
  const hasNext = !!onNext;

  useEffect(() => {
    setHinting(false);
    setAsking(false);
    setFolded(false);
    const t = setTimeout(() => setHinting(true), vm.hintMs);
    return () => clearTimeout(t);
  }, [vm.id, vm.hintMs]);

  // A step that waits for a game action folds itself to one line after a few seconds (the player has read it and needs the stall back);
  // a new hint from the tutorial unfolds it again. Steps that wait for "Got it" stay open.
  useEffect(() => {
    if (hasNext) return undefined;
    const t = setTimeout(() => setFolded(true), FOLD_MS);
    return () => clearTimeout(t);
  }, [vm.id, hasNext]);
  useEffect(() => {
    if (vm.hint) setFolded(false);
  }, [vm.hint]);

  // A step that only waits for "Got it": put the keyboard there (the bubble comes after the whole HUD in tab order). Never steal
  // focus from an open dialog (cook sheet, pause).
  useEffect(() => {
    if (!hasNext || !nextRef.current) return;
    const a = document.activeElement;
    if (a && a !== document.body && a.closest?.('[aria-modal="true"]')) return;
    nextRef.current.focus({ preventScroll: true });
  }, [vm.id, hasNext]);

  // The skip confirmation is an alertdialog: focus moves in, Esc backs out (without pausing the game), focus returns to Skip.
  useEffect(() => {
    if (asking) {
      keepRef.current?.focus({ preventScroll: true });
      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        setAsking(false);
      };
      document.addEventListener('keydown', onKey, true);
      wasAsking.current = true;
      return () => document.removeEventListener('keydown', onKey, true);
    }
    if (wasAsking.current) {
      wasAsking.current = false;
      skipRef.current?.focus({ preventScroll: true });
    }
    return undefined;
  }, [asking]);

  if (!step) return null;
  return (
    <div className="tc-menu tc-menu-coach" data-hinting={hinting || undefined}>
      <section className={`tc-menu-chitbubble${hinting ? ' is-hinting' : ''}${folded ? ' is-folded' : ''}`} aria-label="Tutorial">
        <ChotuAvatar size={52} className="tc-menu-chitbubble__who" />
        <div className="tc-menu-chitbubble__main">
          <p className="tc-menu-chitbubble__name">Chotu <span lang="te" className="tc-menu-te">చోటు</span> <small>{vm.position}</small></p>
          <div className="tc-menu-chitbubble__say" role="status" aria-live="polite" aria-atomic="true" hidden={folded}>
            <p className="tc-menu-chitbubble__text">{vm.text}</p>
            {vm.te && <p className="tc-menu-chitbubble__te" lang="te">{vm.te}</p>}
            {hinting && vm.hint && <p className="tc-menu-chitbubble__hint">{vm.hint}</p>}
          </div>
          {asking ? (
            <div className="tc-menu-chitbubble__ask" role="alertdialog" aria-label="Skip the tutorial?">
              <p>Skip the tutorial? Co-op stays locked until you finish it.</p>
              <div className="tc-menu-row">
                <button type="button" ref={keepRef} className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--sm" onClick={() => setAsking(false)}>Keep going</button>
                <button type="button" className="tc-menu-btn tc-menu-btn--danger tc-menu-btn--sm" onClick={() => onSkip?.()}>Skip tutorial</button>
              </div>
            </div>
          ) : (
            <div className="tc-menu-chitbubble__foot">
              <span className="tc-menu-dots" role="img" aria-label={vm.position}>
                {vm.dots.map((d, i) => <i key={i} className={`is-${d}`} />)}
              </span>
              {onNext && <button type="button" ref={nextRef} className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--sm" onClick={() => onNext()}>{vm.last ? 'Done' : 'Got it'}</button>}
              {!onNext && (
                <button type="button" className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--sm tc-menu-chitbubble__fold" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
                  {folded ? 'Show tip' : 'Hide'}
                </button>
              )}
              <button type="button" ref={skipRef} className="tc-menu-btn tc-menu-btn--ghost tc-menu-btn--sm tc-menu-chitbubble__skip" onClick={() => setAsking(true)}>Skip tutorial</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
