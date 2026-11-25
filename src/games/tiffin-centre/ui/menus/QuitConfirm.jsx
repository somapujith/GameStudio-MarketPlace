// Co-op: the game keeps running for everyone else, so there is no pause. Leaving ends YOUR seat only.
import { useRef } from 'react';
import { useDialog } from './hooks.js';
import './menus.css';

/** Props: { open, onStay, onQuit, teammates?: number } (teammates = how many others are still at the stall). */
export default function QuitConfirm({ open = false, onStay, onQuit, teammates: mates = 0 }) {
  const root = useRef(null);
  const teammates = Array.isArray(mates) ? mates.length : Number(mates) || 0; // a count, or the list of names
  useDialog(root, { active: open, onEscape: () => onStay?.() });
  if (!open) return null;
  return (
    <div className="tc-menu tc-menu-layer tc-menu-quit" ref={root} role="alertdialog" aria-modal="true" aria-labelledby="tc-quit-h" aria-describedby="tc-quit-d" tabIndex={-1}>
      <div className="tc-menu-panel tc-menu-panel--tin">
        <h2 id="tc-quit-h" className="tc-menu-paint">Leave the stall?</h2>
        <p id="tc-quit-d" className="tc-menu-lede">
          The shift keeps running for the others and your seat ends.{' '}
          {teammates > 0 ? `${teammates} ${teammates === 1 ? 'friend is' : 'friends are'} still serving, they will miss you.` : 'You can come back through the invite link while the table is open.'}
        </p>
        <div className="tc-menu-stack">
          <button type="button" className="tc-menu-btn tc-menu-btn--steel tc-menu-btn--primary tc-menu-btn--big" data-autofocus onClick={() => onStay?.()}>Stay and serve</button>
          <button type="button" className="tc-menu-btn tc-menu-btn--danger" onClick={() => onQuit?.()}>Leave my seat</button>
        </div>
        <p className="tc-menu-keys" aria-hidden="true"><kbd>Esc</kbd> stay</p>
      </div>
    </div>
  );
}
