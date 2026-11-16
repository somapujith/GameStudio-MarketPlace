import { useState } from 'react';
import { useCopied } from './clipboard.js';
import { spacedCode, whatsappUrl } from './codes.js';
import ShareSheet, { CopyIcon, ShareIcon, WhatsAppIcon } from './ShareSheet.jsx';
import '@/styles/store-rooms.css';
import '@/styles/lobby-invite.css';

/**
 * The invite ticket: the ONE place the lobby shows the room code big, with everything needed to get people in.
 *  - the code in large grouped letters ("ABC 234") on an accent-lit ticket
 *  - primary action: Share invite, which opens the share-link sheet (link, QR, native share, WhatsApp, message)
 *  - Copy code and WhatsApp right beside it
 * Props: { code, gameName, onNotify(message, tone), onShare(), highlight? }
 *  - `onShare` opens the share sheet (the lobby owns one sheet for the ticket, the Start bar and the empty seats).
 *  - `highlight` is a counter: each time it changes the ticket plays one calm outline pulse (the lobby bumps it after an
 *    invite was shared or copied, so the player sees where the code lives).
 * Tour hook: lobby-invite (the ticket).
 */
export function InviteTicket({ code, gameName, onNotify, onShare, highlight = 0 }) {
  const [codeCopied, copyCode] = useCopied();
  const notify = (text, tone) => onNotify && onNotify(text, tone);

  const onCopyCode = async () => {
    if (!(await copyCode(code))) notify('Could not copy. Select the code and copy it manually.', 'bad');
  };

  return (
    <section className={`lp-ticket${highlight ? ` is-lit-${highlight % 2}` : ''}`} data-tour="lobby-invite" aria-label="Invite code">
      <div className="lp-ticket__top">
        <span className="lp-label">Room code</span>
        <div className="lp-ticket__code">
          <span aria-hidden="true">{spacedCode(code)}</span>
          <span className="lp-sr">{`Room code ${String(code).split('').join(' ')}`}</span>
        </div>
        <p className="lp-ticket__hint">Friends enter this code, or open your invite link.</p>
      </div>

      <div className="lp-ticket__tear" aria-hidden="true" />

      <div className="lp-ticket__actions">
        <button type="button" className="ho-btn ho-btn--primary lp-btn lp-ticket__main" onClick={onShare}>
          <ShareIcon /> Share invite
        </button>
        <button type="button" className={`ho-btn ho-btn--ghost lp-btn${codeCopied ? ' is-done' : ''}`} onClick={onCopyCode}>
          <span className="lp-ticket__swap" key={codeCopied ? 'done' : 'idle'}>
            <CopyIcon done={codeCopied} /> <span aria-live="polite">{codeCopied ? 'Copied!' : 'Copy code'}</span>
          </span>
        </button>
        <a className="ho-btn ho-btn--wa lp-btn" href={whatsappUrl(code, gameName)} target="_blank" rel="noopener noreferrer">
          <WhatsAppIcon /> WhatsApp
        </a>
      </div>
    </section>
  );
}

/** Standalone card version of the invite ticket (it brings its own share sheet). */
export default function ShareCard({ code, gameName, hostName, onNotify, id }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="sr-card lp-card" aria-label="Invite players" id={id} tabIndex={-1}>
      <header className="sr-card__head">
        <div>
          <span className="st-eyebrow">Invite</span>
          <h2 className="sr-card__title">Fill the table</h2>
        </div>
      </header>
      <InviteTicket code={code} gameName={gameName} onNotify={onNotify} onShare={() => setOpen(true)} />
      <ShareSheet open={open} onClose={() => setOpen(false)} code={code} gameName={gameName} hostName={hostName} onNotify={onNotify} />
    </section>
  );
}
