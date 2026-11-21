import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LIMITS, listUsers } from '@/lib/adminApi.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useDebounced, useLoad, useNow } from '@/components/admin/hooks.js';
import { fmtDate, fmtDateTime, fmtNum, readUserQuery, relTime, writeUserQuery } from '@/components/admin/model.js';
import { AdmIcon, Badge, Card, ChipGroup, Empty, ErrorState, Loading, PageHead, Pager, RoleChip, UserCell } from '@/components/admin/ui.jsx';

export const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'members', label: 'Members' },
  { value: 'guests', label: 'Guests' },
  { value: 'banned', label: 'Banned' },
  { value: 'staff', label: 'Staff' },
];
export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'last_seen', label: 'Last seen' },
  { value: 'coins', label: 'Most coins' },
  { value: 'level', label: 'Highest level' },
  { value: 'games', label: 'Most games' },
];

/** The users table (cards on phones). Pure. */
export function UsersTable({ users, now = Date.now() }) {
  const navigate = useNavigate();
  return (
    <div className="adm-tablewrap">
      <table className="adm-table adm-table--cards adm-table--users">
        <caption className="adm-sr">Users</caption>
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col" className="is-num">
              Coins
            </th>
            <th scope="col" className="is-num">
              Level
            </th>
            <th scope="col" className="is-num">
              Games
            </th>
            <th scope="col">Joined</th>
            <th scope="col">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.id}
              className={`adm-row--link${u.banned ? ' is-banned' : ''}`}
              onClick={(e) => {
                if (e.target.closest('a,button')) return;
                navigate(paths.admin(`users/${u.id}`));
              }}
            >
              <td data-label="User" className="adm-td-user">
                <UserCell id={u.id} name={u.name} handle={u.handle} avatar={u.avatar} sub={u.isGuest ? 'guest' : u.friendCode} />
                {u.banned ? <Badge tone="bad">Banned</Badge> : null}
              </td>
              <td data-label="Email" className="adm-td-email">
                {u.email ? <span className="adm-mono">{u.email}</span> : <span className="adm-faint">{u.isGuest ? 'Guest' : '–'}</span>}
              </td>
              <td data-label="Role">
                <RoleChip role={u.role} />
              </td>
              <td data-label="Coins" className="is-num">
                {fmtNum(u.coins)}
              </td>
              <td data-label="Level" className="is-num">
                {fmtNum(u.level)}
              </td>
              <td data-label="Games" className="is-num">
                {fmtNum(u.games)}
              </td>
              <td data-label="Joined">
                <time dateTime={u.createdAt} title={fmtDateTime(u.createdAt)}>
                  {fmtDate(u.createdAt)}
                </time>
              </td>
              <td data-label="Last seen">
                <time dateTime={u.lastSeen} title={fmtDateTime(u.lastSeen)}>
                  {relTime(u.lastSeen, now)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /admin/users: search (debounced), filter chips, sort, paginated. All of it lives in the query string. */
export default function Users({ initial }) {
  useDocTitle('Users · Admin · Jalebi Games');
  const [params, setParams] = useSearchParams();
  const query = readUserQuery(params);
  const [text, setText] = useState(query.q);
  const debounced = useDebounced(text, 300);
  const now = useNow();
  const first = useRef(true);
  const pageSize = LIMITS.usersPageSize;

  // typing -> URL (after 300 ms), back to page 1
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (debounced.trim() === query.q.trim()) return;
    setParams(writeUserQuery({ ...query, q: debounced, page: 1 }), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // URL -> box (back / forward)
  useEffect(() => {
    setText((t) => (t.trim() === query.q.trim() ? t : query.q));
  }, [query.q]);

  const set = (patch) => setParams(writeUserQuery({ ...query, page: 1, ...patch }));

  const { data, error, loading, reload } = useLoad(
    ({ signal }) => listUsers({ q: query.q, filter: query.filter, sort: query.sort, page: query.page, pageSize }, { signal }),
    [query.q, query.filter, query.sort, query.page],
    { initial },
  );
  const users = data?.users || [];
  const total = data?.total ?? 0;

  return (
    <div className="adm-page">
      <PageHead title="Users" lead="Find a player by name, @handle, email, friend code or id." />
      <Card flush className="adm-users">
        <div className="adm-toolbar">
          <div className="adm-search">
            <label htmlFor="adm-user-q" className="adm-sr">
              Search users
            </label>
            <AdmIcon name="search" size={18} className="adm-search__icon" />
            <input
              id="adm-user-q"
              className="adm-input adm-search__input"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Name, @handle, email, HYD-code or id"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <ChipGroup label="Filter users" options={FILTER_OPTIONS} value={query.filter} onChange={(filter) => set({ filter })} />
          <div className="adm-sort">
            <label htmlFor="adm-user-sort" className="adm-label adm-label--inline">
              Sort
            </label>
            <select id="adm-user-sort" className="adm-input adm-select" value={query.sort} onChange={(e) => set({ sort: e.target.value })}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="adm-sr" aria-live="polite">
          {loading ? 'Searching' : data ? `${total} users found` : ''}
        </p>
        {error && !data ? (
          <ErrorState error={error} onRetry={reload} what="users" />
        ) : !data ? (
          <Loading label="Loading users" rows={8} />
        ) : users.length ? (
          <div className={loading ? 'adm-stale' : undefined}>
            <UsersTable users={users} now={now} />
            <Pager page={query.page} total={total} pageSize={data.pageSize || pageSize} onPage={(page) => setParams(writeUserQuery({ ...query, page }))} label="User pages" />
          </div>
        ) : (
          <Empty title="No users match">{query.q ? `Nothing for “${query.q}”. Try a different spelling, an email or a friend code.` : 'Try another filter.'}</Empty>
        )}
      </Card>
    </div>
  );
}
