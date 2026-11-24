import { Link } from 'react-router-dom';
import { HubLogo } from '@/platform/game/hubArt.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import '@/styles/x-legal.css'; // still loaded globally here: the Help / About pages lean on its .xl-* blocks

const LINKS = [
  { to: paths.about(), text: 'About' },
  { to: paths.help(), text: 'Help' },
  { to: paths.privacy(), text: 'Privacy' },
  { to: paths.terms(), text: 'Terms' },
];

/**
 * The hub's minimal centred footer: the Jalebi logo, one quiet line, small links (About, Help, Privacy, Terms) and the
 * copyright. AppShell renders it once, after the page, inside `.hub-footslot`, which keeps it clear of the phone dock
 * and the home indicator. Never rendered on game screens.
 */
export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="cj-foot" aria-label="Site footer">
      <Link to={paths.hub()} className="cj-foot__logo" aria-label={`${BRAND.name}, home`}>
        <HubLogo size={34} compact={false} />
      </Link>
      <p className="cj-foot__line">
        {BRAND.tagline} Board games to play with your friends, right in the browser.
      </p>
      <nav aria-label="Footer">
        <ul className="cj-foot__links">
          {LINKS.map((l) => (
            <li key={l.to}>
              <Link to={l.to}>{l.text}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="cj-foot__small">
        © {year} {BRAND.name}
      </p>
    </footer>
  );
}
