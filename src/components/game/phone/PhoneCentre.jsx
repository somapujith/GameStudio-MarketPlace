// The calm middle of the board on a portrait phone (Board's `center`): one status caption at the top ("You bought",
// "Sana is playing…"), a small chip for the tile in play, ONE hero illustration (the animation session's scene) and the
// die resting on the bottom edge of it. No log, no tabs, no ribbons: the full log is behind the "..." menu.
import { useEffect, useRef, useState } from 'react';
import { PieceToken } from '../Pawn.jsx';
import Dice from '../Dice.jsx';
import SceneStage from '../SceneStage.jsx';
import { useSettings } from '@/lib/storage.js';
import { activePlayer } from '../ui/helpers.js';
import { cosmeticsOf } from '../turn/room.js';
import { captionFor, chipFor, splitCaption } from './phoneModel.js';

/** How long an event caption ("You bought") stays before the status line comes back. */
export const CAPTION_MS = 3200;

/** The caption to show: an event caption for CAPTION_MS after a new bubble, then the status line. */
export function useCaption(session, spec) {
  const [settings] = useSettings();
  const speed = Number(settings?.playbackSpeed) > 0 ? Number(settings.playbackSpeed) : 1;
  const id = session?.bubble?.id ?? null;
  const seen = useRef(id); // the bubble that was up when the table mounted is not replayed
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (id == null || id === seen.current) return undefined;
    seen.current = id;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), CAPTION_MS / Math.max(0.75, speed));
    return () => clearTimeout(t);
  }, [id, speed]);
  return captionFor(session, spec, { fresh });
}

/** One caption line: a big headline over a small detail line. Screen readers get the whole sentence once (the two halves are hidden). */
function Line({ caption, className, ...rest }) {
  const { head, detail, text } = splitCaption(caption.text);
  return (
    <p className={className} data-detail={detail ? '' : undefined} {...rest}>
      <span className="cp-sr">{text}</span>
      <span className="pc-cap__h" aria-hidden="true">{head}</span>
      {detail ? <span className="pc-cap__d" aria-hidden="true">{detail}</span> : null}
    </p>
  );
}

/** The caption, cross-fading when its words change (the old line fades out while the new one fades in). */
function Caption({ caption }) {
  const [prev, setPrev] = useState(null);
  const last = useRef(caption);
  useEffect(() => {
    if (last.current.key === caption.key) return undefined;
    setPrev(last.current);
    last.current = caption;
    const t = setTimeout(() => setPrev(null), 260);
    return () => clearTimeout(t);
  }, [caption]);
  return (
    <div className="pc-cap" role="status" aria-live="polite" aria-atomic="true">
      {prev ? <Line key={`o${prev.key}`} caption={prev} className={`pc-cap__l is-out is-${prev.tone}`} aria-hidden="true" /> : null}
      <Line key={caption.key} caption={caption} className={`pc-cap__l is-in is-${caption.tone}`} />
    </div>
  );
}

function Chip({ chip, onClick }) {
  return (
    <button
      type="button"
      className={`pc-chip${chip.owner ? ' is-owned' : ''}`}
      style={{ '--tc': chip.color, '--tink': chip.ink, '--oc': chip.owner?.color }}
      onClick={() => onClick?.(chip)}
      aria-label={`${chip.name}${chip.amountLabel ? `, ${chip.amountLabel}` : ''}${chip.owner ? `, owned by ${chip.owner.name}` : ''}. Open details`}
    >
      {chip.owner ? (
        <span className="pc-chip__who" aria-hidden="true"><PieceToken piece={chip.owner.piece} color={chip.owner.color} size={28} /></span>
      ) : null}
      <span className="pc-chip__tile">
        {chip.amountText ? <em>{chip.amountText}</em> : null}
        <b>{chip.short}</b>
      </span>
    </button>
  );
}

export default function PhoneCentre({ session, spec, onChip }) {
  const caption = useCaption(session, spec);
  const chip = chipFor(session, caption.tile);
  const player = activePlayer(session);
  const diceSkin = player ? cosmeticsOf(session, player.id).dice : undefined;
  return (
    <section className="pc" aria-label="Game status" style={{ '--tpc': player?.color || '#55d6c2' }}>
      <Caption caption={caption} />
      <div className="pc-chipslot">
        {chip ? <Chip key={`${chip.id}:${caption.key}`} chip={chip} onClick={onChip} /> : null}
      </div>
      <div className="pc-hero"><SceneStage session={session} /></div>
      <div className="pc-die"><Dice session={session} skin={diceSkin} /></div>
    </section>
  );
}
