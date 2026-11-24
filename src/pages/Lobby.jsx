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
import SeatStepper from '@/components/online/SeatStepper.jsx';
import SettingsPanel from '@/components/online/SettingsPanel.jsx';
import { InviteTicket } from '@/components/online/ShareCard.jsx';
import ShareSheet from '@/components/online/ShareSheet.jsx';
import StatusPanel, { Loading } from '@/components/online/StatusPanel.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { HubLogo } from '@/platform/game/hubArt.jsx';
import { themeVars as gameVars } from '@/platform/game/color.js';
import { publisherArt } from '@/platform/browse/publisherArt.js';
import LobbyTour from '@/components/tour/LobbyTour.jsx';
import PiecePicker from '@/platform/game/PiecePicker.jsx';
import '@/styles/online.css';
import '@/styles/cine.css';
import '@/styles/cine/lobby.css';

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
 * The lobby is a full-screen route (no tab bar, so nobody leaves by accident). It wears the cine skin
 * (docs/CINE_UI.md, styles/cine/lobby.css): everything is scoped under `.cj-lobby`, over a blurred ambient backdrop of
 * the game's own art.
 */
function Shell({ style, game = null, children }) {
  return (
    <div className="hub-app hub-app--lobby cj-lobby" style={style}>
      <Ambient game={game} />
      {children}
    </div>
  );
}

