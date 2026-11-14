// Phone camera: while a landing is being shown, the board leans in a little towards that tile, then eases
// back. A scale about the tile's own centre, so the focused tile never moves out of view. Only on narrow boards
// (container query in fx.css) and never under reduced motion.

import { tileCenter } from './geometry.js';
import '@/styles/fx.css';

export default function CameraFocus({ tile = null, active = false, children }) {
  const on = active && Number.isInteger(tile) && tile >= 0;
  const style = {};
  if (on) {
    const { x, y } = tileCenter(tile);
    style['--cam-x'] = `${(x * 100).toFixed(2)}%`;
    style['--cam-y'] = `${(y * 100).toFixed(2)}%`;
  }
  return (
    <div className={`fx-cam${on ? ' is-focus' : ''}`} style={style}>
      {children}
    </div>
  );
}
