// The action panel on /admin/users/:id. Each form validates against the contract limits, then hands a request
// (`{ title, body, confirmLabel, danger, run, done }`) to the page, which confirms it in a dialog, runs it, toasts
// and reloads. Which forms show depends on GET /api/admin/me permissions and on who the target is.
import { useState } from 'react';
import {
  LIMITS,
  PERMS,
  ROLES,
  adjustCoins,
  adjustXp,
  amountError,
  banUser,
  grantItem,
  maxLenError,
  nameError,
  notifyUser,
  reasonError,
  renameUser,
  resetHandle,
  setRole,
  unbanUser,
} from '@/lib/adminApi.js';
import { cosmeticById } from '@shared/cosmetics.js';
import { ROLE_LABEL, fmtNum, itemGroups } from './model.js';
import { Card, Field } from './ui.jsx';

const len = (s) => [...String(s ?? '')].length;
const isStaffRole = (r) => r === 'moderator' || r === 'admin';

/** Who may do what to `target` (pure; the server enforces the same rules). */
export function actionRules({ can, selfId, target }) {
  const self = !!target && target.id === selfId;
  const staffTarget = !!target && isStaffRole(target.role);
  const isAdmin = can(PERMS.roles) || can(PERMS.economy);
  const moderate = can(PERMS.moderate);
  // moderators: never on staff; admins: never on themselves
  const moderateBlocked = !moderate ? 'Your role cannot moderate.' : self ? 'Not on your own account.' : staffTarget && !isAdmin ? 'Moderators cannot act on staff.' : '';
  const roleBlocked = !can(PERMS.roles) ? 'Admins only.' : self ? 'You cannot change your own role.' : target?.isGuest ? 'Guests cannot have a role.' : '';
  return {
    economy: can(PERMS.economy),
    moderate,
    moderateBlocked,
    roles: can(PERMS.roles),
    roleBlocked,
  };
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="adm-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`adm-seg__btn${value === o.value ? ' is-on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ReasonField({ value, onChange, show, optional = false, label = 'Reason' }) {
  return (
    <Field label={optional ? `${label} (optional)` : label} error={show ? reasonError(value, { optional }) : ''} count={len(value.trim())} max={LIMITS.reasonMax}>
      <input className="adm-input" value={value} onChange={(e) => onChange(e.target.value)} maxLength={LIMITS.reasonMax + 20} autoComplete="off" placeholder="Shown in the audit log" />
    </Field>
  );
}

/** Give / take coins. */
function CoinsForm({ user, onRequest }) {
  const [dir, setDir] = useState('give');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [tried, setTried] = useState(false);
  const signedAmount = (dir === 'take' ? -1 : 1) * Math.abs(Number(amount) || 0);
  const amountErr = amountError(amount.replace(/^-/, '')) || (dir === 'take' && Math.abs(signedAmount) > (user.coins || 0) ? `They only have ${fmtNum(user.coins)} coins.` : '');
  const reasonErr = reasonError(reason);
  const next = (user.coins || 0) + signedAmount;
  const reset = () => {
    setAmount('');
    setReason('');
    setTried(false);
  };
  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    if (amountErr || reasonErr) return;
    const n = Math.abs(signedAmount);
    onRequest(
      {
        title: dir === 'give' ? `Give ${fmtNum(n)} coins to ${user.name}?` : `Take ${fmtNum(n)} coins from ${user.name}?`,
        body: `Balance goes from ${fmtNum(user.coins)} to ${fmtNum(next)}. Reason: “${reason.trim()}”.${notify && dir === 'give' ? ' They get a gift notification.' : ''}`,
        confirmLabel: dir === 'give' ? 'Give coins' : 'Take coins',
        danger: dir === 'take',
        run: () => adjustCoins(user.id, { amount: signedAmount, reason: reason.trim(), notify }),
        done: (r) => `${user.name} now has ${fmtNum(r?.coins ?? next)} coins.`,
      },
      reset,
    );
  };
  return (
    <form className="adm-form" onSubmit={submit} noValidate>
      <h3 className="adm-form__title">Coins</h3>
      <Segmented label="Give or take coins" value={dir} onChange={setDir} options={[{ value: 'give', label: 'Give' }, { value: 'take', label: 'Take' }]} />
      <Field label="Amount" error={tried || amount ? amountErr : ''} hint={amount && !amountErr ? `New balance: ${fmtNum(next)}` : `Now ${fmtNum(user.coins)} coins`}>
        <input className="adm-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="500" autoComplete="off" />
      </Field>
      <ReasonField value={reason} onChange={setReason} show={tried || reason !== ''} />
      <label className="adm-check">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the player
      </label>
      <button type="submit" className={`adm-btn ${dir === 'take' ? 'adm-btn--danger' : 'adm-btn--primary'}`}>
        {dir === 'give' ? 'Give coins' : 'Take coins'}
      </button>
    </form>
  );
}

