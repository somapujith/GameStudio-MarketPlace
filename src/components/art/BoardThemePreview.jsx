import { memo } from 'react';

/**
 * Shop preview of a board theme (kind 'board'): a miniature of the board ring in the theme's colours.
 * Props: { item (catalogue item: colors [night, paper, accent], finish), size = 64 }.
 *
 * WAVE 0 STUB: a flat three-colour swatch so every item previews. The board-theme work package replaces this body
 * (keep the default export, the props and the root <svg>).
 */
function BoardThemePreview({ item, size = 64 }) {
  const [night, paper, accent] = (item && item.colors) || ['#15173a', '#f6ead4', '#ffc857'];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={item ? item.name : 'Board theme'}>
      <rect x="4" y="4" width="56" height="56" rx="8" fill={night} stroke={accent} strokeWidth="2" />
      <rect x="14" y="14" width="36" height="36" rx="4" fill={paper} />
    </svg>
  );
}
export default memo(BoardThemePreview);
