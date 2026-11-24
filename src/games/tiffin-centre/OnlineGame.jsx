// The co-op table at /play/tiffin-centre/online/:code (manifest loaders.onlineGame; the hub's pages/OnlineGame.jsx loads this file).
// Real time: it uses the room session (useRoomSession over useRoomConnection), NOT the turn-based useOnlineGame of Nawabi Raj.
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth.jsx';
import { isRoomCode, normalizeRoomCode } from '@/components/online/codes.js';
import { paths } from '@/platform/paths.js';
import { GAME_ID } from '@shared/tiffin-centre/catalog.js';
import TiffinGame from './TiffinGame.jsx';
import { StatusScreen } from './ui/menus/index.js';
import { useRoomSession } from './session/index.js';
import './tiffin.css';

function Shell({ children }) {
  return <div className="tc">{children}</div>;
}

export default function OnlineGame() {
  const { code: rawCode } = useParams();
  const code = normalizeRoomCode(rawCode || '');
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const toGame = () => navigate(paths.game(GAME_ID), { replace: true });

  if (!isRoomCode(code)) {
    return (
      <Shell>
        <StatusScreen kind="error" onExit={toGame} />
      </Shell>
    );
  }
  if (loading) {
    return (
      <Shell>
        <StatusScreen kind="loading" onExit={toGame} />
      </Shell>
    );
  }
  if (!user) return <Navigate to={paths.login(paths.online(GAME_ID, code))} replace />;
  return <Table code={code} />;
}

function Table({ code }) {
  const navigate = useNavigate();
  const session = useRoomSession(code);
  const toGame = () => navigate(paths.game(GAME_ID), { replace: true });

  if (session.fatal?.kind === 'left') return <Navigate to={paths.game(GAME_ID)} replace />;
  if (session.fatal?.kind === 'auth') return <Navigate to={paths.login(paths.online(GAME_ID, code))} replace />;
  // the room is (back) in the lobby: the shift is not running yet
  if (session.lobby) return <Navigate to={paths.lobby(code)} replace />;

  return (
    <TiffinGame
      session={session}
      onExit={toGame}
      onRetry={() => navigate(paths.lobby(code), { replace: true })}
      onInvite={undefined}
    />
  );
}
