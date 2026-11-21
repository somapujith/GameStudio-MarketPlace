import { Link } from 'react-router-dom';
import { getReferrals } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useLoad, useNow } from '@/components/admin/hooks.js';
import { fmtDateTime, fmtNum, relTime } from '@/components/admin/model.js';
import { conversionText } from '@/components/admin/engagementModel.js';
import { AdmIcon, Badge, Card, Empty, ErrorState, Loading, PageHead, RefreshButton, StatTile, UserCell } from '@/components/admin/ui.jsx';

/** Everything below the heading for a loaded GET /api/admin/referrals answer. Pure. */
export function ReferralsView({ data, now = Date.now() }) {
  const { top = [], recent = [], totals = {} } = data;
  return (
    <>
      <div className="adm-tiles" role="group" aria-label="Referral totals">
        <StatTile label="Invited" value={fmtNum(totals.invited)} sub="accounts created from a link" icon="share" />
        <StatTile label="Rewarded" value={fmtNum(totals.rewarded)} sub={`${conversionText(totals)} played a first match`} tone="orange" />
        <StatTile label="Coins paid" value={fmtNum(totals.coinsPaid)} sub="both sides, 250 each" tone="gold" />
      </div>
      <div className="adm-refs">
        <Card title="Top referrers" meta={`top ${top.length}`} flush>
          {top.length ? (
            <ol className="adm-rank">
              {top.map((r, i) => (
                <li key={r.id} className="adm-rank__row">
                  <span className="adm-rank__n">{i + 1}</span>
                  <UserCell id={r.id} name={r.name} avatar={r.avatar} />
                  <span className="adm-refs__nums">
                    <span>
                      <b>{fmtNum(r.rewarded)}</b> rewarded
                    </span>
                    <span className="adm-faint">{`${fmtNum(r.invited)} invited`}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty icon="share" title="Nobody has referred a friend yet" />
          )}
        </Card>
        <Card title="Recent referrals" meta={`latest ${recent.length}`} flush>
          {recent.length ? (
            <div className="adm-tablewrap">
              <table className="adm-table adm-table--cards adm-table--refs">
                <caption className="adm-sr">Recent referrals</caption>
                <thead>
                  <tr>
                    <th scope="col">Referrer → invitee</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Reward</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.invitee.id}>
                      <td data-label="Referral" className="adm-td-wide">
                        <span className="adm-refline">
                          <Link to={paths.admin(`users/${r.referrer.id}`)}>{r.referrer.name}</Link>
                          <AdmIcon name="arrowR" size={14} className="adm-refline__arrow" />
                          <span className="adm-sr">invited</span>
                          <Link to={paths.admin(`users/${r.invitee.id}`)}>{r.invitee.name}</Link>
                        </span>
                      </td>
                      <td data-label="Joined">
                        <time dateTime={r.joinedAt} title={fmtDateTime(r.joinedAt)}>
                          {relTime(r.joinedAt, now)}
                        </time>
                      </td>
                      <td data-label="Reward">{r.rewarded ? <Badge tone="good">Rewarded</Badge> : <Badge>No match yet</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="users" title="No referrals yet">
              A friend link is a player&apos;s code: /?ref=HYD-XXXX. Both get 250 coins after the new player&apos;s first match.
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}

/** /admin/referrals (staff) */
export default function Referrals({ initial }) {
  useDocTitle('Referrals · Admin · Jalebi Games');
  const now = useNow();
  const { data, error, loading, reload } = useLoad(({ signal }) => getReferrals({ signal }), [], { initial });
  return (
    <div className="adm-page">
      <PageHead title="Referrals" lead="Friends who signed up from a player's link. Both sides get 250 coins once the new player finishes a first match (a referrer is paid for at most 20 in 30 days).">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHead>
      {error && !data ? (
        <ErrorState error={error} onRetry={reload} what="referrals" />
      ) : !data ? (
        <Loading label="Loading referrals" rows={3} kind="tiles" />
      ) : (
        <div className={`adm-stack${loading ? " adm-stale" : ""}`}>
          <ReferralsView data={data} now={now} />
        </div>
      )}
    </div>
  );
}
