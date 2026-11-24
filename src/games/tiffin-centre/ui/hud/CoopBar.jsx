// Co-op bar (online tables only): teammate chips with what they hold, the connection chip, emote buttons and floating emotes.
import ConnectionChip from '@/components/online/ConnectionChip.jsx';
import HudIcon from './HudIcon.jsx';
import { EMOTES, emoteInfo } from './hudLogic.js';

function Float({ f }) {
  const info = emoteInfo(f.e);
  return info ? (
    <span className="tc-hud-emote-float" aria-hidden="true">
      <HudIcon name={info.icon} size={22} />
    </span>
  ) : null;
}

export default function CoopBar({ mates, floats, meId, connection, link, onRetry, onEmote, reduced }) {
  const mine = floats.filter((f) => f.by === meId);
  return (
    <aside className="tc-hud-coop" aria-label="Your team">
      <div className="tc-hud-mates">
        {mates.map((m) => (
          <div key={m.id} className={`tc-hud-mate${m.online ? '' : ' is-away'}`} style={{ '--hue': m.hue }} aria-label={`${m.name}: ${m.online ? m.holding : 'away'}`}>
            <span className="tc-hud-mate-dot" aria-hidden="true">{String(m.name).charAt(0).toUpperCase()}</span>
            <span className="tc-hud-mate-txt">
              <b>{m.name}</b>
              <small>{m.online ? m.holding : 'Teammate left'}</small>
            </span>
            {floats.filter((f) => f.by === m.id).map((f) => (
              <Float key={f.id} f={f} />
            ))}
          </div>
        ))}
      </div>
      <ConnectionChip connection={connection} link={link} onRetry={onRetry} compact />
      <div className="tc-hud-emotes" role="group" aria-label="Emotes">
        {EMOTES.map((e) => (
          <button key={e.e} type="button" className="tc-hud-btn tc-hud-emote" onClick={() => onEmote(e.e)} aria-label={e.label}>
            <HudIcon name={e.icon} size={20} />
          </button>
        ))}
        {!reduced && mine.map((f) => <Float key={f.id} f={f} />)}
      </div>
    </aside>
  );
}
