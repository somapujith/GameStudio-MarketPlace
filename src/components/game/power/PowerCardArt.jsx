import { memo } from 'react';
import { powerCardById } from '@shared/powerCards.js';

/**
 * Illustration for a Power Card: { id: 'shield'|'double'|'steal'|'swap', size = 96 } -> an <svg> (aria-hidden).
 *
 * WAVE 0 STUB: a flat tinted square so every surface can import it today. The hand-UI work package replaces this body
 * with the real illustrations (keep the default export, the props and the root <svg>).
 */
function PowerCardArt({ id, size = 96 }) {
  const card = powerCardById(id);
  const tone = { blue: '#4cc9f0', gold: '#ffc857', teal: '#3ddc97', violet: '#b794f6' }[card ? card.tone : 'gold'];
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="80" height="80" rx="16" fill={tone} opacity="0.85" />
    </svg>
  );
}
export default memo(PowerCardArt);
