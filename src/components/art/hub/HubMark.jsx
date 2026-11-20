import { memo, useId } from 'react';
import { BRAND } from '@/platform/brand.js';
import './jalebi-logo.css';

/** The supplied spiral, cropped out of the full Jalebi wordmark. */
function HubMarkBase({ size = 40, className, title, style }) {
  const label = title === undefined ? '' : title || BRAND.name;
  return (
    <img
      className={className}
      src="/brand/jalebi-mark.svg"
      width={size}
      height={size}
      alt={label}
      aria-hidden={label ? undefined : true}
      draggable="false"
      style={{ flex: 'none', display: 'block', objectFit: 'contain', ...style }}
    />
  );
}
export const HubMark = memo(HubMarkBase);

/** Separate eyes keep the supplied artwork sharp without moving its lettering. */
function JalebiEyes() {
  const cream = `jalebi-cream-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg className="jalebi-face" viewBox="145 70 1240 895" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={cream} x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stopColor="#fff4d2" />
          <stop offset="1" stopColor="#ffdda0" />
        </linearGradient>
      </defs>
      <g transform="translate(754 766) scale(1.55) translate(-754 -766)">
        <g className="jalebi-face__open">
          <g className="jalebi-face__eye jalebi-face__eye--left">
            <ellipse cx="710" cy="766" rx="35" ry="58" transform="rotate(20 710 766)" fill={`url(#${cream})`} stroke="#180f0b" strokeWidth="2.2" />
            <g className="jalebi-face__pupil">
              <ellipse cx="730" cy="747" rx="19.5" ry="29" fill="#100c09" />
              <ellipse cx="737" cy="738" rx="7.4" ry="9.2" fill="#fff9e9" />
            </g>
          </g>
          <g className="jalebi-face__eye jalebi-face__eye--right">
            <ellipse cx="800" cy="758" rx="35" ry="57" transform="rotate(20 800 758)" fill={`url(#${cream})`} stroke="#180f0b" strokeWidth="2.2" />
            <g className="jalebi-face__pupil">
              <ellipse cx="814" cy="735" rx="18.5" ry="29" fill="#100c09" />
              <ellipse cx="825" cy="726" rx="6.1" ry="8" fill="#fff9e9" />
            </g>
          </g>
        </g>
        <g className="jalebi-face__happy" fill="none" stroke="#ffe6b5" strokeWidth="13" strokeLinecap="round">
          <path d="M683 786 Q705 744 737 769" />
          <path d="M776 776 Q797 734 828 759" />
        </g>
      </g>
    </svg>
  );
}

function HubLogoBase({ size = 40, compact = false, wordmark = true, animated = false, className = '', style }) {
  if (!wordmark) return <HubMark size={size} className={className} title={BRAND.name} style={style} />;
  return (
    <span
      className={`jalebi-logo${animated ? ' jalebi-logo--animated' : ''}${compact ? ' jalebi-logo--compact' : ''} ${className}`.trim()}
      role="img"
      aria-label={BRAND.name}
      style={{ fontSize: size, ...style }}
    >
      <span className="jalebi-logo__art" aria-hidden="true">
        <img
          src={animated ? '/brand/jalebi-logo-body.svg' : '/brand/jalebi-logo.svg'}
          width="1240"
          height="895"
          alt=""
          draggable="false"
        />
        {animated && <JalebiEyes />}
      </span>
      <span className="jalebi-logo__descriptor" aria-hidden="true">
        <span>Jalebi</span>
        <span>Games</span>
      </span>
    </span>
  );
}
export const HubLogo = memo(HubLogoBase);
