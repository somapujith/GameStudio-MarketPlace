// "Rotate your phone for the best view" with a Fullscreen button (hidden where fullscreen is unsupported, e.g. iPhone Safari).
import { CloseIcon, FullscreenIcon, RotateIcon } from './icons.jsx';

export default function RotateHint({ bottom, fullscreenSupported, onFullscreen, onDismiss }) {
  return (
    <div className="aw-ct-hint" role="status" style={{ bottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))` }}>
      <RotateIcon size={26} />
      <span>
        Rotate your phone for the best view
        <small>Landscape gives you the wide road</small>
      </span>
      {fullscreenSupported && (
        <button type="button" className="aw-ct-pill is-hot" onClick={onFullscreen}>
          <FullscreenIcon size={15} /> Fullscreen
        </button>
      )}
      <button type="button" className="aw-ct-x" aria-label="Dismiss" onClick={onDismiss}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
