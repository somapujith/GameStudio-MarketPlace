// Share a game page: the system share sheet when there is one, otherwise copy the link and say so. The same behaviour as
// ActionPanel's ShareButton, as a hook so the cine round icon buttons (home hero, game page) can use it.
import { useCallback } from 'react';
import { useToast } from '@/components/shell/Toast.jsx';
import { paths } from '@/platform/paths.js';
import { shareData } from './detailModel.js';

export default function useShareGame(game) {
  const toast = useToast();
  return useCallback(async () => {
    if (!game) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}${paths.game(game.id)}`;
    const data = shareData(game, url);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (typeof navigator.canShare !== 'function' || navigator.canShare(data))) {
        await navigator.share(data);
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // the player closed the share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Send it to your friends.', { tone: 'success' });
    } catch {
      toast(`Copy this link: ${url}`, { duration: 7000 });
    }
  }, [game, toast]);
}
