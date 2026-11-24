// The subtitle strip: the latest thing a customer in view said (else the most urgent customer's line), in the chosen subtitle style, with
// their token. The strip is visual only (aria-hidden); a polite live region announces every line's English gloss once.
import { moodTone, subtitleLines } from './dialogue.js';

export function SubtitleStrip({ entry, subs, token }) {
  if (!entry) return <div className="tc-hud-subs" aria-hidden="true" data-empty="1" />;
  const u = entry.u;
  const lines = subtitleLines(u, subs);
  return (
    <div className="tc-hud-subs" aria-hidden="true" data-tone={moodTone(u.mood)} data-leaving={entry.leaving ? '1' : '0'} data-subs={subs}>
      <span className="tc-hud-subs-token">
        <small>TOKEN</small>
        <b>{token ?? u.customer}</b>
      </span>
      <span className="tc-hud-subs-text" lang={u.lang === 'dk' ? 'hi' : u.lang}>
        {lines.map((l) => (
          <span key={l.kind} className={`tc-hud-subs-${l.kind}`}>{l.text}</span>
        ))}
      </span>
    </div>
  );
}

export function GlossLive({ items }) {
  return (
    <div className="tc-hud-sr" role="status" aria-live="polite" aria-relevant="additions" data-gloss="">
      {items.map((m) => (
        <p key={m.id}>{m.text}</p>
      ))}
    </div>
  );
}
