// Small stroke icons for the HUD, toasts and touch buttons (24x24, currentColor). Inline SVG: no image requests, crisp at any size.
function Svg({ size = 20, className = '', children, fill = 'none', sw = 2 }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const SunIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7" />
  </Svg>
);
export const DuskIcon = (p) => (
  <Svg {...p}>
    <path d="M6.5 16.5a5.5 5.5 0 0 1 11 0" />
    <path d="M2.5 16.5h19M5 20.5h14M12 5.5v2.2M4.6 9.1l1.6 1.4M19.4 9.1l-1.6 1.4" />
  </Svg>
);
export const MoonIcon = (p) => (
  <Svg {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2Z" />
  </Svg>
);
export const PinIcon = (p) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);
export const PauseIcon = (p) => (
  <Svg {...p} sw={2.6}>
    <path d="M8.5 5.5v13M15.5 5.5v13" />
  </Svg>
);
export const FuelIcon = (p) => (
  <Svg {...p}>
    <path d="M5 21V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V21M3.5 21h12" />
    <path d="M7.5 8.5h4M14 10.5h1.8a1.7 1.7 0 0 1 1.7 1.7v4.1a1.4 1.4 0 0 0 2.8 0V9.3l-2.6-2.6" />
  </Svg>
);
export const BoltIcon = (p) => (
  <Svg {...p}>
    <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z" />
  </Svg>
);
export const DriftIcon = (p) => (
  <Svg {...p}>
    <path d="M5 19c4.5-1 5.5-5 5.5-8s1.5-5.5 5-6.5" />
    <path d="M12.5 4.8 16 4.5l-.8 3.5M4 14.5c2 .2 3.6 1 4.5 2.5M3 19.5c2.2.2 4 1 5 2.4" />
  </Svg>
);
export const HornIcon = (p) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
    <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </Svg>
);
export const CameraIcon = (p) => (
  <Svg {...p}>
    <path d="M3.5 8.2A1.7 1.7 0 0 1 5.2 6.5h2.3l1.4-2h6.2l1.4 2h2.3a1.7 1.7 0 0 1 1.7 1.7v9.1a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V8.2Z" />
    <circle cx="12" cy="12.7" r="3.6" />
  </Svg>
);
export const HandIcon = (p) => (
  <Svg {...p}>
    <path d="M8 12.5V6.2a1.4 1.4 0 0 1 2.8 0v5M10.8 11V4.8a1.4 1.4 0 0 1 2.8 0V11M13.6 11V6a1.4 1.4 0 0 1 2.8 0v6" />
    <path d="M16.4 9.6a1.4 1.4 0 0 1 2.8 0v4.6c0 3.8-2.6 6.3-6 6.3-2.5 0-4.2-1.2-5.5-3.2L4.8 13a1.5 1.5 0 0 1 2.4-1.7L8 12.5" />
  </Svg>
);
export const ArrowIcon = (p) => (
  <Svg {...p} sw={2.6}>
    <path d="M12 20V5M6 11l6-6 6 6" />
  </Svg>
);
export const UTurnIcon = (p) => (
  <Svg {...p} sw={2.6}>
    <path d="M7 20V9a4.5 4.5 0 0 1 9 0v3M12.5 9.5 16 13l3.5-3.5" />
  </Svg>
);
export const FlagIcon = (p) => (
  <Svg {...p}>
    <path d="M5.5 21V4M5.5 5h11l-2 3.8 2 3.7h-11" />
  </Svg>
);
export const ClockIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5.2l3 1.8" />
  </Svg>
);
export const CheckIcon = (p) => (
  <Svg {...p} sw={2.6}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
);
export const CoinIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.5 9.2h5M9.5 12h5M9.5 9.2c3.3 0 3.3 4.2 0 4.2l4.2 3.1" />
  </Svg>
);
export const VolumeIcon = ({ off, ...p }) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" />
    {off ? <path d="m16.5 9.5 5 5M21.5 9.5l-5 5" /> : <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
  </Svg>
);

