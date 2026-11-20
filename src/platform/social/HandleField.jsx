import { useEffect, useId, useState } from 'react';
import { checkHandle, errorMessage } from '@/lib/api.js';
import { useAccount } from '@/components/shell/hooks.js';
import { useToast } from '@/components/shell/Toast.jsx';
import { HANDLE_RULES, handleCooldownLeft, handleStatus, parseHandle } from '@/components/online/friendsModel.js';
import '@/styles/handle.css';

const CHECK_DELAY = 350;

/** The line under the field for each state (`remote` = the server's last answer for the typed value). */
export function handleMessage(status, value, remote, current) {
  switch (status) {
    case 'checking':
      return 'Checking...';
    case 'available':
      return `@${value} is available.`;
    case 'taken':
      return 'That username is taken.';
    case 'invalid':
      return remote && remote.value === value && remote.reason === 'reserved' ? 'That username is not available.' : `Usernames are ${HANDLE_RULES}`;
    default:
      return current && value === current ? 'This is your username. Friends can find you with it.' : 'Pick a username friends can find you by.';
  }
}

/**
 * The field itself, with no data fetching (so every state renders on the server for tests).
 * status: 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
 */
export function HandleFieldView({ id = 'hd-handle', value, onChange, onSubmit, status = 'idle', message, canSave = false, saving = false, locked = '', error = '' }) {
  const statusId = `${id}-status`;
  const rulesId = `${id}-rules`;
  const bad = status === 'taken' || status === 'invalid';
  return (
    <form className="hd-form" onSubmit={onSubmit} noValidate>
      <label className="hd-label" htmlFor={id}>
        Username
      </label>
      <div className="hd-row">
        <div className={`hd-field${locked ? ' is-locked' : ''}`} data-status={status}>
          <span className="hd-at" aria-hidden="true">
            @
          </span>
          <input
            id={id}
            className="hd-input"
            value={value}
            onChange={onChange}
            placeholder="chai_uncle"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={21}
            disabled={!!locked}
            aria-invalid={bad ? true : undefined}
            aria-describedby={`${statusId} ${rulesId}`}
          />
        </div>
        <button type="submit" className="hub-btn hub-btn--primary hd-save" disabled={!canSave || saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <p id={statusId} className={`hd-status hd-status--${error ? 'invalid' : status}`} role="status" aria-live="polite">
        {(error || status !== 'idle') && <span className="hd-status__dot" aria-hidden="true" />}
        {error || message}
      </p>
      <p id={rulesId} className="hd-rules">
        {HANDLE_RULES} You can change it once a week.
      </p>
      {locked && <p className="hd-note">{locked}</p>}
    </form>
  );
}

/** Profile > Username: claim or change your @username (members only; guests and signed-out visitors see nothing). */
export default function HandleField() {
  const { user, account, auth } = useAccount();
  const toast = useToast();
  const uid = useId();
  const current = (user && user.handle) || '';
  const [value, setValue] = useState(current);
  const [remote, setRemote] = useState(null); // { value, available, reason } | { value, failed: true } | null
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // a saved (or refreshed) handle becomes the field's value
  useEffect(() => {
    setValue(current);
  }, [current]);

  const typed = parseHandle(value);
  useEffect(() => {
    if (!typed || typed === current) {
      setRemote(null);
      return undefined;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      checkHandle(typed, { signal: ctrl.signal })
        .then((r) => {
          if (!ctrl.signal.aborted) setRemote({ value: typed, available: !!(r && r.available), reason: r && r.reason });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setRemote({ value: typed, failed: true });
        });
    }, CHECK_DELAY);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [typed, current]);

  if (!account) return null;

  const cooldown = handleCooldownLeft(user);
  const answer = remote && !remote.failed ? remote : null;
  const status = handleStatus(value, current, answer);
  // when the check itself could not run, keep the Save button usable: the server decides on save
  const unchecked = !!typed && typed !== current && remote && remote.failed;
  const canSave = !cooldown && (status === 'available' || unchecked);

  const onChange = (e) => {
    setValue(e.target.value.replace(/\s+/g, '').replace(/^@+/, '').toLowerCase());
    if (error) setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave || saving || !auth.updateProfile) return;
    setSaving(true);
    setError('');
    try {
      await auth.updateProfile({ handle: typed });
      toast(`Username saved: @${typed}`, { tone: 'success' });
    } catch (err) {
      if (err && err.status === 409) setRemote({ value: typed, available: false, reason: 'taken' });
      else setError(errorMessage(err, 'Could not save your username'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="username" className="hub-panel hd-card sa-anchor" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className="hub-section__title">
        Username
      </h2>
      <p className="hd-lede">Friends can search for @username to add you, even if other players share your display name.</p>
      <HandleFieldView
        id={`${uid}-handle`}
        value={value}
        onChange={onChange}
        onSubmit={submit}
        status={unchecked ? 'idle' : status}
        message={unchecked ? 'Could not check right now. Save to try it.' : handleMessage(status, typed || value, answer, current)}
        canSave={canSave}
        saving={saving}
        error={error}
        locked={cooldown ? `You can change your username again in ${cooldown} ${cooldown === 1 ? 'day' : 'days'}.` : ''}
      />
    </section>
  );
}
