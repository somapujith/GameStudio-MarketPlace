import { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Sheet from './Sheet.jsx';
import { canShare, shareOrCopy, useCopied } from './clipboard.js';
import { inviteMessage, inviteText, joinLink, spacedCode, whatsappUrl } from './codes.js';
import '@/styles/lobby-invite.css';

export function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12.04 2a9.9 9.9 0 0 0-8.4 15.1L2 22l5.05-1.6A9.93 9.93 0 1 0 12.04 2zm0 1.8a8.13 8.13 0 1 1-4.3 15.05l-.3-.18-3 .95.98-2.92-.2-.31A8.13 8.13 0 0 1 12.04 3.8zm-3.1 3.6c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.35 5.15 4.56 2.55 1 3.07.8 3.62.75.55-.05 1.78-.73 2.03-1.43.25-.7.25-1.3.18-1.43-.08-.12-.28-.2-.58-.35-.3-.15-1.78-.88-2.05-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.95 1.18-.18.2-.35.23-.65.08-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.67-2.08-.18-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.53-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.68-.5z"
      />
    </svg>
  );
}

/** Copy icon that turns into a check (with a small pop) once `done`. */
export function CopyIcon({ done }) {
  return (
    <svg className={done ? 'lp-pop' : undefined} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {done ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : (<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" /></>)}
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V4M8 8l4-4 4 4M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z" />
    </svg>
  );
}

/**
 * "Share invite link": a sheet (bottom sheet on phones, centred card on wide screens; focus trap, Esc closes, safe-area
 * padding come from Sheet) with the LINK as the primary option.
 *   - the join link (exactly `joinLink(code)`) in a read-only field and a big Copy link button
 *   - Share... (the native share sheet) where the browser has one, WhatsApp, Copy message (the full invite text + link)
 *   - a QR code ("Scan to join")
 * The header says what is being shared ("Invite to <Host>'s table · <Game>") with the code as a secondary line.
 *
 * Props: { open, onClose(acted), code, gameName, hostName?, onNotify(message, tone) }
 *  - `onClose` is told whether anything was copied or shared while it was open, so the page can point at the ticket.
 */
export default function ShareSheet({ open, onClose, code, gameName, hostName, onNotify }) {
  const [linkCopied, copyLink] = useCopied();
  const [msgCopied, copyMessage] = useCopied();
  const acted = useRef(false);
  const link = joinLink(code);
  const notify = (text, tone) => onNotify && onNotify(text, tone);

  const close = () => {
    const did = acted.current;
    acted.current = false;
    if (onClose) onClose(did);
  };

  const onCopyLink = async () => {
    if (await copyLink(link)) {
      acted.current = true;
      notify('Invite link copied', 'good');
    } else notify('Could not copy the link.', 'bad');
  };
  const onCopyMessage = async () => {
    if (await copyMessage(inviteText(code, gameName))) {
      acted.current = true;
      notify('Invite message copied', 'good');
    } else notify('Could not copy the message.', 'bad');
  };
  const onNativeShare = async () => {
    const res = await shareOrCopy(inviteMessage(code, gameName));
    if (res === 'shared') acted.current = true;
    else if (res === 'copied') {
      acted.current = true;
      notify('Invite copied to clipboard', 'good');
    } else if (res === 'failed') notify('Could not share. Copy the link instead.', 'bad');
  };

  const title = `Invite to ${hostName ? `${hostName}'s table` : 'your table'}${gameName ? ` · ${gameName}` : ''}`;

  return (
    <Sheet open={open} onClose={close} title={title} subtitle={`Room code ${spacedCode(code)}`}>
      <div className="lp-sheet">
        <div className="lp-sheet__link">
          <label className="lp-label" htmlFor="lp-sheet-link">
            Invite link
          </label>
          <input id="lp-sheet-link" className="lp-link__input lp-sheet__input" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button type="button" className={`ho-btn ho-btn--primary ho-btn--lg lp-btn lp-sheet__copy${linkCopied ? ' is-done' : ''}`} onClick={onCopyLink}>
            <span className="lp-ticket__swap" key={linkCopied ? 'done' : 'idle'}>
              <CopyIcon done={linkCopied} /> <span aria-live="polite">{linkCopied ? 'Copied' : 'Copy link'}</span>
            </span>
          </button>
        </div>

        <div className="lp-sheet__row">
          {canShare() && (
            <button type="button" className="ho-btn ho-btn--ghost lp-btn" onClick={onNativeShare}>
              <ShareIcon /> Share…
            </button>
          )}
          <a className="ho-btn ho-btn--wa lp-btn" href={whatsappUrl(code, gameName)} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon /> WhatsApp
          </a>
          <button type="button" className={`ho-btn ho-btn--ghost lp-btn${msgCopied ? ' is-done' : ''}`} onClick={onCopyMessage}>
            <span className="lp-ticket__swap" key={msgCopied ? 'done' : 'idle'}>
              {msgCopied ? <CopyIcon done /> : <MessageIcon />} <span aria-live="polite">{msgCopied ? 'Copied' : 'Copy message'}</span>
            </span>
          </button>
        </div>

        <div className="lp-qr">
          <div className="lp-qr__tile">
            <QRCodeSVG value={link} size={148} level="M" marginSize={2} bgColor="#ffffff" fgColor="#1b1340" title={`QR code for ${link}`} />
          </div>
          <span className="lp-qr__hint">Scan to join</span>
        </div>
      </div>
    </Sheet>
  );
}
