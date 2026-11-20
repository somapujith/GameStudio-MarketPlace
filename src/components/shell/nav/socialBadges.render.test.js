// Social badges in the chrome: the Friends tab / rail item and the top-bar bell (rendered to HTML).
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';

const counts = vi.hoisted(() => ({ value: { requests: 0, invites: 0, total: 0 } }));
vi.mock('@/platform/social/useSocialCounts.js', async (orig) => ({ ...(await orig()), useSocialCounts: () => counts.value }));

const { default: TabBar, TopNav } = await import('../TabBar.jsx');
const { default: SocialBell } = await import('@/platform/social/SocialBell.jsx');
const { withSocialBadge, socialLabel } = await import('@/platform/social/useSocialCounts.js');

const inRouter = (el) => renderToString(h(StaticRouter, { location: '/' }, el));
const friendsLi = (html) => html.split('<li').find((s) => s.includes('href="/friends"')) || '';

describe('Friends nav badge', () => {
  const social = { requests: 2, invites: 1, total: 3 };
  const badges = withSocialBadge({ friends: { count: 0, online: 2 } }, social);

  it('tab bar (phones): count pill with a label on Friends only', () => {
    const html = inRouter(h(TabBar, { badges }));
    const li = friendsLi(html);
    expect(li).toContain('bd-badge');
    expect(li).toContain(`aria-label="${socialLabel(social)}"`);
    expect(li).toContain('>3<');
    expect(html.match(/class="bd-badge/g)).toHaveLength(1);
    expect(li).not.toContain('hub-navbadge--live'); // the count replaces the online dot
  });

  it('rail (wide screens): same pill', () => {
    const html = inRouter(h(TopNav, { badges }));
    expect(friendsLi(html)).toContain('bd-badge bd-badge--nav');
    expect(html.match(/class="bd-badge/g)).toHaveLength(1);
  });

  it('nothing waiting: no pill, the online dot stays', () => {
    const quiet = withSocialBadge({ friends: { count: 0, online: 2 } }, { requests: 0, invites: 0, total: 0 });
    const html = inRouter(h(TabBar, { badges: quiet }));
    expect(html).not.toContain('bd-badge');
    expect(html).toContain('hub-navbadge--live');
  });

  it('caps a large count at 99+', () => {
    const big = withSocialBadge({}, { requests: 120, invites: 0, total: 120 });
    expect(inRouter(h(TabBar, { badges: big }))).toContain('>99+<');
  });
});

describe('top-bar bell', () => {
  it('renders nothing at zero', () => {
    counts.value = { requests: 0, invites: 0, total: 0 };
    expect(inRouter(h(SocialBell))).toBe('');
  });
  it('links to the Requests card with the count', () => {
    counts.value = { requests: 2, invites: 0, total: 2 };
    const html = inRouter(h(SocialBell));
    expect(html).toContain('href="/friends#requests"');
    expect(html).toContain('aria-label="2 pending requests"');
    expect(html).toContain('>2<');
  });
  it('invites only: links to the invites inbox', () => {
    counts.value = { requests: 0, invites: 1, total: 1 };
    expect(inRouter(h(SocialBell))).toContain('href="/friends#invites"');
  });
});

