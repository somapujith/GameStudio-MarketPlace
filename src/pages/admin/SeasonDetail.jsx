import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api.js';
import { getSeasonStandings, payoutSeason } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useToasts } from '@/components/online/Toasts.jsx';
import ConfirmAction from '@/components/admin/ConfirmAction.jsx';
import { useAdmin, useLoad, useNow } from '@/components/admin/hooks.js';
import { fmtDateTime, fmtNum, prizeText, tierSummary } from '@/components/admin/model.js';
import { SEASON_STATUS, payoutConfirmCopy, payoutGate, payoutTotals, seasonStatus, windowHint } from '@/components/admin/engagementModel.js';
import { AdmIcon, Badge, Card, Empty, ErrorState, Loading, StatTile, UserCell } from '@/components/admin/ui.jsx';

/** The payout card: the gate, the button and the last result. Pure apart from the callback. */
export function PayoutPanel({ season, totals, gate, onPayout, result, error }) {
  const st = seasonStatus(season);
  return (
    <Card title="Payout" meta={st === 'paid' ? 'done' : st === 'ended' ? 'ready' : 'locked'} className="adm-payout">
      <div className="adm-payout__body">
        <dl className="adm-payout__sum">
          <div>
            <dt>Winners</dt>
            <dd>{fmtNum(totals.winners)}</dd>
          </div>
          <div>
            <dt>Coins</dt>
            <dd>{fmtNum(totals.coins)}</dd>
          </div>
          <div>
            <dt>Items</dt>
            <dd>{fmtNum(totals.items.reduce((n, i) => n + i.count, 0))}</dd>
          </div>
        </dl>
        {result != null ? (
          <p className="adm-result" role="status">
            <b>{fmtNum(result)}</b> {result === 1 ? 'winner was' : 'winners were'} paid. Their gifts are in their inboxes.
          </p>
        ) : null}
        {error ? (
          <p className="adm-formerror" role="alert">
            <AdmIcon name="info" size={15} /> {error}
          </p>
        ) : null}
        <button type="button" className="adm-btn adm-btn--primary adm-btn--block" onClick={onPayout} disabled={!gate.enabled} aria-describedby={gate.reason ? 'adm-payout-why' : undefined}>
          <AdmIcon name="gift" size={16} /> Pay out
        </button>
        {gate.reason ? (
          <p className="adm-hint adm-payout__why" id="adm-payout-why">
            <AdmIcon name="lock" size={13} /> {gate.reason}
          </p>
        ) : (
          <p className="adm-hint adm-payout__why">Grants every prize once, from the final standings. You will be asked to type PAY.</p>
        )}
      </div>
    </Card>
  );
}

