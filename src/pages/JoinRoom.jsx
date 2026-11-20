import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage, getMyRooms, getRoom } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import CodeInput from '@/components/online/CodeInput.jsx';
import { useOnline } from '@/components/online/ConnectionChip.jsx';
import GameIcon from '@/components/online/GameIcon.jsx';
import InviteLanding, { InviteSkeleton } from '@/components/online/InviteLanding.jsx';
import RoomPreview, { RoomPreviewSkeleton } from '@/components/online/RoomPreview.jsx';
import { codeFromSearch, isRoomCode, normalizeRoomCode, playerCountOf, roomProblemKind } from '@/components/online/codes.js';
import { gameName, gameOf } from '@/components/online/games.js';
import { roomGameId } from '@/components/online/gameRoute.js';
import { clearJoinDraft, joinProblemCopy, readJoinDraft, writeJoinDraft } from '@/components/online/inviteModel.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import '@/styles/online.css';
import '@/styles/store-rooms.css';
import '@/styles/join-code.css';

const JOIN_DELAY = 1400; // ms: long enough to read who and what you are joining, short enough to feel instant

const PROBLEM_ICON = { missing: 'search', full: 'users', playing: 'clock', finished: 'info', forbidden: 'info', wrongGame: 'info' };

/** Why a code cannot be used: one clear card per reason, with the obvious next action first. */
function BlockedState({ kind, info, onRejoin, onClear }) {
  const key = PROBLEM_ICON[kind] ? kind : 'missing';
  const copy = joinProblemCopy(key, info && info.maxPlayers);
  const gameId = info ? roomGameId(info) : null;
  const target = gameId && gameOf(gameId) ? gameId : BRAND.defaultGameId;
  // The lookup does not say who is in the room: players already seated can always get back in.
  const canRejoin = key === 'playing' || key === 'full';
  return (
    <div className={`sr-blocked sr-blocked--${key}`} role="alert">
      <span className="sr-blocked__icon" aria-hidden="true">
        <HubIcon name={PROBLEM_ICON[key]} size={26} />
      </span>
      <div className="sr-blocked__text">
        <b>{copy.title}</b>
        <span>{copy.body}</span>
      </div>
      <div className="sr-blocked__actions">
        {canRejoin && (
          <button type="button" className="ho-btn ho-btn--primary" onClick={onRejoin}>
            I was in this game: rejoin
          </button>
        )}
        {key === 'wrongGame' && (
          <button type="button" className="ho-btn ho-btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        )}
        {key !== 'wrongGame' && (
          <button type="button" className={`ho-btn ${key === 'missing' ? 'ho-btn--primary' : 'ho-btn--ghost'}`} onClick={onClear}>
            Try another code
          </button>
        )}
        {key !== 'wrongGame' && (
          <Link to={paths.game(target)} className={`ho-btn ${key === 'finished' || key === 'forbidden' ? 'ho-btn--primary' : 'ho-btn--ghost'}`}>
            Start your own table
          </Link>
        )}
      </div>
    </div>
  );
}

/** Your own open tables (real: GET /api/rooms/mine), so "where was I?" is one tap. */
function MyTables({ user }) {
  const [rooms, setRooms] = useState([]);
  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    getMyRooms().then(
      (r) => alive && setRooms(Array.isArray(r && r.rooms) ? r.rooms.slice(0, 3) : []),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [user]);
  if (!rooms.length) return null;
  return (
    <section className="sr-mine" aria-labelledby="sr-mine-h">
      <h2 id="sr-mine-h" className="sr-mine__title">
        Your open tables
      </h2>
      <ul className="sr-mine__list">
        {rooms.map((r) => {
          const gid = roomGameId(r);
          const g = gameOf(gid);
          const max = r.maxPlayers || null;
          return (
            <li key={r.code}>
              <Link to={r.status === 'playing' ? paths.online(gid, r.code) : paths.lobby(r.code)} className="sr-mine__row">
                <GameIcon game={g} name={gameName(gid, g)} size={40} />
                <span className="sr-mine__main">
                  <b>{gameName(gid, g)}</b>
                  <small>
                    {r.code} · {r.status === 'playing' ? 'In progress' : 'Waiting'} · {playerCountOf(r)}
                    {max ? `/${max}` : ''} players
                  </small>
                </span>
                <span className="sr-mine__go">
                  Rejoin <HubIcon name="arrowR" size={16} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * /join/:code, /join?code=ABC234 and /join. Anyone can look a code up (GET /api/rooms/:code, no session needed), so
 * the table is shown and any problem (not found, full, started, closed) is explained BEFORE anyone is asked to sign in.
 *   - signed in (Google or guest): the table preview, then the lobby opens after a short visible countdown
 *     (Join now / Cancel);
 *   - signed out: the "You're invited" card with Google or "play as a guest"; whichever they pick, the page checks the
 *     room again and goes straight to the lobby (no countdown: they just chose).
 * Players already in the room may always come back (see roomProblemKind). The code survives a reload (URL, or the
 * tab's session storage for a typed one).
 */
export default function JoinRoom() {
  const { code: paramCode } = useParams();
  const [search] = useSearchParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  const queryCode = codeFromSearch(search);
  const fromLink = !!paramCode || !!queryCode;
  const [code, setCode] = useState(() => normalizeRoomCode(paramCode || '') || queryCode || readJoinDraft().code);
  // idle | checking | joining (auto-opens the lobby) | held (joining was cancelled) | gate (needs a session) | blocked (`kind`) | error | offline
  const [check, setCheck] = useState({ state: 'idle', message: '', info: null, kind: null });
  const [dropped, setDropped] = useState([]); // look-alike characters just refused (O I 0 1)
  const seq = useRef(0);
  const joinTimer = useRef(null);
  const noteTimer = useRef(null);
  const navigating = useRef(false); // one trip to the lobby, however many taps or timers ask for it
  const chose = useRef(false); // the visitor was at the invite card: whatever they pick, go straight in
  const myId = user ? user.id : null;

  useEffect(
    () => () => {
      clearTimeout(joinTimer.current);
      clearTimeout(noteTimer.current);
    },
    [],
  );

  // a different /join/:code in the same page (link opened while on the join page)
  useEffect(() => {
    const next = normalizeRoomCode(paramCode || '') || queryCode;
    if (next) setCode(next);
  }, [paramCode, queryCode]);

  const enter = useCallback(
    (c) => {
      if (navigating.current) return;
      navigating.current = true;
      clearJoinDraft();
      navigate(paths.lobby(c), { replace: fromLink });
    },
    [navigate, fromLink],
  );

  const verify = useCallback(
    async (c) => {
      const mine = ++seq.current;
      clearTimeout(joinTimer.current);
      setCheck({ state: 'checking', message: '', info: null, kind: null });
      try {
        const info = await getRoom(c);
        if (mine !== seq.current) return;
        const kind = roomProblemKind(info, myId);
        if (kind) {
          chose.current = false;
          setCheck({ state: 'blocked', kind, info });
          return;
        }
        if (!gameOf(roomGameId(info))) {
          chose.current = false;
          setCheck({ state: 'blocked', kind: 'wrongGame', info });
          return;
        }
        if (!myId) {
          chose.current = true;
          setCheck({ state: 'gate', info });
          return;
        }
        if (chose.current) {
          // they just signed in from the invite card: no countdown, straight to the lobby
          setCheck({ state: 'joining', message: '', info });
          enter(c);
          return;
        }
        setCheck({ state: 'joining', message: '', info });
        joinTimer.current = setTimeout(() => {
          if (mine === seq.current) enter(c);
        }, JOIN_DELAY);
      } catch (e) {
        if (mine !== seq.current) return;
        if (e && e.status === 404) setCheck({ state: 'blocked', kind: 'missing', info: null });
        else if (e && e.status === 400) setCheck({ state: 'error', message: errorMessage(e, 'That code is not valid.'), info: null });
        else if (e && (e.status === 401 || e.status === 403)) {
          // the lookup wants a session: signed out -> the invite card without a preview; signed in -> not allowed
          if (!myId) {
            chose.current = true;
            setCheck({ state: 'gate', info: null });
          } else setCheck({ state: 'blocked', kind: 'forbidden', info: null });
        } else setCheck({ state: 'offline', message: errorMessage(e, 'Could not reach the server'), info: null });
      }
    },
    [myId, enter],
  );

  // stop the auto-join (wrong room, changed my mind): the room stays found, one tap joins it
  const cancelJoin = () => {
    seq.current += 1;
    clearTimeout(joinTimer.current);
    setCheck((c) => ({ ...c, state: 'held' }));
  };
  const joinNow = () => {
    seq.current += 1;
    clearTimeout(joinTimer.current);
    enter(code);
  };
  const resetCode = () => {
    chose.current = false;
    setCode('');
    if (fromLink) navigate(paths.join(), { replace: true });
  };

  // check as soon as six valid characters are in (and again once the network or the session is back)
  useEffect(() => {
    if (loading) return;
    if (!isRoomCode(code)) {
      seq.current += 1;
      clearTimeout(joinTimer.current);
      chose.current = false;
      setCheck({ state: 'idle', message: '', info: null, kind: null });
      return;
    }
    verify(code);
  }, [code, loading, myId, verify, online]);

  // keep the visitor's place across a reload
  useEffect(() => {
    if (isRoomCode(code) || code === '') writeJoinDraft({ code });
  }, [code]);

  const onInvalid = (chars) => {
    setDropped(chars);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setDropped([]), 3200);
  };

  const state = check.state;
  const uiState = state === 'checking' ? 'checking' : state === 'error' || state === 'blocked' ? 'error' : state === 'joining' || state === 'held' || state === 'gate' ? 'ok' : 'idle';
  const info = check.info;
  const hostName = info && info.hostName;
  const joiningGame = info ? gameName(roomGameId(info)) : '';
  const statusId = 'sr-join-status';

  // Opened from a link while signed out (or just signed in from the invite card): the invite takes the whole page.
  const pending = isRoomCode(code) && (loading || state === 'idle' || state === 'checking');
  const invite = fromLink && (!user || chose.current) && (pending || state === 'gate' || (chose.current && state === 'joining'));
  if (invite) {
    return (
      <div className="hub-page st-scope sr-join jc-join">
        <header className="sr-join__head st-reveal">
          <span className="st-eyebrow">Join a table</span>
          <h1 className="sr-join__title">{state === 'gate' ? "You're invited" : 'Opening your invite'}</h1>
          <p className="sr-join__lead">{state === 'gate' ? 'Pick how you want to sit down. Either way you land in the lobby.' : 'One moment while we find the table.'}</p>
        </header>
        {state === 'gate' ? (
          <InviteLanding code={code} info={info} onOtherCode={resetCode} />
        ) : (
          <InviteSkeleton text={user ? 'Taking you to the lobby...' : 'Opening your invite...'} />
        )}
      </div>
    );
  }

  return (
    <div className="hub-page st-scope sr-join">
      <header className="sr-join__head st-reveal">
        <span className="st-eyebrow">Join a table</span>
        <h1 className="sr-join__title">Got a code? You are in.</h1>
        <p className="sr-join__lead">Type the code, paste it, or paste the invite link, and you are at your friend's table.</p>
      </header>

      <section className="sr-ticket st-reveal" style={{ '--i': 1 }} aria-labelledby="sr-join-h">
        <h2 id="sr-join-h" className="sr-ticket__title">
          Enter the 6-character code
        </h2>
        <p className="sr-ticket__hint">Letters and numbers only. Codes never use O, I, 0 or 1, so they are easy to read out loud.</p>

        <CodeInput
          value={code}
          onChange={setCode}
          onInvalid={onInvalid}
          state={uiState}
          autoFocus={!fromLink && !loading}
          disabled={state === 'joining'}
          describedBy={statusId}
        />

        <div id={statusId} className="sr-ticket__status" role="status" aria-live="polite">
          {state === 'idle' && code.length === 0 && !dropped.length && <span className="sr-muted">Waiting for the code</span>}
          {state === 'idle' && code.length > 0 && !dropped.length && (
            <span className="sr-muted">
              {code.length} of 6 <span aria-hidden="true">·</span> {6 - code.length} more to go
            </span>
          )}
          {dropped.length > 0 && <span className="sr-warn">{dropped.join(', ')} {dropped.length === 1 ? 'is' : 'are'} not used in codes, so we left {dropped.length === 1 ? 'it' : 'them'} out.</span>}
          {state === 'checking' && !dropped.length && (
            <span className="sr-muted">
              <span className="ho-spinner" aria-hidden="true" /> Looking for the table...
            </span>
          )}
          {state === 'joining' && !dropped.length && <span className="sr-good">Table found. Taking you in...</span>}
          {state === 'held' && <span className="sr-muted">Table found. Join when you are ready.</span>}
          {state === 'gate' && <span className="sr-good">Table found. One step left.</span>}
          {state === 'blocked' && <span className="sr-bad" aria-hidden="true">{joinProblemCopy(check.kind, info && info.maxPlayers).title}</span>}
          {state === 'error' && <span className="sr-bad">{check.message}</span>}
          {state === 'offline' && <span className="sr-bad">{online ? check.message : 'You are offline.'}</span>}
        </div>
      </section>

      {state === 'checking' && <RoomPreviewSkeleton />}

      {(state === 'joining' || state === 'held') && info && (
        <RoomPreview info={info}>
          {state === 'joining' && (
            <div className="sr-joining" style={{ '--sr-join-ms': `${JOIN_DELAY}ms` }}>
              <span className="sr-joining__text">
                <span className="ho-spinner" aria-hidden="true" />
                {hostName ? `Taking you to ${hostName}'s ${joiningGame} table...` : `Taking you to the ${joiningGame} table...`}
              </span>
              <span className="sr-joining__actions">
                <button type="button" className="ho-btn ho-btn--primary ho-btn--sm" onClick={joinNow}>
                  Join now
                </button>
                <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={cancelJoin}>
                  Cancel
                </button>
              </span>
              <i className="sr-joining__bar" aria-hidden="true" />
            </div>
          )}
          {state === 'held' && (
            <div className="sr-joining sr-joining--held">
              <span className="sr-joining__actions">
                <button type="button" className="ho-btn ho-btn--primary" onClick={joinNow}>
                  <HubIcon name="arrowR" size={18} /> Join table
                </button>
                <button type="button" className="ho-btn ho-btn--ghost" onClick={resetCode}>
                  Use a different code
                </button>
              </span>
            </div>
          )}
        </RoomPreview>
      )}

      {state === 'gate' && !user && <InviteLanding code={code} info={info} onOtherCode={resetCode} />}

      {state === 'blocked' && (
        <>
          <BlockedState kind={check.kind} info={info} onRejoin={() => enter(code)} onClear={resetCode} />
          {info && info.exists !== false && check.kind !== 'missing' && <RoomPreview info={info} tone="blocked" />}
        </>
      )}

      {(state === 'error' || state === 'offline') && (
        <div className="sr-blocked sr-blocked--offline" role="alert">
          <span className="sr-blocked__icon" aria-hidden="true">
            <HubIcon name={state === 'offline' ? 'wifiOff' : 'info'} size={26} />
          </span>
          <div className="sr-blocked__text">
            <b>{state === 'offline' ? (online ? 'Could not reach the server' : 'You are offline') : 'That code is not valid'}</b>
            <span>{state === 'offline' ? 'Check your connection. We check the code again as soon as you are back online.' : 'Room codes are 6 letters or numbers, like ABC234.'}</span>
          </div>
          <div className="sr-blocked__actions">
            {state === 'offline' && (
              <button type="button" className="ho-btn ho-btn--primary" onClick={() => isRoomCode(code) && verify(code)}>
                Try again
              </button>
            )}
            <button type="button" className={`ho-btn ${state === 'offline' ? 'ho-btn--ghost' : 'ho-btn--primary'}`} onClick={resetCode}>
              Use a different code
            </button>
          </div>
        </div>
      )}

      {(state === 'idle' || state === 'held') && !loading && user && <MyTables user={user} />}

      <p className="sr-join__alt">
        Want your own table? <Link to={paths.game(BRAND.defaultGameId)}>Create one</Link>.
      </p>
    </div>
  );
}