function XpForm({ user, onRequest }) {
  const [dir, setDir] = useState('give');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const amountErr = amountError(amount);
  const reasonErr = reasonError(reason);
  const n = Number(amount) || 0;
  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    if (amountErr || reasonErr) return;
    onRequest(
      {
        title: dir === 'give' ? `Give ${fmtNum(n)} XP to ${user.name}?` : `Take ${fmtNum(n)} XP from ${user.name}?`,
        body: `XP goes from ${fmtNum(user.xp)} to ${fmtNum(Math.max(0, (user.xp || 0) + (dir === 'take' ? -n : n)))} (never below 0). Reason: “${reason.trim()}”.`,
        confirmLabel: dir === 'give' ? 'Give XP' : 'Take XP',
        danger: dir === 'take',
        run: () => adjustXp(user.id, { amount: dir === 'take' ? -n : n, reason: reason.trim() }),
        done: (r) => `${user.name} is now level ${fmtNum(r?.level)} with ${fmtNum(r?.xp)} XP.`,
      },
      () => {
        setAmount('');
        setReason('');
        setTried(false);
      },
    );
  };
  return (
    <form className="adm-form" onSubmit={submit} noValidate>
      <h3 className="adm-form__title">XP</h3>
      <Segmented label="Give or take XP" value={dir} onChange={setDir} options={[{ value: 'give', label: 'Give' }, { value: 'take', label: 'Take' }]} />
      <Field label="XP amount" error={tried || amount ? amountErr : ''} hint={`Now ${fmtNum(user.xp)} XP · level ${fmtNum(user.level)}`}>
        <input className="adm-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="250" autoComplete="off" />
      </Field>
      <ReasonField value={reason} onChange={setReason} show={tried || reason !== ''} />
      <button type="submit" className={`adm-btn ${dir === 'take' ? 'adm-btn--danger' : 'adm-btn--primary'}`}>
        {dir === 'give' ? 'Give XP' : 'Take XP'}
      </button>
    </form>
  );
}

