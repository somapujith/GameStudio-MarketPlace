// Rows of the garage menu. Every row is a button-like element with role=option; the highlighted one carries the accent bar.
import { forwardRef } from 'react';
import { MAX_UPGRADE } from '../../gameplay/catalog.js';

const cls = (...a) => a.filter(Boolean).join(' ');

/** The right-hand label of a row: INSTALLED / OWNED / FREE / Rs 260 / MAX. */
export function Tag({ status }) {
  return <span className={`aw-ws-tag is-${status.tone}`}>{status.label}</span>;
}

/** A category or section entry (levels 0 and 1). */
export const NavRow = forwardRef(function NavRow({ label, te, hint, hl, onHover, onClick }, ref) {
  return (
    <div ref={ref} role="option" aria-selected={hl} tabIndex={-1} className={cls('aw-ws-row', 'is-nav', hl && 'is-hl')} onPointerEnter={onHover} onClick={onClick}>
      <span className="aw-ws-row-main">
        <span className="aw-ws-row-name">{label}</span>
        {te && <span className="aw-ws-row-te" lang="te">{te}</span>}
      </span>
      {hint && <span className="aw-ws-row-hint">{hint}</span>}
      <span className="aw-ws-chev" aria-hidden="true">&rsaquo;</span>
    </div>
  );
});

export const ItemRow = forwardRef(function ItemRow({ row, status, hl, onHover, onClick, onPlay, playing }, ref) {
  return (
    <div ref={ref} role="option" aria-selected={hl} tabIndex={-1} className={cls('aw-ws-row', hl && 'is-hl', status.tone === 'installed' && 'is-on')} onPointerEnter={onHover} onClick={onClick}>
      {row.hex && <span className="aw-ws-dot" style={{ background: row.hex }} aria-hidden="true" />}
      <span className="aw-ws-row-main">
        <span className="aw-ws-row-name" lang={/[ఀ-౿]/.test(row.name) ? 'te' : undefined}>{row.name}</span>
        {row.te && <span className="aw-ws-row-te" lang="te">{row.te}</span>}
      </span>
      {onPlay && (
        <button
          type="button"
          className={cls('aw-ws-play', playing && 'is-playing')}
          aria-label={`Play ${row.name}`}
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
        </button>
      )}
      <Tag status={status} />
    </div>
  );
});

export const GridCell = forwardRef(function GridCell({ row, status, hl, onHover, onClick }, ref) {
  return (
    <div ref={ref} role="option" aria-selected={hl} tabIndex={-1} className={cls('aw-ws-cell', hl && 'is-hl', status.tone === 'installed' && 'is-on')} onPointerEnter={onHover} onClick={onClick}>
      <span className="aw-ws-swatch" style={{ '--sw': row.hex || '#444' }}>
        {row.data?.pattern && <span className={`aw-ws-pattern is-${row.data.pattern}`} aria-hidden="true" />}
        {row.data?.cycle && <span className="aw-ws-pattern is-rainbow" aria-hidden="true" />}
        {row.hex === null && !row.data?.cycle && <span className="aw-ws-pattern is-none" aria-hidden="true" />}
        {status.tone === 'installed' && <span className="aw-ws-tick" aria-hidden="true">&#10003;</span>}
      </span>
      <span className="aw-ws-cell-name">{row.name}</span>
      <span className={`aw-ws-cell-price is-${status.tone}`}>{status.label}</span>
    </div>
  );
});

export const UpgradeRow = forwardRef(function UpgradeRow({ row, status, hl, onHover, onClick }, ref) {
  const lvl = status.level || 0;
  return (
    <div ref={ref} role="option" aria-selected={hl} tabIndex={-1} className={cls('aw-ws-row', 'is-up', hl && 'is-hl')} onPointerEnter={onHover} onClick={onClick}>
      <span className="aw-ws-row-main">
        <span className="aw-ws-row-name">{row.name}</span>
        <span className="aw-ws-row-te" lang="te">{row.te}</span>
        <span className="aw-ws-pips" role="img" aria-label={`Level ${lvl} of ${MAX_UPGRADE}`}>
          {Array.from({ length: MAX_UPGRADE }, (_, i) => <i key={i} className={i < lvl ? 'is-on' : ''} />)}
        </span>
      </span>
      <Tag status={status} />
    </div>
  );
});

export const InputRow = forwardRef(function InputRow({ row, status, hl, value, onChange, onSubmit, onHover, inputRef, invalid }, ref) {
  return (
    <div ref={ref} role="option" aria-selected={hl} tabIndex={-1} className={cls('aw-ws-row', 'is-input', hl && 'is-hl')} onPointerEnter={onHover}>
      <label className="aw-ws-input-wrap">
        <span className="aw-ws-row-name">{row.name}</span>
        <input
          ref={inputRef}
          className={cls('aw-ws-input', row.upper && 'is-upper', invalid && 'is-bad')}
          type="text"
          value={value}
          maxLength={row.max}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize={row.upper ? 'characters' : 'off'}
          enterKeyHint="done"
          aria-label={row.name}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        />
        <span className="aw-ws-row-hint">{row.hint}, up to {row.max}</span>
      </label>
      <button type="button" className="aw-ws-apply" onClick={onSubmit} disabled={invalid}>
        Apply
        <small>{status.label}</small>
      </button>
    </div>
  );
});
