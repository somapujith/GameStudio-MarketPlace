import { getAchievementStats } from '@/lib/adminApi.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useLoad } from '@/components/admin/hooks.js';
import { fmtNum, prizeText } from '@/components/admin/model.js';
import { achievementRows, rateText } from '@/components/admin/engagementModel.js';
import { AdmIcon, Card, Empty, ErrorState, Loading, Meter, PageHead, RefreshButton, StatTile } from '@/components/admin/ui.jsx';

const CATEGORY_LABEL = { play: 'Play', streak: 'Streak', collection: 'Collection', social: 'Social' };

/** The achievements table (catalogue order). Pure. */
export function AchievementsTable({ rows }) {
  return (
    <div className="adm-tablewrap">
      <table className="adm-table adm-table--cards adm-table--ach">
        <caption className="adm-sr">Achievements and unlock rates</caption>
        <thead>
          <tr>
            <th scope="col">Achievement</th>
            <th scope="col">Category</th>
            <th scope="col">Reward</th>
            <th scope="col" className="is-num">
              Unlocked
            </th>
            <th scope="col">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td data-label="Achievement" className="adm-td-wide">
                <span className="adm-ach">
                  <span className={`adm-ach__icon adm-ach__icon--${a.category}`} aria-hidden="true">
                    <AdmIcon name={a.icon} size={18} />
                  </span>
                  <span className="adm-ach__text">
                    <b>{a.name}</b>
                    <span className="adm-faint">{a.description}</span>
                  </span>
                </span>
              </td>
              <td data-label="Category">{CATEGORY_LABEL[a.category] || a.category}</td>
              <td data-label="Reward">
                <span className="adm-ach__reward">{prizeText(a.reward)}</span>
              </td>
              <td data-label="Unlocked" className="is-num">
                {fmtNum(a.unlocked)}
              </td>
              <td data-label="Rate" className="adm-td-rate">
                <span className="adm-rate">
                  <Meter value={a.rate} />
                  <span className="adm-rate__n">{a.rateLabel}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /admin/achievements (staff) */
export default function Achievements({ initial }) {
  useDocTitle('Achievements · Admin · Jalebi Games');
  const { data, error, loading, reload } = useLoad(({ signal }) => getAchievementStats({ signal }), [], { initial });
  const rows = data ? achievementRows(data) : [];
  const total = rows.reduce((n, r) => n + r.unlocked, 0);
  const sorted = [...rows].sort((a, b) => b.unlocked - a.unlocked);
  const most = sorted[0];
  const rarest = sorted.filter((r) => r.unlocked > 0).at(-1);
  const never = rows.filter((r) => !r.unlocked).length;

  return (
    <div className="adm-page">
      <PageHead title="Achievements" lead="Unlocks per badge, and the share of members who have it. Admins can grant one from a player's page.">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHead>
      {error && !data ? (
        <ErrorState error={error} onRetry={reload} what="achievements" />
      ) : !data ? (
        <Loading label="Loading achievements" rows={4} kind="tiles" />
      ) : (
        <>
          <div className="adm-tiles adm-tiles--sm" role="group" aria-label="Achievement totals">
            <StatTile label="Members" value={fmtNum(data.members)} sub="rates are over members" icon="users" />
            <StatTile label="Unlocks" value={fmtNum(total)} sub={data.members ? `${(total / data.members).toFixed(1)} per member` : undefined} tone="gold" />
            <StatTile label="Most unlocked" value={most && most.unlocked ? most.name : '–'} sub={most && most.unlocked ? rateText(most.rate) : 'none yet'} />
            <StatTile label="Rarest" value={rarest ? rarest.name : '–'} sub={rarest ? `${rarest.rateLabel}${never ? ` · ${never} never unlocked` : ''}` : 'none yet'} />
          </div>
          <Card title="Badges" meta={`${rows.length} in the catalogue`} flush>
            {rows.length ? (
              <div className={loading ? 'adm-stale' : undefined}>
                <AchievementsTable rows={rows} />
              </div>
            ) : (
              <Empty icon="star" title="No achievements in the catalogue" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
