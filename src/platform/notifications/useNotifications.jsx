import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getNotifications, markNotificationsRead } from '@/lib/api.js';
import { useAuth, useUserEvents } from '@/lib/auth.jsx';
import { FOCUS_REFETCH_MS, insertNotification, markRead, normalizeList, unreadOf } from './notificationsModel.js';

/**
 * Gifts and messages from the Jalebi Games team, for a signed-in member (guests and visitors get an empty, idle
 * state). Mounted once in AppShell; the top-bar bell and the gift popup read it with `useNotifications()`.
 *
 *   const { items, unread, status, reload, markRead(ids), markAllRead() } = useNotifications();
 *
 * Loads GET /api/notifications when the shell mounts (so coming back from a game re-reads it) and on window focus (at
 * most every 30 s); `{t:'notification'}` on the user socket inserts live. Marking read is optimistic: the list and
 * the count change at once and the server's `unread` answer settles the count. Never throws.
 */
const NotificationsContext = createContext(null);

const IDLE = Object.freeze({
  enabled: false,
  items: [],
  unread: 0,
  status: 'idle',
  reload: () => {},
  markRead: async () => {},
  markAllRead: async () => {},
});

/** Exported for tests and harnesses: provide a fixed notifications state. */
export { NotificationsContext };

export function NotificationsProvider({ children }) {
  const { user, loading, reachable } = useAuth();
  const uid = user && !user.isGuest && user.id != null ? String(user.id) : null;
  const enabled = !!uid && !loading && reachable !== false;

  // state is tied to the account: switching accounts never shows the previous one's inbox
  const [state, setState] = useState({ uid: null, items: [], unread: 0, status: 'idle' });
  const cur = state.uid === uid ? state : { uid, items: [], unread: 0, status: enabled ? 'loading' : 'idle' };
  const last = useRef(0);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    last.current = Date.now();
    const mine = ++seq.current;
    setState((s) => (s.uid === uid ? s : { uid, items: [], unread: 0, status: 'loading' }));
    try {
      const r = await getNotifications({ timeout: 10_000 });
      if (mine !== seq.current) return;
      const items = normalizeList(r?.notifications);
      setState({ uid, items, unread: unreadOf(items, r?.unread), status: 'ok' });
    } catch (e) {
      if (mine !== seq.current) return;
      setState((s) => (s.uid === uid && s.status === 'ok' ? s : { uid, items: [], unread: 0, status: e?.status === 0 ? 'offline' : 'error' }));
    }
  }, [enabled, uid]);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const onFocus = () => {
      if (Date.now() - last.current < FOCUS_REFETCH_MS) return;
      load();
    };
    const onVis = () => document.visibilityState === 'visible' && onFocus();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      seq.current += 1; // a late answer for this account is dropped
    };
  }, [enabled, load]);

  useUserEvents(
    (msg) => {
      if (!enabled || !msg?.notification) return;
      setState((s) => {
        const base = s.uid === uid ? s : { uid, items: [], unread: 0, status: 'ok' };
        const { list, added } = insertNotification(base.items, msg.notification);
        return { ...base, items: list, unread: base.unread + (added ? 1 : 0), status: base.status === 'loading' ? base.status : 'ok' };
      });
    },
    ['notification'],
  );

  const doMark = useCallback(
    async (ids) => {
      if (!enabled) return;
      const all = ids === 'all';
      const list = all ? 'all' : (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String);
      if (!all && !list.length) return;
      setState((s) => {
        if (s.uid !== uid) return s;
        const { list: next, changed } = markRead(s.items, list);
        return { ...s, items: next, unread: all ? 0 : Math.max(0, s.unread - changed) };
      });
      try {
        const r = await markNotificationsRead(list);
        const n = Math.floor(Number(r?.unread));
        if (Number.isFinite(n) && n >= 0) setState((s) => (s.uid === uid ? { ...s, unread: n } : s));
      } catch {
        /* offline: the local read state stands; the next load re-syncs with the server */
      }
    },
    [enabled, uid],
  );

  const value = useMemo(
    () => ({
      enabled,
      items: cur.items,
      unread: cur.unread,
      status: enabled ? cur.status : 'idle',
      reload: load,
      markRead: doMark,
      markAllRead: () => doMark('all'),
    }),
    [enabled, cur.items, cur.unread, cur.status, load, doMark],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/** The notifications state (an idle, empty one outside the provider). */
export function useNotifications() {
  return useContext(NotificationsContext) || IDLE;
}
