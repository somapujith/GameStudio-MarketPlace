// Safe accessors for the hub art kit (`src/components/art/hub/index.js`, owned by the art agent).
//
// Every hub screen imports its art from HERE instead of from the kit directly. A namespace import never
// throws for a missing export, so if a piece of art is not delivered (or is renamed) the chrome still
// renders with the tiny fallbacks below instead of crashing the whole app.
import * as Kit from '@/components/art/hub/index.js';
import { HubLogo as JalebiLogo, HubMark as JalebiMark } from '@/components/art/hub/HubMark.jsx';

const pick = (name, fallback) => (Kit && Kit[name] ? Kit[name] : fallback);

function FallbackMark(props) {
  return <JalebiMark {...props} />;
}

function FallbackLogo(props) {
  return <JalebiLogo {...props} />;
}

const Nothing = () => null;

/** Small plain cover used only when the art kit has no cover for a game. */
function FallbackCover({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="160" height="90" fill="#1b2547" />
      <circle cx="120" cy="30" r="46" fill="#26325e" />
      <circle cx="30" cy="80" r="40" fill="#141c38" />
    </svg>
  );
}

export const HubLogo = pick('HubLogo', FallbackLogo);
export const HubMark = pick('HubMark', FallbackMark);
export const HubBackdrop = pick('HubBackdrop', Nothing);
export const CategoryIcon = pick('CategoryIcon', Nothing);
export const ComingSoonCover = pick('ComingSoonCover', FallbackCover);
export const ComingSoonIcon = pick('ComingSoonIcon', FallbackMark);
export const BadgeIcon = pick('BadgeIcon', Nothing);
export const TycoonCover = pick('TycoonCover', FallbackCover);
export const TycoonIcon = pick('TycoonIcon', FallbackMark);
export { FallbackCover };
