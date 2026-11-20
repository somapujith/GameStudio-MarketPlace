import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { BRAND } from '@/platform/brand.js';
import { useRoomConnection } from '@/components/online/useRoomConnection.js';
import {
  fatalView,
  joinedLabel,
  pieceChoices,
  pieceOf,
  rosterChanges,
  seatColor,
  startReason,
  startState,
  waitingText,
} from '@/components/online/lobbyModel.js';
import { readRematchFrom } from '@/components/online/playAgainModel.js';
import { sameId } from '@/components/online/gameHelpers.js';
import { useCopied } from '@/components/online/clipboard.js';
import { isRoomCode, normalizeRoomCode, spacedCode } from '@/components/online/codes.js';
import { gameName, gameOf, warmOnlineGame } from '@/components/online/games.js';
import { rememberRoomGame, roomGameId } from '@/components/online/gameRoute.js';
import { mapFieldOf, skinPieces } from '@/components/online/mapModel.js';
import { useApplyMap } from '@/components/online/useApplyMap.js';
import { useRoster } from '@/components/online/roster.js';
import ConfirmDialog from '@/components/online/ConfirmDialog.jsx';
import ConnectionChip from '@/components/online/ConnectionChip.jsx';
import GameIcon from '@/components/online/GameIcon.jsx';
import InviteFriends from '@/components/online/InviteFriends.jsx';
import MapTag from '@/components/online/MapTag.jsx';
import PlayAgain, { RematchBanner } from '@/components/online/PlayAgain.jsx';
import Seat, { EmptySeat } from '@/components/online/Seat.jsx';
import SettingsPanel from '@/components/online/SettingsPanel.jsx';
import { InviteTicket } from '@/components/online/ShareCard.jsx';
import ShareSheet from '@/components/online/ShareSheet.jsx';
import StatusPanel, { Loading } from '@/components/online/StatusPanel.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { HubBackdrop, HubLogo } from '@/platform/game/hubArt.jsx';
import { themeVars as gameVars } from '@/platform/game/color.js';
import LobbyTour from '@/components/tour/LobbyTour.jsx';
import PiecePicker from '@/platform/game/PiecePicker.jsx';
import '@/styles/online.css';
import '@/styles/x-lobby.css';
import '@/styles/store-rooms.css';
import '@/styles/lobby-shell.css';
import '@/styles/lobby-invite.css';

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

/**
 * The lobby is a full-screen route (no tab bar, so nobody leaves by accident). `.hub-app` keeps the Jalebi poster skin
 * (online.css "Lobby: two-sided panel") on it; `.ls-page` brings the hub's backdrop and the lobby's own top bar.
 */
function Shell({ style, children }) {
  return (
    <div className="hub-app hub-app--lobby ls-page" style={style}>
      <Backdrop />
      {children}
    </div>
  );
}

/** Terminal / gating states (bad code, opening, match over, kicked, lost connection): one centred panel. */
function Solo({ children }) {
  return (
    <div className="hub-app hub-app--lobby">
      <div className="hub-page st-scope sr-solo">{children}</div>
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
      <Solo>
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
      </Solo>
    );
  }
  if (loading) {
    return (
      <Solo>
        <StatusPanel busy eyebrow={`Room ${code}`} title="Opening the lobby..." />
      </Solo>
    );
  }
  if (!user) return <Navigate to={paths.login(paths.lobby(code))} replace />;
  return <LobbyInner code={code} user={user} />;
}

/** The same soft glow as behind Home (the lobby is full screen, so it brings its own copy of the hub backdrop). */
function Backdrop() {
  return (
    <div className="hub-backdrop ls-backdrop" aria-hidden="true">
      <HubBackdrop />
      <div className="hub-backdrop__shade" />
    </div>
  );
}

/**
 * The hub's top bar in the lobby's own words: logo (home), "Home / <Game> / Table ABCD", the tour "?" and Leave.
 * The logo and crumbs only walk away; Leave asks.
 */
