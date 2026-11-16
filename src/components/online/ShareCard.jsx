import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { canShare, shareOrCopy, useCopied } from './clipboard.js';
import { inviteMessage, joinLink, spacedCode, whatsappUrl } from './codes.js';
import '@/styles/store-rooms.css';
import '@/styles/lobby-invite.css';

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12.04 2a9.9 9.9 0 0 0-8.4 15.1L2 22l5.05-1.6A9.93 9.93 0 1 0 12.04 2zm0 1.8a8.13 8.13 0 1 1-4.3 15.05l-.3-.18-3 .95.98-2.92-.2-.31A8.13 8.13 0 0 1 12.04 3.8zm-3.1 3.6c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.35 5.15 4.56 2.55 1 3.07.8 3.62.75.55-.05 1.78-.73 2.03-1.43.25-.7.25-1.3.18-1.43-.08-.12-.28-.2-.58-.35-.3-.15-1.78-.88-2.05-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.95 1.18-.18.2-.35.23-.65.08-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.67-2.08-.18-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.53-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.68-.5z"
      />
    </svg>
  );
}

function CopyIcon({ done }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {done ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : (<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" /></>)}
    </svg>
  );
}

function QrIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <path d="M14 14h2.5v2.5H14zM18 18h2.5M18 14h2.5" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V4M8 8l4-4 4 4M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
    </svg>
  );
}

/**
 * The share tools: room code (copy), invite link (copy), WhatsApp, native share, and a QR code behind a toggle.
 * Props: { code, gameName, onNotify(message, tone) }. Used by the lobby's "Share" tab (InvitePanel) and by ShareCard.
 */
export function ShareTools({ code, gameName, onNotify }) {
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();
  const [qrOpen, setQrOpen] = useState(false);
  const link = joinLink(code);
  const notify = (text, tone) => onNotify && onNotify(text, tone);

  const share = async () => {
    const res = await shareOrCopy(inviteMessage(code, gameName));
    if (res === 'copied') notify('Invite copied to clipboard', 'good');
    else if (res === 'failed') notify('Could not share. Copy the link instead.', 'bad');
  };

  return (
    <div className="lp-share">
      <div className="lp-code">
        <div className="lp-code__main">
          <span className="lp-label">Room code</span>
          <div className="lp-code__value" aria-label={`Room code ${String(code).split('').join(' ')}`}>
            {spacedCode(code)}
          </div>
        </div>
        <button
          type="button"
          className={`ho-btn ho-btn--ghost ho-btn--sm lp-btn${codeCopied ? ' is-done' : ''}`}
          onClick={async () => {
            if (!(await copyCode(code))) notify('Could not copy. Select the code and copy it manually.', 'bad');
          }}
        >
          <CopyIcon done={codeCopied} />
          <span aria-live="polite">{codeCopied ? 'Copied!' : 'Copy code'}</span>
        </button>
      </div>

      <div className="lp-link">
        <input className="lp-link__input" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className={`ho-btn ho-btn--ghost ho-btn--sm lp-btn${linkCopied ? ' is-done' : ''}`}
          onClick={async () => {
            if (!(await copyLink(link))) notify('Could not copy the link.', 'bad');
          }}
        >
          <CopyIcon done={linkCopied} />
          <span aria-live="polite">{linkCopied ? 'Copied!' : 'Copy link'}</span>
        </button>
      </div>

      <div className="lp-actions">
        <a className="ho-btn ho-btn--wa lp-btn" href={whatsappUrl(code, gameName)} target="_blank" rel="noopener noreferrer">
          <WhatsAppIcon /> WhatsApp
        </a>
        {canShare() && (
          <button type="button" className="ho-btn ho-btn--primary lp-btn" onClick={share}>
            <ShareIcon /> Share
          </button>
        )}
        <button type="button" className="ho-btn ho-btn--ghost lp-btn" onClick={() => setQrOpen((v) => !v)} aria-expanded={qrOpen} aria-controls="lp-qr">
          <QrIcon /> {qrOpen ? 'Hide QR' : 'Show QR'}
        </button>
      </div>

      {qrOpen && (
        <div className="lp-qr" id="lp-qr">
          <div className="lp-qr__tile">
            <QRCodeSVG value={link} size={156} level="M" marginSize={2} bgColor="#ffffff" fgColor="#1b1340" title={`QR code for ${link}`} />
          </div>
          <span className="lp-qr__hint">Scan to join</span>
        </div>
      )}
    </div>
  );
}

/** Standalone card version of the share tools (kept for callers that want a framed block). */
export default function ShareCard({ code, gameName, onNotify, id }) {
  return (
    <section className="sr-card lp-card" aria-label="Invite players" id={id} tabIndex={-1}>
      <header className="sr-card__head">
        <div>
          <span className="st-eyebrow">Invite</span>
          <h2 className="sr-card__title">Fill the table</h2>
        </div>
      </header>
      <ShareTools code={code} gameName={gameName} onNotify={onNotify} />
    </section>
  );
}
