import HubIcon from '@/platform/game/HubIcon.jsx';
import { Preview } from '@/platform/home/Ava.jsx';
import { CoinIcon } from '@/components/shell/icons.jsx';
import { Countdown } from './useNow.jsx';
import { prizeTiers, seasonCountdown, seasonStatusAt, seasonStatusLabel, tierSpoken } from './engagementModel.js';

const compact = (n) => (n >= 100_000 ? `${Number((n / 100_000).toFixed(1))}L` : n >= 10_000 ? `${Number((n / 1000).toFixed(1))}K` : Number(n).toLocaleString('en-IN'));

/**
 * The season's glass card, in the leaderboard's "Your record" spot (same box, so the viewport-fit layout holds): status,
 * a once-a-minute countdown, the season name and its prize tiers (coins and item art; the row scrolls sideways when a
 * season has many tiers, it never grows the page). `season` null = no season at all.
 */
export default function SeasonCard({ season, now = Date.now(), avatar }) {
  if (!season) {
    return (
      <section className="cj-lb-season cj-lb-season--none" aria-labelledby="lb-season-h">
        <h2 id="lb-season-h" className="cj-lb-season__name">
          Seasons
        </h2>
        <p className="cj-lb-season__rules">Points races with prizes: 3 points a win, 1 a game. The next one shows up here.</p>
      </section>
    );
  }
  const status = seasonStatusAt(season, now);
  const cd = seasonCountdown({ ...season, status: season.status === 'paid' ? 'paid' : status }, now);
  const tiers = prizeTiers(season);
  return (
    <section className="cj-lb-season" aria-labelledby="lb-season-h" data-status={status}>
      <div className="cj-lb-season__head">
        <p className="cj-lb-season__kicker">
          <span className={`cj-lb-season__status cj-lb-season__status--${status}`}>
            {status === 'active' && <i className="cj-live-dot" aria-hidden="true" />}
            {seasonStatusLabel(status)}
          </span>
          {cd && <Countdown className="cj-lb-season__count" text={cd.text} spoken={cd.spoken} />}
        </p>
        <h2 id="lb-season-h" className="cj-lb-season__name" title={season.name}>
          {season.name}
        </h2>
      </div>
      {tiers.length > 0 ? (
        <ul className="cj-lb-season__tiers" aria-label="Prizes" tabIndex={tiers.length > 3 ? 0 : undefined}>
          {tiers.map((t) => (
            <li key={t.ranks} className="cj-lb-season__tier" title={tierSpoken(t)}>
              <span className="sr-only">{tierSpoken(t)}</span>
              <b aria-hidden="true">{t.ranks}</b>
              <span className="cj-lb-season__prize" aria-hidden="true">
                {t.coins > 0 && (
                  <span className="cj-lb-season__coins">
                    <CoinIcon size={14} />
                    {compact(t.coins)}
                  </span>
                )}
                {t.item && (
                  <span className={`cj-lb-season__item cj-lb-season__item--${t.item.kind}`}>
                    {t.item.kind === 'title' ? <HubIcon name="crown" size={16} /> : <Preview item={t.item} size={26} avatar={avatar} />}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cj-lb-season__rules">3 points a win, 1 a game. Bragging rights only this time.</p>
      )}
    </section>
  );
}
