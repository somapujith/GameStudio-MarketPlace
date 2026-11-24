// The cine row: a `.cj-section` with its heading (optionally a link with a chevron, like "Trending Movies >") over a
// `.cj-row` sideways scroller. On a pointer device, round glass arrows fade in at the ends while there is more to see;
// the row also takes Left / Right / Home / End when it has focus. Used by Home and the game page.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useReducedMotion } from '@/components/shell/hooks.js';
import '@/styles/cine/browse.css'; // .cj-rowwrap / .cj-rowarrow (shared cine primitives)

/** Section + head. `to` turns the title into a link. `extra` sits after the title (a count, a picker, a link). */
export function CineSection({ id, title, to, extra, className = '', headClass = '', children, labelledBy, ...rest }) {
  const auto = useId();
  const hid = labelledBy || `${id || auto}-h`;
  return (
    <section id={id} className={`cj-section ${className}`.trim()} aria-labelledby={hid} {...rest}>
      <div className={`cj-section__head sh-head ${headClass}`.trim()}>
        <h2 id={hid} className="cj-section__title" tabIndex={-1}>
          {to ? (
            <Link to={to} className="cj-section__title">
              {title}
              <HubIcon name="chevR" size={16} className="cj-chev" />
            </Link>
          ) : (
            title
          )}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** `<ul class="cj-row">` with hover arrows and keyboard scrolling. Children are the `<li>` items. */
export function CineRow({ label, className = '', children, count = 0, style }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [edge, setEdge] = useState({ over: false, start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = { over: el.scrollWidth - el.clientWidth > 6, start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 };
    setEdge((cur) => (cur.over === next.over && cur.start === next.start && cur.end === next.end ? cur : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } else window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, [measure, count]);

  const by = (dir) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: reduced ? 'auto' : 'smooth' });
  };
  const onKey = (e) => {
    if (e.target !== e.currentTarget) return; // links inside keep their own keys
    const el = ref.current;
    if (e.key === 'ArrowRight') by(1);
    else if (e.key === 'ArrowLeft') by(-1);
    else if (e.key === 'Home') el.scrollTo({ left: 0, behavior: reduced ? 'auto' : 'smooth' });
    else if (e.key === 'End') el.scrollTo({ left: el.scrollWidth, behavior: reduced ? 'auto' : 'smooth' });
    else return;
    e.preventDefault();
  };

  return (
    <div className="cj-rowwrap" data-over={edge.over ? 'true' : 'false'}>
      <ul ref={ref} className={`cj-row ${className}`.trim()} style={style} aria-label={label} tabIndex={edge.over ? 0 : undefined} onKeyDown={onKey}>
        {children}
      </ul>
      {edge.over && (
        <>
          <button type="button" className="cj-iconbtn cj-rowarrow cj-rowarrow--prev" onClick={() => by(-1)} disabled={edge.start} aria-label={`Scroll ${label} left`} tabIndex={-1}>
            <HubIcon name="chevL" size={18} />
          </button>
          <button type="button" className="cj-iconbtn cj-rowarrow cj-rowarrow--next" onClick={() => by(1)} disabled={edge.end} aria-label={`Scroll ${label} right`} tabIndex={-1}>
            <HubIcon name="chevR" size={18} />
          </button>
        </>
      )}
    </div>
  );
}
