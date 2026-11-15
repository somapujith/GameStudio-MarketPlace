import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { createRoom, errorMessage } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { useRoomConnection } from '@/components/online/useRoomConnection.js';
import { joinedLabel, joinedPercent, pieceChoices, pieceOf, rosterChanges, seatColor, startState, waitingText } from '@/components/online/lobbyModel.js';
import { resolveSettings } from '@/components/online/settings.js';
import { sameId } from '@/components/online/gameHelpers.js';
import { isRoomCode, normalizeRoomCode } from '@/components/online/codes.js';
import { gameName, gameOf, warmOnlineGame } from '@/components/online/games.js';
import { rememberRoomGame, roomGameId } from '@/components/online/gameRoute.js';
import ConfirmDialog from '@/components/online/ConfirmDialog.jsx';
import GameIcon from '@/components/online/GameIcon.jsx';
import InviteFriends from '@/components/online/InviteFriends.jsx';
import Seat, { EmptySeat } from '@/components/online/Seat.jsx';
import SettingsPanel from '@/components/online/SettingsPanel.jsx';
import ShareCard from '@/components/online/ShareCard.jsx';
import StatusPanel, { Loading } from '@/components/online/StatusPanel.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import PiecePicker from '@/platform/game/PiecePicker.jsx';
import AutoMascot from '@/components/art/AutoMascot.jsx';
import '@/styles/online.css';
import '@/styles/x-lobby.css';

const PIECE_SETTLE = 4000; // ms: no answer to a piece pick -> show what the server says again

/** CSS variables that tint the lobby with the game's own colours. */
function themeVars(game) {
  const t = (game && game.theme) || {};
  const v = {};
  if (t.accent) v['--ho-accent'] = t.accent;
  if (t.accent2 || t.accent) v['--ho-accent-2'] = t.accent2 || t.accent;
  if (t.bg) v['--ho-game-bg'] = t.bg;
  return v;
}

function ConnectionBanner({ connection }) {
  if (connection === 'open') return null;
  return (
    <div className="ho-banner ho-banner--warn" role="status" aria-live="polite">
      <span className="ho-spinner" aria-hidden="true" />
      <span>{connection === 'closed' ? 'Disconnected from the room.' : 'Reconnecting to the room... your seat is kept.'}</span>
    </div>
  );
}

/** /lobby/:code */
export default function Lobby() {
  const { code: rawCode } = useParams();
  const code = normalizeRoomCode(rawCode || '');
  const valid = isRoomCode(code);
  const { user, loading } = useAuth();

  if (!valid) {
    return (
      <div className="ho-page xl-page">
        <StatusPanel
          icon={<HubIcon name="hash" size={30} />}
          tone="bad"
          title="That is not a room code"
          body="Room codes are 6 letters or numbers, like ABC234."
          actions={[
            { label: 'Enter a code', to: paths.join(), primary: true },
            { label: 'Home', to: paths.hub() },
          ]}
        />
      </div>
    );
  }
  if (loading) {
    return (
      <div className="ho-page xl-page">
        <Loading text="Opening the lobby..." />
      </div>
    );
  }
  if (!user) return <Navigate to={paths.login(paths.lobby(code))} replace />;
  return <LobbyInner code={code} user={user} />;
}

/** Compact header of its own (the lobby sits outside the hub chrome): back to the game page, game + room code, leave. */
function LobbyHeader({ game, gName, code, backTo, onLeave }) {
  return (
    <header className="ho-qhead xl-head">
      <Link to={backTo} className="xl-head__back" aria-label={game ? `Back to ${gName}` : 'Back to games'}>
        <HubIcon name="chevL" size={22} />
      </Link>
      <GameIcon game={game} name={gName} size={44} className="ho-qhead__icon" />
      <div className="ho-qhead__main">
        <h1 className="ho-h1">{gName}</h1>
        <p className="ho-muted">
          Room <b className="ho-qhead__code">{code}</b>
        </p>
      </div>
      {onLeave && (
        <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm xl-head__leave" onClick={onLeave}>
          <HubIcon name="door" size={18} /> <span>Leave</span>
        </button>
      )}
    </header>
  );
}

