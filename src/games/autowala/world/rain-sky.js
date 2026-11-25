// An overcast sky for rain. render/sky.js already darkens the lights and thickens the fog from the `weather` value; this wraps its
// update() to also turn the dome grey (rain clouds, no sun disc) and to light it up during lightning. The palette colours are the very
// objects the dome and the terrain shader read, so editing them in place is all it takes. Removing the wrapper restores the sky.
import { Color } from 'three';

const FLASH = new Color(0.78, 0.84, 1.0);

/** Pull `c` toward its own luminance (k = 0 untouched, 1 grey) and darken it by `dark` (0 untouched). */
export function greyOut(c, k, dark) {
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const m = 1 - dark;
  c.r = (c.r + (lum - c.r) * k) * m;
  c.g = (c.g + (lum - c.g) * k) * m;
  c.b = (c.b + (lum - c.b) * k) * m;
}

/**
 * Wrap `sky.update`. `read()` returns { weather 0..1 (the value the sky already got), flash 0..1 }.
 * Returns an `undo()`.
 */
export function installOvercast(sky, scene, read) {
  const original = sky.update;
  const p = sky.palette;
  sky.update = function overcastUpdate(...args) {
    const st = original.apply(this, args);
    try {
      const { weather, flash } = read();
      if (weather > 0.02 || flash > 0.01) {
        const k = Math.min(0.85, weather * 0.95);
        const dark = weather * 0.32 * (1 - st.night * 0.5);
        greyOut(p.top, k, dark);
        greyOut(p.mid, k, dark * 0.8);
        greyOut(p.hor, k * 0.8, dark * 0.5);
        greyOut(p.hs, k * 0.6, 0);
        p.sun.multiplyScalar(1 - 0.9 * Math.min(1, weather * 1.2)); // the dome's sun disc and halo disappear behind the cloud
        if (flash > 0.01) {
          p.top.lerp(FLASH, flash * 0.55);
          p.mid.lerp(FLASH, flash * 0.6);
          p.hor.lerp(FLASH, flash * 0.5);
        }
        // rain clouds block the sun: the lights go dimmer than the sky module's own (already modest) weather factor
        const day = 1 - st.night * 0.7; // at night there is little light to take away: keep the street readable
        sky.key.intensity *= 1 - 0.5 * weather * day;
        sky.hemi.intensity *= 1 - 0.3 * weather * day;
        st.fogColor.copy(p.hor).lerp(p.mid, 0.18);
        scene.fog.color.copy(st.fogColor);
        scene.fog.density *= 1 + weather * 0.35;
      }
    } catch {
      /* the sky must never fail because of the weather */
    }
    return st;
  };
  return () => {
    if (sky.update !== original) sky.update = original;
  };
}
