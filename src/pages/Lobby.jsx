import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { createRoom, errorMessage } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { useRoomConnection } from '@/components/online/useRoomConnection.js';
import {
  fatalView,
  joinedLabel,
  joinedPercent,
  pieceChoices,
  pieceOf,
  rosterChanges,
  seatColor,
  startReason,
  startState,
  waitingText,
} from '@/components/online/lobbyModel.js';
import { resolveSettings } from '@/components/online/settings.js';
import { sameId } from '@/components/online/gameHelpers.js';
import { inviteMessage, isRoomCode, normalizeRoomCode } from '@/components/online/codes.js';
import { shareOrCopy } from '@/components/online/clipboard.js';
import { gameName, gameOf, warmOnlineGame } from '@/components/online/games.js';
import { rememberRoomGame, roomGameId } from '@/components/online/gameRoute.js';
import { useRoster } from '@/components/online/roster.js';
import ConfirmDialog from '@/components/online/ConfirmDialog.jsx';
import ConnectionChip from '@/components/online/ConnectionChip.jsx';
import InviteFriends from '@/components/online/InviteFriends.jsx';
import Seat, { EmptySeat } from '@/components/online/Seat.jsx';
import SettingsPanel from '@/components/online/SettingsPanel.jsx';
import ShareCard from '@/components/online/ShareCard.jsx';
import StatusPanel from '@/components/online/StatusPanel.jsx';
import TableHeader from '@/components/online/TableHeader.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import PiecePicker from '@/platform/game/PiecePicker.jsx';
import AutoMascot from '@/components/art/AutoMascot.jsx';
import '@/styles/online.css';
import '@/styles/x-lobby.css';
import '@/styles/store-rooms.css';

const PIECE_SETTLE = 4000; // ms: no answer to a piece pick -> show what the server says again

/** CSS variables that tint the lobby's controls with the game's own colours (the lit header uses color.js on its own). */
function themeVars(game) {
  const t = (game && game.theme) || {};
  const v = {};
  if (t.accent) v['--ho-accent'] = t.accent;
  if (t.accent2 || t.accent) v['--ho-accent-2'] = t.accent2 || t.accent;
  if (t.bg) v['--ho-game-bg'] = t.bg;
  return v;
}

/** /lobby/:code */
export default function Lobby() {
  const { code: rawCode } = useParams();
  const code = normalizeRoomCode(rawCode || '');
  const valid = isRoomCode(code);
  const { user, loading } = useAuth();

  if (!valid) {
    return (
      <div className="hub-page st-scope sr-solo">
        <StatusPanel
          icon={<HubIcon name="hash" size={30} />}
          tone="bad"
          eyebrow="Room link"
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
      <div className="hub-page st-scope sr-solo">
        <StatusPanel busy eyebrow={`Room ${code}`} title="Opening the lobby..." />
      </div>
    );
  }
  if (!user) return <Navigate to={paths.login(paths.lobby(code))} replace />;
  return <LobbyInner code={code} user={user} />;
}

/** Back to the game page (left) and leave the table (right). The lobby sits outside the hub chrome, so it brings its own bar. */
function TopBar({ game, gName, backTo, onLeave, isHost, alone }) {
  return (
    <nav className="sr-topbar" aria-label="Lobby">
      <Link to={backTo} className="sr-topbar__back">
        <HubIcon name="chevL" size={20} />
        <span>{game ? gName : 'Games'}</span>
      </Link>
      {onLeave && (
        <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm sr-topbar__leave" onClick={onLeave}>
          <HubIcon name="door" size={18} /> <span>{isHost && alone ? 'Close table' : 'Leave table'}</span>
        </button>
      )}
    </nav>
  );
}

/** Shapes of the seats while the room payload is on its way. */
function SeatsSkeleton({ n = 4 }) {
  return (
    <ul className="sr-seats" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="sr-seat sr-seat--skel" style={{ '--i': i }}>
          <span className="st-skel sr-skel-avatar" />
          <span className="st-skel sr-skel-line sr-skel-line--m" />
          <span className="st-skel sr-skel-line sr-skel-line--s" />
        </li>
      ))}
    </ul>
  );
}

