// The "Power cards" guide sheet (docs/POWER_CARDS.md 3.4): the four cards with their art and full text, and the rules in plain
// language. Opened by the DOM event `hg:power-guide` (the hand tray's info button dispatches it) and by a button in the Rules sheet.
//   <PowerGuide open onClose />      the sheet itself
//   <PowerGuideHost />               mounted once (RulesSheet renders it when the rule is on): listens for the event
//   openPowerGuide()                 dispatches the event (what the buttons call)
import { useEffect, useState } from 'react';
import Sheet from '../ui/Sheet.jsx';
import PowerCardArt from './PowerCardArt.jsx';
import { POWER_CARDS } from '@shared/powerCards.js';
import { GUIDE_INTRO, GUIDE_RULES, POWER_GUIDE_EVENT } from './powerView.js';
import '@/styles/power-opp.css';

export function openPowerGuide() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(POWER_GUIDE_EVENT));
}

export default function PowerGuide({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="Power cards" className="hg-powerguide pwo-guide" desktop="modal">
      <p className="pwo-guide__intro">{GUIDE_INTRO}</p>
      <ul className="pwo-guide__cards">
        {POWER_CARDS.map((c) => (
          <li key={c.id} className="pwo-gc" data-tone={c.tone} data-card={c.id}>
            <span className="pwo-gc__art"><PowerCardArt id={c.id} size={64} /></span>
            <div>
              <h4>{c.name}</h4>
              <p>{c.long}</p>
            </div>
          </li>
        ))}
      </ul>
      <h3 className="hg-h3">The rules</h3>
      <ul className="pwo-guide__rules">
        {GUIDE_RULES.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </Sheet>
  );
}

/** Listens for `hg:power-guide` and shows the guide. The sheet mounts on the first open (nothing is rendered before that). */
export function PowerGuideHost() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const show = () => { setSeen(true); setOpen(true); };
    window.addEventListener(POWER_GUIDE_EVENT, show);
    return () => window.removeEventListener(POWER_GUIDE_EVENT, show);
  }, []);
  return seen ? <PowerGuide open={open} onClose={() => setOpen(false)} /> : null;
}
