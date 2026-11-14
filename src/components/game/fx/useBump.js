import { useState } from 'react';

/**
 * A counter that goes up every time `value` changes AFTER the first render (render-phase update, no effect,
 * so the keyed animation starts in the same paint as the change). 0 = never changed: nothing to animate,
 * which keeps snapshots / reconnects / first paint free of one-off effects.
 * `when(prev, next)` filters which changes count (default: any change).
 */
export function useBump(value, when) {
  const [seen, setSeen] = useState(value);
  const [n, setN] = useState(0);
  if (!Object.is(seen, value)) {
    setSeen(value);
    if (!when || when(seen, value)) setN(n + 1);
  }
  return n;
}

export default useBump;