function LobbyInner({ code, user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { push, node } = useToasts();
  const { room, connection, fatal, error, errorId, send, pickPiece, leave } = useRoomConnection(code);
  const [confirm, setConfirm] = useState(null); // {kind:'leave'} | {kind:'kick', player}
  const [starting, setStarting] = useState(false);
  const [pending, setPending] = useState(null); // piece id asked for, not yet confirmed by the server
  const startTimer = useRef(null);
  const pieceTimer = useRef(null);
  const roster = useRef(null);

  const gameId = room ? roomGameId(room) : null;
  const game = useMemo(() => (gameId ? gameOf(gameId) : null), [gameId]);
  const gName = gameName(gameId, game);
  const players = room && Array.isArray(room.players) ? room.players : [];

  // a message handed over by whoever sent us here ("Invite sent to Ravi")
  useEffect(() => {
    const t = location.state && location.state.toast;
    if (t && t.text) {
      push(t.text, t.tone || 'info');
      navigate(location.pathname, { replace: true, state: null });
    }
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // server told us something went wrong (rejected setting, piece taken, can't start, ...): roll back
  useEffect(() => {
    if (errorId && error) {
      push(error, 'bad');
      setStarting(false);
      setPending(null);
    }
  }, [errorId, error, push]);
  useEffect(
    () => () => {
      clearTimeout(startTimer.current);
      clearTimeout(pieceTimer.current);
    },
    [],
  );

  // "<name> joined" / "<name> left" as people come and go (never for the first payload)
  useEffect(() => {
    if (!room) return;
    const list = Array.isArray(room.players) ? room.players : [];
    const { joined, left } = rosterChanges(roster.current, list, user.id);
    roster.current = list;
    joined.forEach((p) => push(`${p.name || 'A player'} joined`, 'good'));
    left.forEach((p) => push(`${p.name || 'A player'} left`, 'info'));
  }, [room, user.id, push]);

  // the server confirmed the pick: stop showing the optimistic one
  const myServerPiece = (players.find((p) => sameId(p.id, user.id)) || {}).piece || null;
  useEffect(() => {
    if (pending && myServerPiece === pending) {
      clearTimeout(pieceTimer.current);
      setPending(null);
    }
  }, [pending, myServerPiece]);

  // get the game's page ready while people gather, so Start feels instant
  useEffect(() => {
    warmOnlineGame(game);
  }, [game]);

  // game started: head for the board
  useEffect(() => {
    if (room && room.status === 'playing' && !fatal) {
      rememberRoomGame(code, gameId);
      navigate(paths.online(gameId, code), { replace: true });
    }
  }, [room, fatal, code, gameId, navigate]);

  if (fatal) return <Fatal fatal={fatal} code={code} />;

  if (!room) {
    return (
      <div className="ho-page ho-lobby ho-lobby--quick xl-lobby">
        <LobbyHeader game={null} gName="Lobby" code={code} backTo={paths.hub()} />
        <Loading text="Joining the room..." />
        <button type="button" className="ho-btn ho-btn--ghost ho-lobby__cancel" onClick={() => navigate(paths.hub())}>
          Cancel
        </button>
        {node}
      </div>
    );
  }

  if (room.status === 'finished') return <Rematch room={room} game={game} gameId={gameId} gameLabel={gName} />;

  const isHost = sameId(room.hostId, user.id);
  const host = players.find((p) => sameId(p.id, room.hostId));
  const bounds = (game && game.players) || {};
  const maxPlayers = room.maxPlayers || bounds.max || 6;
  const minToStart = Number.isFinite(bounds.min) ? bounds.min : 2;
  const open = connection === 'open';
  const joined = players.length;
  const { enough, full, emptySeats, need, label: startLabel, help: startHelp } = startState({ players: joined, joined, maxPlayers, minToStart, starting, open });
  const canStart = isHost && enough && open && !starting;
  const myIndex = players.findIndex((p) => sameId(p.id, user.id));
  const myColor = seatColor(game, Math.max(0, myIndex));
  const pieces = game && game.pieces;
  const { mine: myPiece, choices } = pieceChoices(pieces, players, user.id, pending);

  const start = () => {
    if (!canStart) return;
    setStarting(true);
    send({ t: 'start' }, { queue: false });
    clearTimeout(startTimer.current);
    startTimer.current = setTimeout(() => setStarting(false), 4000);
  };

  // optimistic: the tile and my seat show the new piece at once; an error or silence rolls it back
  const choosePiece = (id) => {
    if (!open) return;
    if (!pickPiece(id)) {
      push('Not connected. Try again in a moment.', 'bad');
      return;
    }
    setPending(id);
    clearTimeout(pieceTimer.current);
    pieceTimer.current = setTimeout(() => setPending(null), PIECE_SETTLE);
  };

  const doLeave = () => {
    leave();
    navigate(paths.hub(), { replace: true });
  };

  const askLeave = () => {
    if (isHost && players.length > 1) setConfirm({ kind: 'leave' });
    else doLeave();
  };

  return (
    <div className="ho-page ho-lobby ho-lobby--quick xl-lobby" style={themeVars(game)}>
      <LobbyHeader game={game} gName={gName} code={code} backTo={game ? paths.game(gameId) : paths.hub()} onLeave={askLeave} />

      <ConnectionBanner connection={connection} />

      {!game && (
        <div className="ho-banner ho-banner--warn" role="status">
          <span>This game is not available in this version of the app. Reload to update, or leave the room.</span>
          <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      <div className="ho-lobby__cols">
        <div className="ho-lobby__col ho-lobby__col--invite">
          <div className="xl-o-invite">
            <ShareCard code={code} gameName={gName} onNotify={push} />
          </div>
          {user.isGuest && (
            <p className="ho-help ho-qguest xl-o-guest">
              Share the code, link or QR above. <Link to={paths.login(paths.lobby(code))}>Sign in with Google</Link> to invite friends in one tap.
            </p>
          )}
          {!user.isGuest && (
            <div className="xl-o-friends">
              <InviteFriends code={code} gameName={gName} onNotify={push} />
            </div>
          )}
        </div>

        <div className="ho-lobby__col ho-lobby__col--table">
          <section className="ho-card ho-seats xl-o-seats" aria-label="Players">
            <div className="ho-card__head">
              <h2 className="ho-h2">Players</h2>
              <span className={`ho-count${full ? ' is-full' : ''}`} aria-live="polite">
                {joinedLabel(joined, maxPlayers)}
              </span>
            </div>
            <div className="ho-progress" role="progressbar" aria-label="Seats taken" aria-valuemin={0} aria-valuemax={maxPlayers} aria-valuenow={Math.min(joined, maxPlayers)}>
              <span style={{ transform: `scaleX(${joinedPercent(joined, maxPlayers) / 100})` }} />
            </div>
            <ul className="ho-seatgrid" data-seats={players.length + emptySeats}>
              {players.map((p, i) => {
                const me = sameId(p.id, user.id);
                return (
                  <Seat
                    key={p.id}
                    player={p}
                    piece={pieceOf(me ? { ...p, piece: myPiece } : p, pieces)}
                    color={seatColor(game, i)}
                    isMe={me}
                    isHost={sameId(p.id, room.hostId)}
                    canRemove={isHost && !me && open}
                    onRemove={() => setConfirm({ kind: 'kick', player: p })}
                  />
                );
              })}
              {Array.from({ length: emptySeats }, (_, i) => (
                <EmptySeat key={`empty-${i}`} />
              ))}
            </ul>
          </section>

          {choices.length > 0 && (
            <div className="xl-o-pieces">
              <PiecePicker choices={choices} color={myColor} onPick={choosePiece} disabled={!open} pending={!!pending} />
            </div>
          )}

          <div className="xl-o-settings">
            <SettingsPanel game={game} settings={room.settings} isHost={isHost} disabled={!open} errorId={errorId} onSend={(msg) => send(msg, { queue: false })} />
          </div>

          <section
            className={`ho-card ho-startcard xl-o-start${isHost && canStart ? ' is-ready' : ''}${full ? ' is-full' : ''}${starting ? ' is-starting' : ''}`}
            aria-label="Start"
          >
            {gameId === 'hyderabad-tycoon' && <AutoMascot key={canStart ? 'ready' : 'waiting'} mood={canStart ? 'roll' : 'waiting'} />}
            {isHost ? (
              <>
                <button type="button" className={`ho-btn ho-btn--primary ho-btn--lg ho-btn--block${full && canStart ? ' ho-btn--full' : ''}`} onClick={start} disabled={!canStart}>
                  {canStart && <HubIcon name="play" size={18} />} {startLabel}
                </button>
                <p className="ho-help" aria-live="polite">
                  {startHelp}
                </p>
              </>
            ) : (
              <p className="ho-waiting" role="status" aria-live="polite">
                <span className="ho-spinner" aria-hidden="true" /> {waitingText({ need, hostName: host && host.name })}
              </p>
            )}
          </section>

        </div>
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'leave'}
        title="Leave this room?"
        body="Other players stay in the lobby and the host role passes on."
        confirmLabel="Leave room"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          doLeave();
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'kick'}
        title={confirm?.player ? `Remove ${confirm.player.name}?` : ''}
        body="They will be taken out of the lobby and cannot rejoin for a while."
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const p = confirm?.player;
          setConfirm(null);
          if (p) send({ t: 'kick', id: p.id });
        }}
      />
      {node}
    </div>
  );
}

/** The match in this room is over: offer a fresh private room for the same game with the same settings. */
function Rematch({ room, game, gameId, gameLabel }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // only the keys the game's schema knows: the server validates strictly
      const settings = game && game.settings ? resolveSettings(game.settings, room.settings) : undefined;
      const res = await createRoom({ gameId, settings, maxPlayers: room.maxPlayers, visibility: 'private' });
      navigate(paths.lobby(res.code), { replace: true });
    } catch (e) {
      setError(errorMessage(e, 'Could not create a new room'));
      setBusy(false);
    }
  };

  return (
    <div className="ho-page xl-page">
      <StatusPanel
        icon={<HubIcon name="trophy" size={30} />}
        title="This game has finished"
        body={`The ${gameLabel} match in this room is over. Start a new private room with the same settings and send your friends the new code.`}
        actions={[
          { label: busy ? 'Creating...' : 'New room, same settings', onClick: create, primary: true },
          { label: 'Home', to: paths.hub() },
        ]}
      >
        {error && (
          <p className="ho-inline-error" role="alert">
            {error}
          </p>
        )}
      </StatusPanel>
    </div>
  );
}

