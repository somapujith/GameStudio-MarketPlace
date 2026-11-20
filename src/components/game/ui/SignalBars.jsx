// Connection strength as wifi bars: four ascending bars lit by level (4 and 3 green, 2 amber, 1 red), a dim "measuring"
// state, and, when a player is gone, grey bars with a slash and a small pill BESIDE them ("Offline" / "Reconnecting…").
// ONE component for the game pods, the top bar, the wallet bar, the lobby seats and the player sheet.
//
//   <SignalBars kind="ok" level={3} rtt={120} size="sm" />          or     <SignalBars {...signalOf(rp, { isMe, local })} />
//
//   kind   'ok' | 'measuring' | 'offline' | 'reconnecting' ('none' renders nothing)
//   level  1..4 (kind 'ok'), rtt ms (for the words), stale = the report is old (dimmed)
//   size   'sm' (pods: bars 4/6/9/11px) | 'md' (5/8/11/14px)
//   pill   false hides the pill (the bars stay)
//
// The lit COUNT carries the meaning, colour only adds to it. The bars are one `role="img"` with the sentence a
// screen reader needs; the pill is decoration for the same fact (aria-hidden). Pods put their own aria-label on the card.
import { useState } from 'react';
import { pillText, signalLabel, signalTitle } from './signalModel.js';
import '@/styles/signal.css';

const BARS = [1, 2, 3, 4];

/**
 * Just the pill ("Offline" / "Reconnecting…"), for a layout that has no room beside the bars (the phone table puts it
 * under the avatar). Renders nothing for any other kind. Same text and colours as the pill inside <SignalBars>.
 */
export function SignalPill({ kind, className = '' }) {
  const text = pillText({ kind });
  if (!text) return null;
  return (
    <span className={`sg__pill sg__pill--${kind}${className ? ` ${className}` : ''}`} aria-hidden="true">
      {text}
    </span>
  );
}

export default function SignalBars({ kind = 'measuring', level = null, rtt = null, stale = false, size = 'md', pill = true, className = '', title }) {
  const lit = kind === 'ok' && Number.isInteger(level) ? Math.min(4, Math.max(0, level)) : 0;
  // The bars that just lit up pop in: remember the level we showed before (React's "adjust state while rendering" pattern).
  const [shown, setShown] = useState({ lit, from: lit });
  if (shown.lit !== lit) setShown({ lit, from: lit > shown.lit ? shown.lit : lit });
  if (kind === 'none') return null;

  const sig = { kind, level: kind === 'ok' ? lit : kind === 'measuring' ? null : 0, rtt, stale };
  const text = pill ? pillText(sig) : '';
  const cls = ['sg', `sg--${size === 'sm' ? 'sm' : 'md'}`, `sg--${kind}`, kind === 'ok' && `sg--l${lit}`, stale && kind === 'ok' && 'is-stale', className].filter(Boolean).join(' ');
  return (
    <span className={cls} data-kind={kind} data-level={kind === 'ok' ? lit : undefined}>
      <span className="sg__bars" role="img" aria-label={signalLabel(sig)} title={title ?? signalTitle(sig)}>
        {BARS.map((n) => (
          <i key={n} className={`sg__bar${n <= lit ? ' is-on' : ''}${n <= lit && n > shown.from ? ' is-pop' : ''}`} />
        ))}
      </span>
      {text ? <SignalPill kind={kind} /> : null}
    </span>
  );
}
