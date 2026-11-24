// Tiffin Centre: the online (room) session as a React hook. Built on `useRoomConnection` (NOT `useOnlineGame`, which is
// Tycoon-coupled and locks input while it waits for the server): the room runs in real time, so every tap is sent at once.
//
//   const session = useRoomSession(code);
//   const { state, tickAt, status, lobby, fatal, room, players } = useSession(session);
//   if (lobby) return <Navigate to={paths.lobby(code)} replace />;
//
// The returned object IS the session interface of docs/TIFFIN_CENTRE_PLAN.md section 4 (stable for the life of the room code),
// plus `room`, `players`, `lobby` (the room is back in its lobby), `fatal` ({ kind, message } when the link is gone for good)
// and `retry()`. See roomCore.js for the logic (and its tests).
import { useEffect, useRef } from 'react';
import { useRoomConnection } from '@/components/online/useRoomConnection.js';
import { useAuth } from '@/lib/auth.jsx';
import { createRoomSessionCore } from './roomCore.js';

export function useRoomSession(code) {
  const { user } = useAuth();
  const meId = user ? String(user.id) : '';
  const sendRef = useRef(() => false);
  const leaveRef = useRef(() => {});
  const holder = useRef(null);

  if (!holder.current || holder.current.code !== code) {
    if (holder.current) holder.current.core.dispose();
    holder.current = {
      code,
      core: createRoomSessionCore({
        meId,
        send: (msg, opts) => sendRef.current(msg, opts),
        leave: () => leaveRef.current(),
      }),
    };
  }
  const { core } = holder.current;

  const conn = useRoomConnection(code, { onState: core.handleState });
  sendRef.current = conn.send;
  leaveRef.current = conn.leave;

  useEffect(() => {
    core.setMe(meId);
  }, [core, meId]);
  useEffect(() => {
    core.setRoom(conn.room);
  }, [core, conn.room]);
  useEffect(() => {
    core.setConnection(conn.connection);
  }, [core, conn.connection]);
  useEffect(() => {
    core.setFatal(conn.fatal);
  }, [core, conn.fatal]);
  useEffect(() => {
    if (conn.error) core.setError(conn.error);
  }, [core, conn.error, conn.errorId]);
  useEffect(() => () => core.dispose(), [core]);

  const retryRef = useRef(conn.retry);
  retryRef.current = conn.retry;
  const session = core.session;
  if (!session.retry) Object.defineProperty(session, 'retry', { value: () => retryRef.current(), enumerable: true });
  return session;
}

export default useRoomSession;
