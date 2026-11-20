import { Link, useLocation } from 'react-router-dom';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import IndiaArt from '@/components/art/IndiaArt.jsx';
import useDocTitle from '@/platform/game/useDocTitle.js';

/** A wrong turn in the gully, with the original Indian street-print art. */
export default function NotFound() {
  const { pathname } = useLocation();
  useDocTitle(`Page not found · ${BRAND.name}`);
  return (
    <section className="hub-404" aria-labelledby="hub-404-h">
      <IndiaArt art="jaipur" className="hub-404__print" decorative />
      <p className="hub-eyebrow">Error 404</p>
      <h1 id="hub-404-h" className="hub-h1">
        This table doesn't exist
      </h1>
      <p className="hub-lead">
        We couldn't find <code>{pathname}</code>. The link may be old, or the room may have closed.
      </p>
      <div className="hub-404__actions">
        <Link to={paths.hub()} className="hub-btn hub-btn--primary hub-btn--lg">
          <HubIcon name="gamepad" size={20} /> Browse games
        </Link>
        <button type="button" className="hub-btn hub-btn--ghost hub-btn--lg" onClick={() => window.dispatchEvent(new Event('hub:open-code'))}>
          <HubIcon name="hash" size={20} /> Have a code?
        </button>
      </div>
    </section>
  );
}
