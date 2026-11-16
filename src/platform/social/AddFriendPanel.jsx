import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { errorMessage, getRecentPlayers, searchPlayers } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { FriendAvatar, FriendTitle } from '@/components/online/InviteFriends.jsx';
import { handleLabel, mergeRelations } from '@/components/online/friendsModel.js';
import AddByCode from './AddByCode.jsx';
import AddFriendButton from './AddFriendButton.jsx';
import { loadFriends, useFriendStore } from './friendStore.js';
import { RowSkeleton } from './Rows.jsx';
import SIcon from './SIcon.jsx';
import '@/styles/social-add.css';
import '@/styles/handle.css';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;
const RECENT_SHOWN = 4;

/** One person: avatar, name, level (+ title) and either the add button or their relation. */
function PersonRow({ p, onSent }) {
  return (
    <li className="af-row">
      <span className="af-row__ava">
        <FriendAvatar person={p} size={44} />
      </span>
      <span className="af-row__main">
        <span className="af-row__name">{p.name}</span>
        {handleLabel(p) && <span className="hd-handle">{handleLabel(p)}</span>}
        <span className="af-row__sub">
          <span>Lv {p.level}</span>
          <FriendTitle person={p} />
        </span>
      </span>
      <span className="af-row__act">
        {p.relation === 'friends' ? (
          <span className="af-chip af-chip--good">
            <SIcon name="check" size={15} /> Friends
          </span>
        ) : (
          <AddFriendButton userId={p.id} name={p.name} onSent={onSent} />
        )}
      </span>
    </li>
  );
}

/**
 * "Add a friend" panel: find people by name, pick someone you recently played with, or enter a friend code.
 *
 * Props: { onDone? (called after a request was sent), compact? (inside a sheet / the lobby: no outer card),
 * onNotify?(text, tone) (toast hook; without it messages show inline) }.
 * Renders nothing for guests and signed-out visitors (they have no friends).
 */
