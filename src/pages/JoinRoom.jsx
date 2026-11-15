import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, getMyRooms, getRoom } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import CodeInput from '@/components/online/CodeInput.jsx';
import { useOnline } from '@/components/online/ConnectionChip.jsx';
import GameIcon from '@/components/online/GameIcon.jsx';
import RoomPreview, { RoomPreviewSkeleton } from '@/components/online/RoomPreview.jsx';
import { isRoomCode, normalizeRoomCode, playerCountOf, roomProblemKind } from '@/components/online/codes.js';
import { gameName, gameOf } from '@/components/online/games.js';
import { roomGameId } from '@/components/online/gameRoute.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import '@/styles/online.css';
import '@/styles/store-rooms.css';

const JOIN_DELAY = 1400; // ms: long enough to read who and what you are joining, short enough to feel instant

/** Why a code cannot be used: one clear card per reason, each with the way forward. */
const BLOCKED = {
  missing: {
    icon: 'search',
    title: 'Room not found',
    body: 'No table has that code. It may be mistyped, or the room closed after everyone left.',
  },
  full: {
    icon: 'users',
    title: 'This table is full',
    body: (max) => (max ? `All ${max} seats are taken. Ask the host for the next table, or start your own.` : 'Every seat is taken. Ask the host for the next table, or start your own.'),
  },
  playing: { icon: 'clock', title: 'This game has already started', body: 'New players cannot join a match in progress. If you were playing, you can rejoin.' },
  finished: { icon: 'trophy', title: 'This game has ended', body: 'The match in this room is over. Ask the host for the code of their next table, or check how it went on your profile.' },
  wrongGame: { icon: 'info', title: 'This game is not in your version', body: 'The table plays a game this version of GameHub does not have. Reload to get the latest, then try the code again.' },
};

