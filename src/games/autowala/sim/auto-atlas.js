// The decal atlas of the player's auto: ONE canvas texture with a cell per always-visible decal (number plates, banner, rear-window
// sticker, engine-cover art, mud-flap art, roof badge) plus a small white cell for the parts that have no picture. The art functions in
// custom-art*.js keep making their own canvas textures (customize.js swaps them on the materials with `setMap` exactly as before); those
// textures are never drawn by a mesh any more: `syncAtlas` copies a texture's canvas into its cell when the texture (or its version, bumped
// by a late font-load redraw) changes, and the merged auto meshes (sim/auto-uber.js) read the atlas through uvs baked into their cell.
// Each cell has a gutter of replicated edge pixels so mipmaps do not bleed one decal into the next.
// OWNER: customisation agent.
import { canvasTexture } from '../render/textures.js';

export const ATLAS_GUTTER = 8;
export const ATLAS_WIDTH = 1024;

/** Cell name -> inner size in px (the size each art function draws at, so nothing is resampled). Insertion order = packing order. */
export const ATLAS_CELLS = {
  banner: [512, 110],
  rearWindow: [256, 154],
  flap: [128, 152],
  white: [16, 16],
  cover: [256, 125],
  badge: [256, 108],
  plate: [256, 64],
};

/**
 * Shelf packing, in insertion order: each cell's INNER rect {x, y, w, h} (canvas px, y down) with `gutter` px free on every side.
 * Returns { width, height, rects }. Height is rounded up to a multiple of 32.
 */
export function layoutAtlas(cells = ATLAS_CELLS, width = ATLAS_WIDTH, gutter = ATLAS_GUTTER) {
  const rects = {};
  let x = 0;
  let y = 0;
  let row = 0;
  for (const [name, [w, h]] of Object.entries(cells)) {
    const ow = w + 2 * gutter;
    const oh = h + 2 * gutter;
    if (ow > width) throw new Error(`auto-atlas: cell "${name}" is wider than the atlas`);
    if (x + ow > width) {
      y += row;
      x = 0;
      row = 0;
    }
    rects[name] = { x: x + gutter, y: y + gutter, w, h };
    x += ow;
    row = Math.max(row, oh);
  }
  const height = Math.ceil((y + row) / 32) * 32;
  return { width, height, rects };
}

/** A cell's uv rectangle (the texture is uploaded with flipY, so v = 0 is the bottom row of the canvas). */
export function cellUv(rect, width, height) {
  return { u0: rect.x / width, u1: (rect.x + rect.w) / width, v0: 1 - (rect.y + rect.h) / height, v1: 1 - rect.y / height };
}

/** Map a 0..1 uv attribute array (in place) into a cell; `null` cell = every uv on the centre of the white cell. */
export function remapUvs(arr, cell, white) {
  if (!cell) {
    const u = (white.u0 + white.u1) / 2;
    const v = (white.v0 + white.v1) / 2;
    for (let i = 0; i < arr.length; i += 2) {
      arr[i] = u;
      arr[i + 1] = v;
    }
    return arr;
  }
  const du = cell.u1 - cell.u0;
  const dv = cell.v1 - cell.v0;
  for (let i = 0; i < arr.length; i += 2) {
    arr[i] = cell.u0 + arr[i] * du;
    arr[i + 1] = cell.v0 + arr[i + 1] * dv;
  }
  return arr;
}

export const ATLAS = layoutAtlas();
export const ATLAS_UV = Object.fromEntries(Object.entries(ATLAS.rects).map(([k, r]) => [k, cellUv(r, ATLAS.width, ATLAS.height)]));

/**
 * Paint a source image (a canvas, or null = plain white) into a cell, its outermost rows / columns stretched over the gutter.
 * `g` is the atlas' 2d context.
 */
export function drawCell(g, rect, img, gutter = ATLAS_GUTTER) {
  const { x, y, w, h } = rect;
  const G = gutter;
  g.clearRect(x - G, y - G, w + 2 * G, h + 2 * G);
  const iw = img ? img.width : 0;
  const ih = img ? img.height : 0;
  if (!iw || !ih) {
    g.fillStyle = '#ffffff';
    g.fillRect(x - G, y - G, w + 2 * G, h + 2 * G);
    return;
  }
  g.drawImage(img, 0, 0, iw, ih, x, y, w, h);
  g.drawImage(img, 0, 0, iw, 1, x, y - G, w, G); // top
  g.drawImage(img, 0, ih - 1, iw, 1, x, y + h, w, G); // bottom
  g.drawImage(img, 0, 0, 1, ih, x - G, y, G, h); // left
  g.drawImage(img, iw - 1, 0, 1, ih, x + w, y, G, h); // right
  g.drawImage(img, 0, 0, 1, 1, x - G, y - G, G, G); // corners
  g.drawImage(img, iw - 1, 0, 1, 1, x + w, y - G, G, G);
  g.drawImage(img, 0, ih - 1, 1, 1, x - G, y + h, G, G);
  g.drawImage(img, iw - 1, ih - 1, 1, 1, x + w, y + h, G, G);
}

/**
 * The atlas texture of one auto. `sources`: [{ cell, material }] - the material whose `.map` feeds that cell (the materials stay the
 * data customize.js writes; they are never drawn). Returns { texture, sources, sync() }: `sync()` is cheap when nothing changed (a reference
 * and a number compared per cell, no allocation) and repaints + re-uploads only when a map was swapped or redrawn.
 */
export function createAtlas(sources) {
  const texture = canvasTexture(ATLAS.width, ATLAS.height, (g) => drawCell(g, ATLAS.rects.white, null), { anisotropy: 4 });
  const g = texture.image.getContext('2d');
  const list = sources.map((s) => ({ rect: ATLAS.rects[s.cell], material: s.material, tex: undefined, ver: -2 }));
  const atlas = {
    texture,
    sources: list,
    /** Repaint the cells whose texture changed; flags one upload. Returns true when something was repainted. */
    sync() {
      let dirty = false;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const t = s.material.map || null;
        const ver = t ? t.version : -1;
        if (t === s.tex && ver === s.ver) continue;
        s.tex = t;
        s.ver = ver;
        drawCell(g, s.rect, t ? t.image : null);
        dirty = true;
      }
      if (dirty) texture.needsUpdate = true;
      return dirty;
    },
  };
  return atlas;
}
