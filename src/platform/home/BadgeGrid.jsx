import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeArt } from './GameArt.jsx';
import { buildBadgeContext, evaluateBadges, gameBadges, loadSeen, newlyEarned, saveSeen } from './badges.js';
import { fmtStat, resolveGameStats } from './gameStats.js';
import { useApi, useApiReady } from './useApi.js';
import { useAccount } from '@/components/shell/hooks.js';
import { useProfile } from '@/components/shell/stores.js';
import { BRAND } from '@/platform/brand.js';
import { celebrate } from '@/components/shell/celebrate.js';
import '@/styles/hubMoments.css';

/**
 * Badges: the platform's (badges.js) plus each live game's `manifest.badges`. When a badge becomes earned that
 * this device has not celebrated yet, the shell's celebration overlay shows it once. The first visit only records
 * what is already earned (no burst of old badges).
 */
export default function BadgeGrid({ games, user, level }) {
  const { account, signedIn, loading } = useAccount();
  const [profile] = useProfile();
  const ready = useApiReady();
  const friendsRes = useApi('/api/friends', { enabled: ready && account });
  const friends = friendsRes.status === 'ok' && Array.isArray(friendsRes.data?.friends) ? friendsRes.data.friends.length : null;
  const streak = signedIn && user?.daily ? user.daily.streak : profile.dailyStreak;

  const { platform, perGame } = useMemo(() => {
    const per = games.map((g) => resolveGameStats({ user, gameId: g.id })).filter(Boolean);
    const plat = evaluateBadges(buildBadgeContext({ perGame: per, streak, level, friends, liveGames: games.length }));
    const byGame = games
      .map((g) => {
        const own = user?.gameStats?.[g.id];
        const legacy = g.id === BRAND.defaultGameId ? user?.stats : null;
        return { game: g, badges: gameBadges(g, own, legacy) };
      })
      .filter((x) => x.badges.length);
    return { platform: plat, perGame: byGame };
  }, [games, user, streak, level, friends]);

  const all = useMemo(() => [...platform, ...perGame.flatMap((x) => x.badges)], [platform, perGame]);

  // Celebrate newly earned badges once per device. Wait until the account is known (and, for accounts, the
  // friends list settled) so a half-loaded profile never "earns" or re-celebrates anything.
  const uid = user?.id ? String(user.id) : 'local';
  const settled = !loading && (!account || friendsRes.status !== 'loading');
  const done = useRef(new Set());
  const [freshBadges, setFreshBadges] = useState(() => new Set());
  useEffect(() => {
    if (!settled) return;
    const earnedIds = all.filter((b) => b.earned).map((b) => b.id);
    const seen = loadSeen(uid);
    if (seen === null) {
      saveSeen(uid, earnedIds);
      return;
    }
    const fresh = newlyEarned(seen, all).filter((id) => !done.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => done.current.add(id));
    setFreshBadges(new Set(fresh));
    saveSeen(uid, [...seen, ...fresh]);
    const first = all.find((b) => b.id === fresh[0]);
    celebrate({
      kind: 'badge',
      title: `Badge unlocked: ${first.label}`,
      text: fresh.length > 1 ? `${first.desc}. Plus ${fresh.length - 1} more on your profile.` : first.desc,
      icon: 'medal',
    });
  }, [settled, all, uid]);

  const earned = all.filter((b) => b.earned).length;
  return (
    <section id="badges" className="cj-pro-sec" aria-labelledby="hh2-badges-h" data-tour="profile-badges">
      <div className="cj-pro-sec__head">
        <h2 id="hh2-badges-h" className="cj-pro-sec__title">
          Badges
          <span className="cj-pro-sec__count">
            {earned}/{all.length}
          </span>
        </h2>
      </div>
      <BadgeList badges={platform} fresh={freshBadges} />
      {perGame.map(({ game, badges }) => (
        <div key={game.id} className="cj-pro-badgegroup">
          <h3 className="cj-pro-sec__sub">{game.name}</h3>
          <BadgeList badges={badges} fresh={freshBadges} />
        </div>
      ))}
    </section>
  );
}

/** Wait for a new badge to enter view; old achievements remain still. */
function BadgeArtwork({ badge, fresh }) {
  const node = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!fresh) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: .5 });
    if (node.current) observer.observe(node.current);
    return () => observer.disconnect();
  }, [fresh]);
  return <span ref={node} className={`hub-moment-badge${badge.earned && fresh && visible ? ' is-new' : ''}`}><BadgeArt id={badge.art} size={64} locked={!badge.earned} /></span>;
}

function BadgeList({ badges, fresh }) {
  // earned first, then the closest to unlocking; the catalogue order breaks ties
  const sorted = badges
    .map((b, i) => ({ b, i }))
    .sort((x, y) => Number(y.b.earned) - Number(x.b.earned) || (x.b.earned ? 0 : y.b.pct - x.b.pct) || x.i - y.i)
    .map((x) => x.b);
  return (
    <ul className="cj-pro-badges">
      {sorted.map((b, i) => (
        <li key={b.id} className={`cj-pro-badge ${b.earned ? 'is-earned' : 'is-locked'}`} style={{ '--i': Math.min(i, 12) }}>
          <BadgeArtwork badge={b} fresh={fresh?.has(b.id)} />
          <b className="cj-pro-badge__name">{b.label}</b>
          <small className="cj-pro-badge__desc">
            {!b.earned && <span className="cj-pro-badge__how">How to earn</span>}
            {b.desc}
          </small>
          {b.earned ? (
            <span className="cj-pro-badge__state">Earned</span>
          ) : (
            <span className="cj-pro-bar-row">
              <span className="cj-pro-bar" aria-hidden="true">
                <i style={{ width: `${b.pct}%` }} />
              </span>
              <span className="sr-only">Locked. Progress </span>
              {fmtStat(b.value, b.format ? { format: b.format } : undefined)} / {fmtStat(b.target, b.format ? { format: b.format } : undefined)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
