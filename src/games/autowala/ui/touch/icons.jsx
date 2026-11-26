// Stroke icons for the touch controls (24x24, currentColor). Own copy so the touch layer does not depend on the HUD's icon file.
function Svg({ size = 22, children, fill = 'none', sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const BoltIcon = (p) => (
  <Svg {...p}>
    <path d="M13 2.5 5 13.2h6l-1 8.3 8-11h-6l1-8Z" />
  </Svg>
);
export const DriftIcon = (p) => (
  <Svg {...p}>
    <path d="M6 4.5c-2 6 2 8 6 10s4 3.5 3 5.5" />
    <path d="M10 4.5c-1.2 3.4.4 5 3.4 6.6M16.5 7.5c1.5 2.6 1.5 5 .3 7.4" />
    <circle cx="16.5" cy="20" r="1.2" fill="currentColor" />
  </Svg>
);
export const HornIcon = (p) => (
  <Svg {...p}>
    <path d="M4 10v4h3.2l5.3 4V6L7.2 10H4Z" />
    <path d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8" />
  </Svg>
);
export const CameraIcon = (p) => (
  <Svg {...p}>
    <path d="M3.5 8.2h3.2l1.5-2.2h7.6l1.5 2.2h3.2v10.3h-17Z" />
    <circle cx="12" cy="13.2" r="3.4" />
  </Svg>
);
export const HandIcon = (p) => (
  <Svg {...p}>
    <path d="M8 12.5V5.8a1.5 1.5 0 0 1 3 0v5M11 10.5V4.6a1.5 1.5 0 0 1 3 0v6M14 10.8V6.2a1.5 1.5 0 0 1 3 0v8.2c0 4-2.4 6.6-5.8 6.6-2.6 0-4-1.4-5.2-3.4l-2-3.4a1.5 1.5 0 0 1 2.5-1.6L8 14.2" />
  </Svg>
);
export const MapIcon = (p) => (
  <Svg {...p}>
    <path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2Z" />
    <path d="M9 4.5v13M15 6.5v13" />
  </Svg>
);
export const RadioIcon = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="8.5" width="17" height="11" rx="2.2" />
    <path d="M7 8.5 17.5 3.5" />
    <circle cx="9" cy="14" r="2.4" />
    <path d="M14.5 12.5h3.5M14.5 15.5h3.5" />
  </Svg>
);
export const PhoneIcon = (p) => (
  <Svg {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.4" />
    <path d="M10.6 18.4h2.8" />
  </Svg>
);
export const QuestIcon = (p) => (
  <Svg {...p}>
    <path d="M6 3.5h12v17l-6-3.6-6 3.6Z" />
    <path d="M9.2 8.5h5.6M9.2 11.8h3.6" />
  </Svg>
);
export const PauseIcon = (p) => (
  <Svg {...p} sw={3}>
    <path d="M8.5 5.5v13M15.5 5.5v13" />
  </Svg>
);
export const GearIcon = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
  </Svg>
);
export const DotsIcon = (p) => (
  <Svg {...p} fill="currentColor" sw={0}>
    <circle cx="5.5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="18.5" cy="12" r="2" />
  </Svg>
);
export const ChevronIcon = ({ dir = 'left', size = 40 }) => (
  <Svg size={size} sw={3}>
    <path d={dir === 'left' ? 'M14.5 5 7.5 12l7 7' : 'M9.5 5l7 7-7 7'} />
  </Svg>
);
export const FullscreenIcon = (p) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const RotateIcon = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="11" height="14" rx="2" transform="rotate(-18 9 14)" />
    <path d="M16.5 4.2a6 6 0 0 1 4.3 4.2M20.8 4.5v4h-4" />
  </Svg>
);
export const CloseIcon = (p) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
