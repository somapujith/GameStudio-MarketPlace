// Pause (solo) and the co-op "leave your seat" confirm. Both are modal layers inside the game root: focus is trapped, Esc steps back.
import { useEffect, useRef, useState } from 'react';
import { useDialog } from './hooks.js';
import './menus.css';

/**
 * Solo pause: "Chai break". Props: { open, onResume, onRestart, onQuit, muted, onMute(next: boolean) }.
 * Restart and Quit ask once more before they throw the shift away.
 */
export default function PauseMenu({ open = false, onResume, onRestart, onQuit, muted = false, onMute }) {
  const root = useRef(null);
  const [ask, setAsk] = useState(null); // null | 'restart' | 'quit'
  useDialog(root, {
    active: open,
    onEscape: () => (ask ? setAsk(null) : onResume?.()),
  });
  useEffect(() => {
    if (open) root.current?.querySelector('[data-autofocus]')?.focus?.({ preventScroll: true });
  }, [ask, open]);
  if (!open) return null;
  const confirm = ask === 'restart' ? { text: 'Restart this shift? Today\'s tally so far is lost.', yes: 'Restart shift', run: onRestart } : ask === 'quit' ? { text: 'Leave the stall? This shift will not be saved.', yes: 'Leave', run: onQuit } : null;

  return (
    <div className="tc-menu tc-menu-layer tc-menu-pause" ref={root} role="dialog" aria-modal="true" aria-labelledby="tc-pause-h" tabIndex={-1}>
      <div className="tc-menu-panel tc-menu-panel--tin">
        <h2 id="tc-pause-h" className="tc-menu-paint">Chai break</h2>
        <p className="tc-menu-lede">The stall is on hold. Nobody walks away while you sip.</p>
        {confirm ? (
          <div className="tc-menu-confirm" role="alertdialog" aria-label="Confirm">
            <p>{confirm.text}</p>
            <div className="tc-menu-stack">
              <button type="button" className="tc-menu-btn tc-menu-btn--plank" data-autofocus onClick={() => setAsk(null)}>Keep playing</button>
              <button type="button" className="tc-menu-btn tc-menu-btn--danger" onClick={() => confirm.run?.()}>{confirm.yes}</button>
            </div>
          </div>
        ) : (
          <div className="tc-menu-stack">
            <button type="button" className="tc-menu-btn tc-menu-btn--steel tc-menu-btn--primary tc-menu-btn--big" data-autofocus onClick={() => onResume?.()}>Resume</button>
            <button type="button" className="tc-menu-btn tc-menu-btn--plank" onClick={() => setAsk('restart')}>Restart shift</button>
            <button type="button" className="tc-menu-btn tc-menu-btn--plank" role="switch" aria-checked={!!muted} onClick={() => onMute?.(!muted)}>
              Sound: {muted ? 'off' : 'on'}
            </button>
            <button type="button" className="tc-menu-btn tc-menu-btn--ghost" onClick={() => setAsk('quit')}>Leave the stall</button>
          </div>
        )}
        <p className="tc-menu-keys" aria-hidden="true"><kbd>Esc</kbd> {ask ? 'back' : 'resume'}</p>
      </div>
    </div>
  );
}
