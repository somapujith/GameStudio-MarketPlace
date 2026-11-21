import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LIMITS, listMatches } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useLoad, useNow } from '@/components/admin/hooks.js';
import { fmtDateTime, fmtNum, gameName, relTime } from '@/components/admin/model.js';
import { AdmIcon, Badge, Card, Empty, ErrorState, Loading, PageHead, Pager, RefreshButton } from '@/components/admin/ui.jsx';

const duration = (a, b) => {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '–';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** Matches table with expandable player rows. Pure apart from which rows are open. */
export function MatchesTable({ matches, now = Date.now(), initiallyOpen = [] }) {
  const [open, setOpen] = useState(() => new Set(initiallyOpen));
  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="adm-tablewrap">
      <table className="adm-table adm-table--matches">
        <caption className="adm-sr">Finished matches</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="adm-sr">Expand</span>
            </th>
            <th scope="col">Game</th>
            <th scope="col">Winner</th>
            <th scope="col" className="is-num adm-hide-sm">
              Players
            </th>
            <th scope="col" className="adm-hide-sm">
              Rounds
            </th>
            <th scope="col" className="adm-hide-sm">
              Length
            </th>
            <th scope="col">Ended</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const isOpen = open.has(m.id);
            const panel = `adm-match-${m.id}`;
            const players = [...(m.players || [])].sort((a, b) => (a.rank || 99) - (b.rank || 99));
            return (
              <Fragment key={m.id}>
                <tr className={isOpen ? 'is-open' : undefined}>
                  <td className="is-act">
                    <button type="button" className="adm-iconbtn adm-expand" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(m.id)} aria-label={`${isOpen ? 'Hide' : 'Show'} players of match ${m.roomCode || ''}`}>
                      <AdmIcon name="chevR" size={16} />
                    </button>
                  </td>
                  <td>
                    <span className="adm-game-name">{gameName(m.gameId)}</span> {m.roomCode ? <code className="adm-code adm-code--sm">{m.roomCode}</code> : null}
                  </td>
                  <td>{m.winner ? m.winner.id ? <Link to={paths.admin(`users/${m.winner.id}`)}>{m.winner.name}</Link> : m.winner.name : <span className="adm-faint">no winner</span>}</td>
                  <td className="is-num adm-hide-sm">{m.playerCount}</td>
                  <td className="adm-hide-sm">{m.rounds ?? '–'}</td>
                  <td className="adm-hide-sm">{duration(m.startedAt, m.endedAt)}</td>
                  <td>
                    <time dateTime={m.endedAt} title={fmtDateTime(m.endedAt)}>
                      {relTime(m.endedAt, now)}
                    </time>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="adm-subrow" id={panel}>
                    <td colSpan={7}>
                      <ol className="adm-standings" aria-label="Final standings">
                        {players.map((p, i) => (
                          <li key={`${p.userId || 'bot'}-${i}`} className={`adm-standing${p.rank === 1 ? ' is-win' : ''}`}>
                            <span className="adm-standing__rank">#{p.rank ?? i + 1}</span>
                            <span className="adm-standing__name">
                              {p.userId && !p.isBot ? <Link to={paths.admin(`users/${p.userId}`)}>{p.name}</Link> : p.name}
                              {p.isBot ? <Badge>bot</Badge> : null}
                            </span>
                            <span className="adm-standing__worth">{fmtNum(p.finalWorth)}</span>
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** /admin/matches?page= */
export default function Matches({ initial }) {
  useDocTitle('Matches · Admin · Jalebi Games');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1);
  const pageSize = LIMITS.matchesPageSize;
  const now = useNow();
  const { data, error, loading, reload } = useLoad(({ signal }) => listMatches({ page, pageSize }, { signal }), [page], { initial });
  const matches = data?.matches || [];
  return (
    <div className="adm-page">
      <PageHead title="Matches" lead="Finished games, newest first. Open a row for the final standings.">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHead>
      <Card flush title="Finished matches" meta={data ? `${fmtNum(data.total)} total` : undefined}>
        {error && !data ? (
          <ErrorState error={error} onRetry={reload} what="matches" />
        ) : !data ? (
          <Loading label="Loading matches" rows={8} />
        ) : matches.length ? (
          <div className={loading ? 'adm-stale' : undefined}>
            <MatchesTable matches={matches} now={now} />
            <Pager page={page} total={data.total} pageSize={data.pageSize || pageSize} onPage={(p) => setParams(p > 1 ? { page: String(p) } : {})} label="Match pages" />
          </div>
        ) : (
          <Empty icon="trophy" title="No matches yet" />
        )}
      </Card>
    </div>
  );
}
