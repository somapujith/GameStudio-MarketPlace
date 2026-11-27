// OWNER: quests agent. "Mama's First Day": the tutorial card. Step dots, the instruction (English + Telugu) with the key to press,
// and a SKIP button (also the N key). Reads snap.quest.tutorial.
import { useTouchMode } from '../hud/touchMode.js';
import { coachStepText } from './coachText.js';

export default function Coach({ q, onSkip }) {
  const touch = useTouchMode();
  const t = q.tutorial;
  if (!t) return null;
  const idx = Math.min(t.stepIndex, t.steps.length - 1);
  const cur = coachStepText({ ...t.steps[idx], key: t.key }, touch);
  return (
    <aside className="aw-quest-coach" aria-label="Tutorial">
      <header>
        <span className="aw-quest-tag is-gold">MAMA&apos;S FIRST DAY</span>
        <span className="aw-te">మామా మొదటి రోజు</span>
      </header>
      <ol className="aw-quest-dots" aria-label={`Step ${idx + 1} of ${t.steps.length}`}>
        {t.steps.map((s, i) => (
          <li key={i} className={s.done ? 'is-done' : s.current ? 'is-now' : ''} />
        ))}
      </ol>
      <p className="aw-quest-coach__text" aria-live="polite">
        <span className="aw-quest-coach__n" aria-hidden="true">{idx + 1}/{t.steps.length}</span>
        {cur.key && <kbd className="aw-key">{cur.key}</kbd>}
        {cur.label}
      </p>
      {cur.te && <p className="aw-te aw-quest-coach__te">{cur.te}</p>}
      {t.progress && <p className="aw-quest-progress">{t.progress}</p>}
      <button type="button" className="aw-quest-skip" onClick={onSkip}>
        {touch ? 'Skip' : 'Skip tutorial'} {!touch && <kbd className="aw-key">N</kbd>}
      </button>
    </aside>
  );
}
