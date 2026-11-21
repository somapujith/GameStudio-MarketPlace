import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getAchievements } from '@/lib/api.js';
import { useUserEvents } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useApi, useApiReady } from '@/platform/home/useApi.js';
import { useAccount } from '@/components/shell/hooks.js';
import RewardChips from './RewardChips.jsx';
import { achievementProgress, achievementSummary, dateLabel, groupAchievements } from './engagementModel.js';
import '@/styles/engagement.css';

/** One badge: the catalogue icon on a medal (unlocked) or a locked medal with a progress bar, plus its reward. */
export function AchievementCard({ a, avatar, i = 0 }) {
  const prog = achievementProgress(a);
  const barId = `jg-ach-${a.id}-p`;
  return (
    <li className={`jg-ach ${a.unlocked ? 'is-unlocked' : 'is-locked'}`} style={{ '--i': Math.min(i, 10) }}>
      <span className="jg-ach__medal" aria-hidden="true">
        <HubIcon name={a.icon} size={28} strokeWidth={2.2} />
        {!a.unlocked && (
          <span className="jg-ach__lock">
            <HubIcon name="lock" size={12} strokeWidth={2.6} />
          </span>
        )}
      </span>
      <div className="jg-ach__body">
        <h4 className="jg-ach__name">{a.name}</h4>
        <p className="jg-ach__desc">{a.description}</p>
        {a.unlocked ? (
          <p className="jg-ach__date">
            <HubIcon name="check" size={13} strokeWidth={3} />
            <span>
              Unlocked{a.unlockedAt ? <> <time dateTime={a.unlockedAt}>{dateLabel(a.unlockedAt)}</time></> : null}
            </span>
          </p>
        ) : prog ? (
          <div className="jg-ach__prog">
            <span
              className="jg-ach__bar"
              role="progressbar"
              aria-labelledby={barId}
              aria-valuemin={0}
              aria-valuemax={prog.goal}
              aria-valuenow={prog.value}
              aria-valuetext={prog.spoken}
            >
              <i style={{ width: `${prog.pct}%` }} />
            </span>
            <span className="jg-ach__count" id={barId}>
              <span className="sr-only">{a.name} progress: </span>
              {prog.text}
            </span>
          </div>
        ) : null}
        <RewardChips reward={a.reward} avatar={avatar} label={a.unlocked ? `${a.name} reward, collected` : `${a.name} reward`} className={a.unlocked ? 'is-earned' : ''} />
      </div>
    </li>
  );
}

/** Presentational (renders on the server): the summary, then one titled grid per category. */
export function AchievementsView({ data, status = 'ok', signedIn = true, avatar, onRetry }) {
  const groups = useMemo(() => groupAchievements(data?.achievements), [data]);
  const sum = achievementSummary(data);
  const pct = sum.total ? Math.round((sum.unlocked / sum.total) * 100) : 0;
  return (
    <section id="achievements" className="hub-section sa-anchor jg-achs" aria-labelledby="jg-achs-h">
      <div className="hub-section__head jg-achs__head">
        <h2 id="jg-achs-h" className="hub-section__title">
          Achievements
        </h2>
        {status === 'ok' && signedIn && (
          <p className="jg-achs__sum">
            <b>{sum.text}</b>
            <span className="jg-achs__meter" role="progressbar" aria-label="Achievements unlocked" aria-valuemin={0} aria-valuemax={sum.total} aria-valuenow={sum.unlocked} aria-valuetext={sum.text}>
              <i style={{ width: `${pct}%` }} />
            </span>
          </p>
        )}
      </div>
      {!signedIn && (
        <div className="hh2-banner jg-achs__gate" role="note">
          <HubIcon name="lock" size={20} />
          <p>Sign in to track your progress, unlock badges and collect their coins and items.</p>
          <Link to={paths.login(paths.profile())} className="hub-btn hub-btn--primary hub-btn--sm">
            Sign in
          </Link>
        </div>
      )}
      {status === 'loading' ? (
        <ul className="jg-ach-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((k) => (
            <li key={k} className="jg-ach jg-ach--skel">
              <span className="st-skel jg-ach__medal" />
              <span className="st-skel" style={{ height: 14, width: '60%' }} />
            </li>
          ))}
        </ul>
      ) : status !== 'ok' ? (
        <div className="hub-empty jg-achs__err">
          <p className="hub-empty__title">{status === 'offline' ? 'You are offline' : 'Could not load achievements'}</p>
          <p className="hub-empty__text">Your badges are safe. Try again in a moment.</p>
          {onRetry && (
            <div className="hub-empty__actions">
              <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={onRetry}>
                <HubIcon name="refresh" size={16} /> Try again
              </button>
            </div>
          )}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.category} className="jg-achs__group">
            <h3 className="jg-achs__cat">
              {g.label}
              {signedIn && (
                <span className="jg-achs__catn" aria-label={`${g.unlocked} of ${g.items.length} unlocked`}>
                  {g.unlocked}/{g.items.length}
                </span>
              )}
            </h3>
            <ul className="jg-ach-grid">
              {g.items.map((a, i) => (
                <AchievementCard key={a.id} a={a} avatar={avatar} i={i} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** Profile section: GET /api/achievements (progress when signed in); reloads when an unlock arrives live. */
export default function AchievementsGrid() {
  const ready = useApiReady();
  const { user, signedIn } = useAccount();
  const res = useApi('/api/achievements', { enabled: ready, fetcher: getAchievements });
  useUserEvents((msg) => {
    // an unlock notification, or an `items` push (a reward item landed): the numbers moved
    if (!msg?.notification || msg.notification.kind === 'achievement') res.reload();
  }, ['notification', 'items']);
  const status = !ready ? 'loading' : res.status === 'idle' ? 'loading' : res.status;
  return <AchievementsView data={res.data} status={status} signedIn={signedIn} avatar={user?.avatar} onRetry={res.reload} />;
}
