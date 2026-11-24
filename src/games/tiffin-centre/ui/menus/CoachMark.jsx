// Tutorial overlay: Chotu the stall helper speaks from a newspaper-chit bubble at the top centre (so the thumb dock stays free).
// The layer never blocks pointers outside the bubble. After the step's hint timer the bubble pulses and shows the hint line.
import { useEffect, useState } from 'react';
import { ChotuAvatar } from './art.jsx';
import { coachViewModel } from './menuModels.js';
import './menus.css';

/**
 * Props: { step: { id, text, te?, hint?, hintMs? }, index (0-based), total, onSkip(), onNext?() }
 * `onNext` is optional: show a Got it / Next button for steps that wait for a tap rather than for a game event.
 */
export default function CoachMark({ step, index = 0, total = 1, onSkip, onNext }) {
  const vm = coachViewModel(step, index, total);
  const [hinting, setHinting] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    setHinting(false);
    setAsking(false);
    const t = setTimeout(() => setHinting(true), vm.hintMs);
    return () => clearTimeout(t);
  }, [vm.id, vm.hintMs]);

  if (!step) return null;
  return (
    <div className="tc-menu tc-menu-coach" data-hinting={hinting || undefined}>
      <section className={`tc-menu-chitbubble${hinting ? ' is-hinting' : ''}`} aria-label="Tutorial">
        <ChotuAvatar size={52} className="tc-menu-chitbubble__who" />
        <div className="tc-menu-chitbubble__main">
          <p className="tc-menu-chitbubble__name">Chotu <span lang="te" className="tc-menu-te">చోటు</span> <small>{vm.position}</small></p>
          <div className="tc-menu-chitbubble__say" role="status" aria-live="polite" aria-atomic="true">
            <p className="tc-menu-chitbubble__text">{vm.text}</p>
            {vm.te && <p className="tc-menu-chitbubble__te" lang="te">{vm.te}</p>}
            {hinting && vm.hint && <p className="tc-menu-chitbubble__hint">{vm.hint}</p>}
          </div>
          {asking ? (
            <div className="tc-menu-chitbubble__ask" role="alertdialog" aria-label="Skip the tutorial?">
              <p>Skip the tutorial? Co-op stays locked until you finish it.</p>
              <div className="tc-menu-row">
                <button type="button" className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--sm" onClick={() => setAsking(false)}>Keep going</button>
                <button type="button" className="tc-menu-btn tc-menu-btn--danger tc-menu-btn--sm" onClick={() => onSkip?.()}>Skip tutorial</button>
              </div>
            </div>
          ) : (
            <div className="tc-menu-chitbubble__foot">
              <span className="tc-menu-dots" role="img" aria-label={vm.position}>
                {vm.dots.map((d, i) => <i key={i} className={`is-${d}`} />)}
              </span>
              {onNext && <button type="button" className="tc-menu-btn tc-menu-btn--plank tc-menu-btn--sm" onClick={() => onNext()}>{vm.last ? 'Done' : 'Got it'}</button>}
              <button type="button" className="tc-menu-btn tc-menu-btn--ghost tc-menu-btn--sm" onClick={() => setAsking(true)}>Skip tutorial</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
