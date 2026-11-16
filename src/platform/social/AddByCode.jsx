import { useId, useRef, useState } from 'react';
import { errorMessage, requestFriendByHandle, requestFriendByCode } from '@/lib/api.js';
import { normalizeFriendCode, parseFriendLink } from '@/components/online/codes.js';
import { parseFriendInput } from '@/components/online/friendsModel.js';
import SIcon from './SIcon.jsx';
import '@/styles/handle.css';

/**
 * "Add by code": a friend code (HYD-7K2Q), a pasted friend link or an @username. Sends POST /api/friends/request.
 * `embedded` drops the card and its heading so AddFriendPanel can place it as one of its sections.
 */
export default function AddByCode({ myCode, myHandle, onSent, onNotify, embedded = false }) {
  const uid = useId();
  const inputId = `${uid}-code`;
  const errorId = `${uid}-error`;
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (adding) return;
    const parsed = parseFriendInput(code);
    if (parsed.kind === 'invalid') {
      setError(
        code.trim().startsWith('@')
          ? 'Usernames are 3-20 letters, numbers or underscores, starting with a letter (e.g. @chai_uncle).'
          : 'Friend codes look like HYD-7K2Q (4 letters or numbers after HYD-). You can also paste a friend link or type @username.',
      );
      input.current?.focus();
      return;
    }
    if (parsed.kind === 'code' && parsed.value === myCode) {
      setError('That is your own code. Share it with a friend instead.');
      return;
    }
    if (parsed.kind === 'handle' && myHandle && parsed.value === String(myHandle).toLowerCase()) {
      setError('That is your own username. Share it with a friend instead.');
      return;
    }
    setAdding(true);
    setError('');
    try {
      await (parsed.kind === 'handle' ? requestFriendByHandle(parsed.value) : requestFriendByCode(parsed.value));
      setCode('');
      onNotify?.('Friend request sent', 'good');
      onSent?.();
    } catch (err) {
      const msg = errorMessage(err, 'Could not send the request');
      setError(msg);
      onNotify?.(msg, 'bad');
    } finally {
      setAdding(false);
    }
  };

  const form = (
    <form onSubmit={submit} noValidate>
      <label className="sc-add__label" htmlFor={inputId}>
        Friend code, @username or link
      </label>
      <div className="sc-add__row">
        <input
          id={inputId}
          ref={input}
          className={`sc-add__input${code.startsWith('@') ? ' hd-lower' : ''}`}
          value={code}
          onChange={(e) => {
            const v = e.target.value;
            // "@username" stays as typed (lowercase); a pasted link/code becomes the clean code; plain typing is normalised as you go
            setCode(
              v.trimStart().startsWith('@')
                ? v.trim().slice(0, 21).toLowerCase()
                : parseFriendLink(v) || (v.includes('/') ? v : normalizeFriendCode(v)),
            );
            if (error) setError('');
          }}
          placeholder="HYD-7K2Q or @username"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <button type="submit" className="hub-btn hub-btn--primary" disabled={adding || !code}>
          <SIcon name="userPlus" size={17} /> {adding ? 'Sending...' : 'Add'}
        </button>
      </div>
      {error && (
        <p id={errorId} className="sc-add__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );

  if (embedded) return <div className="fa-code">{form}</div>;
  return (
    <section className="sc-card sc-add" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className="sc-card__title">
        Add by code
      </h2>
      {form}
    </section>
  );
}
