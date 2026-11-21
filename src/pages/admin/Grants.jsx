import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '@/lib/api.js';
import { LIMITS, PERMS, bulkCoinsError, bulkGrant, listUsers, maxLenError, parseIds, reasonError } from '@/lib/adminApi.js';
import { COSMETIC_KINDS } from '@shared/cosmetics.js';
import { paths } from '@/platform/paths.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { useToasts } from '@/components/online/Toasts.jsx';
import ConfirmAction from '@/components/admin/ConfirmAction.jsx';
import { useAdmin, useDebounced, useLoad } from '@/components/admin/hooks.js';
import { KIND_LABEL, fmtNum, grantPreview, grantableItems } from '@/components/admin/model.js';
import { AdmIcon, Card, Field, Forbidden, PageHead, UserAvatar } from '@/components/admin/ui.jsx';

const len = (s) => [...String(s ?? '')].length;

const AUDIENCES = [
  { value: 'ids', label: 'Specific users', hint: 'Paste ids or pick from search' },
  { value: 'members', label: 'All members', hint: 'Every signed-in Google account (not guests, not banned)' },
  { value: 'active7d', label: 'Active in the last 7 days', hint: 'Members seen in the last week' },
];

/** Pick users by search, for the "specific users" audience. */
function UserPicker({ picked, onPick }) {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const { data, loading, error } = useLoad(({ signal }) => listUsers({ q: term, filter: 'members', pageSize: 8 }, { signal }), [term], { skip: term.length < 2 });
  const results = term.length >= 2 ? data?.users || [] : [];
  return (
    <div className="adm-picker">
      <Field label="Find users" hint="Two or more characters: name, @handle, email, code">
        <input className="adm-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Search members" />
      </Field>
      <div aria-live="polite" className="adm-picker__results">
        {term.length >= 2 && loading ? <p className="adm-faint">Searching…</p> : null}
        {term.length >= 2 && error ? <p className="adm-error">{errorMessage(error)}</p> : null}
        {term.length >= 2 && !loading && !error && !results.length ? <p className="adm-faint">No members match “{term}”.</p> : null}
        {results.length ? (
          <ul className="adm-picker__list">
            {results.map((u) => {
              const on = picked.has(u.id);
              return (
                <li key={u.id}>
                  <button type="button" className={`adm-pick${on ? ' is-on' : ''}`} onClick={() => onPick(u)} aria-pressed={on}>
                    <UserAvatar preset={u.avatar} size={24} />
                    <span className="adm-pick__name">{u.name}</span>
                    {u.handle ? <span className="adm-faint">{`@${u.handle}`}</span> : null}
                    <AdmIcon name={on ? 'check' : 'plus'} size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** /admin/grants (admin only) */
export default function Grants() {
  useDocTitle('Grants · Admin · Jalebi Games');
  const { can, me } = useAdmin();
  const { push, node } = useToasts();
  const [audience, setAudience] = useState('ids');
  const [pasted, setPasted] = useState('');
  const [picked, setPicked] = useState(() => new Map()); // id -> name
  const [coins, setCoins] = useState('');
  const [itemId, setItemId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const items = useMemo(grantableItems, []);

  const parsed = parseIds(pasted);
  const ids = useMemo(() => [...new Set([...parsed.ids, ...picked.keys()])], [parsed.ids.join(','), picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const errs = {
    ids: audience !== 'ids' ? '' : parsed.bad.length ? `Not a user id: ${parsed.bad.slice(0, 3).join(', ')}${parsed.bad.length > 3 ? '…' : ''}` : !ids.length ? 'Add at least one user.' : ids.length > LIMITS.bulkIdsMax ? `At most ${LIMITS.bulkIdsMax} users at once.` : '',
    coins: bulkCoinsError(coins),
    gift: !String(coins).trim() && !itemId ? 'Give coins, an item or both.' : '',
    title: maxLenError(title, LIMITS.grantTitleMax),
    message: maxLenError(message, LIMITS.grantMessageMax),
    reason: reasonError(reason),
  };
  const invalid = Object.values(errs).some(Boolean);
  const preview = grantPreview({ audience, count: ids.length, coins: Number(coins) || 0, itemId });
  const whole = audience !== 'ids';

  if (me && !can(PERMS.bulk)) {
    return (
      <div className="adm-page">
        <PageHead title="Grants" />
        <Forbidden />
      </div>
    );
  }

  const togglePick = (u) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(u.id)) n.delete(u.id);
      else n.set(u.id, u.name);
      return n;
    });

  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    setResult(null);
    if (!invalid) setConfirming(true);
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await bulkGrant({
        audience,
        ids: audience === 'ids' ? ids : undefined,
        coins: Number(coins) || undefined,
        itemId: itemId || undefined,
        title: title.trim() || undefined,
        message: message.trim() || undefined,
        reason: reason.trim(),
      });
      const count = Number(r?.count) || 0;
      setResult({ count, preview });
      push(`Granted to ${fmtNum(count)} ${count === 1 ? 'user' : 'users'}.`, 'good');
      setConfirming(false);
      setTried(false);
      setReason('');
    } catch (err) {
      push(errorMessage(err, 'The grant failed.'), 'bad');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const show = (k, v) => (tried || v ? errs[k] : '');

  return (
    <div className="adm-page">
      <PageHead title="Grants" lead="Give coins or an item to many players at once. Each user gets a gift notification." />
      <form className="adm-grants" onSubmit={submit} noValidate>
        <div className="adm-grants__main">
          <Card title="1 · Audience">
            <fieldset className="adm-radios">
              <legend className="adm-sr">Who gets it</legend>
              {AUDIENCES.map((a) => (
                <label key={a.value} className={`adm-radio${audience === a.value ? ' is-on' : ''}`}>
                  <input type="radio" name="audience" value={a.value} checked={audience === a.value} onChange={() => setAudience(a.value)} />
                  <span className="adm-radio__text">
                    <b>{a.label}</b>
                    <span className="adm-faint">{a.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {audience === 'ids' ? (
              <div className="adm-grants__ids">
                <Field label="User ids" hint="Comma, space or one per line" error={tried || pasted ? (parsed.bad.length ? errs.ids : '') : ''}>
                  <textarea className="adm-input adm-textarea adm-mono" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} placeholder="1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed" />
                </Field>
                <UserPicker picked={picked} onPick={togglePick} />
                {picked.size ? (
                  <ul className="adm-tags" aria-label="Picked users">
                    {[...picked].map(([id, name]) => (
                      <li key={id} className="adm-tag">
                        {name}
                        <button type="button" className="adm-tag__x" onClick={() => togglePick({ id })} aria-label={`Remove ${name}`}>
                          <AdmIcon name="close" size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className={`adm-countline${tried && errs.ids && !parsed.bad.length ? ' adm-error' : ''}`}>
                  {tried && errs.ids && !parsed.bad.length ? errs.ids : `${fmtNum(ids.length)} ${ids.length === 1 ? 'user' : 'users'} selected (max ${LIMITS.bulkIdsMax})`}
                </p>
              </div>
            ) : null}
          </Card>

          <Card title="2 · Gift">
            <div className="adm-grid2">
              <Field label="Coins" hint={`1 to ${fmtNum(LIMITS.bulkCoinsMax)} each`} error={show('coins', coins)}>
                <input className="adm-input" inputMode="numeric" value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^\d]/g, ''))} placeholder="200" autoComplete="off" />
              </Field>
              <Field label="Item" hint="Users who own it already are skipped">
                <select className="adm-input adm-select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">No item</option>
                  {COSMETIC_KINDS.map((k) => {
                    const list = items.filter((i) => i.kind === k);
                    return list.length ? (
                      <optgroup key={k} label={KIND_LABEL[k] || k}>
                        {list.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} · {i.rarity}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </Field>
            </div>
            {tried && errs.gift ? <p className="adm-error">{errs.gift}</p> : null}
          </Card>

          <Card title="3 · Note">
            <Field label="Notification title (optional)" error={show('title', title)} count={len(title.trim())} max={LIMITS.grantTitleMax}>
              <input className="adm-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A Diwali gift from Jalebi Games" autoComplete="off" />
            </Field>
            <Field label="Message (optional)" error={show('message', message)} count={len(message.trim())} max={LIMITS.grantMessageMax}>
              <textarea className="adm-input adm-textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <Field label="Reason" hint="Kept in the audit log" error={show('reason', reason)} count={len(reason.trim())} max={LIMITS.reasonMax}>
              <input className="adm-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Diwali 2026 event" autoComplete="off" />
            </Field>
          </Card>
        </div>

        <aside className="adm-grants__side">
          <Card title="Preview" className="adm-preview-card">
            <p className="adm-preview" aria-live="polite">
              {preview}
              {preview.startsWith('Give') ? '.' : ''}
            </p>
            {whole ? (
              <p className="adm-warnline">
                <AdmIcon name="info" size={16} /> Goes to a whole audience. You will be asked to type GIVE.
              </p>
            ) : null}
            <button type="submit" className="adm-btn adm-btn--primary adm-btn--block">
              <AdmIcon name="gift" size={16} /> Review and grant
            </button>
            <div aria-live="polite">
              {result ? (
                <p className="adm-result">
                  <b>{fmtNum(result.count)}</b> {result.count === 1 ? 'user' : 'users'} granted. <Link to={`${paths.admin('audit')}?action=grant.bulk`}>See it in the audit log</Link>
                </p>
              ) : null}
            </div>
          </Card>
        </aside>
      </form>

      <ConfirmAction
        open={confirming}
        title={`${preview}?`}
        body={
          <>
            {title.trim() ? <>Notification: “{title.trim()}”. </> : null}
            Reason: “{reason.trim()}”. This cannot be undone in one step.
          </>
        }
        confirmLabel="Grant"
        busy={busy}
        typeToConfirm={whole ? 'GIVE' : ''}
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />
      {node}
    </div>
  );
}
