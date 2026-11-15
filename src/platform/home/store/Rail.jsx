import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useReducedMotion } from '@/components/shell/hooks.js';

/**
 * A store shelf: `.st-head` (eyebrow, title, sub, optional live chip, "see all" link, prev/next buttons on desktop)
 * over a snap rail (`.st-rail`) with a visible peek of the next card. The rail is a focusable region: Left/Right
 * (and Home/End) scroll it when it has focus; the buttons do the same with a pointer.
 *
 * `children` are the rail items (wrap each in `<li>`). `solo` stretches a single item (a rail of one).
 * `rail={false}` renders the head only plus `children` as-is (for non-scrolling bodies like tiles).
 */
export default function Rail({ eyebrow, title, sub, badge, moreTo, moreLabel = 'See all', count = 0, solo = false, label, className = '', children, bare = false, headExtra }) {
  const id = useId();
  const rail = useRef(null);
  const reduced = useReducedMotion();
  const [edge, setEdge] = useState({ over: false, start: true, end: true });

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const next = {
      over: el.scrollWidth - el.clientWidth > 6,
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    };
    setEdge((cur) => (cur.over === next.over && cur.start === next.start && cur.end === next.end ? cur : next));
  }, []);

  useEffect(() => {
    if (bare) return undefined;
    measure();
    const el = rail.current;
    if (!el) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } else {
      window.addEventListener('resize', measure);
    }
    return () => {
      el.removeEventListener('scroll', measure);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [measure, count, bare]);

  const by = (dir) => {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: reduced ? 'auto' : 'smooth' });
  };

  const onKey = (e) => {
    if (e.target !== e.currentTarget) return; // only when the rail itself has focus (links keep their own keys)
    const el = rail.current;
    if (!el) return;
    if (e.key === 'ArrowRight') by(1);
    else if (e.key === 'ArrowLeft') by(-1);
    else if (e.key === 'Home') el.scrollTo({ left: 0, behavior: reduced ? 'auto' : 'smooth' });
    else if (e.key === 'End') el.scrollTo({ left: el.scrollWidth, behavior: reduced ? 'auto' : 'smooth' });
    else return;
    e.preventDefault();
  };

  return (
    <section className={`sh-shelf ${className}`.trim()} aria-labelledby={id}>
      <header className="st-head sh-head">
        <div className="sh-head__text">
          <div className="sh-kicker">
            {eyebrow && <span className="st-eyebrow">{eyebrow}</span>}
            {badge}
          </div>
          <h2 id={id} className="st-head__title">
            {title}
          </h2>
        </div>
        <div className="sh-head__end">
          {headExtra}
          {!bare && (
            <div className="sh-arrows" data-over={edge.over ? 'true' : 'false'}>
              <button type="button" className="sh-arrow" onClick={() => by(-1)} disabled={edge.start} aria-label={`Scroll ${label || title} left`}>
                <HubIcon name="chevL" size={18} />
              </button>
              <button type="button" className="sh-arrow" onClick={() => by(1)} disabled={edge.end} aria-label={`Scroll ${label || title} right`}>
                <HubIcon name="chevR" size={18} />
              </button>
            </div>
          )}
          {moreTo && (
            <Link to={moreTo} className="st-link sh-more">
              {moreLabel} <HubIcon name="arrowR" size={14} strokeWidth={2.6} />
            </Link>
          )}
        </div>
      </header>
      {sub && <p className="st-head__sub sh-sub">{sub}</p>}
      {bare ? (
        children
      ) : (
        <ul
          className="st-rail sh-rail"
          ref={rail}
          data-solo={solo ? 'true' : 'false'}
          data-over={edge.over ? 'true' : 'false'}
          data-start={edge.start ? 'true' : 'false'}
          data-end={edge.end ? 'true' : 'false'}
          tabIndex={edge.over ? 0 : undefined}
          aria-label={label || (typeof title === 'string' ? title : undefined)}
          onKeyDown={onKey}
        >
          {children}
        </ul>
      )}
    </section>
  );
}