function TopBar({ game, gName, code, backTo, onLeave, isHost, alone, tour = null }) {
  return (
    <header className="ls-bar">
      <div className="ls-bar__in">
        <Link to={paths.hub()} className="ls-bar__logo" aria-label={`${BRAND.name}, home`}>
          <HubLogo size={30} />
        </Link>
        <nav className="ls-crumbs" aria-label="Breadcrumb">
          <ol>
            <li className="ls-crumbs__home">
              <Link to={paths.hub()}>Home</Link>
            </li>
            <li className="ls-crumbs__game">
              <Link to={backTo}>
                <HubIcon name="chevL" size={16} className="ls-crumbs__chev" />
                <span>{game ? gName : 'Games'}</span>
              </Link>
            </li>
            <li className="ls-crumbs__here" aria-current="page">
              Table {code}
            </li>
          </ol>
        </nav>
        <div className="ls-bar__end">
          {tour}
          {onLeave && (
            <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm ls-bar__leave" onClick={onLeave} data-tour="lobby-leave">
              <HubIcon name="door" size={18} /> <span>{isHost && alone ? 'Close table' : 'Leave table'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** The compact code chip in the masthead ("Code ABC 234", tap to copy). The code is big in one place: the invite ticket. */
function CodeChip({ code, onNotify }) {
  const [copied, copy] = useCopied();
  const spoken = String(code).split('').join(' ');
  return (
    <>
      <button
        type="button"
        className={`ho-qhead__code${copied ? ' is-copied' : ''}`}
        data-tour="lobby-code"
        aria-label={`Room code ${spoken}. Tap to copy.`}
        onClick={async () => {
          if (!(await copy(code)) && onNotify) onNotify('Could not copy. Select the code and copy it manually.', 'bad');
        }}
      >
        <span aria-hidden="true">{spacedCode(code)}</span>
        <span className="ho-qhead__copy" aria-hidden="true">
          {copied ? 'Copied' : 'Copy'}
        </span>
      </button>
      <span className="ho-sr" role="status" aria-live="polite">
        {copied ? 'Room code copied' : ''}
      </span>
    </>
  );
}

/** "Invite" in the Start card: phones and portrait tablets (from 900px the invite ticket sits in view beside it). */
function InviteButton({ onInvite }) {
  return (
    <button type="button" className="ho-btn ho-btn--ghost ls-start__invite ho-startcard__invite" onClick={onInvite} aria-label="Invite players">
      <HubIcon name="share" size={18} /> <span>Invite</span>
    </button>
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
  const [shareOpen, setShareOpen] = useState(false); // the share-link sheet
  const [inviteLit, setInviteLit] = useState(0); // bumped to play the invite ticket's calm outline pulse
  const startTimer = useRef(null);
  const pieceTimer = useRef(null);
  const roster = useRef(null);
  const hostSeen = useRef(null);
  const sawLobby = useRef(false);
  const [rematch] = useState(() => readRematchFrom(location.state && location.state.rematchFrom)); // "play again": who we wait for (the toast effect below clears the history state)

  const gameId = room ? roomGameId(room) : null;
  const game = useMemo(() => (gameId ? gameOf(gameId) : null), [gameId]);
  const gName = gameName(gameId, game);
  const players = useMemo(() => (room && Array.isArray(room.players) ? room.players : []), [room]);
  const seats = useRoster(players);
  // the host's map: the names of the board, the header and the previews follow it (and go back to the default when we leave)
  const hasMaps = !!(game && mapFieldOf(game.settings));
  useApplyMap(hasMaps && room ? room.settings : null);

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
      <Shell>
        <TopBar game={null} gName="Lobby" code={code} backTo={paths.hub()} />
        <main className="ls-main ho-lobby-main" aria-busy="true">
          <div className="ho-page ho-lobby">
            <Loading text="Joining the room..." />
            <div className="ho-lobby__wait-chip">{chip}</div>
            <button type="button" className="ho-btn ho-btn--ghost ho-lobby__cancel" onClick={() => navigate(paths.hub())}>
              Cancel
            </button>
          </div>
        </main>
        {node}
      </Shell>
    );
  }

  if (room.status === 'finished') return <Rematch room={room} game={game} gameId={gameId} gameLabel={gName} />;

  const isHost = sameId(room.hostId, user.id);
  const host = players.find((p) => sameId(p.id, room.hostId));
  const hostName = host && host.name;
  const bounds = (game && game.players) || {};
  const maxPlayers = room.maxPlayers || bounds.max || 6;
  const minToStart = Number.isFinite(bounds.min) ? bounds.min : 2;
  const open = connection === 'open';
  const joined = players.length;
  const { enough, full, emptySeats, need, label: startLabel, help: startHelp } = startState({ players: joined, joined, maxPlayers, minToStart, starting, open });
  const canStart = isHost && enough && open && !starting;
  const reason = startReason({ enough, open, starting, players: joined, minToStart });
  const myIndex = players.findIndex((p) => sameId(p.id, user.id));
  const myColor = seatColor(game, Math.max(0, myIndex));
  const pieces = skinPieces(game && game.pieces, hasMaps && room ? room.settings : null); // the map's names: Pearl -> Mango
  const { mine: myPiece, choices } = pieceChoices(pieces, players, user.id, pending);
  // a leaving seat holds its place for a beat; only the empty seats make room for it
  const openSlots = Math.max(0, joined + emptySeats - seats.length);

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

  // One handler for every "invite someone" button (an empty seat, the Invite button in the Start card, the ticket's Share invite):
  // it opens the share-link sheet, which leads with the link. When the sheet closes after something was copied or shared,
  // the invite ticket is brought into view (nearest, so no big jump) and plays one calm pulse so the player sees where the code lives.
  const inviteSomeone = () => setShareOpen(true);
  const closeShare = (acted) => {
    setShareOpen(false);
    if (!acted) return;
    const el = typeof document !== 'undefined' ? document.getElementById('sr-invite') : null;
    if (el && el.scrollIntoView) {
      const calm = document.documentElement.dataset.motion === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
      el.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    }
    setInviteLit((n) => n + 1);
  };

  const alone = joined <= 1;
  const vars = { ...gameVars(game && game.theme), ...themeVars(game) };
  const seatsOpen = emptySeats > 0 ? `${emptySeats} ${emptySeats === 1 ? 'seat' : 'seats'} open` : 'Table full';

  return (
    <Shell style={vars}>
      <TopBar
        game={game}
        gName={gName}
        code={code}
        backTo={game ? paths.game(gameId) : paths.hub()}
        onLeave={askLeave}
        isHost={isHost}
        alone={alone}
        tour={<LobbyTour isHost={isHost} ready={open && !!game} />}
      />

      <main className="ls-main ho-lobby-main">
        <div className="ho-page ho-lobby ho-lobby--quick">
          <header className="ho-qhead" data-tour="lobby-header">
            <GameIcon game={game} name={gName} size={48} className="ho-qhead__icon" />
            <div className="ho-qhead__main">
              <h1 className="ho-h1">{gName}</h1>
              <p className="ho-muted">
                {hostName ? `${hostName}'s table` : 'Your table'} <span aria-hidden="true">&middot;</span> Room <CodeChip code={code} onNotify={push} />
              </p>
              {hasMaps && <MapTag value={room.settings || {}} className="ho-qhead__map" />}
            </div>
            <div className="ho-qhead__conn" data-tour="lobby-connection">
              {chip}
            </div>
          </header>

          {!game && (
            <div className="ho-banner ho-banner--warn" role="status">
              <span>This game is not available in this version of the app. Reload to update, or leave the room.</span>
              <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          )}

          <RematchBanner from={rematch} players={players} meId={user.id} />

          <div className="ho-lobby__cols">
            <div className="ho-col ho-lobby__side ho-lobby__side--people">
              {/* the invite: the room code big on a ticket; Share invite opens the lobby's one share-link sheet (link, QR, WhatsApp) */}
              <section className="ho-card ho-share ho-ticketcard" id="sr-invite" tabIndex={-1} aria-labelledby="ho-invite-h">
                <div className="ho-card__head">
                  <h2 id="ho-invite-h" className="ho-h2">
                    Invite
                  </h2>
                  <span className="ho-muted">{seatsOpen}</span>
                </div>
                <InviteTicket code={code} gameName={gName} onNotify={push} onShare={inviteSomeone} highlight={inviteLit} />
              </section>

              <section className="ho-card ho-seats" aria-labelledby="ho-seats-h" data-tour="lobby-seats">
                <div className="ho-card__head">
                  <h2 id="ho-seats-h" className="ho-h2">
                    Players
                  </h2>
                  <span className={`ho-count${full ? ' is-full' : ''}`} aria-live="polite">
                    {joinedLabel(joined, maxPlayers)}
                  </span>
                </div>
                <div className="ho-progress ho-progress--seats" role="progressbar" aria-label="Seats taken" aria-valuemin={0} aria-valuemax={maxPlayers} aria-valuenow={Math.min(joined, maxPlayers)}>
                  {Array.from({ length: maxPlayers }, (_, i) => (
                    <span key={i} className={i < joined ? 'is-on' : undefined} />
                  ))}
                </div>
                <ul className="ho-seatgrid" data-seats={seats.length + openSlots}>
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
                        friendable={!user.isGuest}
                        onRemove={() => setConfirm({ kind: 'kick', player: p })}
                      />
                    );
                  })}
                  {Array.from({ length: openSlots }, (_, e) => (
                    <EmptySeat key={`empty-${e}`} onInvite={inviteSomeone} />
                  ))}
                </ul>
              </section>
            </div>

            <div className="ho-col ho-lobby__side ho-lobby__side--control">
              {choices.length > 0 && (
                <div className="ho-lobby__pieces" data-tour="lobby-pieces">
                  <PiecePicker choices={choices} color={myColor} onPick={choosePiece} disabled={!open} pending={!!pending} me={{ name: user.name, avatar: (players[myIndex] || user).avatar }} />
                </div>
              )}

              <div className="ho-lobby__settings" data-tour="lobby-settings">
                <SettingsPanel game={game} settings={room.settings} isHost={isHost} disabled={!open || starting} errorId={errorId} error={error} onSend={(msg) => send(msg, { queue: false })} />
              </div>

              <section className={`ho-card ho-startcard${canStart ? ' is-ready' : ''}${starting ? ' is-starting' : ''}`} aria-label="Start" data-tour="lobby-start">
                {isHost ? (
                  <>
                    <div className="ho-startcard__row">
                      <InviteButton onInvite={inviteSomeone} />
                      <button
                        type="button"
                        className={`ho-btn ho-btn--primary ho-btn--lg ho-btn--block${full && canStart ? ' ho-btn--full' : ''}`}
                        onClick={start}
                        disabled={!canStart}
                        aria-describedby="ho-start-note"
                      >
                        {starting && <span className="ho-spinner" aria-hidden="true" />} {startLabel}
                      </button>
                    </div>
                    <p id="ho-start-note" className={`ho-help${reason ? ' is-reason' : ''}`} aria-live="polite">
                      {reason || startHelp}
                    </p>
                  </>
                ) : (
                  <div className="ho-startcard__row">
                    <p className="ho-waiting" role="status" aria-live="polite">
                      {open ? <i className="st-live" aria-hidden="true" /> : <span className="ho-spinner" aria-hidden="true" />}{' '}
                      <span>{open ? waitingText({ need, hostName }) : 'Reconnecting to the room...'}</span>
                    </p>
                    <InviteButton onInvite={inviteSomeone} />
                  </div>
                )}
              </section>

              <section className="ho-card ho-invitefriends" aria-labelledby="ho-friends-h" data-tour="lobby-friends">
                <div className="ho-card__head">
                  <h2 id="ho-friends-h" className="ho-h2">
                    Invite friends
                  </h2>
                </div>
                {user.isGuest ? (
                  <p className="ho-help ho-qguest">
                    Friends need an account. <Link to={paths.login(paths.lobby(code))}>Sign in with Google</Link> to invite them in one tap, or share the code above.
                  </p>
                ) : (
                  <InviteFriends code={code} gameName={gName} onNotify={push} />
                )}
              </section>
            </div>
          </div>
        </div>
      </main>

      <ShareSheet open={shareOpen} onClose={closeShare} code={code} gameName={gName} hostName={hostName} onNotify={push} />
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
    </Shell>
  );
}

