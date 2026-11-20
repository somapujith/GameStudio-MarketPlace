import { HubMark } from '@/components/art/hub/index.js';

/** Branded loading screen (Suspense fallback). `inline` fills only its container. */
export default function Loading({ label = 'Cooking up your next round…', inline = false }) {
  return (
    <div className={`hh-loading jalebi-loading ${inline ? 'hh-loading--inline' : ''}`} role="status" aria-live="polite">
      <div className="jalebi-loader" aria-hidden="true">
        <HubMark size={96} />
      </div>
      <p className="jalebi-loader__caption">{label}</p>
    </div>
  );
}