function BlockedState({ kind, info, onRejoin, onClear }) {
  const b = BLOCKED[kind] || BLOCKED.missing;
  const gameId = info ? roomGameId(info) : null;
  const known = !!(gameId && gameOf(gameId));
  const target = known ? gameId : BRAND.defaultGameId;
  const body = typeof b.body === 'function' ? b.body(info && info.maxPlayers) : b.body;
  return (
    <div className={`sr-blocked sr-blocked--${kind}`} role="alert">
      <span className="sr-blocked__icon" aria-hidden="true">
        <HubIcon name={b.icon} size={26} />
      </span>
      <div className="sr-blocked__text">
        <b>{b.title}</b>
        <span>{body}</span>
      </div>
      <div className="sr-blocked__actions">
        {(kind === 'playing' || kind === 'full') && (
          // The lookup does not say who is in the room: players already seated can always get back in.
          <button type="button" className="ho-btn ho-btn--primary" onClick={onRejoin}>
            I was in this game: rejoin
          </button>
        )}
        {kind === 'wrongGame' && (
          <button type="button" className="ho-btn ho-btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        )}
        {kind === 'finished' && (
          <>
            {known && (
              <Link to={paths.game(gameId)} className="ho-btn ho-btn--primary">
                See the game
              </Link>
            )}
            <Link to={paths.profile()} className="ho-btn ho-btn--ghost">
              Your profile
            </Link>
          </>
        )}
        {kind !== 'finished' && kind !== 'wrongGame' && (
          <Link to={paths.game(target)} className="ho-btn ho-btn--ghost">
            Start your own table
          </Link>
        )}
        <button type="button" className="ho-btn ho-btn--ghost" onClick={onClear}>
          Try another code
        </button>
      </div>
    </div>
  );
}

/** Signed-out visitor with a good code: sign in, or take a seat as a guest with just a name. */
function JoinGate({ code, loginGuest, hostName }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) {
      setError('Pick a name so the table knows who you are.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await loginGuest(clean);
      // the session arrives through useAuth: the page then checks the room again and takes the seat
    } catch (err) {
      setError(errorMessage(err, 'Could not start a guest session. Try again.'));
      setBusy(false);
    }
  };
  return (
    <section className="sr-gate" aria-labelledby="sr-gate-h">
      <h2 id="sr-gate-h" className="sr-gate__title">
        One step: who is joining{hostName ? ` ${hostName}` : ''}?
      </h2>
      <div className="sr-gate__opts">
        <div className="sr-gate__opt">
          <b>Sign in</b>
          <span>Keep your coins, level and friends.</span>
          <Link to={paths.login(paths.join(code))} className="ho-btn ho-btn--primary ho-btn--block">
            Sign in to join
          </Link>
        </div>
        <form className="sr-gate__opt" onSubmit={submit} noValidate>
          <b>Play as a guest</b>
          <label className="sr-gate__label" htmlFor="sr-gate-name">
            Your name at the table
          </label>
          <input
            id="sr-gate-name"
            className="sr-gate__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="nickname"
            placeholder="e.g. Asha"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'sr-gate-err' : undefined}
          />
          {error && (
            <span id="sr-gate-err" className="sr-gate__error" role="alert">
              {error}
            </span>
          )}
          <button type="submit" className="ho-btn ho-btn--ghost ho-btn--block" disabled={busy}>
            {busy ? 'Taking a seat...' : 'Join as guest'}
          </button>
        </form>
      </div>
      <p className="sr-gate__note">Guests can play but cannot add friends or keep progress between devices.</p>
    </section>
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
 * /join and /join/:code. Anyone can look a code up; taking the seat needs a session (Google or guest), so a signed-out
 * visitor is offered both right on the page and carries on by themselves. The code is checked against
 * GET /api/rooms/:code (game, host, seats, settings), then we open the lobby.
 */
export default function JoinRoom() {
  const { code: paramCode } = useParams();
  const { user, loading, loginGuest } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  const fromLink = !!paramCode;
  const [code, setCode] = useState(normalizeRoomCode(paramCode || ''));
  // idle | checking | joining (auto-opens the lobby) | held (joining was cancelled) | gate (needs a session) | blocked (`kind`) | error | offline
  const [check, setCheck] = useState({ state: 'idle', message: '', info: null, kind: null });
  const [dropped, setDropped] = useState([]); // look-alike characters just refused (O I 0 1)
  const [pasteNote, setPasteNote] = useState('');
  const seq = useRef(0);
  const joinTimer = useRef(null);
  const noteTimer = useRef(null);
  const myId = user ? user.id : null;

  useEffect(
    () => () => {
      clearTimeout(joinTimer.current);
      clearTimeout(noteTimer.current);
    },
    [],
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
          setCheck({ state: 'blocked', kind, info });
          return;
        }
        if (!gameOf(roomGameId(info))) {
          setCheck({ state: 'blocked', kind: 'wrongGame', info });
          return;
        }
        if (!myId) {
          setCheck({ state: 'gate', info });
          return;
        }
        setCheck({ state: 'joining', message: '', info });
        joinTimer.current = setTimeout(() => {
          if (mine === seq.current) navigate(paths.lobby(c), { replace: fromLink });
        }, JOIN_DELAY);
      } catch (e) {
        if (mine !== seq.current) return;
        if (e && e.status === 404) setCheck({ state: 'blocked', kind: 'missing', info: null });
        else if (e && e.status === 400) setCheck({ state: 'error', message: errorMessage(e, 'That code is not valid.'), info: null });
        else setCheck({ state: 'offline', message: errorMessage(e, 'Could not reach the server'), info: null });
      }
    },
    [myId, navigate, fromLink],
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
    navigate(paths.lobby(code), { replace: fromLink });
  };

  // check as soon as six valid characters are in (and again once the network or the session is back)
  useEffect(() => {
    if (loading) return;
    if (!isRoomCode(code)) {
      seq.current += 1;
      clearTimeout(joinTimer.current);
      setCheck({ state: 'idle', message: '', info: null, kind: null });
      return;
    }
    verify(code);
  }, [code, loading, myId, verify, online]);

  const flashNote = (text, set) => {
    set(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => set(''), 3200);
  };
  const onInvalid = (chars) => {
    setDropped(chars);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setDropped([]), 3200);
  };
  const canPaste = typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function';
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const next = normalizeRoomCode(text);
      if (next) setCode(next);
      else flashNote('No room code on the clipboard.', setPasteNote);
    } catch {
      flashNote('Paste is blocked here: press and hold in the boxes, then choose Paste.', setPasteNote);
    }
  };

  const state = check.state;
  const uiState = state === 'checking' || state === 'joining' ? 'checking' : state === 'error' || state === 'blocked' ? 'error' : state === 'held' || state === 'gate' ? 'ok' : 'idle';
  const info = check.info;
  const hostName = info && info.hostName;
  const joiningGame = info ? gameName(roomGameId(info)) : '';
  const statusId = 'sr-join-status';

  return (
    <div className="hub-page st-scope sr-join">
      <header className="sr-join__head st-reveal">
        <span className="st-eyebrow">Join a table</span>
        <h1 className="sr-join__title">Got a code? You are in.</h1>
        <p className="sr-join__lead">Pop the code in, or paste the invite link, and you are at your friend's table.</p>
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
          {state === 'idle' && code.length === 0 && !dropped.length && !pasteNote && <span className="sr-muted">Waiting for the code</span>}
          {state === 'idle' && code.length > 0 && !dropped.length && (
            <span className="sr-muted">
              {code.length} of 6 <span aria-hidden="true">·</span> {6 - code.length} more to go
            </span>
          )}
          {dropped.length > 0 && <span className="sr-warn">{dropped.join(', ')} {dropped.length === 1 ? 'is' : 'are'} not used in codes, so we left {dropped.length === 1 ? 'it' : 'them'} out.</span>}
          {pasteNote && <span className="sr-warn">{pasteNote}</span>}
          {state === 'checking' && !dropped.length && (
            <span className="sr-muted">
              <span className="ho-spinner" aria-hidden="true" /> Looking for the table...
            </span>
          )}
          {state === 'joining' && !dropped.length && <span className="sr-good">Table found. Taking you in...</span>}
          {state === 'held' && <span className="sr-muted">Table found. Join when you are ready.</span>}
          {state === 'gate' && <span className="sr-good">Table found. One step left.</span>}
          {state === 'blocked' && <span className="ho-sr">{(BLOCKED[check.kind] || BLOCKED.missing).title}</span>}
          {state === 'error' && <span className="sr-bad">{check.message}</span>}
          {state === 'offline' && <span className="sr-bad">{online ? check.message : 'You are offline.'}</span>}
        </div>

        <div className="sr-ticket__tools">
          {canPaste && code.length < 6 && (
            <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={paste}>
              <HubIcon name="copy" size={16} /> Paste code
            </button>
          )}
          {code.length > 0 && state !== 'joining' && (
            <button type="button" className="sr-link" onClick={() => setCode('')}>
              Clear
            </button>
          )}
        </div>
      </section>

      {state === 'checking' && <RoomPreviewSkeleton />}

      {(state === 'joining' || state === 'held' || state === 'gate') && info && (
        <RoomPreview info={info}>
          {state === 'joining' && (
            <div className="sr-joining" style={{ '--sr-join-ms': `${JOIN_DELAY}ms` }}>
              <span className="sr-joining__text">
                <span className="ho-spinner" aria-hidden="true" />
                {hostName ? `Joining ${hostName}'s ${joiningGame} room...` : `Joining the ${joiningGame} room...`}
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
                  <HubIcon name="arrowR" size={18} /> Join room
                </button>
                <button type="button" className="ho-btn ho-btn--ghost" onClick={() => setCode('')}>
                  Clear code
                </button>
              </span>
            </div>
          )}
        </RoomPreview>
      )}

      {state === 'gate' && !user && <JoinGate code={code} loginGuest={loginGuest} hostName={hostName} />}

      {state === 'blocked' && (
        <>
          <BlockedState kind={check.kind} info={info} onRejoin={() => navigate(paths.lobby(code))} onClear={() => setCode('')} />
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
            <button type="button" className="ho-btn ho-btn--ghost" onClick={() => setCode('')}>
              Clear code
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
