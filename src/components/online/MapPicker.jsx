import { useId, useMemo, useRef } from 'react';
import { mapChoices, mapIdOf, mapPatch, nextMapId } from './mapModel.js';
import '@fontsource-variable/noto-sans-telugu';
import '@/styles/mappicker.css';

/**
 * The mini board of a map: its tiles as a 10x10 ring, each cell in the colour of its collection (from the map's own
 * groups), START bottom-left, a lit centre. Cheap SVG, no images; decorative (the card's text says everything).
 */
export function MapRing({ cells, size = 100, accent, mark }) {
  const pad = 1.2;
  const span = size - pad * 2;
  const n = Math.max(3, Math.round(size / 10));
  const band = span * 0.2; // the ring is a chunky band (a fifth of the width) so each collection reads as a clear segment
  const edge = (span - 2 * band) / (n - 2); // the length of a cell along a side
  const seg = (k) => (k <= 0 ? [pad, band] : k >= n - 1 ? [pad + span - band, band] : [pad + band + (k - 1) * edge, edge]);
  const inner = pad + band + 1.4;
  const innerSpan = span - 2 * band - 2.8;
  const letter = typeof mark === 'string' ? mark.trim().charAt(0).toUpperCase() : '';
  return (
    <svg className="mp-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" style={accent ? { '--mp-accent': accent } : undefined}>
      <rect className="mp-ring__bed" x="0.5" y="0.5" width={size - 1} height={size - 1} rx="7" />
      <rect className="mp-ring__core" x={inner} y={inner} width={innerSpan} height={innerSpan} rx="4" />
      {letter && (
        <text className="mp-ring__mark" x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.36}>
          {letter}
        </text>
      )}
      {cells.map((c) => {
        const [x, w] = seg(c.col);
        const [y, h] = seg(c.row);
        return (
          <rect
            key={c.i}
            className={`mp-ring__cell is-${c.kind}${c.i === 0 ? ' is-start' : ''}`}
            x={x + 0.45}
            y={y + 0.45}
            width={Math.max(0.5, w - 0.9)}
            height={Math.max(0.5, h - 0.9)}
            rx="1.2"
            fill={c.color}
          />
        );
      })}
    </svg>
  );
}

/** A name in its own script: `lang="te"` and the Telugu font stack, so the right glyphs are used and read out. */
export function TeText({ text, className = '' }) {
  if (!text) return null;
  return (
    <span className={`mp-te ${className}`.trim()} lang="te">
      {text}
    </span>
  );
}

/** A map's card without a choice attached (the store's "maps" section): ring, names, tagline, blurb and sample places. */
export function MapCard({ id }) {
  const c = mapChoices().find((x) => x.id === id);
  return c ? <Card c={c} selected={false} interactive={false} /> : null;
}

function Card({ c, selected, interactive, disabled, onPick, tabIndex, refCb }) {
  const inner = (
    <>
      <MapRing cells={c.cells} size={c.size} accent={c.accent} mark={c.name} />
      <span className="mp-card__body">
        <span className="mp-card__head">
          <b className="mp-card__name">{c.name}</b>
          {c.te && <TeText text={c.te} className="mp-card__te" />}
        </span>
        <span className="mp-card__tag">{c.tagline}</span>
        {c.blurb && <span className="mp-card__blurb">{c.blurb}</span>}
        {c.places.length > 0 && (
          <span className="mp-card__places" aria-label="Sample places">
            {c.places.map((p) => (
              <span key={p} className="mp-place">
                {p}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="mp-card__mark" aria-hidden="true">
        {selected ? 'Selected' : ''}
      </span>
    </>
  );
  if (!interactive) {
    return (
      <div className={`mp-card is-readonly${selected ? ' is-on' : ''}`} style={{ '--mp-accent': c.accent }} data-map={c.id}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`mp-card${selected ? ' is-on' : ''}`}
      style={{ '--mp-accent': c.accent }}
      data-map={c.id}
      disabled={disabled}
      tabIndex={tabIndex}
      ref={refCb}
      onClick={() => onPick(c.id)}
    >
      {inner}
    </button>
  );
}

/**
 * The map choice of a table. Host: a radio group of one card per map (arrow keys / Home / End move, a tap picks, the
 * choice is sent through `onPick(patch)` with the settings patch `{ map }`). Everyone else: the chosen map, read-only.
 * Props: `value` (the map id, or any settings / cfg object), `isHost`, `disabled`, `onPick`.
 */
export default function MapPicker({ value, isHost, disabled = false, onPick, label = 'Map', helpText, compact = false }) {
  const id = mapIdOf(value);
  const choices = useMemo(() => mapChoices(), []);
  const labelId = useId();
  const refs = useRef({});

  if (!isHost) {
    const c = choices.find((x) => x.id === id) || choices[0];
    return (
      <div className="mp mp--ro" data-tour="lobby-map" data-map={c.id} role="group" aria-labelledby={labelId}>
        <div className="mp__head">
          <span id={labelId} className="ho-field__label mp__label">
            {label}
          </span>
          <span className="ho-muted">Chosen by the host</span>
        </div>
        <Card c={c} selected interactive={false} />
      </div>
    );
  }

  const pick = (to) => {
    const patch = mapPatch(id, to);
    if (patch && onPick) onPick(patch);
  };
  const onKey = (e) => {
    const to = nextMapId(id, e.key, choices.map((c) => c.id));
    if (!to) return;
    e.preventDefault();
    if (to !== id) pick(to);
    const el = refs.current[to];
    if (el) el.focus();
  };

  if (compact) {
    return (
      <div className="mp mp--compact" data-count={choices.length}>
        <span id={labelId} className="mp__label mp-compact__label">
          {label}
        </span>
        <div className="mp-compact__row" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKey}>
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === id}
              className={`mp-opt${c.id === id ? ' is-on' : ''}`}
              style={{ '--mp-accent': c.accent }}
              data-map={c.id}
              disabled={disabled}
              tabIndex={c.id === id ? 0 : -1}
              ref={(el) => {
                refs.current[c.id] = el;
              }}
              onClick={() => pick(c.id)}
            >
              <span className="mp-opt__ring">
                <MapRing cells={c.cells} size={c.size} accent={c.accent} />
              </span>
              <span className="mp-opt__name">{c.name}</span>
              {c.te && <TeText text={c.te} className="mp-opt__te" />}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mp" data-tour="lobby-map" data-count={choices.length}>
      <div className="mp__head">
        <span id={labelId} className="ho-field__label mp__label">
          {label}
        </span>
      </div>
      <div className="mp__grid" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKey}>
        {choices.map((c) => (
          <Card
            key={c.id}
            c={c}
            selected={c.id === id}
            interactive
            disabled={disabled}
            tabIndex={c.id === id ? 0 : -1}
            refCb={(el) => {
              refs.current[c.id] = el;
            }}
            onPick={pick}
          />
        ))}
      </div>
      {helpText && <p className="ho-help">{helpText}</p>}
    </div>
  );
}
