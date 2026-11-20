// Phones: the chat (quick reactions + the text composer) lives in a tray above the action dock, opened by the dock's Chat
// button, instead of taking a permanent card out of a screen that is already short. The children stay MOUNTED while the
// tray is closed (a half-typed message survives); `hidden` takes them out of the layout and the accessibility tree.
// The tray sits above whichever is higher, the dock or the on-screen keyboard (--hg-kb, ui/viewport.js), so the input is
// never hidden behind the keyboard and nothing else on the screen moves when it opens. Escape or a tap outside closes it.
import { useEffect } from 'react';
import Icon from '../ui/Icon.jsx';

export default function ChatTray({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <div className={`ct${open ? ' is-open' : ''}`} hidden={!open} data-testid="chat-tray">
      <div className="ct-scrim" onClick={onClose} aria-hidden="true" />
      <div className="ct-card">
        <button type="button" className="ct-x" onClick={onClose} aria-label="Close chat">
          <Icon name="close" size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
