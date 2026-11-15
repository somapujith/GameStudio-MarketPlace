// What the signed-in player may play: the voice lines their account owns (`GET /api/shop`, the same cached call as the shop),
// plus the shared cooldown as a hook. The server checks ownership again on every press; this only decides what to draw.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth.jsx';
import { getShop } from '@/lib/api.js';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import { ownedVoiceIds, voiceItem, voiceItems } from './voiceModel.js';
import { setPrimeList, voiceCooldown } from './voicePlayer.js';

/**
 * `{ state, signedIn, owned: Set<id>, items, reload }`
 * state: 'signed-out' | 'loading' | 'offline' | 'owned' (has at least one line) | 'locked' (owns none)
 */
export function useVoiceAccess({ enabled = true } = {}) {
  const auth = useAuth() || {};
  const signedIn = !!auth.user;
  const { ready } = useApiGate();
  const res = useApi('/api/shop', { enabled: enabled && ready && signedIn, fetcher: getShop });
  const owned = useMemo(() => new Set(ownedVoiceIds(res.data?.items)), [res.data]);
  let state;
  if (!signedIn) state = 'signed-out';
  else if (res.status === 'ok') state = owned.size ? 'owned' : 'locked';
  else if (res.status === 'idle' || res.status === 'loading') state = 'loading';
  else state = 'offline';
  return { state, signedIn, owned, items: voiceItems(), reload: res.reload };
}

/** First gesture warms the audio elements of every line (iOS lets a script start a clip only on an element a gesture touched). */
export function usePrimeVoices() {
  useEffect(() => {
    setPrimeList(() => voiceItems().filter((i) => voiceItem(i.id)));
    return () => setPrimeList(null);
  }, []);
}

/** Milliseconds left on the shared cooldown, ticking while it runs (and `startedAt` so the ring can restart). */
export function useCooldown() {
  const [, bump] = useState(0);
  const [left, setLeft] = useState(() => voiceCooldown.left());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const l = voiceCooldown.left();
      setLeft(l);
      clearTimeout(timer);
      if (l > 0) timer = setTimeout(tick, Math.min(250, l));
    };
    tick();
    const off = voiceCooldown.subscribe(() => { bump((n) => n + 1); tick(); });
    return () => { off(); clearTimeout(timer); };
  }, []);
  return { left, ...voiceCooldown.state() };
}
