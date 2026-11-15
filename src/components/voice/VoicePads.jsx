// The soundboard: one big pad per voice line (art + title). Owned lines are live: a tap plays the clip for everyone, at any
// time (not only on your turn). Lines you do not own are locked pads with the price and a link to the shop (new tab: a live
// game is never navigated away from). One cooldown for the whole board, shown as a bar draining across every pad.
//   <VoicePads session access variant="bar"|"phone" />     `access` = useVoiceAccess() (a prop so tests can feed any state)
//   <VoiceToggle open onClick access />                    the button next to the reactions that opens the board on desktop
import { useId } from 'react';
import { voiceItems, cooldownSeconds, accessHint } from './voiceModel.js';
import { pressVoice } from './voiceActions.js';
import { useCooldown } from './useVoiceAccess.js';
import VoiceIcon from './VoiceIcon.jsx';
import '@/styles/voice.css';

export const SHOP_VOICE_HREF = '/shop?kind=voice';
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function Pad({ item, owned, session, access, cd }) {
  const left = cd.left;
  const cooling = left > 0;
  const secs = cooldownSeconds(left);
  const elapsed = Math.max(0, cd.ms - left);
  if (!owned) {
    return (
      <a
        className="vl-pad is-locked"
        href={SHOP_VOICE_HREF}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${item.name} is locked. ${fmt(item.price)} coins. Get it in the shop (opens in a new tab)`}
        data-voice={item.id}
      >
        <span className="vl-pad__art"><VoiceIcon item={item} size={34} locked /></span>
        <span className="vl-pad__name">{item.name}</span>
        <span className="vl-pad__sub"><i className="vl-coin" aria-hidden="true" /> {fmt(item.price)} · Get it in the shop</span>
        <span className="vl-pad__lock" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 10.5h11v9h-11zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
        </span>
      </a>
    );
  }
  return (
    <button
      type="button"
      className={`vl-pad${cooling ? ' is-cooling' : ''}`}
      onClick={() => pressVoice({ session, access, id: item.id })}
      disabled={cooling || session?.connection !== 'open'}
      aria-label={cooling ? `${item.name}, ready in ${secs} seconds` : `Play ${item.name} for everyone`}
      data-voice={item.id}
    >
      <span className="vl-pad__art"><VoiceIcon item={item} size={34} /></span>
      <span className="vl-pad__name">{item.name}</span>
      <span className="vl-pad__sub" aria-hidden="true">{cooling ? `${secs}s` : item.caption || 'Tap to play'}</span>
      {cooling ? (
        <span
          key={cd.startedAt}
          className="vl-pad__cd"
          aria-hidden="true"
          style={{ '--vl-cd': `${cd.ms}ms`, animationDelay: `-${elapsed}ms` }}
        />
      ) : null}
    </button>
  );
}

export default function VoicePads({ session, access, variant = 'bar' }) {
  const cd = useCooldown();
  const head = useId();
  const items = voiceItems();
  if (!items.length) return null;
  const hint = accessHint(access.state === 'owned' ? '' : access.state);
  const showPads = access.signedIn && access.state !== 'loading' && access.state !== 'offline';
  return (
    <section className={`vl-board vl-board--${variant}`} aria-labelledby={head} data-state={access.state}>
      <h3 id={head} className="vl-board__title">Voice lines <span className="vl-board__sub">play for everyone</span></h3>
      {showPads ? (
        <div className="vl-pads" role="group" aria-label="Voice lines">
          {items.map((item) => (
            <Pad key={item.id} item={item} owned={access.owned.has(item.id)} session={session} access={access} cd={cd} />
          ))}
        </div>
      ) : null}
      {hint ? (
        <p className="vl-hint" role="status">
          {hint}
          {access.state === 'offline' && typeof access.reload === 'function' ? (
            <>
              {' '}
              <button type="button" className="vl-link" onClick={access.reload}>Try again</button>
            </>
          ) : null}
          {access.state === 'locked' ? (
            <>
              {' '}
              <a className="vl-link" href={SHOP_VOICE_HREF} target="_blank" rel="noopener noreferrer">Open the shop</a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/** The button beside the reactions that opens the soundboard (desktop chat card). */
export function VoiceToggle({ open, onClick, access, popId }) {
  const have = access.owned ? access.owned.size : 0;
  return (
    <button
      type="button"
      className={`table-chat__react vl-toggle${open ? ' is-open' : ''}`}
      onClick={onClick}
      aria-expanded={!!open}
      aria-controls={popId}
      aria-haspopup="true"
      aria-label={have ? 'Voice lines: open the soundboard' : 'Voice lines: get them in the shop'}
      title="Voice lines"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </svg>
    </button>
  );
}
