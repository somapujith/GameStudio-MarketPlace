// Tutorial overlay: Chotu the stall helper, in a bar that never covers the stall or the HUD.
//   phones (portrait): a ONE-line "Chotu says" bar just above the chit strip and dock (the HUD publishes `--tc-hud-bottom`); tap it to
//                      open the full card (text, Telugu line, hint, controls, recipe, chapters); "Got it" stays on the bar itself
//   landscape phones / desktop: the same bar at the top, under the banner and beside the chalk board (`--tc-hud-top`)
// Progress is by CHAPTER (Look, Tokens, Tawa, ...) as a segmented strip plus "Step n of N", not one dot per step. The wording follows the
// device: `textTouch` / `hintTouch` on a touch screen, `text` / `hint` with a keyboard. A step with a recipe offers the recipe card.
import { useEffect, useRef, useState } from 'react';
import RecipeCard from '../hud/RecipeCard.jsx';
import { ChotuAvatar } from './art.jsx';
import { coachStepFromTutorial, coachViewModel } from './menuModels.js';
import './menus.css';

const FOLD_MS = 9000;
const WIDE = '(min-width: 900px) and (min-height: 521px)';

const useMedia = (query, fallback = false) => {
  const [on, setOn] = useState(fallback);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia(query);
    const upd = () => setOn(mq.matches);
    upd();
    mq.addEventListener?.('change', upd);
    return () => mq.removeEventListener?.('change', upd);
  }, [query]);
  return on;
};

/**
 * Props: { step: { id, say?, text, textTouch?, te?, hint?, hintTouch?, hintMs?, controls?, recipe?, ack? }, index (0-based), total, onSkip(), onNext?(),
 *          chapters?, chapter?, touch? }
 * or just { tutorial } (a session's `tutorial` object or a driver): the step, index, total, chapters and recipe are read from it.
 * `onNext` shows a Got it / Done button for steps that wait for a tap rather than for a game event. `touch` defaults to (pointer: coarse).
 */
