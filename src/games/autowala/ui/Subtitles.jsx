// OWNER: voice agent. The subtitle bar for spoken lines: listens to `voice:line` on the game's event bus and shows the Telugu
// line (Noto Sans Telugu), the English beneath it, and a persona chip. The Mega Hero gets a neon-gold, slightly bigger frame.
// Mount once: <Subtitles game={game} /> (it renders nothing while idle and never takes pointer events).
import { useEffect, useRef, useState } from 'react';
import { subtitleHold } from '../audio/voice-math.js';
import './subtitles.css';

export default function Subtitles({ game }) {
  const [line, setLine] = useState(null); // { key, ...voice:line payload, out: boolean }
  const timers = useRef([]);

  useEffect(() => {
    if (!game?.on) return undefined;
    let n = 0;
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    const off = game.on((e) => {
      if (e?.type !== 'voice:line' || !e.te) return;
      clear();
      const hold = subtitleHold(Number(e.ms) || 0, `${e.te}${e.en || ''}`);
      setLine({ ...e, key: ++n, out: false });
      timers.current.push(setTimeout(() => setLine((l) => (l && l.key === n ? { ...l, out: true } : l)), hold));
      timers.current.push(setTimeout(() => setLine((l) => (l && l.key === n ? null : l)), hold + 380));
    });
    return () => {
      off?.();
      clear();
    };
  }, [game]);

  if (!line) return null;
  return (
    <div className={`aw-sub${line.hero ? ' aw-sub--hero' : ''}${line.out ? ' aw-sub--out' : ''}`} style={{ '--aw-sub-c': line.color || '#fff' }} role="status" aria-live="polite" key={line.key}>
      <span className="aw-sub-chip">{line.hero ? `★ ${line.personaName}` : line.speaker || line.personaName}</span>
      <p className="aw-sub-te" lang="te">{line.te}</p>
      <p className="aw-sub-en">{line.en}</p>
    </div>
  );
}
