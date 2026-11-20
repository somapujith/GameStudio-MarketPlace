import { HubMark } from './hubArt.jsx';

/** Hub loading state (Suspense fallback). `fullscreen` fills the viewport; otherwise it fills its container. */
export default function PageLoading({ label = 'Cooking up your next round…', fullscreen = false }) {
  return (
    <div className={`hub-loading jalebi-loading${fullscreen ? ' hub-loading--full' : ''}`} role="status" aria-live="polite">
      <span className="jalebi-loader" aria-hidden="true">
        <HubMark size={96} />
      </span>
      <span className="jalebi-loader__caption">{label}</span>
    </div>
  );
}
