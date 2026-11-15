import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/art/index.js';
import { dismissInvite, getInvites } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { dropInvite, inviteExpiryLabel, mergeInvites, normalizeInvite, relativeTime, withLeaving } from './friendsModel.js';
import '@/styles/online.css';
import '@/styles/x-social.css';
import '@/styles/store-social.css';

// Floating notices for realtime user-socket events (game invites with Join / Dismiss, a heads-up for friend
// requests / accepted requests) PLUS the invites inbox store: invites stored by the server while you were away
// (GET /api/invites) merged with the realtime ones. Rendered through a portal by <AuthProvider>, which sits
// OUTSIDE the router, so navigation works with or without a router context.

const TTL = { invite: 45000, friend_request: 9000, friend_accepted: 7000 };
const REFRESH_GAP_MS = 15000;
const LEAVE_MS = 220;

/** Router-less navigation: React Router's BrowserRouter listens to popstate. */
function navigateWithoutRouter(to) {
  try {
    window.history.pushState({}, '', to);
    const Ev = window.PopStateEvent || window.Event;
    window.dispatchEvent(new Ev('popstate', { state: window.history.state }));
  } catch {
    window.location.assign(to);
  }
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return true;
  try {
    if (document.documentElement.dataset.motion === 'reduced') return true;
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- invites store (module singleton)

const EMPTY = Object.freeze({ invites: [], status: 'idle', error: '' });
const store = {
  uid: null,
  snap: EMPTY,
  live: [], // realtime invites (no id yet)
  stored: [], // last GET /api/invites
  dismissed: new Map(), // key -> dismissedAt (hides a matching stored copy that arrives later)
  listeners: new Set(),
  inflight: null,
  lastFetch: 0,
};

function emit(patch) {
  const invites = mergeInvites(store.stored, store.live, Date.now()).filter((i) => {
    const at = store.dismissed.get(i.key);
    return at == null || i.createdAt > at;
  });
  store.snap = { ...store.snap, ...patch, invites };
  store.listeners.forEach((fn) => fn());
}

/** Point the store at a user (null = signed out / guest): clears it and loads that user's invites. */
export function setInvitesUser(uid) {
  const id = uid == null ? null : String(uid);
  if (id === store.uid) return;
  store.uid = id;
  store.live = [];
  store.stored = [];
  store.dismissed = new Map();
  store.lastFetch = 0;
  store.snap = EMPTY;
  emit({ status: id ? 'loading' : 'idle', error: '' });
  if (id) refreshInvites({ force: true });
}

/**
 * Reload stored invites. Never throws. A missing endpoint (older server) simply means "no stored invites";
 * offline keeps what we have and says so.
 */
export function refreshInvites({ force = false } = {}) {
  if (!store.uid) return Promise.resolve();
  if (store.inflight) return store.inflight;
  if (!force && Date.now() - store.lastFetch < REFRESH_GAP_MS) return Promise.resolve();
  const uid = store.uid;
  store.lastFetch = Date.now();
  store.inflight = (async () => {
    try {
      const res = await getInvites();
      if (uid !== store.uid) return;
      const rows = res && Array.isArray(res.invites) ? res.invites : [];
      store.stored = rows.map((r) => normalizeInvite(r)).filter((i) => i && i.id);
      // something we dismissed while it had no id yet: tell the server now
      for (const inv of store.stored) {
        const at = store.dismissed.get(inv.key);
        if (at != null && inv.createdAt <= at) dismissInvite(inv.id).catch(() => {});
      }
      emit({ status: 'ready', error: '' });
    } catch (e) {
      if (uid !== store.uid) return;
      if (e && e.status === 404) emit({ status: 'ready', error: '' });
      else if (e && e.status === 401) emit({ status: 'ready', error: '' });
      else emit({ status: e && e.status === 0 ? 'offline' : 'error', error: e && e.status === 0 ? '' : 'Could not load your invites' });
    } finally {
      store.inflight = null;
    }
  })();
  return store.inflight;
}

/** A realtime `{t:'invite', from, code, gameId, gameName}` message. */
export function addLiveInvite(msg) {
  if (!store.uid) return;
  const inv = normalizeInvite({ ...msg, id: undefined, createdAt: Date.now() });
  if (!inv) return;
  store.dismissed.delete(inv.key);
  store.live = [inv, ...dropInvite(store.live, inv.key)];
  emit({});
}

/** Dismiss (or, with `{ joined: true }`, consume after Join): gone locally at once, and on the server. */
export function dismissInviteEntry(inv) {
  if (!inv || !inv.key) return;
  const match = store.snap.invites.find((i) => i.key === inv.key);
  const id = inv.id || (match && match.id);
  store.dismissed.set(inv.key, Math.max(inv.createdAt || 0, match ? match.createdAt : 0, Date.now()));
  store.live = dropInvite(store.live, inv.key);
  store.stored = dropInvite(store.stored, inv.key);
  emit({});
  if (id) dismissInvite(id).catch(() => {});
}

const subscribeStore = (fn) => {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
};
const getSnap = () => store.snap;

/** Plain (non-React) subscription: `fn(snapshot)` after every change. Returns the unsubscribe. */
export function subscribeInvites(fn) {
  return subscribeStore(() => fn(store.snap));
}
export const getInvitesSnapshot = getSnap;
const getServerSnap = () => EMPTY;

/** `{ invites, status: 'idle'|'loading'|'ready'|'offline'|'error', error, refresh, dismiss }`. */
export function useInvites() {
  const snap = useSyncExternalStore(subscribeStore, getSnap, getServerSnap);
  return { ...snap, refresh: refreshInvites, dismiss: dismissInviteEntry };
}

/** Re-render every `ms` so relative times ("4 min ago") stay true. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Enter/exit for lists: returns [{ key, item, leaving }]. Removed items stay `leaving` for `ms` so CSS can animate
 * them out; under reduced motion they go at once.
 */
export function usePresence(items, keyOf, ms = LEAVE_MS) {
  const prev = useRef(null);
  const [gone, setGone] = useState(() => new Map());
  const timers = useRef(new Set());
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;

  useEffect(() => {
    const set = timers.current;
    return () => set.forEach((t) => clearTimeout(t));
  }, []);

  useIsoLayoutEffect(() => {
    const k = keyRef.current;
    const now = new Map((items || []).map((it, i) => [k(it), { item: it, index: i }]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const removed = [...before.entries()].filter(([key]) => !now.has(key));
    const back = [...now.keys()].filter((key) => gone.has(key));
    if (back.length) setGone((g) => new Map([...g].filter(([key]) => !now.has(key))));
    if (!removed.length || !ms || prefersReducedMotion()) return;
    setGone((g) => {
      const n = new Map(g);
      removed.forEach(([key, v]) => n.set(key, v));
      return n;
    });
    const t = setTimeout(() => {
      timers.current.delete(t);
      setGone((g) => {
        const n = new Map(g);
        removed.forEach(([key]) => n.delete(key));
        return n;
      });
    }, ms);
    timers.current.add(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ms]);

  return withLeaving(items, gone, keyOf);
}

// ---------------------------------------------------------------- notices

/** The words and destination of a notice (pure, unit-tested). */
export function noticeContent({ kind, from, code, gameName }) {
  const name = from?.name || 'A friend';
  let title;
  let body;
  let actionLabel;
  let target;
  if (kind === 'invite') {
    // `gameName` comes from the server's invite push ({t:'invite', from, code, gameId, gameName})
    title = gameName ? `${name} invited you to play ${gameName}` : `${name} invited you to play`;
    body = code ? `Room ${code}` : 'Tap Join to jump in';
    actionLabel = 'Join';
    // the join page checks the room (full? started?) and then opens the lobby
    target = code ? paths.join(code) : null;
  } else if (kind === 'friend_request') {
    title = `${name} sent you a friend request`;
    body = 'Open Friends to accept';
    actionLabel = 'View';
    target = paths.friends();
  } else {
    title = `${name} accepted your friend request`;
    body = 'You are friends now';
    actionLabel = 'Friends';
    target = paths.friends();
  }
  return { title, body, actionLabel, target };
}

/** What the compact "invites waiting" banner says for `invites` (pure). */
export function pendingSummary(invites, now = Date.now()) {
  const list = Array.isArray(invites) ? invites : [];
  if (!list.length) return null;
  const top = list[0];
  if (list.length === 1) {
    const game = top.gameName ? ` to ${top.gameName}` : '';
    return {
      count: 1,
      title: `${top.from.name} invited you${game}`,
      body: [relativeTime(top.createdAt, now), top.code ? `Room ${top.code}` : ''].filter(Boolean).join(' · '),
      actionLabel: 'Join',
      target: top.code ? paths.join(top.code) : paths.friends(),
      expiry: inviteExpiryLabel(top.createdAt, now),
    };
  }
  return {
    count: list.length,
    title: `${list.length} game invites waiting`,
    body: `Latest: ${top.from.name}${top.gameName ? ` · ${top.gameName}` : ''} · ${relativeTime(top.createdAt, now)}`,
    actionLabel: 'View',
    target: `${paths.friends()}#invites`,
  };
}

/** Where the compact banner must not appear (a running game, the inbox itself, a lobby / join screen). */
export function quietPath(path) {
  const p = String(path || '');
  return p.startsWith('/play/') || p.startsWith('/game/') || p.startsWith(paths.friends()) || p.startsWith('/lobby/') || p.startsWith('/join');
}

function Notice({ item, leaving, onDismiss, go }) {
  const { key, kind, from } = item;
  useEffect(() => {
    const t = setTimeout(() => onDismiss(key), TTL[kind] || 8000);
    return () => clearTimeout(t);
  }, [key, kind, onDismiss]);

  const { title, body, actionLabel, target } = noticeContent(item);
  const isInvite = kind === 'invite';

  const dismissThis = () => {
    if (isInvite) dismissInviteEntry(normalizeInvite(item));
    onDismiss(key);
  };

  return (
    <div
      className={`sc-toast sc-toast--${kind}${leaving ? ' is-leaving' : ''}`}
      role={isInvite ? 'alert' : 'status'}
      aria-hidden={leaving || undefined}
      style={{ '--ttl': `${TTL[kind] || 8000}ms` }}
    >
      <span className="sc-toast__ava">
        <Avatar preset={Number.isInteger(from?.avatar) ? from.avatar : 0} size={46} />
      </span>
      <div className="sc-toast__text">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      <div className="sc-toast__actions">
        {target && (
          <button
            type="button"
            className="hub-btn hub-btn--primary hub-btn--sm"
            disabled={leaving}
            onClick={() => {
              dismissThis();
              go(target);
            }}
          >
            {actionLabel}
          </button>
        )}
        {isInvite ? (
          <button type="button" className="hub-btn hub-btn--ghost hub-btn--sm" disabled={leaving} onClick={dismissThis} aria-label={`Dismiss: ${title}`}>
            Dismiss
          </button>
        ) : (
          <button type="button" className="sc-toast__x" disabled={leaving} onClick={dismissThis} aria-label={`Dismiss: ${title}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        )}
      </div>
      <span className="sc-toast__timer" aria-hidden="true" />
    </div>
  );
}

/** Track the URL from outside the router (pushState does not fire events, so poll gently while needed). */
function usePathname(active) {
  const [path, setPath] = useState(() => (typeof window === 'undefined' ? '/' : window.location.pathname));
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    const read = () => setPath(window.location.pathname);
    read();
    const t = setInterval(read, 800);
    window.addEventListener('popstate', read);
    return () => {
      clearInterval(t);
      window.removeEventListener('popstate', read);
    };
  }, [active]);
  return path;
}

function PendingBanner({ invites, go }) {
  const now = useNow(30000);
  const [hiddenFor, setHiddenFor] = useState('');
  const sig = invites.map((i) => i.key).join('|');
  const path = usePathname(invites.length > 0);
  const show = invites.length > 0 && hiddenFor !== sig && !quietPath(path);
  const s = show ? pendingSummary(invites, now) : null;
  if (!s) return null;
  const top = invites[0];
  return (
    <div className="sc-toast sc-toast--pending" role="status">
      <span className="sc-toast__avas" aria-hidden="true">
        {invites.slice(0, 3).map((i) => (
          <Avatar key={i.key} preset={i.from.avatar} size={38} />
        ))}
      </span>
      <div className="sc-toast__text">
        <strong>{s.title}</strong>
        <span>
          {s.body}
          {s.expiry ? ` · ${s.expiry}` : ''}
        </span>
      </div>
      <div className="sc-toast__actions">
        <button
          type="button"
          className="hub-btn hub-btn--primary hub-btn--sm"
          onClick={() => {
            if (s.count === 1) dismissInviteEntry(top);
            go(s.target);
          }}
        >
          {s.actionLabel}
        </button>
        {s.count === 1 ? (
          <button type="button" className="hub-btn hub-btn--ghost hub-btn--sm" onClick={() => dismissInviteEntry(top)} aria-label={`Dismiss invite from ${top.from.name}`}>
            Dismiss
          </button>
        ) : (
          <button type="button" className="sc-toast__x" onClick={() => setHiddenFor(sig)} aria-label="Hide for now" title="Hide for now">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/** Keeps the invites store in sync with the signed-in user, the socket and the network. Renders nothing. */
function InviteSync() {
  const { user, subscribe, userSocketStatus } = useAuth();
  const uid = user && !user.isGuest ? user.id : null;
  const lastStatus = useRef(userSocketStatus);

  useEffect(() => {
    setInvitesUser(uid);
  }, [uid]);

  useEffect(() => (uid ? subscribe(['invite'], (msg) => addLiveInvite(msg)) : undefined), [uid, subscribe]);

  // (re)connected after being away: invites may have been stored meanwhile
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = userSocketStatus;
    if (uid && userSocketStatus === 'open' && was !== 'open') refreshInvites({ force: was === 'reconnecting' });
  }, [uid, userSocketStatus]);

  useEffect(() => {
    if (!uid || typeof window === 'undefined') return undefined;
    const onBack = () => refreshInvites();
    window.addEventListener('focus', onBack);
    window.addEventListener('online', onBack);
    return () => {
      window.removeEventListener('focus', onBack);
      window.removeEventListener('online', onBack);
    };
  }, [uid]);
  return null;
}

// In-flow slot: the hub shell renders <NoticeSlot /> at the top of its content column, and notices portal into
// it there (pushing the page down, never covering a header or its buttons). Without a slot (sign-in, 404, ...)
// they fall back to a fixed stack below the top bar.
let noticeSlot = null;
const slotSubs = new Set();
function setNoticeSlot(el) {
  if (noticeSlot === el) return;
  noticeSlot = el;
  slotSubs.forEach((fn) => fn());
}
const subscribeSlot = (fn) => {
  slotSubs.add(fn);
  return () => slotSubs.delete(fn);
};
const readSlot = () => noticeSlot;
const readSlotServer = () => null;

/** Where the hub's notices render in flow (AppShell puts it above the routed page). */
export function NoticeSlot() {
  const ref = useRef(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    setNoticeSlot(el);
    return () => {
      if (noticeSlot === el) setNoticeSlot(null);
    };
  }, []);
  return <div ref={ref} className="hub-noticeslot" />;
}

function BannerView({ items, onDismiss, go }) {
  const slot = useSyncExternalStore(subscribeSlot, readSlot, readSlotServer);
  const { invites } = useInvites();
  const list = items || [];
  const shown = usePresence(list, (n) => n.key);
  // invites already on screen as a realtime notice are not repeated in the compact banner
  const noticed = new Set(list.filter((n) => n.kind === 'invite').map((n) => `${n.code ?? ''}:${n.from?.id ?? ''}`));
  const pending = invites.filter((i) => !noticed.has(i.key));
  if (typeof document === 'undefined' || (shown.length === 0 && pending.length === 0)) return null;
  return createPortal(
    <div className={`ho-notices xs-notices sc-toasts${slot ? ' is-inline' : ''}`} aria-label="Notifications" aria-live="polite">
      {shown.map(({ key, item, leaving }) => (
        <Notice key={key} item={item} leaving={leaving} onDismiss={onDismiss} go={go} />
      ))}
      <PendingBanner invites={pending} go={go} />
    </div>,
    slot || document.body,
  );
}

function WithRouter(props) {
  const navigate = useNavigate();
  const go = useCallback((to) => navigate(to), [navigate]);
  return <BannerView {...props} go={go} />;
}

function WithoutRouter(props) {
  return <BannerView {...props} go={navigateWithoutRouter} />;
}

/** `items`: [{ key, kind: 'invite'|'friend_request'|'friend_accepted', from:{id,name,avatar}, code? }] */
export function InviteBanner({ items, onDismiss }) {
  const inRouter = useInRouterContext();
  const Comp = inRouter ? WithRouter : WithoutRouter;
  return (
    <>
      <InviteSync />
      <Comp items={items} onDismiss={onDismiss} />
    </>
  );
}

export default InviteBanner;