// customer kinds (the trip panel badge)
const PERSON = (
  <>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20.5a7 7 0 0 1 14 0" />
  </>
);
export function KindIcon({ kind = 'generic', ...p }) {
  let body = PERSON;
  if (['office', 'worker', 'commuter', 'techie', 'vip', 'doctor'].includes(kind)) {
    body = (
      <>
        <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
        <path d="M9 7.5V5.8A1.3 1.3 0 0 1 10.3 4.5h3.4A1.3 1.3 0 0 1 15 5.8v1.7M3.5 13h17" />
      </>
    );
  } else if (['student'].includes(kind)) {
    body = (
      <>
        <path d="m2.5 9.5 9.5-4.5 9.5 4.5-9.5 4.5-9.5-4.5Z" />
        <path d="M6.5 11.8v4.2c0 1.2 2.5 2.5 5.5 2.5s5.5-1.3 5.5-2.5v-4.2" />
      </>
    );
  } else if (['tourist', 'traveller', 'traveler', 'pilgrim'].includes(kind)) {
    body = (
      <>
        <path d="M3.5 8.2A1.7 1.7 0 0 1 5.2 6.5h2.3l1.4-2h6.2l1.4 2h2.3a1.7 1.7 0 0 1 1.7 1.7v9.1a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V8.2Z" />
        <circle cx="12" cy="12.7" r="3.6" />
      </>
    );
  } else if (['shopper', 'foodie'].includes(kind)) {
    body = (
      <>
        <path d="M5 8.5h14l-1 11.5H6L5 8.5Z" />
        <path d="M8.5 10.5V7.2a3.5 3.5 0 0 1 7 0v3.3" />
      </>
    );
  } else if (['family', 'elder', 'senior'].includes(kind)) {
    body = (
      <>
        <circle cx="8.5" cy="8" r="2.8" />
        <circle cx="16.5" cy="9.5" r="2.2" />
        <path d="M3 19.5a5.5 5.5 0 0 1 11 0M14.5 14.8a4.6 4.6 0 0 1 6.5 4.7" />
      </>
    );
  } else if (['airport'].includes(kind)) {
    body = <path d="m21 3-9 9M21 3l-6 18-3.5-8.5L3 9l18-6Z" />;
  }
  return <Svg {...p}>{body}</Svg>;
}

export function StarShape({ size = 14, fill = 1, id }) {
  // a 5-point star with a partial gold fill (fill 0..1), used for the rating
  const gid = `aw-star-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
          <stop offset={`${Math.round(fill * 100)}%`} stopColor="#ffc857" />
          <stop offset={`${Math.round(fill * 100)}%`} stopColor="rgba(255,255,255,0.18)" />
        </linearGradient>
      </defs>
      <path d="m12 2.8 2.75 5.9 6.45.8-4.75 4.4 1.25 6.4L12 17.1 6.3 20.3l1.25-6.4L2.8 9.5l6.45-.8L12 2.8Z" fill={`url(#${gid})`} stroke="rgba(255,200,87,0.55)" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

export const RainIcon = (p) => (
  <Svg {...p}>
    <path d="M7 14.5a4.2 4.2 0 0 1-.4-8.4 5.6 5.6 0 0 1 10.7 1.3 3.6 3.6 0 0 1-.3 7.1H7Z" />
    <path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5" />
  </Svg>
);
export const WrenchIcon = (p) => (
  <Svg {...p}>
    <path d="M14.5 5.5a4 4 0 0 0 4.9 5L10 19.9a2.1 2.1 0 0 1-3-3L16.4 7.5a4 4 0 0 0-1.9-2Z" />
  </Svg>
);
export const ChaiIcon = (p) => (
  <Svg {...p}>
    <path d="M5 9.5h11v4.5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 14V9.5ZM16 11h1.5a2.2 2.2 0 0 1 0 4.4H15.7" />
    <path d="M8.5 3.5c-.8 1 .8 1.6 0 2.8M12 3.5c-.8 1 .8 1.6 0 2.8" />
  </Svg>
);
export const ShieldIcon = (p) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5.5c0 4.3 2.8 7.6 7 9.5 4.2-1.9 7-5.2 7-9.5V6l-7-3Z" />
    <path d="M12 8.5v4M12 15.3v.2" />
  </Svg>
);

// phone HUD: the More button (a 2x2 grid), the sheet's close X and the minimap's "tap to enlarge" corner mark
export const MoreIcon = (p) => (
  <Svg {...p} sw={2.4}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
  </Svg>
);
export const CloseIcon = (p) => (
  <Svg {...p} sw={2.6}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const ExpandIcon = (p) => (
  <Svg {...p} sw={2.6}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </Svg>
);
