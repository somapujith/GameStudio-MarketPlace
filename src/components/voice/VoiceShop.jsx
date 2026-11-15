// Shop pieces for voice lines: the gold-ringed medallion that is the card art, and the preview player.
// Preview is for lines you OWN only; a locked card shows the lock and the price instead.
import { useCallback, useEffect, useState } from 'react';
import { loadSettings } from '@/lib/storage.js';
import { getVoicePlayer } from './voicePlayer.js';
import VoiceIcon from './VoiceIcon.jsx';
import '@/styles/voice.css';

export function VoiceArt({ item, size = 76, locked = false, playing = false }) {
  const icon = Math.round(size * 0.62);
  return (
    <span className={`vl-medal${locked ? ' is-locked' : ''}${playing ? ' is-playing' : ''}`} style={{ width: size, height: size }} data-voice-art={item.id}>
      <VoiceIcon item={item} size={icon} locked={locked} />
      {locked ? (
        <span className="vl-medal__lock" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 10.5h11v9h-11zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
        </span>
      ) : null}
    </span>
  );
}

/** `{ playingId, toggle(item) }`: one preview at a time; pressing the playing line stops it. */
export function useVoicePreview() {
  const [playingId, setPlayingId] = useState(null);
  useEffect(() => {
    const p = getVoicePlayer(loadSettings);
    const sync = () => setPlayingId(p.activeIds()[0] || null);
    const off = p.subscribe(sync);
    return () => {
      off();
      p.stopAll();
    };
  }, []);
  const toggle = useCallback((item) => {
    const p = getVoicePlayer(loadSettings);
    if (p.isPlaying(item.id)) {
      p.stop(item.id);
      return 'stopped';
    }
    p.stopAll();
    return p.play(item, { force: true });
  }, []);
  return { playingId, toggle };
}