export default function AddFriendPanel({ onDone, compact = false, onNotify }) {
  const { user } = useAuth();
  const member = !!user && !user.isGuest;
  const { data: local, status: storeStatus } = useFriendStore({ enabled: member });
  const uid = useId();
  const searchId = `${uid}-search`;
  const hintId = `${uid}-hint`;

  const [query, setQuery] = useState('');
  const [term, setTerm] = useState(''); // debounced + trimmed
  const [search, setSearch] = useState({ status: 'idle', players: [], error: '' }); // idle | loading | ready | error
  const [attempt, setAttempt] = useState(0);
  const [recent, setRecent] = useState({ status: 'loading', players: [] });
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [notice, setNotice] = useState('');
  const listRef = useRef(null);
  const noticeTimer = useRef(0);

  // debounce the typed text; below the minimum there is no request at all
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!member) return undefined;
    if (term.length < MIN_CHARS) {
      setSearch({ status: 'idle', players: [], error: '' });
      return undefined;
    }
    const ctrl = new AbortController();
    setSearch((s) => ({ status: 'loading', players: s.players, error: '' }));
    searchPlayers(term, { signal: ctrl.signal })
      .then((res) => {
        if (ctrl.signal.aborted) return;
        setSearch({ status: 'ready', players: Array.isArray(res && res.results) ? res.results : [], error: '' });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setSearch({ status: 'error', players: [], error: errorMessage(e, 'Could not search right now') });
      });
    return () => ctrl.abort();
  }, [member, term, attempt]);

  // "Recently played with": quiet on failure, hidden when empty
  useEffect(() => {
    if (!member) return undefined;
    const ctrl = new AbortController();
    getRecentPlayers({ signal: ctrl.signal })
      .then((res) => {
        if (!ctrl.signal.aborted) setRecent({ status: 'ready', players: Array.isArray(res && res.players) ? res.players : [] });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setRecent({ status: 'error', players: [] });
      });
    return () => ctrl.abort();
  }, [member]);

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // local friend data is fresher than what the server said a moment ago (see mergeRelations)
  const known = storeStatus === 'ready' ? local : null;
  const results = useMemo(() => mergeRelations(search.players, known, user && user.id), [search.players, known, user]);
  const recents = useMemo(() => mergeRelations(recent.players, known, user && user.id).filter((p) => p.relation !== 'friends'), [recent.players, known, user]);

  if (!member) return null;

  const sent = () => {
    loadFriends({ force: true });
    onDone?.();
  };
  const tell = (text, tone) => {
    onNotify?.(text, tone);
    clearTimeout(noticeTimer.current);
    setNotice(tone === 'bad' ? '' : text);
    if (tone !== 'bad') noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  };

  const typed = query.trim().length;
  const waiting = typed >= MIN_CHARS && (term !== query.trim() || search.status === 'loading');
  const shownRecents = showAllRecent ? recents : recents.slice(0, RECENT_SHOWN);
  const status =
    typed < MIN_CHARS
      ? ''
      : search.status === 'error'
        ? search.error
        : waiting
          ? 'Searching'
          : results.length === 0
            ? 'No players found'
            : `${results.length} ${results.length === 1 ? 'player' : 'players'} found`;

  const onKey = (e) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    } else if (e.key === 'ArrowDown') {
      const first = listRef.current && listRef.current.querySelector('button:not(:disabled)');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <section className={`af-panel${compact ? ' af-panel--compact' : ' sc-card'}`} aria-labelledby={`${uid}-h`}>
      <div className="af-head">
        <h2 id={`${uid}-h`} className="af-title">
          Add a friend
        </h2>
        {!compact && <p className="af-lede">Search by name or @username, pick someone you just played with, or use a code.</p>}
      </div>

      <div className="af-sec">
        <h3 className="af-h3">
          <label htmlFor={searchId}>Find by name or @username</label>
        </h3>
        <div className="af-search">
          <SIcon name="users" size={18} className="af-search__icon" />
          <input
            id={searchId}
            className="af-search__input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Name or @username"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={40}
            aria-describedby={hintId}
          />
          {query && (
            <button
              type="button"
              className="af-search__clear"
              onClick={() => {
                setQuery('');
                document.getElementById(searchId)?.focus();
              }}
              aria-label="Clear search"
            >
              <SIcon name="close" size={16} />
            </button>
          )}
        </div>
        <p id={hintId} className="af-hint" role="status" aria-live="polite">
          {typed === 0 ? `Type at least ${MIN_CHARS} letters.` : typed < MIN_CHARS ? `Keep typing: ${MIN_CHARS} letters or more.` : status}
        </p>

        {typed >= MIN_CHARS && (
          <div className="af-results" ref={listRef} aria-busy={waiting || undefined}>
            {search.status === 'error' && !waiting ? (
              <div className="af-state af-state--bad">
                <span>{search.error}</span>
                <button type="button" className="hub-btn hub-btn--ghost hub-btn--sm" onClick={() => setAttempt((n) => n + 1)}>
                  <SIcon name="refresh" size={16} /> Try again
                </button>
              </div>
            ) : waiting && results.length === 0 ? (
              <RowSkeleton n={3} />
            ) : results.length === 0 ? (
              <div className="af-state">
                <span className="af-state__icon">
                  <SIcon name="question" size={20} />
                </span>
                <span>
                  <strong>Nobody called &ldquo;{term}&rdquo;</strong>
                  Check the spelling, or ask them for their friend code.
                </span>
              </div>
            ) : (
              <ul className={`af-list${waiting ? ' is-stale' : ''}`} aria-label="Search results">
                {results.map((p) => (
                  <PersonRow key={p.id} p={p} onSent={sent} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {recent.status === 'ready' && recents.length > 0 && (
        <div className="af-sec">
          <h3 className="af-h3" id={`${uid}-recent`}>
            Recently played with
          </h3>
          <ul className="af-list" aria-labelledby={`${uid}-recent`}>
            {shownRecents.map((p) => (
              <PersonRow key={p.id} p={p} onSent={sent} />
            ))}
          </ul>
          {recents.length > RECENT_SHOWN && (
            <button type="button" className="af-more" onClick={() => setShowAllRecent((v) => !v)} aria-expanded={showAllRecent}>
              {showAllRecent ? 'Show fewer' : `Show ${recents.length - RECENT_SHOWN} more`}
            </button>
          )}
        </div>
      )}

      <div className="af-sec">
        <h3 className="af-h3">Have a friend code?</h3>
        <AddByCode embedded myCode={user.friendCode} onNotify={tell} onSent={sent} />
        {notice && (
          <p className="af-note" role="status">
            <SIcon name="check" size={15} /> {notice}
          </p>
        )}
      </div>
    </section>
  );
}
