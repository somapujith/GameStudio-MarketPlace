import { getAdminStats } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useLoad } from '@/components/admin/hooks.js';
import { fmtCompact, fmtNum } from '@/components/admin/model.js';
import TrendChart from '@/components/admin/TrendChart.jsx';
import { Card, Empty, ErrorState, Loading, PageHead, RefreshButton, StatTile, UserCell } from '@/components/admin/ui.jsx';
import { Link } from 'react-router-dom';

/** The stat tiles, charts and top holders for a GET /stats answer (pure: tests render it with mock data). */
export function DashboardView({ stats }) {
  const s = stats || {};
  const u = s.users || {};
  const series = s.series || { days: [], signups: [], active: [], matches: [] };
  const top = Array.isArray(s.topCoins) ? s.topCoins : [];
  return (
    <>
      <div className="adm-tiles" aria-label="Key numbers" role="group">
        <StatTile icon="users" label="Users" value={fmtCompact(u.total)} sub={`${fmtNum(u.members)} members · ${fmtNum(u.guests)} guests`} />
        <StatTile icon="bolt" label="Active" value={fmtNum(s.active?.day)} sub={`today · ${fmtNum(s.active?.week)} in 7 d`} />
        <StatTile icon="plus" label="Signups" value={fmtNum(s.signups?.today)} sub={`today · ${fmtNum(s.signups?.week)} in 7 d`} />
        <StatTile icon="trophy" label="Matches" value={fmtNum(s.matches?.today)} sub={`today · ${fmtNum(s.matches?.week)} in 7 d · ${fmtCompact(s.matches?.total)} all time`} />
        <StatTile icon="table" label="Live rooms" value={fmtNum(s.rooms?.live)} sub={`${fmtNum(s.rooms?.lobby)} in lobby · ${fmtNum(s.rooms?.playing)} playing`} tone="orange" />
        <StatTile icon="rupee" label="Coins in circulation" value={fmtCompact(s.economy?.coinsInCirculation)} sub={`avg ${fmtNum(Math.round(s.economy?.avgCoins || 0))} · ${fmtNum(s.economy?.itemsOwned)} items owned`} tone="gold" />
        <StatTile icon="lock" label="Banned" value={fmtNum(u.banned)} sub={`${fmtNum(u.staff)} staff`} tone={u.banned ? 'bad' : undefined} />
      </div>

      <div className="adm-dash">
        <Card title="Last 14 days" meta="UTC days" className="adm-dash__trends">
          <div className="adm-charts">
            <TrendChart title="Signups" days={series.days} values={series.signups} />
            <TrendChart title="Active" days={series.days} values={series.active} approx tone="teal" />
            <TrendChart title="Matches" days={series.days} values={series.matches} tone="yellow" />
          </div>
        </Card>
        <Card title="Top coin holders" meta="members" className="adm-dash__top" flush>
          {top.length ? (
            <ol className="adm-rank">
              {top.map((p, i) => (
                <li key={p.id} className="adm-rank__row">
                  <span className="adm-rank__n">{i + 1}</span>
                  <UserCell id={p.id} name={p.name} avatar={p.avatar} />
                  <b className="adm-rank__coins">{fmtNum(p.coins)}</b>
                </li>
              ))}
            </ol>
          ) : (
            <Empty icon="rupee" title="No members yet" />
          )}
          <div className="adm-card__foot">
            <Link className="adm-textlink" to={`${paths.admin('users')}?sort=coins`}>
              All users by coins
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}

/** /admin */
export default function Dashboard({ initial }) {
  useDocTitle('Dashboard · Admin · Jalebi Games');
  const { data, error, loading, reload } = useLoad(({ signal }) => getAdminStats({ signal }), [], { initial });
  return (
    <div className="adm-page">
      <PageHead title="Dashboard" lead="How the platform is doing right now.">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHead>
      {error && !data ? <ErrorState error={error} onRetry={reload} what="the numbers" /> : data ? <DashboardView stats={data} /> : <Loading label="Loading numbers" rows={7} kind="tiles" />}
      {error && data ? (
        <p className="adm-inline-error" role="alert">
          Refresh failed. Showing the last numbers.
        </p>
      ) : null}
    </div>
  );
}