/** Terminal / gating states (bad code, opening, match over, kicked, lost connection): one centred glass panel. */
function Solo({ children }) {
  return (
    <div className="hub-app hub-app--lobby cj-lobby cj-lobby--solo">
      <Ambient />
      <div className="hub-page st-scope sr-solo cj-lobby-solo">{children}</div>
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

/**
 * The calm ambient field behind the lobby (like the reference's "My Lists" page): the cine green glow, with the game's
 * own painted cover blurred far out of focus over it when it has one.
 */
function Ambient({ game = null }) {
  const art = game ? publisherArt(game) : null;
  return (
    <div className="cj-ambient cj-lobby-ambient" aria-hidden="true">
      {art && <img className="cj-lobby-ambient__art" src={art.src} alt="" decoding="async" />}
      <div className="cj-lobby-ambient__shade" />
    </div>
  );
}

/**
 * The lobby's top bar, like the reference's title page: a back arrow (to the game's page) and the small Jalebi logo
 * (home) on the left; the tour "?" and Leave on the right. The arrow and logo only walk away; Leave asks.
 */
function TopBar({ game, gName, backTo, onLeave, isHost, alone, tour = null }) {
  return (
    <header className="cj-lobby-bar">
      <div className="cj-lobby-bar__start">
        <Link to={backTo} className="cj-lobby-bar__back" aria-label={game ? `Back to ${gName}` : 'Back to the games'}>
          <HubIcon name="arrowL" size={24} />
        </Link>
        <Link to={paths.hub()} className="cj-lobby-bar__logo" aria-label={`${BRAND.name}, home`}>
          <HubLogo size={40} compact />
        </Link>
      </div>
      <div className="cj-lobby-bar__end">
        {tour}
        {onLeave && (
          <button type="button" className="cj-btn cj-btn--sm cj-lobby-bar__leave" onClick={onLeave} data-tour="lobby-leave">
            <HubIcon name="door" size={18} /> <span>{isHost && alone ? 'Close table' : 'Leave table'}</span>
          </button>
        )}
      </div>
    </header>
  );
}

/** The compact code chip in the page head ("Room ABC 234 Copy", tap to copy). The code is big in one place: the invite ticket. */
function CodeChip({ code, onNotify }) {
  const [copied, copy] = useCopied();
  const spoken = String(code).split('').join(' ');
  return (
    <>
      <button
        type="button"
        className={`cj-lobby-code${copied ? ' is-copied' : ''}`}
        data-tour="lobby-code"
        aria-label={`Room code ${spoken}. Tap to copy.`}
        onClick={async () => {
          if (!(await copy(code)) && onNotify) onNotify('Could not copy. Select the code and copy it manually.', 'bad');
        }}
      >
        <span className="cj-lobby-code__k" aria-hidden="true">
          Room
        </span>
        <span className="cj-lobby-code__v" aria-hidden="true">
          {spacedCode(code)}
        </span>
        <span className="cj-lobby-code__copy" aria-hidden="true">
          <HubIcon name={copied ? 'check' : 'copy'} size={15} />
          {copied ? 'Copied' : 'Copy'}
        </span>
      </button>
      <span className="ho-sr" role="status" aria-live="polite">
        {copied ? 'Room code copied' : ''}
      </span>
    </>
  );
}

/** "Invite" in the Start bar: phones and portrait tablets (from 900px the invite ticket sits in view beside it). */
function InviteButton({ onInvite }) {
  return (
    <button type="button" className="cj-btn cj-btn--lg ls-start__invite cj-lobby-start__invite" onClick={onInvite} aria-label="Invite players">
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
        <TopBar game={null} gName="Lobby" backTo={paths.hub()} />
        <main className="cj-lobby-main cj-lobby-main--wait" aria-busy="true">
          <div className="cj-lobby-wait">
            <Loading text="Joining the room..." />
            <div className="cj-lobby-wait__chip">{chip}</div>
            <button type="button" className="cj-btn cj-lobby-wait__cancel" onClick={() => navigate(paths.hub())}>
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
    <Shell style={vars} game={game}>
      <TopBar
        game={game}
        gName={gName}
        backTo={game ? paths.game(gameId) : paths.hub()}
        onLeave={askLeave}
        isHost={isHost}
        alone={alone}
        tour={<LobbyTour isHost={isHost} ready={open && !!game} />}
      />

      <main className={`cj-lobby-main${isHost ? ' is-host' : ''}`}>
        <div className="cj-lobby-page">
          <header className="cj-lobby-head" data-tour="lobby-header">
            <div className="cj-lobby-head__main">
              <h1 className="cj-pagehead__title cj-lobby-head__title">{hostName ? `${hostName}'s table` : 'Your table'}</h1>
              <ul className="cj-meta cj-lobby-head__meta">
                <li className="cj-lobby-head__game">
                  <GameIcon game={game} name={gName} size={22} className="cj-lobby-head__icon" />
                  <span>{gName}</span>
                </li>
                {hasMaps && (
                  <li>
                    <MapTag value={room.settings || {}} className="cj-lobby-head__map" />
                  </li>
                )}
                <li className="cj-lobby-head__count">
                  Players {Math.min(joined, maxPlayers)}/{maxPlayers}
                </li>
                <li className="cj-lobby-head__conn" data-tour="lobby-connection">
                  {chip}
                </li>
              </ul>
            </div>
            <div className="cj-lobby-head__code">
              <CodeChip code={code} onNotify={push} />
            </div>
          </header>

          {!game && (
            <div className="cj-lobby-banner" role="status">
              <span>This game is not available in this version of the app. Reload to update, or leave the room.</span>
              <button type="button" className="cj-btn cj-btn--sm" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          )}

          <RematchBanner from={rematch} players={players} meId={user.id} />

          <div className="ho-lobby__cols cj-lobby-cols">
            <div className="ho-lobby__side ho-lobby__side--people cj-lobby-side">
              {/* the invite: the room code big on a ticket; Share invite opens the lobby's one share-link sheet (link, QR, WhatsApp) */}
              <section className="cj-lobby-card cj-lobby-invite" id="sr-invite" tabIndex={-1} aria-labelledby="ho-invite-h">
                <div className="cj-lobby-card__head">
                  <h2 id="ho-invite-h" className="cj-lobby-card__title">
                    Invite
                  </h2>
                  <span className="cj-lobby-card__aside">{seatsOpen}</span>
                </div>
                <InviteTicket code={code} gameName={gName} onNotify={push} onShare={inviteSomeone} highlight={inviteLit} />
              </section>

              <section className="cj-lobby-card cj-lobby-seats" aria-labelledby="ho-seats-h" data-tour="lobby-seats">
                <div className="cj-lobby-card__head">
                  <h2 id="ho-seats-h" className="cj-lobby-card__title">
                    Players
                  </h2>
                  <div className="cj-lobby-card__tools">
                    {isHost && (
                      <SeatStepper
                        value={maxPlayers}
                        joined={joined}
                        min={minToStart}
                        max={bounds.max || maxPlayers}
                        disabled={!open || starting}
                        onChange={(n) => send({ t: 'settings', settings: { maxPlayers: n } }, { queue: false })}
                      />
                    )}
                    <span className={`cj-lobby-count${full ? ' is-full' : ''}`} aria-live="polite">
                      {joinedLabel(joined, maxPlayers)}
                    </span>
                  </div>
                </div>
                <div className="cj-lobby-progress" role="progressbar" aria-label="Seats taken" aria-valuemin={0} aria-valuemax={maxPlayers} aria-valuenow={Math.min(joined, maxPlayers)}>
                  {Array.from({ length: maxPlayers }, (_, i) => (
                    <span key={i} className={i < joined ? 'is-on' : undefined} />
                  ))}
                </div>
                <ul className="cj-lobby-seatgrid" data-seats={seats.length + openSlots}>
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

            <div className="ho-lobby__side ho-lobby__side--control cj-lobby-side">
              {choices.length > 0 && (
                <div className="cj-lobby-pieces" data-tour="lobby-pieces">
                  <PiecePicker choices={choices} color={myColor} onPick={choosePiece} disabled={!open} pending={!!pending} me={{ name: user.name, avatar: (players[myIndex] || user).avatar }} />
                </div>
              )}

              <div className="cj-lobby-settings" data-tour="lobby-settings">
                <SettingsPanel game={game} settings={room.settings} isHost={isHost} disabled={!open || starting} errorId={errorId} error={error} onSend={(msg) => send(msg, { queue: false })} />
              </div>

              <section className={`cj-lobby-start${isHost ? ' is-host' : ''}${canStart ? ' is-ready' : ''}${starting ? ' is-starting' : ''}`} aria-label="Start" data-tour="lobby-start">
                {isHost ? (
                  <>
                    <div className="cj-lobby-start__row">
                      <InviteButton onInvite={inviteSomeone} />
                      <button
                        type="button"
                        className={`cj-btn cj-btn--primary cj-btn--lg cj-btn--block cj-lobby-start__go${full && canStart ? ' is-full' : ''}`}
                        onClick={start}
                        disabled={!canStart}
                        aria-describedby="ho-start-note"
                      >
                        {starting ? <span className="cj-lobby-spin" aria-hidden="true" /> : <HubIcon name="play" size={18} />} {startLabel}
                      </button>
                    </div>
                    <p id="ho-start-note" className={`cj-lobby-start__note${reason ? ' is-reason' : ''}`} aria-live="polite">
                      {reason || startHelp}
                    </p>
                  </>
                ) : (
                  <div className="cj-lobby-start__row">
                    <p className="cj-lobby-start__wait" role="status" aria-live="polite">
                      {open ? <i className="cj-live-dot" aria-hidden="true" /> : <span className="cj-lobby-spin" aria-hidden="true" />}{' '}
                      <span>{open ? waitingText({ need, hostName }) : 'Reconnecting to the room...'}</span>
                    </p>
                    <InviteButton onInvite={inviteSomeone} />
                  </div>
                )}
              </section>

              <section className="cj-lobby-card cj-lobby-friends" aria-labelledby="ho-friends-h" data-tour="lobby-friends">
                <div className="cj-lobby-card__head">
                  <h2 id="ho-friends-h" className="cj-lobby-card__title">
                    Invite friends
                  </h2>
                </div>
                {user.isGuest ? (
                  <p className="cj-lobby-friends__guest">
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
