import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { canShare, shareOrCopy, useCopied } from '@/components/online/clipboard.js';
import { friendInviteMessage, friendLinkUrl, friendShareText } from '@/components/online/codes.js';
import SIcon, { WhatsAppIcon } from './SIcon.jsx';

/**
 * Your friend code as a shop sign: the code on a lit plaque, the link (copy, WhatsApp, native share) and a QR code
 * for someone standing next to you. `onNotify(text, tone)` shows a toast.
 */
export default function FriendCodeCard({ code, onNotify, className = '' }) {
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();
  const [qr, setQr] = useState(false);
  const link = code ? friendLinkUrl(code) : '';
  const native = canShare();

  const copy = async (fn, text, ok, bad) => {
    if (await fn(text)) onNotify?.(ok, 'good');
    else onNotify?.(bad, 'bad');
  };
  const share = async () => {
    const res = await shareOrCopy(friendInviteMessage(code));
    if (res === 'copied') onNotify?.('Friend link copied', 'good');
    else if (res === 'failed') onNotify?.('Could not share. Copy your link instead.', 'bad');
  };
  const whatsapp = code ? `https://wa.me/?text=${encodeURIComponent(friendShareText(code))}` : undefined;

  return (
    <section className={`sc-sign ${className}`.trim()} aria-labelledby="sc-sign-h">
      <span className="sc-sign__lamp" aria-hidden="true" />
      <div className="sc-sign__top">
        <span className="st-eyebrow" id="sc-sign-h">
          Your friend code
        </span>
        <button type="button" className={`sc-sign__qrbtn${qr ? ' is-on' : ''}`} onClick={() => setQr((v) => !v)} aria-expanded={qr} aria-controls="sc-sign-qr" disabled={!link}>
          <SIcon name="qr" size={16} /> {qr ? 'Hide QR' : 'Show QR'}
        </button>
      </div>

      <div className="sc-sign__body">
        <div className="sc-sign__plaque" role="group" aria-label={`Your friend code ${code || ''}`}>
          <span className="sc-sign__code">{code || '...'}</span>
        </div>
        <div id="sc-sign-qr" className={`sc-sign__qr${qr ? ' is-open' : ''}`}>
          {link && <QRCodeSVG value={link} size={132} level="M" marginSize={2} bgColor="#ffffff" fgColor="#1b1340" title={`QR code for ${link}`} />}
          <span>Scan to add me</span>
        </div>
      </div>

      <div className="sc-sign__link">
        <input className="sc-sign__input" readOnly value={link} aria-label="Your friend link" onFocus={(e) => e.target.select()} placeholder="Your friend link" />
        <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={() => copy(copyLink, link, 'Friend link copied', 'Could not copy the link.')} disabled={!link}>
          <SIcon name={linkCopied ? 'check' : 'link'} size={16} /> {linkCopied ? 'Copied!' : 'Copy link'}
        </button>
      </div>

      <div className="sc-sign__actions">
        <button
          type="button"
          className="hub-btn hub-btn--ghost hub-btn--sm"
          onClick={() => copy(copyCode, code, 'Friend code copied', 'Could not copy. Select the code and copy it manually.')}
          disabled={!code}
        >
          <SIcon name={codeCopied ? 'check' : 'copy'} size={16} /> {codeCopied ? 'Copied!' : 'Copy code'}
        </button>
        <a className="hub-btn hub-btn--wa hub-btn--sm" href={whatsapp} target="_blank" rel="noopener noreferrer" aria-disabled={!code || undefined}>
          <WhatsAppIcon size={17} /> WhatsApp
        </a>
        <button type="button" className="hub-btn hub-btn--primary hub-btn--sm" onClick={share} disabled={!code}>
          <SIcon name="share" size={16} /> {native ? 'Share' : 'Copy invite'}
        </button>
      </div>
      <p className="sc-sign__help">Anyone who opens your link can add you in one tap. They do not need an account to look.</p>
    </section>
  );
}
