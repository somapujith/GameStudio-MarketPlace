import { Link } from 'react-router-dom';
import { HubLogo } from '@/platform/game/hubArt.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import '@/styles/x-legal.css';

const GROUPS = [
  {
    label: BRAND.name,
    links: [
      { to: paths.games(), text: 'Browse games' },
      { to: paths.join(), text: 'Join a table' },
      { to: paths.about(), text: 'About' },
    ],
  },
  {
    label: 'Help and legal',
    links: [
      { to: paths.help(), text: 'Help' },
      { to: paths.privacy(), text: 'Privacy' },
      { to: paths.terms(), text: 'Terms' },
    ],
  },
];

/**
 * Marketplace footer for the hub shell (About, Help, Privacy, Terms, Browse). Render it once, after the page content,
 * INSIDE `.hub-container` / `.hub-main`: the main area already reserves room for the bottom tab bar and the home
 * indicator (padding-bottom), so the footer never hides behind them. Never render it on game screens.
 */
export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="xl-footer" aria-label="Site footer">
      <div className="xl-footer__brand">
        <Link to={paths.hub()} className="xl-footer__logo" aria-label={`${BRAND.name}, home`}>
          <HubLogo size={26} />
        </Link>
        <p className="xl-footer__tag">{BRAND.tagline}</p>
      </div>
      <nav className="xl-footer__nav" aria-label="Footer">
        {GROUPS.map((g) => (
          <div key={g.label} className="xl-footer__group">
            <p className="xl-footer__label">{g.label}</p>
            <ul>
              {g.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to}>{l.text}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <p className="xl-footer__small">© {year} {BRAND.name}</p>
    </footer>
  );
}
