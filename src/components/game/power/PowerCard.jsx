import { memo } from 'react';
import { powerCardById } from '@shared/powerCards.js';
import Icon from '../ui/Icon.jsx';
import PowerCardArt from './PowerCardArt.jsx';
import { PIPS, expiryInfo } from './powerModel.js';
import '@/styles/power.css';

/**
 * The full face of one Power Card (aspect 5:7, rounded 14px): a coloured band per tone with the icon and name, the art, the
 * one-line effect and the 3-pip expiry meter.
 *   id        'shield' | 'double' | 'steal' | 'swap'
 *   left      rounds left (this one included), omitted = no meter (the guide)
 *   variant   'hand'  an interactive <button> (select, then confirm in the tray's panel)
 *             'face'  a static <div> (guide, moments); the card back is CardBack, not here
 *   selected  lifted (aria-pressed)         dimmed  cannot be played now (the reason is the panel's job; pass `describedBy`)
 *   width     CSS width ("96px", "var(--pw-w)"); omitted = the `--pw-w` custom property, default 96px
 * Hand cards accept the usual button props (onClick, onKeyDown, tabIndex, ref via `innerRef`, aria-*). Memoised and cheap: no
 * state, no effects, one inline SVG.
 */
function PowerCard({
  id, left = null, variant = 'hand', selected = false, dimmed = false, width, className = '', innerRef, describedBy, style, ...rest
}) {
  const meta = powerCardById(id) || powerCardById('shield');
  const ex = expiryInfo(left, meta.name);
  const cls = `pw-card pw-tone-${meta.tone}${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}${ex.last ? ' is-last' : ''} ${className}`.trim();
  const st = width ? { '--pw-w': width, ...style } : style;
  const body = (
    <>
      <span className="pw-card__band">
        <Icon name={ICON[meta.id] || 'spark'} size={13} className="pw-card__ico" />
        <span className="pw-card__name">{meta.name}</span>
      </span>
      <span className="pw-card__art"><PowerCardArt id={meta.id} size={96} /></span>
      <span className="pw-card__short">{meta.short}</span>
      {ex.left != null ? (
        <span className="pw-card__meter" aria-hidden="true">
          <span className="pw-pips">
            {Array.from({ length: PIPS }, (_, i) => <i key={i} className={ex.pips[i] ? 'is-on' : ''} />)}
          </span>
          <span className="pw-card__left">
            {ex.last ? (<><span className="pw-last-long">Last round</span><span className="pw-last-short">Last</span></>) : ex.text}
          </span>
        </span>
      ) : null}
      <span className="pw-card__sheen" aria-hidden="true" />
    </>
  );
  if (variant === 'face') {
    return (
      <div className={cls} style={st} role="img" aria-label={ex.aria || meta.name} data-power-card={meta.id} {...rest}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      ref={innerRef}
      className={cls}
      style={st}
      aria-label={ex.aria || meta.name}
      aria-pressed={selected}
      aria-describedby={describedBy}
      data-power-card={meta.id}
      {...rest}
    >
      {body}
    </button>
  );
}

/** Band icons from the game's own icon set (the art carries the real picture). */
const ICON = { shield: 'lock', double: 'coin', steal: 'dice', swap: 'swap' };

export default memo(PowerCard);
