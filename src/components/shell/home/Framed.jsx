// Cosmetic avatar frame for the home rows (`AvatarFrame` from the art kit).
import { AvatarFrame } from '@/components/art/cosmetics.jsx';

/** `<Framed frame="frame-nizam" size={56}><Ava .../></Framed>`; no frame -> children as-is. */
export default function Framed({ frame, size, children }) {
  if (!frame || typeof frame !== 'string') return children;
  return (
    <AvatarFrame frame={frame} size={size}>
      {children}
    </AvatarFrame>
  );
}