function LobbyInner({ code, user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { push, node } = useToasts();
  const { room, connection, link, fatal, error, errorId, send, pickPiece, leave, retry } = useRoomConnection(code);
  const [confirm, setConfirm] = useState(null); // {kind:'leave'} | {kind:'kick', player}
  const [starting, setStarting] = useState(false);
  const [pending, setPending] = useState(null); // piece id asked for, not yet confirmed by the server
  const startTimer = useRef(null);
  const pieceTimer = useRef(null);
  const roster = useRef(null);
  const hostSeen = useRef(null);
  const sawLobby = useRef(false);

  const gameId = room ? roomGameId(room) : null;
  const game = useMemo(() => (gameId ? gameOf(gameId) : null), [gameId]);
  const gName = gameName(gameId, game);
  const players = useMemo(() => (room && Array.isArray(room.players) ? room.players : []), [room]);
  const seats = useRoster(players);

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

  // the host role moved (the host left): say who has it now
  useEffect(() => {
    if (!room || room.hostId == null) return;
    const prev = hostSeen.current;
    hostSeen.current = room.hostId;
    if (prev == null || sameId(prev, room.hostId)) return;
    if (sameId(room.hostId, user.id)) push('You are the host now', 'gold');
    else {
      const h = (room.players || []).find((p) => sameId(p.id, room.hostId));
      push(`${(h && h.name) || 'Someone'} is the host now`, 'info');
    }
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
    if (room && room.status === 'lobby') sawLobby.current = true;
    if (room && room.status === 'playing' && !fatal) {
      rememberRoomGame(code, gameId);
      if (sawLobby.current) push('Game on! Taking you to the table.', 'good'); // not when we only came back to a running match
      navigate(paths.online(gameId, code), { replace: true });
    }
  }, [room, fatal, code, gameId, navigate, push]);

  const chip = <ConnectionChip connection={connection} link={link} fatal={fatal} onRetry={retry} />;

  if (fatal) return <Fatal fatal={fatal} code={code} gameId={gameId} />;

  if (!room) {
    return (
      <div className="hub-page st-scope ho-lobby sr-lobby">
        <TopBar game={null} gName="Lobby" backTo={paths.hub()} />
        <TableHeader game={null} gName="Lobby" code={code} chip={chip} onNotify={push} />
        <div className="sr-lobby__cols">
          <section className="sr-card sr-seatscard" aria-busy="true">
            <header className="sr-card__head">
              <div>
                <span className="st-eyebrow">Players</span>
                <h2 className="sr-card__title" role="status" aria-live="polite">
                  Joining the room...
                </h2>
              </div>
            </header>
            <SeatsSkeleton />
          </section>
        </div>
        <button type="button" className="ho-btn ho-btn--ghost sr-cancel" onClick={() => navigate(paths.hub())}>
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
  const { enough, full, emptySeats, need, help: startHelp } = startState({ players: joined, joined, maxPlayers, minToStart, starting, open });
  const canStart = isHost && enough && open && !starting;
  const reason = startReason({ enough, open, starting, players: joined, minToStart });
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
    if (isHost) setConfirm({ kind: 'leave' });
    else doLeave();
  };

  // an empty seat is an invitation: the share sheet on phones, else copy the link; bring the invite block into view
  const inviteSomeone = async () => {
    const el = typeof document !== 'undefined' ? document.getElementById('sr-invite') : null;
    if (el && el.scrollIntoView) {
      const calm = document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
      el.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    }
    const res = await shareOrCopy(inviteMessage(code, gName));
    if (res === 'copied') push('Invite link copied. Send it to a friend.', 'good');
    else if (res === 'failed') push('Could not share. Use the link below.', 'bad');
  };

  const alone = joined <= 1;
  const vars = { ...themeVars(game) };

  return (
    <div className="hub-page st-scope ho-lobby sr-lobby" style={vars}>
      <TopBar game={game} gName={gName} backTo={game ? paths.game(gameId) : paths.hub()} onLeave={askLeave} isHost={isHost} alone={alone} />

      <TableHeader game={game} gName={gName} code={code} hostName={host && host.name} chip={chip} onNotify={push} />

      {!game && (
        <div className="sr-note sr-note--warn" role="status">
          <span>This game is not available in this version of the app. Reload to update, or leave the room.</span>
          <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      {choices.length > 0 && (
        <div className="sr-o-pieces">
          <PiecePicker choices={choices} color={myColor} onPick={choosePiece} disabled={!open} pending={!!pending} me={{ name: user.name, avatar: (players[myIndex] || user).avatar }} />
        </div>
      )}

      <div className="sr-lobby__cols">
        <div className="sr-lobby__main">
          <section className="sr-card sr-seatscard sr-o-seats" aria-label="Players">
            <header className="sr-card__head">
              <div>
                <span className="st-eyebrow">Players</span>
                <h2 className="sr-card__title">Around the table</h2>
              </div>
              <span className={`sr-count${full ? ' is-full' : ''}`} aria-live="polite">
                {joinedLabel(joined, maxPlayers)}
              </span>
            </header>
            <div className="sr-meter" role="progressbar" aria-label="Seats taken" aria-valuemin={0} aria-valuemax={maxPlayers} aria-valuenow={Math.min(joined, maxPlayers)}>
              <span style={{ transform: `scaleX(${joinedPercent(joined, maxPlayers) / 100})` }} />
            </div>
            <ul className="sr-seats" data-seats={joined + emptySeats}>
              {seats.map(({ key, player: p, leaving }) => {
                const me = sameId(p.id, user.id);
                const i = players.findIndex((q) => sameId(q.id, p.id));
                return (
                  <Seat
                    key={key}
                    player={p}
                    piece={pieceOf(me ? { ...p, piece: myPiece } : p, pieces)}
                    piecesOn={choices.length > 0}
                    color={seatColor(game, i < 0 ? 0 : i)}
                    isMe={me}
                    isHost={sameId(p.id, room.hostId)}
                    canRemove={isHost && !me && open && !leaving}
                    leaving={leaving}
                    onRemove={() => setConfirm({ kind: 'kick', player: p })}
                  />
                );
              })}
              {Array.from({ length: emptySeats }, (_, i) => (
                <EmptySeat key={`empty-${i}`} onInvite={inviteSomeone} />
              ))}
            </ul>
          </section>

          <div className="sr-o-settings">
            <SettingsPanel game={game} settings={room.settings} isHost={isHost} disabled={!open || starting} errorId={errorId} error={error} onSend={(msg) => send(msg, { queue: false })} />
          </div>

          <section className={`sr-card sr-start sr-o-start${isHost && canStart ? ' is-ready' : ''}${full ? ' is-full' : ''}${starting ? ' is-starting' : ''}`} aria-label="Start">
            {gameId === 'hyderabad-tycoon' && (
              <div className="sr-start__mascot" aria-hidden="true">
                <AutoMascot key={canStart ? 'ready' : 'waiting'} mood={canStart ? 'roll' : 'waiting'} />
              </div>
            )}
            {isHost ? (
              <>
                <button
                  type="button"
                  className={`ho-btn ho-btn--primary ho-btn--lg ho-btn--block sr-start__btn${full && canStart ? ' ho-btn--full' : ''}`}
                  onClick={start}
                  disabled={!canStart}
                  aria-describedby="sr-start-note"
                >
                  {starting ? <span className="ho-spinner" aria-hidden="true" /> : <HubIcon name="play" size={18} />} {starting ? 'Starting...' : 'Start game'}
                </button>
                <p id="sr-start-note" className={`sr-start__note${reason ? ' is-reason' : ''}`} aria-live="polite">
                  {reason || startHelp}
                </p>
              </>
            ) : (
              <p className="sr-start__wait" role="status" aria-live="polite">
                <span className="ho-spinner" aria-hidden="true" /> {open ? waitingText({ need, hostName: host && host.name }) : 'Reconnecting to the room...'}
              </p>
            )}
          </section>
        </div>

        <div className="sr-lobby__side">
          <div className="sr-o-invite">
            <ShareCard code={code} gameName={gName} onNotify={push} id="sr-invite" />
          </div>
          {user.isGuest ? (
            <p className="sr-guest sr-o-guest">
              Share the code, link or QR above. <Link to={paths.login(paths.lobby(code))}>Sign in with Google</Link> to invite friends in one tap.
            </p>
          ) : (
            <div className="sr-o-friends">
              <InviteFriends code={code} gameName={gName} onNotify={push} />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'leave'}
        title={alone ? 'Close this table?' : 'Leave this table?'}
        body={alone ? 'Nobody else is here, so the table closes. You can always start a new one.' : 'Other players stay in the lobby and the host role passes on.'}
        confirmLabel={alone ? 'Close table' : 'Leave table'}
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
    <div className="hub-page st-scope sr-solo">
      <StatusPanel
        icon={<HubIcon name="trophy" size={30} />}
        eyebrow="Match over"
        title="This game has finished"
        body={`The ${gameLabel} match in this room is over. Start a new private room with the same settings and send your friends the new code.`}
        actions={[
          { label: busy ? 'Creating...' : 'New room, same settings', onClick: create, primary: true },
          { label: 'Your profile', to: paths.profile() },
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

function Fatal({ fatal, code, gameId }) {
  if (fatal.kind === 'auth') return <Navigate to={paths.login(paths.lobby(code))} replace />;
  if (fatal.kind === 'left') return <Navigate to={paths.hub()} replace />;
  const v = fatalView(fatal, { paths, gameId: gameId && gameOf(gameId) ? gameId : null });
  if (!v) return <Navigate to={paths.hub()} replace />;
  return (
    <div className="hub-page st-scope sr-solo">
      <StatusPanel
        icon={<HubIcon name={v.icon} size={30} />}
        tone={v.tone}
        eyebrow={v.eyebrow}
        title={v.title}
        body={v.body}
        actions={v.actions.map((a) => (a.act === 'reload' ? { label: a.label, onClick: () => window.location.reload(), primary: a.primary } : a))}
      />
    </div>
  );
}
