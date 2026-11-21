import { Link } from 'react-router-dom';
import { listRooms } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useLoad, useNow, useVisibleInterval } from '@/components/admin/hooks.js';
import { fmtDateTime, gameName, relTime } from '@/components/admin/model.js';
import { Badge, Card, Empty, ErrorState, Loading, PageHead, RefreshButton, UserAvatar } from '@/components/admin/ui.jsx';

export const ROOMS_REFRESH_MS = 15000;
const STATUS_TONE = { lobby: 'info', playing: 'good', ended: 'plain', closed: 'plain' };

/** Rooms table (cards on phones). Pure. */
export function RoomsTable({ rooms, now = Date.now() }) {
  return (
    <div className="adm-tablewrap">
      <table className="adm-table adm-table--cards adm-table--rooms">
        <caption className="adm-sr">Rooms updated in the last 24 hours</caption>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Game</th>
            <th scope="col">Host</th>
            <th scope="col">Status</th>
            <th scope="col">Players</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.code}>
              <td data-label="Code">
                <span>
                  <code className="adm-code">{r.code}</code>
                  {r.visibility === 'public' ? <Badge>public</Badge> : null}
                </span>
              </td>
              <td data-label="Game">{gameName(r.gameId)}</td>
              <td data-label="Host">{r.hostName || <span className="adm-faint">–</span>}</td>
              <td data-label="Status">
                <Badge tone={STATUS_TONE[r.status] || 'plain'}>{r.status}</Badge>
              </td>
              <td data-label="Players" className="adm-td-members">
                <span className="adm-members">
                  <b className="adm-members__n">{`${r.playerCount}/${r.maxPlayers}`}</b>
                  <span className="adm-members__list">
                    {(r.members || []).map((m) => (
                      <Link key={m.id} to={paths.admin(`users/${m.id}`)} className="adm-member" title={m.name}>
                        <UserAvatar preset={m.avatar} size={24} />
                        <span className="adm-member__name">{m.name}</span>
                      </Link>
                    ))}
                  </span>
                </span>
              </td>
              <td data-label="Updated">
                <time dateTime={r.updatedAt} title={fmtDateTime(r.updatedAt)}>
                  {relTime(r.updatedAt, now)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /admin/rooms: refreshes every 15 s while the tab is visible. */
export default function Rooms({ initial }) {
  useDocTitle('Live tables · Admin · Jalebi Games');
  const { data, error, loading, reload } = useLoad(({ signal }) => listRooms({ signal }), [], { initial });
  useVisibleInterval(reload, ROOMS_REFRESH_MS);
  const now = useNow(15000);
  const rooms = data?.rooms || [];
  const playing = rooms.filter((r) => r.status === 'playing').length;
  const lobby = rooms.filter((r) => r.status === 'lobby').length;
  return (
    <div className="adm-page">
      <PageHead title="Live tables" lead="Rooms updated in the last 24 hours. Refreshes every 15 seconds while this tab is open.">
        <RefreshButton onClick={reload} busy={loading} />
      </PageHead>
      <Card flush title="Rooms" meta={data ? `${rooms.length} rooms · ${playing} playing · ${lobby} in lobby` : undefined}>
        <p className="adm-sr" aria-live="polite">
          {data ? `${rooms.length} rooms` : ''}
        </p>
        {error && !data ? (
          <ErrorState error={error} onRetry={reload} what="rooms" />
        ) : !data ? (
          <Loading label="Loading rooms" rows={6} />
        ) : rooms.length ? (
          <RoomsTable rooms={rooms} now={now} />
        ) : (
          <Empty icon="table" title="No tables in the last 24 hours">
            Rooms show up here as soon as someone opens one.
          </Empty>
        )}
        {error && data ? (
          <p className="adm-inline-error" role="alert">
            Auto-refresh failed. Showing the last list.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