function Fatal({ fatal, code }) {
  if (fatal.kind === 'kicked') {
    return (
      <div className="ho-page xl-page">
        <StatusPanel
          icon={<HubIcon name="door" size={30} />}
          tone="bad"
          title="You were removed from the room"
          body="The host took you out of this lobby. You can join another room, or ask for the code again."
          actions={[
            { label: 'Home', to: paths.hub(), primary: true },
            { label: 'Join another room', to: paths.join() },
          ]}
        />
      </div>
    );
  }
  if (fatal.kind === 'auth') {
    return <Navigate to={paths.login(paths.lobby(code))} replace />;
  }
  if (fatal.kind === 'left') {
    return <Navigate to={paths.hub()} replace />;
  }
  return (
    <div className="ho-page xl-page">
      <StatusPanel
        icon={<HubIcon name={fatal.kind === 'join' ? 'lock' : 'wifiOff'} size={30} />}
        tone="bad"
        title={fatal.kind === 'join' ? "Can't join this room" : 'Lost the connection'}
        body={fatal.message}
        actions={[
          ...(fatal.kind === 'closed' ? [{ label: 'Try again', onClick: () => window.location.reload(), primary: true }] : [{ label: 'Enter another code', to: paths.join(), primary: true }]),
          { label: 'Home', to: paths.hub() },
        ]}
      />
    </div>
  );
}
