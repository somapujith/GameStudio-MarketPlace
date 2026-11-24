// A small flat drawing per dish (plate / glass / leaf), used on chits, bubbles, the dock, the chalk board and the action sheet.
// Pure SVG, no assets. Unknown ids get a plain steel plate.
const PLATE = <ellipse cx="20" cy="30" rx="16" ry="5.5" fill="#d3dade" stroke="#6f7c84" strokeWidth="1.2" />;
const OUT = '#8a5a1f';
const dots = (pts, r, fill) => pts.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={fill} />);

const ART = {
  dosa: (
    <>
      {PLATE}
      <path d="M5 29Q20 4 35 29z" fill="#e9b25a" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M12 26Q20 14 28 26" fill="none" stroke="#c98a2b" strokeWidth="1" />
    </>
  ),
  masala_dosa: (
    <>
      {PLATE}
      <path d="M5 29Q20 4 35 29z" fill="#e9b25a" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
      <ellipse cx="20" cy="25" rx="7" ry="3.2" fill="#f2c22e" stroke="#b78a10" strokeWidth="1" />
      <circle cx="30" cy="30" r="2.2" fill="#2f9e5b" />
    </>
  ),
  podi_dosa: (
    <>
      {PLATE}
      <path d="M5 29Q20 4 35 29z" fill="#e0a24d" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
      {dots([[14, 24], [20, 20], [26, 24], [18, 26], [23, 27]], 1.5, '#c4361f')}
    </>
  ),
  set_dosa: (
    <>
      {PLATE}
      <ellipse cx="14" cy="26" rx="8" ry="4" fill="#f2deb0" stroke={OUT} strokeWidth="1.1" />
      <ellipse cx="26" cy="26" rx="8" ry="4" fill="#f2deb0" stroke={OUT} strokeWidth="1.1" />
      <ellipse cx="20" cy="21" rx="8" ry="4" fill="#f7e8c4" stroke={OUT} strokeWidth="1.1" />
    </>
  ),
  pesarattu: (
    <>
      {PLATE}
      <path d="M5 29Q20 4 35 29z" fill="#9fbf5a" stroke="#5c7a22" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M13 26Q20 15 27 26" fill="none" stroke="#6f9230" strokeWidth="1" />
    </>
  ),
  idly: (
    <>
      {PLATE}
      <path d="M6 29a8 8 0 0 1 16 0z" fill="#fffaf0" stroke="#9a9186" strokeWidth="1.2" />
      <path d="M18 29a8 8 0 0 1 16 0z" fill="#fffaf0" stroke="#9a9186" strokeWidth="1.2" />
      <circle cx="20" cy="30" r="2" fill="#d9822b" />
    </>
  ),
  poori: (
    <>
      {PLATE}
      <ellipse cx="17" cy="21" rx="12" ry="9" fill="#e8a63c" stroke={OUT} strokeWidth="1.3" />
      <path d="M9 19q5-4 11-2" fill="none" stroke="#f6cf7a" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="31" cy="29" r="4" fill="#d9822b" stroke="#8a4a10" strokeWidth="1" />
    </>
  ),
  vada: (
    <>
      {PLATE}
      <ellipse cx="20" cy="22" rx="12" ry="8.5" fill="#b9772c" stroke="#6f4410" strokeWidth="1.3" />
      <ellipse cx="20" cy="22" rx="4" ry="2.8" fill="#d3dade" stroke="#6f4410" strokeWidth="1" />
    </>
  ),
  mysore_bonda: (
    <>
      {PLATE}
      <circle cx="20" cy="21" r="10" fill="#c98a38" stroke="#7a4a12" strokeWidth="1.3" />
      {dots([[16, 18], [23, 17], [21, 24], [15, 24]], 1.2, '#e8b866')}
    </>
  ),
  mirchi_bajji: (
    <>
      {PLATE}
      <path d="M5 27Q16 8 32 12Q26 26 5 27z" fill="#dba645" stroke={OUT} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M31 12l5-4" stroke="#2f9e5b" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  irani_chai: (
    <>
      <path d="M11 12h18l-2.4 21H13.4z" fill="#f3d9a6" fillOpacity=".55" stroke="#5a6770" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12.2 19h15.6l-1.4 14H13.6z" fill="#c8793a" />
      <path d="M16 4c0 3 3 3 3 6M22 4c0 3 3 3 3 6" fill="none" stroke="#b7c0c6" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  filter_coffee: (
    <>
      <path d="M11 12h18l-2.4 21H13.4z" fill="#f3d9a6" fillOpacity=".5" stroke="#5a6770" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12.2 17h15.6l-1.4 16H13.6z" fill="#5a3418" />
      <path d="M12.2 17h15.6v3H12.2z" fill="#f1dfc2" />
      <path d="M16 4c0 3 3 3 3 6M22 4c0 3 3 3 3 6" fill="none" stroke="#b7c0c6" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  osmania: (
    <>
      <rect x="6" y="14" width="28" height="17" rx="3.5" fill="#e9c47a" stroke={OUT} strokeWidth="1.3" />
      {dots([[13, 20], [20, 20], [27, 20], [13, 26], [20, 26], [27, 26]], 1.1, '#b98a3c')}
    </>
  ),
};

export default function DishIcon({ dish, size = 36, className = '' }) {
  return (
    <svg className={`tc-hud-dish ${className}`.trim()} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      {ART[dish] || PLATE}
    </svg>
  );
}
