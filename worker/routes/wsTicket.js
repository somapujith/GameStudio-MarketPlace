import { Hono } from 'hono';
import { requireUser, signWsTicket, WS_TICKET_SECONDS } from '../auth.js';
import { limit } from '../ratelimit.js';

const wsTicket = new Hono();

// POST /api/ws-ticket -> { ticket, expiresIn }
// Browsers cannot set an Authorization header on a WebSocket, so a cross-origin client (SPA hosted away from
// the Worker) trades its authenticated session (bearer token or cookie) for a 60-second single-purpose ticket
// and opens `/ws/...?ticket=<ticket>`. A ticket is not accepted as an API session (distinct audience).
// The client asks for a fresh one before every (re)connect.
wsTicket.post('/', limit('ws-ticket', 240, 60), requireUser, async (c) => {
  const user = c.get('user');
  const ticket = await signWsTicket(c.env, { id: user.id, isGuest: user.is_guest });
  return c.json({ ticket, expiresIn: WS_TICKET_SECONDS });
});

export default wsTicket;
