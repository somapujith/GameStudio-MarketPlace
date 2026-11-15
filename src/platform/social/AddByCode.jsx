import { useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api.js';
import { isFriendCode, normalizeFriendCode, parseFriendLink } from '@/components/online/codes.js';
import SIcon from './SIcon.jsx';

/** "Add by code": a friend code (HYD-7K2Q) or a pasted friend link. Sends POST /api/friends/request. */
export default function AddByCode({ myCode, onSent, onNotify }) {
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (adding) return;
    const c = parseFriendLink(code);
    if (!isFriendCode(c)) {
      setError('Friend codes look like HYD-7K2Q (4 letters or numbers after HYD-). You can also paste a friend link.');
      input.current?.focus();
      return;
    }
    if (c === myCode) {
      setError('That is your own code. Share it with a friend instead.');
      return;
    }
    setAdding(true);
    setError('');
    try {
      await api.post('/api/friends/request', { friendCode: c });
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

  return (
    <section className="sc-card sc-add" aria-labelledby="sc-add-h">
      <h2 id="sc-add-h" className="sc-card__title">
        Add by code
      </h2>
      <form onSubmit={submit} noValidate>
        <label className="sc-add__label" htmlFor="sc-add-code">
          Friend code or link
        </label>
        <div className="sc-add__row">
          <input
            id="sc-add-code"
            ref={input}
            className="sc-add__input"
            value={code}
            onChange={(e) => {
              const v = e.target.value;
              // a pasted link/code becomes the clean code; plain typing is normalised as you go
              setCode(parseFriendLink(v) || (v.includes('/') ? v : normalizeFriendCode(v)));
              if (error) setError('');
            }}
            placeholder="HYD-7K2Q"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'sc-add-error' : undefined}
          />
          <button type="submit" className="hub-btn hub-btn--primary" disabled={adding || !code}>
            <SIcon name="userPlus" size={17} /> {adding ? 'Sending...' : 'Add'}
          </button>
        </div>
        {error && (
          <p id="sc-add-error" className="sc-add__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
