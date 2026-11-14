// Small one-shot effects that live on a tile. Each replays only when its trigger CHANGES after mount (see
// useBump), so a fresh snapshot or a reconnect never sets them off. Pure CSS animations from fx.css
// (transform / opacity only, a fixed number of iterations, collapsed under reduced motion).

import { memo } from 'react';
import { useBump } from './useBump.js';
import '@/styles/fx.css';

/**
 * Squash-and-stretch pop around a building when the level goes UP (a sale shrinks quietly).
 * <BuildPop level={2}><BuildingArt … /></BuildPop>
 */
export const BuildPop = memo(function BuildPop({ level = 0, className = '', children }) {
  const n = useBump(level, (a, b) => b > a);
  return (
    <span className={`fx-build${n ? ' is-pop' : ''}${className ? ` ${className}` : ''}`} key={n}>
      {children}
      {n ? <i className="fx-build__dust" aria-hidden="true" /> : null}
    </span>
  );
});

/**
 * The owner band in the owner's colour on the tile's outer edge. A NEW owner gets the purchase stamp: the band
 * sweeps in along the edge.
 */
export const OwnerStamp = memo(function OwnerStamp({ color, owner = '', side = 'bottom' }) {
  const n = useBump(owner, (a, b) => !!b && a !== b);
  if (!color) return null;
  return <i className={`hb-tile__own fx-own--${side}${n ? ' fx-stamp' : ''}`} key={n} aria-hidden="true" />;
});

/** A round chip with the owner's piece; it lands with a thud when the owner changes. */
export const OwnerChip = memo(function OwnerChip({ owner = '', children }) {
  const n = useBump(owner, (a, b) => !!b && a !== b);
  if (!owner) return null;
  return (
    <span className={`hb-tile__chip${n ? ' fx-stamp-chip' : ''}`} key={n} aria-hidden="true">
      {children}
    </span>
  );
});

/** Three wisps of steam rise once from the chai glass every time `count` goes up. */
export const ChaiSteam = memo(function ChaiSteam({ count = 0 }) {
  const n = useBump(count, (a, b) => b > a);
  if (!n) return null;
  return (
    <span className="fx-steam" key={n} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
});

/** A light sweep across a card tile while its card is being drawn. */
export const CardShimmer = memo(function CardShimmer({ active = false }) {
  return active ? <span className="fx-shimmer" aria-hidden="true" /> : null;
});
