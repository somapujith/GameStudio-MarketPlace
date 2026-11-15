// A soft pulsing ring (or a bobbing arrow) that says "press this next": drop it INSIDE the thing to point at (a button or
// a tile; the parent needs `position: relative`). Decorative only (aria-hidden, no pointer events, no layout space).
//
//   <button className="roll">Roll<AttentionPulse active={canRoll} /></button>
//   <AttentionPulse active variant="arrow" placement="top" tone="good" />
//
//   active      false renders nothing
//   variant     'ring' (default) | 'arrow' | 'both'
//   placement   where the arrow sits: 'top' (default) | 'bottom' | 'left' | 'right'
//   tone        'gold' (default) | 'good' | 'bad' | 'sky'
//   radius      CSS border-radius of the ring (default: the parent's own, via `inherit`)
//
// Two transform / opacity loops at most; under reduced motion the ring is a steady outline and the arrow does not bob.
import '@/styles/fx.css';

export default function AttentionPulse({ active = true, variant = 'ring', placement = 'top', tone = 'gold', radius, className = '' }) {
  if (!active) return null;
  const ring = variant === 'ring' || variant === 'both';
  const arrow = variant === 'arrow' || variant === 'both';
  return (
    <span className={`ap ap--${tone}${className ? ` ${className}` : ''}`} style={radius ? { '--ap-r': radius } : undefined} aria-hidden="true" data-attention="">
      {ring ? <><i className="ap__ring" /><i className="ap__ring ap__ring--b" /></> : null}
      {arrow ? <i className={`ap__arrow ap__arrow--${placement}`} /> : null}
    </span>
  );
}

export { AttentionPulse };
