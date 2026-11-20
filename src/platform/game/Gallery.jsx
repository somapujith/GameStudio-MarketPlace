// Swipeable, keyboard-navigable gallery built from the game's own art (cover, a close-up crop of it, the icon).
// Native scroll-snap does the swiping; the buttons, dots and arrow keys scroll the same track, so every input
// lands in one place. Motion is transform/opacity only and drops to a fade under reduced motion.
import { useCallback, useEffect, useRef, useState } from 'react';
import HubIcon from './HubIcon.jsx';
import { Cover } from './GameHero.jsx';
import { galleryItems } from './detailModel.js';

function Slide({ game, item }) {
  if (item.kind === 'board') {
    const Icon = game?.art?.icon;
    return (
      <div className="gd-shot gd-shot--icon">
        {Icon ? <Icon size={160} /> : <span className="gd-shot__ph">{String(game?.name || '?').slice(0, 1)}</span>}
      </div>
    );
  }
  if (item.kind === 'scene') {
    return (
      <div className="gd-shot gd-shot--zoom" style={{ '--gd-origin': item.origin }}>
        <Cover game={game} />
      </div>
    );
  }
  return (
    <div className="gd-shot">
      <Cover game={game} />
    </div>
  );
}

export default function Gallery({ game }) {
  const items = galleryItems(game);
  const track = useRef(null);
  const [index, setIndex] = useState(0);
  const count = items.length;

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const slides = el.children;
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) {
      setIndex(slides.length - 1);
      return;
    }
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < slides.length; i += 1) {
      const d = Math.abs(slides[i].offsetLeft - el.scrollLeft);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setIndex(best);
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return undefined;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, [update, count]);

  const go = useCallback(
    (i) => {
      const el = track.current;
      if (!el || !count) return;
      const next = Math.max(0, Math.min(count - 1, i));
      const slide = el.children[next];
      if (!slide) return;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: slide.offsetLeft, behavior: reduce ? 'auto' : 'smooth' });
      setIndex(next);
    },
    [count],
  );

  const onKey = (e) => {
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(count - 1);
    else return;
    e.preventDefault();
  };

  if (!count) return null;
  const cur = items[index] || items[0];

  return (
    <div className="gd-gallery" role="group" aria-roledescription="carousel" aria-label={`${game.name} gallery`}>
      <div className="gd-gallery__stage">
        <div ref={track} className="gd-gallery__track" tabIndex={0} onKeyDown={onKey} aria-label="Gallery slides. Use the left and right arrow keys to move between them.">
          {items.map((item, i) => (
            <figure key={i} className={`gd-gallery__slide${i === index ? ' is-on' : ''}`} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`}>
              <Slide game={game} item={item} />
            </figure>
          ))}
        </div>
        {count > 1 && (
          <>
            <button type="button" className="gd-gallery__nav gd-gallery__nav--prev" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous image">
              <HubIcon name="chevL" size={20} />
            </button>
            <button type="button" className="gd-gallery__nav gd-gallery__nav--next" onClick={() => go(index + 1)} disabled={index === count - 1} aria-label="Next image">
              <HubIcon name="chevR" size={20} />
            </button>
          </>
        )}
      </div>
      <div className="gd-gallery__foot">
        <p className="gd-gallery__cap" key={index} aria-live="polite">
          {cur.caption || `${game.name}, image ${index + 1}`}
        </p>
        {count > 1 && (
          <div className="gd-dots" role="group" aria-label="Choose an image">
            {items.map((_, i) => (
              <button key={i} type="button" className="gd-dot" aria-label={`Image ${i + 1} of ${count}`} aria-current={i === index ? 'true' : undefined} onClick={() => go(i)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