function GrantItemForm({ user, owned, onRequest }) {
  const [itemId, setItemId] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [tried, setTried] = useState(false);
  const groups = itemGroups(owned);
  const item = cosmeticById(itemId);
  const itemErr = itemId ? '' : 'Pick an item.';
  const reasonErr = reasonError(reason);
  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    if (itemErr || reasonErr) return;
    onRequest(
      {
        title: `Grant ${item.name} to ${user.name}?`,
        body: `A ${item.rarity} ${item.kind} worth ${fmtNum(item.price)} coins. Reason: “${reason.trim()}”.${notify ? ' They get a gift notification.' : ''}`,
        confirmLabel: 'Grant item',
        run: () => grantItem(user.id, { itemId, reason: reason.trim(), notify }),
        done: () => `${item.name} granted to ${user.name}.`,
      },
      () => {
        setItemId('');
        setReason('');
        setTried(false);
      },
    );
  };
  return (
    <form className="adm-form" onSubmit={submit} noValidate>
      <h3 className="adm-form__title">Grant item</h3>
      <Field label="Item" error={tried ? itemErr : ''} hint="Owned and free items are greyed out.">
        <select className="adm-input adm-select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Choose a cosmetic…</option>
          {groups.map((g) => (
            <optgroup key={g.kind} label={g.label}>
              {g.items.map((i) => (
                <option key={i.id} value={i.id} disabled={i.disabled}>
                  {i.name} · {i.rarity}
                  {i.note ? ` (${i.note})` : ` · ${fmtNum(i.price)}`}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <ReasonField value={reason} onChange={setReason} show={tried || reason !== ''} />
      <label className="adm-check">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the player
      </label>
      <button type="submit" className="adm-btn adm-btn--primary">
        Grant item
      </button>
    </form>
  );
}

function MessageForm({ user, onRequest, blocked }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tried, setTried] = useState(false);
  const titleErr = maxLenError(title, LIMITS.notifyTitleMax, { required: true, label: 'A title' });
  const bodyErr = maxLenError(body, LIMITS.notifyBodyMax);
  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    if (titleErr || bodyErr || blocked) return;
    onRequest(
      {
        title: `Send a message to ${user.name}?`,
        body: `“${title.trim()}”${body.trim() ? `: ${body.trim()}` : ''}`,
        confirmLabel: 'Send message',
        run: () => notifyUser(user.id, { title: title.trim(), body: body.trim() || undefined }),
        done: () => `Message sent to ${user.name}.`,
      },
      () => {
        setTitle('');
        setBody('');
        setTried(false);
      },
    );
  };
  return (
    <form className="adm-form" onSubmit={submit} noValidate>
      <h3 className="adm-form__title">Send message</h3>
      <Field label="Title" error={tried || title ? titleErr : ''} count={len(title.trim())} max={LIMITS.notifyTitleMax}>
        <input className="adm-input" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" placeholder="Thanks for the bug report!" disabled={!!blocked} />
      </Field>
      <Field label="Message (optional)" error={body ? bodyErr : ''} count={len(body.trim())} max={LIMITS.notifyBodyMax}>
        <textarea className="adm-input adm-textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} disabled={!!blocked} />
      </Field>
      <button type="submit" className="adm-btn adm-btn--primary" disabled={!!blocked}>
        Send message
      </button>
    </form>
  );
}

function IdentityForm({ user, onRequest, blocked }) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [hReason, setHReason] = useState('');
  const [hTried, setHTried] = useState(false);
  const nameErr = nameError(name) || (name.trim() === user.name ? 'That is already their name.' : '');
  const reasonErr = reasonError(reason);
  const rename = (e) => {
    e.preventDefault();
    setTried(true);
    if (nameErr || reasonErr || blocked) return;
    const clean = name.replace(/\s+/g, ' ').trim();
    onRequest(
      {
        title: `Rename ${user.name} to “${clean}”?`,
        body: `Reason: “${reason.trim()}”.`,
        confirmLabel: 'Rename',
        run: () => renameUser(user.id, { name: clean, reason: reason.trim() }),
        done: (r) => `Renamed to ${r?.name || clean}.`,
      },
      () => {
        setName('');
        setReason('');
        setTried(false);
      },
    );
  };
  const hErr = reasonError(hReason);
  const reset = (e) => {
    e.preventDefault();
    setHTried(true);
    if (hErr || blocked || !user.handle) return;
    onRequest(
      {
        title: `Reset @${user.handle}?`,
        body: `${user.name} loses the username and can pick a new one. Reason: “${hReason.trim()}”.`,
        confirmLabel: 'Reset handle',
        danger: true,
        run: () => resetHandle(user.id, hReason.trim()),
        done: () => `Handle cleared for ${user.name}.`,
      },
      () => {
        setHReason('');
        setHTried(false);
      },
    );
  };
  return (
    <>
      <form className="adm-form" onSubmit={rename} noValidate>
        <h3 className="adm-form__title">Rename</h3>
        <Field label="New display name" error={tried || name ? nameErr : ''} count={len(name.trim())} max={LIMITS.nameMax}>
          <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={user.name} autoComplete="off" disabled={!!blocked} />
        </Field>
        <ReasonField value={reason} onChange={setReason} show={tried || reason !== ''} />
        <button type="submit" className="adm-btn adm-btn--ghost" disabled={!!blocked}>
          Rename
        </button>
      </form>
      <form className="adm-form" onSubmit={reset} noValidate>
        <h3 className="adm-form__title">Reset handle</h3>
        {user.handle ? (
          <>
            <ReasonField value={hReason} onChange={setHReason} show={hTried || hReason !== ''} />
            <button type="submit" className="adm-btn adm-btn--ghost" disabled={!!blocked}>
              {`Reset @${user.handle}`}
            </button>
          </>
        ) : (
          <p className="adm-faint adm-form__note">No username set.</p>
        )}
      </form>
    </>
  );
}

function BanForm({ user, onRequest, blocked }) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const banned = !!user.banned;
  const err = reasonError(reason, { optional: banned });
  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    if (err || blocked) return;
    onRequest(
      banned
        ? {
            title: `Unban ${user.name}?`,
            body: `They can sign in and play again.${reason.trim() ? ` Reason: “${reason.trim()}”.` : ''}`,
            confirmLabel: 'Unban',
            run: () => unbanUser(user.id, reason.trim() || undefined),
            done: () => `${user.name} is unbanned.`,
          }
        : {
            title: `Ban ${user.name}?`,
            body: `They are signed out of every table and see a suspended screen. Reason: “${reason.trim()}”.`,
            confirmLabel: 'Ban user',
            danger: true,
            run: () => banUser(user.id, reason.trim()),
            done: () => `${user.name} is banned.`,
          },
      () => {
        setReason('');
        setTried(false);
      },
    );
  };
  return (
    <form className={`adm-form${banned ? '' : ' adm-form--danger'}`} onSubmit={submit} noValidate>
      <h3 className="adm-form__title">{banned ? 'Unban' : 'Ban'}</h3>
      <ReasonField value={reason} onChange={setReason} show={tried || reason !== ''} optional={banned} />
      <button type="submit" className={`adm-btn ${banned ? 'adm-btn--ghost' : 'adm-btn--danger'}`} disabled={!!blocked}>
        {banned ? 'Unban user' : 'Ban user'}
      </button>
    </form>
  );
}

