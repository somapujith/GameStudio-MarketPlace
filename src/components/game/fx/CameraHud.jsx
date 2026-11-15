// The camera HUD: while the board is zoomed, the die and the status in the middle of it scroll out of view, so this small
// overlay keeps the turn player, one line of what is happening, and three buttons (zoom out, zoom in, show the whole
// board). The buttons are also the keyboard / screen-reader / switch-access alternative to pinching. It sits in the
// board frame, above the zoomed content, and docks to the bottom edge when the action is in the top of the view.
//
// A polite live region next to it announces "Zoomed in on Madhapur" / "Board overview" when the camera changes (never
// at every follow frame: BoardCamera only sets `announce` when the zoomed state flips).
import '@/styles/camera.css';

const Svg = ({ children }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const HUD_BUTTONS = Object.freeze([
  { key: 'out', label: 'Zoom out' },
  { key: 'in', label: 'Zoom in' },
  { key: 'fit', label: 'Show whole board' },
]);

/**
 * @param on        the board is zoomed (the HUD is shown; hidden otherwise, and its buttons leave the tab order)
 * @param text      the status line ("Sana is moving…")
 * @param token     the turn player's avatar token (a node), or null
 * @param edge      'top' (default) | 'bottom'
 * @param announce  the line for the live region (empty most of the time)
 * @param canIn / canOut  disable a zoom button at its limit
 */
export default function CameraHud({ on = false, text = '', token = null, edge = 'top', announce = '', canIn = true, canOut = true, onIn, onOut, onFit }) {
  return (
    <>
      <div className="bc-hud" data-bc-hud="" data-on={on ? '' : undefined} data-edge={edge === 'bottom' ? 'bottom' : 'top'} role="group" aria-label="Board camera">
        <div className="bc-hud__pill">
          {token ? <span className="bc-hud__token">{token}</span> : null}
          <span className="bc-hud__text">{text}</span>
        </div>
        <div className="bc-hud__btns">
          <button type="button" className="bc-hud__btn" aria-label="Zoom out" title="Zoom out" disabled={!canOut} onClick={onOut}>
            <Svg><path d="M5 12h14" /></Svg>
          </button>
          <button type="button" className="bc-hud__btn" aria-label="Zoom in" title="Zoom in" disabled={!canIn} onClick={onIn}>
            <Svg><path d="M5 12h14M12 5v14" /></Svg>
          </button>
          <button type="button" className="bc-hud__btn bc-hud__btn--fit" aria-label="Show whole board" title="Show whole board" onClick={onFit}>
            <Svg><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>
          </button>
        </div>
      </div>
      <p className="hg-sr" aria-live="polite" aria-atomic="true" data-testid="camera-live">{announce}</p>
    </>
  );
}
