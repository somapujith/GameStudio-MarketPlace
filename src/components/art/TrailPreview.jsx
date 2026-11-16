import { memo } from 'react';

/**
 * Shop / lobby preview of a pawn trail (kind 'trail'): the effect the piece leaves behind as it walks.
 * Props: { item (catalogue item: colors [a, b], finish), size = 64 }.
 *
 * WAVE 0 STUB: a plain two-dot swatch so every item previews. The trail work package replaces this body
 * (keep the default export, the props and the root <svg>).
 */
function TrailPreview({ item, size = 64 }) {
  const [a, b] = (item && item.colors) || ['#e3b778', '#a8743a'];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={item ? item.name : 'Trail'}>
      <circle cx="46" cy="32" r="9" fill={a} />
      <circle cx="26" cy="32" r="6" fill={b} opacity="0.7" />
      <circle cx="12" cy="32" r="3.5" fill={b} opacity="0.4" />
    </svg>
  );
}
export default memo(TrailPreview);
