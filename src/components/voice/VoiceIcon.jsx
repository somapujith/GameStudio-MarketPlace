// One lookup for the art of a voice line: icon key -> component, falling back to the line's emoji (then a speaker).
// Used by the shop card, the soundboard pads, the caption line and the speaker mark.
import TigerIcon from './TigerIcon.jsx';
import CatIcon from './CatIcon.jsx';
import OldManIcon from './OldManIcon.jsx';
import { voiceEmoji, voiceIconKey } from './voiceModel.js';

export const VOICE_ICONS = { tiger: TigerIcon, cat: CatIcon, oldman: OldManIcon };

export default function VoiceIcon({ item, size = 32, locked = false, className = '' }) {
  const Comp = VOICE_ICONS[voiceIconKey(item)];
  if (Comp) return <Comp size={size} locked={locked} className={className} />;
  return (
    <span className={`vl-emoji${className ? ` ${className}` : ''}`} aria-hidden="true" style={{ fontSize: Math.round(size * 0.82), lineHeight: 1, opacity: locked ? 0.55 : 1 }}>
      {voiceEmoji(item)}
    </span>
  );
}
