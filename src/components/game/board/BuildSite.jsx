import { memo, useState } from 'react';
import { siteCaption, siteEvent } from './tipModel.js';

/**
 * The business standing on an owned plot. When its level changes the site plays one short story:
 *   up    (a level added, or a fresh purchase)  scaffold pops up, dust puffs, the building rises and settles, a "Level up" tag
 *   down  (a level sold back)                   the roof drops with a thud, rubble and a dust cloud, a "Sold back" tag
 * Nothing plays on first paint, a reconnect or a snapshot (it keys on a CHANGE after mount). Transform / opacity
 * only, one-shot, collapsed under reduced motion. `claim` goes up when the tile gets a new owner.
 *
 * <BuildSite level={1} claim={0} className="hb-tile__bldg"><BuildingArt … /></BuildSite>
 */
export const BuildSite = memo(function BuildSite({ level = 0, claim = 0, className = '', children, fresh = false }) {
  // render-phase tracking (no effect), so the animation starts in the same paint as the change
  const [seen, setSeen] = useState({ level, claim });
  const [ev, setEv] = useState(() => (fresh || claim > 0 ? { n: 1, kind: 'new' } : { n: 0, kind: null }));
  if (seen.level !== level || seen.claim !== claim) {
    const kind = seen.claim !== claim ? 'new' : siteEvent(seen.level, level);
    setSeen({ level, claim });
    if (kind) setEv({ n: ev.n + 1, kind });
  }
  const kind = ev.kind;
  const up = kind === 'up' || kind === 'new';
  return (
    <span className={`hb-site${className ? ` ${className}` : ''}`} data-site={kind || undefined} data-lv={level}>
      <span className={`hb-site__art${kind ? ` is-${up ? 'rise' : 'drop'}` : ''}`} key={`a${ev.n}`}>
        {children}
      </span>
      {kind ? (
        <span className={`hb-site__fx is-${up ? 'up' : 'down'}`} key={`f${ev.n}`} aria-hidden="true">
          {up ? (
            <svg className="hb-site__scaffold" viewBox="0 0 48 40" focusable="false" preserveAspectRatio="xMidYMax meet">
              <path d="M7 39V6M24 39V3M41 39V6" />
              <path d="M7 14H41M7 26H41M7 39L24 14L41 39M7 14L24 39L41 14" className="is-brace" />
              <path d="M4 6H44" className="is-top" />
            </svg>
          ) : null}
          <i className="hb-site__puff hb-site__puff--a" />
          <i className="hb-site__puff hb-site__puff--b" />
          <i className="hb-site__puff hb-site__puff--c" />
          {!up ? (
            <>
              <i className="hb-site__chip hb-site__chip--a" />
              <i className="hb-site__chip hb-site__chip--b" />
              <i className="hb-site__chip hb-site__chip--c" />
            </>
          ) : null}
          <b className={`hb-site__tag is-${up ? 'up' : 'down'}`}>{siteCaption(kind, level)}</b>
        </span>
      ) : null}
    </span>
  );
});

export default BuildSite;
