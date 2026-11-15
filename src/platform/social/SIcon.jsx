// Small inline icon set for the social screens (Friends, Friend link, Rank states). Stroke icons, currentColor.
const P = {
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7',
  close: 'M6 6l12 12M18 6L6 18',
  table: 'M4 9h16M6 9v9M18 9v9M8 5h8l4 4H4z',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  share: 'M12 15V4M8 8l4-4 4 4M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM18 18h2M18 14h2',
  users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  userPlus: 'M14 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 3 17.5V19M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M16 11h6',
  clock: 'M12 7.5V12l3 1.8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.6M19 13a10 10 0 0 0-2.3-1.6M2 9.5a15 15 0 0 1 4.5-2.7M22 9.5A15 15 0 0 0 11 6',
  refresh: 'M20 11a8 8 0 0 0-14.5-3.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.5 3.5M20 20v-4.5h-4.5',
  lock: 'M6.5 10.5h11v9h-11zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  question: 'M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5A3 3 0 0 1 16 10M12 13v4M8.5 20h7M10 17h4',
  play: 'M8 5.5v13l11-6.5z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

export const WHATSAPP_PATH =
  'M12.04 2a9.9 9.9 0 0 0-8.4 15.1L2 22l5.05-1.6A9.93 9.93 0 1 0 12.04 2zm0 1.8a8.13 8.13 0 1 1-4.3 15.05l-.3-.18-3 .95.98-2.92-.2-.31A8.13 8.13 0 0 1 12.04 3.8zm-3.1 3.6c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.35 5.15 4.56 2.55 1 3.07.8 3.62.75.55-.05 1.78-.73 2.03-1.43.25-.7.25-1.3.18-1.43-.08-.12-.28-.2-.58-.35-.3-.15-1.78-.88-2.05-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.95 1.18-.18.2-.35.23-.65.08-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.67-2.08-.18-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.53-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.68-.5z';

export function WhatsAppIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={WHATSAPP_PATH} />
    </svg>
  );
}

/** `<SIcon name="copy" size={18} />` */
export default function SIcon({ name, size = 18, strokeWidth = 2.2, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={P[name] || P.question} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