/** The match in this room is over: one tap opens a private table with the same game and settings and invites the same group (see PlayAgain). */
function Rematch({ room, game, gameId, gameLabel }) {
  return (
    <Solo>
      <StatusPanel
        icon={<HubIcon name="trophy" size={30} />}
        eyebrow="Match over"
        title="This game has finished"
        body={`The ${gameLabel} match in this room is over. Bring the same group to a new private table with the same settings.`}
        actions={[
          { label: 'Your profile', to: paths.profile() },
          { label: 'Home', to: paths.hub() },
        ]}
      >
        <PlayAgain room={room} gameId={gameId} game={game} gameLabel={gameLabel} />
      </StatusPanel>
    </Solo>
  );
}

function Fatal({ fatal, code, gameId }) {
  if (fatal.kind === 'auth') return <Navigate to={paths.login(paths.lobby(code))} replace />;
  if (fatal.kind === 'left') return <Navigate to={paths.hub()} replace />;
  const v = fatalView(fatal, { paths, gameId: gameId && gameOf(gameId) ? gameId : null });
  if (!v) return <Navigate to={paths.hub()} replace />;
  return (
    <Solo>
      <StatusPanel
        icon={<HubIcon name={v.icon} size={30} />}
        tone={v.tone}
        eyebrow={v.eyebrow}
        title={v.title}
        body={v.body}
        actions={v.actions.map((a) => (a.act === 'reload' ? { label: a.label, onClick: () => window.location.reload(), primary: a.primary } : a))}
      />
    </Solo>
  );
}
