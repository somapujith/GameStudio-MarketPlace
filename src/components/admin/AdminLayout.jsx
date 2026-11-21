import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { PERMS } from '@/lib/adminApi.js';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { useAdmin } from './hooks.js';
import { AdmIcon, RoleChip, UserAvatar } from './ui.jsx';

/**
 * Sidebar sections, in order. `perm` hides an entry the role cannot use. Events, seasons, achievements and referrals
 * are readable by all staff; their writes are admin only and gated on the page.
 */
export const ADMIN_NAV = [
  { to: '', label: 'Dashboard', icon: 'home', end: true },
  { to: 'users', label: 'Users', icon: 'users' },
  { to: 'rooms', label: 'Live tables', icon: 'table' },
  { to: 'matches', label: 'Matches', icon: 'trophy' },
  { to: 'events', label: 'Events', icon: 'sparkle' },
  { to: 'seasons', label: 'Seasons', icon: 'crown' },
  { to: 'achievements', label: 'Achievements', icon: 'medal' },
  { to: 'referrals', label: 'Referrals', icon: 'share' },
  { to: 'grants', label: 'Grants', icon: 'gift', perm: PERMS.bulk },
  { to: 'announcements', label: 'Announcements', icon: 'bell' },
  { to: 'audit', label: 'Audit log', icon: 'book' },
];

/**
 * Full-screen console frame (outside the hub shell): a left sidebar with the sections, the signed-in admin and a
 * "Back to site" link. Below 900px it folds into a top bar plus a horizontally scrolling tab strip.
 */
export default function AdminLayout({ children }) {
  const { user } = useAuth();
  const { me, can } = useAdmin();
  const role = me?.role || user?.role;
  const items = ADMIN_NAV.filter((i) => !i.perm || !me || can(i.perm));

  return (
    <div className="adm">
      <a className="adm-skip" href="#adm-main">
        Skip to content
      </a>
      <aside className="adm-side">
        <div className="adm-side__brand">
          <Link to={paths.admin()} className="adm-brand">
            <span className="adm-brand__mark" aria-hidden="true">
              J
            </span>
            <span className="adm-brand__text">
              <span className="adm-brand__name">{BRAND.name}</span>
              <span className="adm-brand__sub">Admin console</span>
            </span>
          </Link>
          <span className="adm-side__me" aria-hidden="true">
            <RoleChip role={role} />
            <UserAvatar preset={user?.avatar} size={28} />
          </span>
          <Link to={paths.hub()} className="adm-side__back adm-side__back--top">
            <AdmIcon name="arrowL" size={16} />
            <span>Site</span>
          </Link>
        </div>
        <nav className="adm-nav" aria-label="Admin sections">
          <ul className="adm-nav__list">
            {items.map((i) => (
              <li key={i.label}>
                <NavLink to={paths.admin(i.to)} end={i.end} className={({ isActive }) => `adm-nav__link${isActive ? ' is-active' : ''}`}>
                  <AdmIcon name={i.icon} size={18} />
                  <span>{i.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="adm-side__foot">
          <div className="adm-whoami">
            <UserAvatar preset={user?.avatar} size={36} />
            <span className="adm-whoami__text">
              <span className="adm-whoami__name">{me?.name || user?.name || 'Staff'}</span>
              <RoleChip role={role} />
            </span>
          </div>
          <Link to={paths.hub()} className="adm-side__back">
            <AdmIcon name="arrowL" size={16} />
            <span>Back to site</span>
          </Link>
        </div>
      </aside>
      <main id="adm-main" className="adm-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