export default function CoachMark({ step: stepProp, tutorial, index: indexProp, total: totalProp, onSkip, onNext, chapters, chapter, touch: touchProp }) {
  const coarse = useMedia('(pointer: coarse)');
  const wide = useMedia(WIDE);
  const touch = touchProp ?? coarse;
  const step = stepProp ?? coachStepFromTutorial(tutorial);
  const index = indexProp ?? tutorial?.index ?? 0;
  const total = totalProp ?? tutorial?.steps?.length ?? 1;
  const vm = coachViewModel(step, index, total, { touch, chapters: chapters ?? step?.chapters ?? tutorial?.chapters, chapter: chapter ?? step?.chapter ?? tutorial?.chapter, steps: tutorial?.steps });
  const [hinting, setHinting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const rootRef = useRef(null);
  const nextRef = useRef(null);
  const skipRef = useRef(null);
  const keepRef = useRef(null);
  const wasAsking = useRef(false);
  const hasNext = !!onNext;

  // New step: back to the one-line bar (a wide screen shows a step that waits for "Got it" open, to be read), the hint timer restarts.
  useEffect(() => {
    setHinting(false);
    setAsking(false);
    setRecipeOpen(false);
    setOpen(wide && hasNext);
    const t = setTimeout(() => setHinting(true), vm.hintMs);
    return () => clearTimeout(t);
  }, [vm.id, vm.hintMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // A wide screen folds a step that waits for a game action to the bar after a few seconds (the player has read it and needs the stall back).
  useEffect(() => {
    if (hasNext || !wide) return undefined;
    const t = setTimeout(() => setOpen(false), FOLD_MS);
    return () => clearTimeout(t);
  }, [vm.id, hasNext, wide]);
  // A new hint from the tutorial draws attention: show it on wide screens (phones show a dot on the bar instead).
  useEffect(() => {
    if (vm.hint && wide) setOpen(true);
  }, [vm.hint, wide]);

  // A step that only waits for "Got it": put the keyboard there (the bar comes after the whole HUD in tab order). Never steal focus from an
  // open dialog (cook sheet, pause).
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

  // Esc folds the open card while focus is inside it (and does not reach the game, which would pause).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || asking || !rootRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, asking]);

  // Tell the HUD how tall a bottom-anchored bar is, so its subtitle strip stays above it (`--tc-coach-h`, 0 when the bar is at the top).
  const present = !!step;
  useEffect(() => {
    const el = rootRef.current;
    const host = el?.parentElement;
    if (!el || !host) return undefined;
    const measure = () => {
      const bar = el.querySelector('.tc-menu-coachbar');
      const r = bar?.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const atBottom = !!r && r.top + r.height / 2 > h.top + h.height / 2;
      host.style.setProperty('--tc-coach-h', atBottom ? `${Math.ceil(r.height + 4)}px` : '0px');
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    const bar = el.querySelector('.tc-menu-coachbar');
    if (bar) ro?.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      host.style.removeProperty('--tc-coach-h');
    };
  }, [present, open, recipeOpen, asking]);

  if (!step) return null;
  const bodyId = `tc-coach-body-${vm.id}`;
  const gloss = [vm.say, vm.text, hinting ? vm.hint : ''].filter(Boolean).join(' ');
  const strip = vm.chapters;
  return (
    <div ref={rootRef} className="tc-menu tc-menu-coach" data-hinting={hinting || undefined} data-open={open || undefined}>
      <section className={`tc-menu-coachbar${hinting ? ' is-hinting' : ''}${open ? ' is-open' : ''}`} aria-label="Tutorial">
        <div className="tc-menu-sr" role="status" aria-live="polite" aria-atomic="true">{`Chotu says: ${gloss}`}</div>
        <div className="tc-menu-coachbar__row">
          <ChotuAvatar size={34} className="tc-menu-coachbar__who" />
          <button type="button" className="tc-menu-coachbar__line" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
            <span className="tc-menu-coachbar__name">
              Chotu says
              <span className="tc-menu-coachbar__pos">{strip.label ? `${strip.label} ${vm.chapterStep ? `${vm.chapterStep.at}/${vm.chapterStep.of}` : `${index + 1}/${total}`}` : `${index + 1}/${total}`}</span>
            </span>
            <span className={`tc-menu-coachbar__text${vm.ack ? ' is-ack' : ''}`}>{vm.line}</span>
            {hinting && vm.hint && !open && <span className="tc-menu-coachbar__dot" aria-hidden="true" />}
            <svg className="tc-menu-coachbar__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
            </svg>
          </button>
          {onNext && (
            <button type="button" ref={nextRef} className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--sm tc-menu-coachbar__next" onClick={() => onNext()}>
              {vm.last ? 'Done' : 'Got it'}
            </button>
          )}
        </div>

        <div className="tc-menu-coachbar__body" id={bodyId} hidden={!open}>
          <p className="tc-menu-coachbar__full">{vm.say ? <b>{vm.say} </b> : null}{vm.text}</p>
          {vm.te && <p className="tc-menu-coachbar__te" lang="te">{vm.te}</p>}
          {hinting && vm.hint && <p className="tc-menu-coachbar__hint">{vm.hint}</p>}
          {vm.controls && <p className="tc-menu-coachbar__controls">{vm.controls}</p>}
          {vm.recipe && (
            <div className="tc-menu-coachbar__recipe">
              <button type="button" className="tc-menu-btn tc-menu-btn--ghost tc-menu-btn--sm" aria-expanded={recipeOpen} onClick={() => setRecipeOpen((r) => !r)}>
                {recipeOpen ? 'Hide recipe' : 'Show recipe'}
              </button>
              {recipeOpen && <RecipeCard dish={vm.recipe} />}
            </div>
          )}
          {strip.items.length > 0 ? (
            <ol className="tc-menu-chapters" aria-label={`Chapters: ${strip.label || 'tutorial'}, ${strip.index + 1} of ${strip.count}`}>
              {strip.items.map((c) => (
                <li key={c.id} className={`is-${c.state}`} aria-current={c.state === 'active' ? 'step' : undefined}>
                  <span>{c.label}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="tc-menu-progress" role="img" aria-label={vm.position}>
              <i style={{ width: `${Math.round(vm.progress * 100)}%` }} />
            </div>
          )}
          {asking ? (
            <div className="tc-menu-coachbar__ask" role="alertdialog" aria-label="Skip the tutorial?">
              <p>Skip the tutorial? Co-op stays locked until you finish it.</p>
              <div className="tc-menu-row">
                <button type="button" ref={keepRef} className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--sm" onClick={() => setAsking(false)}>Keep going</button>
                <button type="button" className="tc-menu-btn tc-menu-btn--danger tc-menu-btn--sm" onClick={() => onSkip?.()}>Skip tutorial</button>
              </div>
            </div>
          ) : (
            <div className="tc-menu-coachbar__foot">
              <small>{vm.position}</small>
              <button type="button" ref={skipRef} className="tc-menu-btn tc-menu-btn--ghost tc-menu-btn--sm tc-menu-coachbar__skip" onClick={() => setAsking(true)}>Skip tutorial</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