/** Everything below the crumbs for a loaded GET /seasons/:id/standings answer. */
export function SeasonDetailView({ data, adminWrite, now = Date.now(), onPayout, result, payError }) {
  const { season, standings = [], prizesPreview = [] } = data;
  const st = seasonStatus(season, now);
  const [tone, label] = SEASON_STATUS[st];
  const totals = payoutTotals(prizesPreview);
  const gate = payoutGate({ season, adminWrite, now });
  const prizeOf = new Map(prizesPreview.map((p) => [p.rank, p]));
  const lines = tierSummary(season.prizeTiers);
  const final = st === 'paid';

  return (
    <>
      <header className="adm-head adm-season-head">
        <div className="adm-head__text">
          <p className="adm-kicker">Season</p>
          <h1 className="adm-h1">{season.name}</h1>
          <p className="adm-lead adm-season-head__line">
            <Badge tone={tone}>{label}</Badge>
            <span>
              <time dateTime={season.startsAt}>{fmtDateTime(season.startsAt)}</time> → <time dateTime={season.endsAt}>{fmtDateTime(season.endsAt)}</time>
            </span>
            <span className="adm-faint">{final && season.paidAt ? `paid ${fmtDateTime(season.paidAt)}` : windowHint(season.startsAt, season.endsAt, now)}</span>
          </p>
        </div>
      </header>

      <div className="adm-tiles adm-tiles--sm" role="group" aria-label="Season numbers">
        <StatTile label={final ? 'Final table' : 'Ranked now'} value={fmtNum(standings.length)} sub={standings.length >= 100 ? 'top 100 shown' : 'players with a match'} />
        <StatTile label="Prize winners" value={fmtNum(totals.winners)} tone="orange" />
        <StatTile label="Prize coins" value={fmtNum(totals.coins)} tone="gold" />
        <StatTile label="Leader" value={standings[0] ? fmtNum(standings[0].points) : '–'} sub={standings[0] ? `${standings[0].name} · points` : 'nobody yet'} />
      </div>

      <div className="adm-detail adm-detail--season">
        <div className="adm-detail__main">
          <Card title="Payout preview" meta={`${fmtNum(prizesPreview.length)} ${prizesPreview.length === 1 ? 'winner' : 'winners'}${final ? ' · paid' : ' · if it ended now'}`} flush>
            {prizesPreview.length ? (
              <div className="adm-tablewrap adm-tablewrap--tall">
                <table className="adm-table adm-table--tight">
                  <caption className="adm-sr">Payout preview</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="is-num">
                        Rank
                      </th>
                      <th scope="col">Player</th>
                      <th scope="col">Prize</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prizesPreview.map((p) => (
                      <tr key={p.rank}>
                        <td className="is-num adm-td-rank">{`#${p.rank}`}</td>
                        <td>
                          <Link to={paths.admin(`users/${p.userId}`)}>{p.name}</Link>
                        </td>
                        <td className="adm-td-prize">{prizeText(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon="gift" title={lines.length ? 'Nobody holds a prize rank yet' : 'This season has no prizes'}>
                {lines.length ? 'Winners appear as soon as players finish matches inside the window.' : 'Edit the season to add prize tiers before it ends.'}
              </Empty>
            )}
          </Card>

          <Card title={final ? 'Final standings' : 'Live standings'} meta={`top ${Math.min(100, standings.length)}`} flush>
            {standings.length ? (
              <div className="adm-tablewrap adm-tablewrap--tall">
                <table className="adm-table adm-table--tight adm-table--standings">
                  <caption className="adm-sr">Standings</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="is-num">
                        Rank
                      </th>
                      <th scope="col">Player</th>
                      <th scope="col" className="is-num">
                        Points
                      </th>
                      <th scope="col" className="is-num">
                        Wins
                      </th>
                      <th scope="col" className="is-num">
                        Games
                      </th>
                      <th scope="col">Prize</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((r) => {
                      const prize = prizeOf.get(r.rank);
                      return (
                        <tr key={r.userId} className={r.rank <= 3 ? `is-top is-top${r.rank}` : undefined}>
                          <td className="is-num adm-td-rank">{`#${r.rank}`}</td>
                          <td className="adm-td-user">
                            <UserCell id={r.userId} name={r.name} avatar={r.avatar} size={26} />
                          </td>
                          <td className="is-num">
                            <b>{fmtNum(r.points)}</b>
                          </td>
                          <td className="is-num">{fmtNum(r.wins)}</td>
                          <td className="is-num">{fmtNum(r.games)}</td>
                          <td className="adm-td-prize">{prize ? prizeText(prize) : <span className="adm-faint">–</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon="podium" title="No ranked players yet">
                Points come from matches finished inside the season window.
              </Empty>
            )}
          </Card>
        </div>

        <aside className="adm-detail__side adm-actions" aria-label="Prizes and payout">
          <PayoutPanel season={season} totals={totals} gate={gate} onPayout={onPayout} result={result} error={payError} />
          <Card title="Prize tiers" meta={`${lines.length} ${lines.length === 1 ? 'tier' : 'tiers'}`}>
            {lines.length ? (
              <ul className="adm-tiersum__list adm-tiersum__list--plain">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="adm-faint adm-form__note">No prizes set.</p>
            )}
            {st !== 'paid' && adminWrite ? (
              <p className="adm-hint adm-form__note adm-tiers__edit">
                <Link className="adm-textlink" to={paths.admin('seasons')}>
                  Edit on the seasons list
                </Link>
              </p>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  );
}

/** /admin/seasons/:id */
export default function SeasonDetail({ initial }) {
  const { id } = useParams();
  const { adminWrite } = useAdmin();
  const { push, node } = useToasts();
  const now = useNow();
  const { data, error, loading, reload } = useLoad(({ signal }) => getSeasonStandings(id, { signal }), [id], { initial });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [payError, setPayError] = useState('');
  useDocTitle(`${data?.season?.name || 'Season'} · Admin · Jalebi Games`);

  const totals = payoutTotals(data?.prizesPreview);
  const copy = payoutConfirmCopy(data?.season, totals);

  const pay = async () => {
    setBusy(true);
    setPayError('');
    try {
      const r = await payoutSeason(data.season.id);
      setResult(Number(r?.paid) || 0);
      push(`${data.season.name} paid out: ${fmtNum(r?.paid || 0)} winners.`, 'good');
      setConfirming(false);
      reload();
    } catch (err) {
      const msg = errorMessage(err, 'The payout did not go through.');
      setPayError(msg);
      push(msg, 'bad');
      setConfirming(false);
      if (err?.status === 409 || err?.status === 404) reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-page adm-page--detail">
      <nav className="adm-crumbs" aria-label="Breadcrumb">
        <Link to={paths.admin('seasons')}>
          <AdmIcon name="arrowL" size={14} /> Seasons
        </Link>
        {data?.season ? <span aria-current="page">{data.season.name}</span> : null}
      </nav>
      {error && !data ? (
        <ErrorState error={error} onRetry={reload} what="this season" />
      ) : !data ? (
        <Loading label="Loading standings" rows={8} />
      ) : (
        <div className={`adm-detail-wrap${loading ? ' adm-stale' : ''}`}>
          <SeasonDetailView data={data} adminWrite={adminWrite} now={now} onPayout={() => setConfirming(true)} result={result} payError={payError} />
        </div>
      )}
      <ConfirmAction open={confirming} title={copy.title} body={copy.body} confirmLabel="Pay out" danger typeToConfirm="PAY" busy={busy} onConfirm={pay} onCancel={() => setConfirming(false)} />
      {node}
    </div>
  );
}
