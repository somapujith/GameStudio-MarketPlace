import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { errorMessage } from '@/lib/api.js';
import { LIMITS, PERMS, getAdminUser, reasonError, revokeItem } from '@/lib/adminApi.js';
import { cosmeticById } from '@shared/cosmetics.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useToasts } from '@/components/online/Toasts.jsx';
import ConfirmAction from '@/components/admin/ConfirmAction.jsx';
import UserActions from '@/components/admin/UserActions.jsx';
import { AuditTable } from '@/components/admin/AuditTable.jsx';
import { useAdmin, useLoad, useNow } from '@/components/admin/hooks.js';
import { KIND_LABEL, fmtDate, fmtDateTime, fmtNum, gameName, itemName, relTime } from '@/components/admin/model.js';
import { AdmIcon, Badge, Card, Empty, ErrorState, Field, Loading, OnlineDot, RoleChip, StatTile, UserAvatar } from '@/components/admin/ui.jsx';

const RARITY_TONE = { common: 'plain', rare: 'info', epic: 'violet', legendary: 'gold' };

function CopyId({ label, value }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* no clipboard: the text is selectable */
    }
  };
  return (
    <span className="adm-idchip">
      <span className="adm-idchip__k">{label}</span>
      <code className="adm-idchip__v">{value}</code>
      <button type="button" className="adm-iconbtn" onClick={copy} aria-label={`Copy ${label}`}>
        <AdmIcon name={done ? 'check' : 'copy'} size={14} />
      </button>
    </span>
  );
}

