import { useEffect, useId, useRef, useState } from 'react';
import { ROOM_CODE_LENGTH, extractRoomCode, isPlainCodeText, isRoomCode, normalizeRoomCode, rejectedChars } from './codes.js';
import '@/styles/join-code.css';

const GROUP = ROOM_CODE_LENGTH / 2; // boxes are shown 3 + 3 (display only: the value stays one 6-character string)

/** What a person typed or pasted -> up to 6 valid characters. A sentence or a link is searched for its code. */
function readCode(raw) {
  return isPlainCodeText(raw) ? normalizeRoomCode(raw) : extractRoomCode(raw) || normalizeRoomCode(raw);
}

/** Why the Paste button could not read the clipboard (pure, for tests). */
export function pasteHint(kind) {
  if (kind === 'empty') return 'No room code on your clipboard. Copy the code or the invite link first.';
  if (kind === 'unsupported') return 'This browser cannot paste with a button. Press and hold in the boxes, then choose Paste.';
  return 'Paste was blocked. Press and hold in the boxes, then choose Paste.';
}

function Check() {
  return (
    <svg className="jc__check-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" />
    </svg>
  );
}

/**
 * Six-box room-code entry, shown 3 + 3. One real <input> sits over the boxes, so typing, backspace, paste, autofill
 * and screen readers all behave natively. Everything is normalised (uppercase, unambiguous alphabet; a link or an
 * invite message pasted whole is reduced to its code). The row below has Paste (clipboard button) and Clear.
 *
 * `state`: 'idle' | 'checking' | 'ok' | 'error' ('ok' confirms with a calm check, 'error' shakes once).
 * `onInvalid(chars)` hears the look-alike characters (O I 0 1) that were dropped.
 * `onComplete(code)` fires exactly once when the 6th character lands (typed or pasted), so a caller can submit
 * without a button. `message` is a short line under the boxes (read out politely, assertively when `state` is 'error'),
 * tied to the input with aria-describedby next to `describedBy`. `showTools={false}` hides Paste and Clear.
 */
export default function CodeInput({ value, onChange, onInvalid, onComplete, state = 'idle', disabled = false, autoFocus = false, label = 'Room code', describedBy, message = '', showTools = true }) {
  const id = useId();
  const msgId = `${id}-msg`;
  const ref = useRef(null);
  const fired = useRef('');
  const noteTimer = useRef(null);
  const [focused, setFocused] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isRoomCode(value)) fired.current = '';
  }, [value]);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const toEnd = (el) => {
    const n = el.value.length;
    try {
      el.setSelectionRange(n, n);
    } catch {
      /* some input types do not support selection */
    }
  };
  const flash = (text) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 4200);
  };
  const commit = (next) => {
    onChange(next);
    if (onComplete && isRoomCode(next) && fired.current !== next) {
      fired.current = next;
      onComplete(next);
    }
  };
  const take = (text) => {
    const bad = isPlainCodeText(text) ? rejectedChars(text) : [];
    if (bad.length && onInvalid) onInvalid(bad);
    const next = extractRoomCode(text);
    if (!next) {
      flash(pasteHint('empty'));
      return;
    }
    setNote('');
    commit(next);
  };
  const paste = async () => {
    const read = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText;
    if (!read) {
      flash(pasteHint('unsupported'));
      ref.current?.focus();
      return;
    }
    try {
      take(await navigator.clipboard.readText());
    } catch {
      flash(pasteHint('blocked'));
      ref.current?.focus();
    }
  };
  const clear = () => {
    setNote('');
    onChange('');
    ref.current?.focus();
  };

  const text = message || note;
  const complete = isRoomCode(value);
  const active = focused ? Math.min(value.length, ROOM_CODE_LENGTH - 1) : -1;
  const box = (i) => (
    <span key={i} className={`jc__box${value[i] ? ' has-char' : ''}${i === active ? ' is-active' : ''}`} style={{ '--i': i }}>
      {value[i] ? (
        <span key={value[i]} className="jc__ch">
          {value[i]}
        </span>
      ) : null}
    </span>
  );
  const indexes = Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => i);

  return (
    <div className={`jc jc--${state}${focused ? ' is-focused' : ''}${disabled ? ' is-disabled' : ''}${complete ? ' is-complete' : ''}`}>
      <div
        className="jc__field"
        onClick={() => {
          ref.current?.focus();
          if (ref.current) toEnd(ref.current);
        }}
      >
        <label htmlFor={id} className="jc__sr">
          {`${label}, ${ROOM_CODE_LENGTH} characters`}
        </label>
        <input
          id={id}
          ref={ref}
          className="jc__input"
          type="text"
          inputMode="text"
          enterKeyHint="go"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          aria-invalid={state === 'error' || undefined}
          aria-describedby={[describedBy, msgId].filter(Boolean).join(' ')}
          onChange={(e) => {
            const raw = e.target.value;
            const bad = isPlainCodeText(raw) ? rejectedChars(raw) : [];
            if (bad.length && onInvalid) onInvalid(bad);
            setNote('');
            commit(readCode(raw));
          }}
          onPaste={(e) => {
            e.preventDefault();
            take(e.clipboardData.getData('text'));
          }}
          onFocus={(e) => {
            setFocused(true);
            toEnd(e.target);
          }}
          onBlur={() => setFocused(false)}
        />
        <div className="jc__boxes" aria-hidden="true">
          <span className="jc__group">{indexes.slice(0, GROUP).map(box)}</span>
          <i className="jc__sep" />
          <span className="jc__group">{indexes.slice(GROUP).map(box)}</span>
          <span className="jc__check">
            <Check />
          </span>
        </div>
      </div>

      {showTools && (
        <div className="jc__tools">
          {value.length < ROOM_CODE_LENGTH && (
            <button type="button" className="jc__btn" onClick={paste} disabled={disabled}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="8" y="3" width="8" height="4" rx="1.5" />
                <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
              </svg>
              Paste
            </button>
          )}
          {value.length > 0 && (
            <button type="button" className="jc__btn jc__btn--quiet" onClick={clear} disabled={disabled} aria-label="Clear the code">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              Clear
            </button>
          )}
        </div>
      )}

      <p id={msgId} className={`jc__msg${state === 'error' && text ? ' is-error' : ''}${state === 'ok' && text ? ' is-ok' : ''}`} aria-live={state === 'error' ? 'assertive' : 'polite'}>
        {text}
      </p>
    </div>
  );
}