function RoleForm({ user, onRequest }) {
  const [role, setRoleValue] = useState(user.role || 'user');
  const submit = (e) => {
    e.preventDefault();
    if (role === user.role) return;
    onRequest({
      title: `Make ${user.name} ${role === 'user' ? 'a regular user' : `a ${ROLE_LABEL[role].toLowerCase()}`}?`,
      body: role === 'admin' ? 'Admins can change coins, items and roles for everyone.' : role === 'moderator' ? 'Moderators can ban, rename and message players and manage announcements.' : `${user.name} loses console access.`,
      confirmLabel: 'Change role',
      danger: role !== 'user' || user.role === 'admin',
      run: () => setRole(user.id, role),
      done: (r) => `${user.name} is now ${ROLE_LABEL[r?.role || role]}.`,
    });
  };
  return (
    <form className="adm-form" onSubmit={submit}>
      <h3 className="adm-form__title">Role</h3>
      <Field label="Role">
        <select className="adm-input adm-select" value={role} onChange={(e) => setRoleValue(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      <button type="submit" className="adm-btn adm-btn--ghost" disabled={role === user.role}>
        Change role
      </button>
    </form>
  );
}

/** The whole panel. `onRequest(spec, reset?)`. */
export default function UserActions({ user, owned = [], can, selfId, onRequest }) {
  const rules = actionRules({ can, selfId, target: user });
  if (!rules.economy && !rules.moderate && !rules.roles) return null;
  return (
    <div className="adm-actions">
      {rules.economy ? (
        <Card title="Economy" meta="admin">
          <div className="adm-forms">
            <CoinsForm user={user} onRequest={onRequest} />
            <XpForm user={user} onRequest={onRequest} />
            <GrantItemForm user={user} owned={owned} onRequest={onRequest} />
          </div>
        </Card>
      ) : null}
      {rules.moderate ? (
        <Card title="Moderation" meta={rules.moderateBlocked || undefined}>
          <div className="adm-forms">
            <MessageForm user={user} onRequest={onRequest} blocked={rules.moderateBlocked} />
            <IdentityForm user={user} onRequest={onRequest} blocked={rules.moderateBlocked} />
            <BanForm user={user} onRequest={onRequest} blocked={rules.moderateBlocked} />
          </div>
        </Card>
      ) : null}
      {rules.roles ? (
        <Card title="Access" meta={rules.roleBlocked || undefined}>
          {rules.roleBlocked ? <p className="adm-faint adm-form__note">{rules.roleBlocked}</p> : <RoleForm key={user.role} user={user} onRequest={onRequest} />}
        </Card>
      ) : null}
    </div>
  );
}