/** Everything on the page below the access check, for a loaded GET /users/:id answer. Pure apart from form state. */
export function UserDetailView({ detail, can, selfId, onRequest, onRevoke, now = Date.now() }) {
  const { user, items = [], friends, matches = [], actions = [], notifications = [], rooms = [] } = detail;
  const owned = items.map((i) => i.id);
  const winRate = user.games ? Math.round(((user.wins || 0) / user.games) * 100) : 0;
  const equipped = Object.entries(user.equipped || {}).filter(([, v]) => v);
  const economy = can(PERMS.economy);

  return (
    <>
      <header className={`adm-profile${user.banned ? ' is-banned' : ''}`}>
        <UserAvatar preset={user.avatar} size={72} />
        <div className="adm-profile__main">
          <div className="adm-profile__line">
            <h1 className="adm-h1 adm-profile__name">{user.name}</h1>
            <RoleChip role={user.role} />
            {user.isGuest ? <Badge>Guest</Badge> : null}
            {user.banned ? <Badge tone="bad">Banned</Badge> : null}
            <OnlineDot online={user.online} />
          </div>
          <p className="adm-profile__handle">{user.handle ? `@${user.handle}` : <span className="adm-faint">no username</span>}{user.email ? <span className="adm-mono"> · {user.email}</span> : null}</p>
          <div className="adm-profile__ids">
            <CopyId label="id" value={user.id} />
            <CopyId label="code" value={user.friendCode} />
          </div>
          {user.banned ? (
            <p className="adm-banline" role="note">
              <AdmIcon name="lock" size={16} /> Banned {user.bannedAt ? relTime(user.bannedAt, now) : ''}
              {user.banReason ? <>: “{user.banReason}”</> : null}
            </p>
          ) : null}
        </div>
      </header>

      <div className="adm-detail">
        <div className="adm-detail__main">
          <div className="adm-tiles adm-tiles--sm" role="group" aria-label="Player stats">
            <StatTile label="Coins" value={fmtNum(user.coins)} tone="gold" />
            <StatTile label="Level" value={fmtNum(user.level)} sub={`${fmtNum(user.xp)} XP`} />
            <StatTile label="Games" value={fmtNum(user.games)} sub={`${fmtNum(user.wins)} wins · ${winRate}%`} />
            <StatTile label="Daily streak" value={fmtNum(user.dailyStreak)} />
            <StatTile label="Best worth" value={fmtNum(user.bestWorth)} />
            <StatTile label="Rent earned" value={fmtNum(user.rentEarned)} />
            <StatTile label="Friends" value={fmtNum(friends?.count ?? 0)} />
            <StatTile label="Joined" value={fmtDate(user.createdAt)} sub={`seen ${relTime(user.lastSeen, now)}`} />
          </div>

          {rooms.length ? (
            <Card title="At a table now" flush>
              <ul className="adm-roomline">
                {rooms.map((r) => (
                  <li key={r.code}>
                    <code className="adm-code">{r.code}</code> {gameName(r.gameId)} <Badge tone={r.status === 'playing' ? 'good' : 'info'}>{r.status}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="Owned items" meta={`${items.length} · ${equipped.length ? `equipped: ${equipped.map(([, v]) => itemName(v)).join(', ')}` : 'nothing equipped'}`} flush>
            {items.length ? (
              <div className="adm-tablewrap">
                <table className="adm-table adm-table--cards">
                  <caption className="adm-sr">Owned items</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Rarity</th>
                      <th scope="col">Acquired</th>
                      <th scope="col" className="is-num">
                        Paid
                      </th>
                      {economy ? (
                        <th scope="col">
                          <span className="adm-sr">Actions</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id}>
                        <td data-label="Item" className="adm-td-wide">
                          <b>{it.name || itemName(it.id)}</b>
                        </td>
                        <td data-label="Kind">{KIND_LABEL[it.kind] || it.kind}</td>
                        <td data-label="Rarity">
                          <Badge tone={RARITY_TONE[it.rarity] || 'plain'}>{it.rarity}</Badge>
                        </td>
                        <td data-label="Acquired">
                          <time dateTime={it.acquiredAt} title={fmtDateTime(it.acquiredAt)}>
                            {fmtDate(it.acquiredAt)}
                          </time>
                        </td>
                        <td data-label="Paid" className="is-num">
                          {it.pricePaid ? fmtNum(it.pricePaid) : <span className="adm-faint">granted</span>}
                        </td>
                        {economy ? (
                          <td className="is-act">
                            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm adm-btn--warn" onClick={() => onRevoke(it)}>
                              <AdmIcon name="trash" size={14} /> Revoke
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon="gift" title="No items yet" />
            )}
          </Card>

          <Card title="Recent matches" meta={`latest ${matches.length}`} flush>
            {matches.length ? (
              <div className="adm-tablewrap">
                <table className="adm-table adm-table--cards">
                  <caption className="adm-sr">Recent matches</caption>
                  <thead>
                    <tr>
                      <th scope="col">Game</th>
                      <th scope="col">Ended</th>
                      <th scope="col" className="is-num">
                        Rank
                      </th>
                      <th scope="col" className="is-num">
                        Final worth
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => (
                      <tr key={m.id}>
                        <td data-label="Game" className="adm-td-wide">
                          <span>
                            {gameName(m.gameId)} {m.won ? <Badge tone="gold">Won</Badge> : null}
                          </span>
                        </td>
                        <td data-label="Ended">
                          <time dateTime={m.endedAt} title={fmtDateTime(m.endedAt)}>
                            {relTime(m.endedAt, now)}
                          </time>
                        </td>
                        <td data-label="Rank" className="is-num">
                          <span>
                            {m.rank ? `#${m.rank}` : '–'} <span className="adm-faint">{`of ${m.playerCount}`}</span>
                          </span>
                        </td>
                        <td data-label="Final worth" className="is-num">
                          {fmtNum(m.finalWorth)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon="trophy" title="No finished matches" />
            )}
          </Card>

          <Card title="Notifications sent" meta={`latest ${notifications.length}`} flush>
            {notifications.length ? (
              <ul className="adm-notes">
                {notifications.map((n) => (
                  <li key={n.id} className="adm-note">
                    <span className={`adm-note__kind adm-note__kind--${n.kind}`}>{n.kind}</span>
                    <span className="adm-note__text">
                      <b>{n.title}</b>
                      {n.body ? <span className="adm-note__body">{n.body}</span> : null}
                      <span className="adm-note__meta">
                        {n.data?.coins ? `+${fmtNum(n.data.coins)} coins · ` : ''}
                        {n.data?.xp ? `+${fmtNum(n.data.xp)} XP · ` : ''}
                        {n.data?.itemId ? `${n.data.itemName || itemName(n.data.itemId)} · ` : ''}
                        {n.data?.from ? `from ${n.data.from} · ` : ''}
                        <time dateTime={n.createdAt} title={fmtDateTime(n.createdAt)}>
                          {relTime(n.createdAt, now)}
                        </time>
                      </span>
                    </span>
                    <Badge tone={n.read ? 'plain' : 'info'}>{n.read ? 'read' : 'unread'}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon="bell" title="Nothing sent yet" />
            )}
          </Card>

          <Card
            title="Audit history"
            meta={`latest ${actions.length}`}
            flush
            actions={
              <Link className="adm-textlink" to={`${paths.admin('audit')}?targetId=${encodeURIComponent(user.id)}`}>
                Full log
              </Link>
            }
          >
            {actions.length ? <AuditTable actions={actions} now={now} hideTarget /> : <Empty icon="book" title="No admin actions on this user" />}
          </Card>
        </div>

        <aside className="adm-detail__side" aria-label="Actions" id="adm-user-actions">
          <UserActions user={user} owned={owned} can={can} selfId={selfId} onRequest={onRequest} />
        </aside>
      </div>
    </>
  );
}

/** /admin/users/:id */
export default function UserDetail({ initial }) {
  const { id } = useParams();
  const { user: me } = useAuth();
  const { can } = useAdmin();
  const { push, node } = useToasts();
  const now = useNow();
  const { data, error, loading, reload } = useLoad(({ signal }) => getAdminUser(id, { signal }), [id], { initial });
  const [pending, setPending] = useState(null); // { spec, reset }
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');
  useDocTitle(`${data?.user?.name || 'User'} · Admin · Jalebi Games`);

  const onRequest = useCallback((spec, reset) => setPending({ spec, reset }), []);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await pending.spec.run();
      push(pending.spec.done ? pending.spec.done(res) : 'Done.', 'good');
      pending.reset?.();
      setPending(null);
      reload();
    } catch (err) {
      push(errorMessage(err, 'That did not work.'), 'bad');
      setPending(null);
      if (err?.status === 404 || err?.status === 409) reload();
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async () => {
    if (!revoking || reasonError(revokeReason)) return;
    setBusy(true);
    try {
      await revokeItem(data.user.id, revoking.id, revokeReason.trim());
      push(`${revoking.name || itemName(revoking.id)} revoked from ${data.user.name}.`, 'good');
      setRevoking(null);
      setRevokeReason('');
      reload();
    } catch (err) {
      push(errorMessage(err, 'Could not revoke it.'), 'bad');
      setRevoking(null);
    } finally {
      setBusy(false);
    }
  };

  const revItem = revoking ? cosmeticById(revoking.id) : null;
  const revErr = reasonError(revokeReason);

  return (
    <div className="adm-page adm-page--detail">
      <nav className="adm-crumbs" aria-label="Breadcrumb">
        <Link to={paths.admin('users')}>
          <AdmIcon name="arrowL" size={14} /> Users
        </Link>
        {data?.user ? <span aria-current="page">{data.user.name}</span> : null}
        {data?.user ? (
          <a className="adm-crumbs__jump adm-textlink" href="#adm-user-actions">
            Jump to actions
          </a>
        ) : null}
      </nav>
      {error && !data ? (
        <ErrorState error={error} onRetry={reload} what="this user" />
      ) : !data ? (
        <Loading label="Loading user" rows={8} />
      ) : (
        <div className={`adm-detail-wrap${loading ? ' adm-stale' : ''}`}>
          <UserDetailView detail={data} can={can} selfId={me?.id} onRequest={onRequest} onRevoke={(it) => setRevoking(it)} now={now} />
        </div>
      )}

      <ConfirmAction
        open={!!pending}
        title={pending?.spec.title}
        body={pending?.spec.body}
        confirmLabel={pending?.spec.confirmLabel}
        danger={pending?.spec.danger}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
      <ConfirmAction
        open={!!revoking}
        title={revoking && data ? `Revoke ${revoking.name || itemName(revoking.id)} from ${data.user.name}?` : ''}
        body={revItem ? `The ${revItem.rarity} ${revItem.kind} is removed and unequipped. Coins are not refunded.` : 'The item is removed and unequipped.'}
        confirmLabel="Revoke item"
        danger
        busy={busy}
        confirmDisabled={!!revErr}
        onConfirm={doRevoke}
        onCancel={() => {
          setRevoking(null);
          setRevokeReason('');
        }}
      >
        <Field label="Reason" error={revokeReason ? revErr : ''} count={[...revokeReason.trim()].length} max={LIMITS.reasonMax}>
          <input className="adm-input" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} data-autofocus autoComplete="off" placeholder="Shown in the audit log" />
        </Field>
      </ConfirmAction>
      <div className="adm-sr" aria-live="polite">
        {loading && data ? 'Refreshing' : ''}
      </div>
      {node}
    </div>
  );
}
