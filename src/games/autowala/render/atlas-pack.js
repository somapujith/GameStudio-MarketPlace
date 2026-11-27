// Shelf packing for small canvas atlases (signs, decals): cells are placed left to right on rows, a new row starts when the next one does
// not fit. Every cell keeps a `pad` pixel gutter on all sides (filled by the caller with the cell's edge pixels) so mip-mapped sampling
// never bleeds a neighbour into the sign.

/**
 * Place `sizes` ([{ w, h }]) in an atlas `width` px wide. Returns { cells: [{ x, y, w, h }], height } in the order given; `x, y, w, h` is the
 * art itself (the gutter lies outside it). Throws when one cell is wider than the atlas.
 */
export function shelfPack(sizes, width, pad = 8) {
  const cells = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const s of sizes) {
    const cw = s.w + pad * 2;
    const ch = s.h + pad * 2;
    if (cw > width) throw new Error(`atlas: a ${s.w}px cell does not fit a ${width}px atlas`);
    if (x + cw > width) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    cells.push({ x: x + pad, y: y + pad, w: s.w, h: s.h });
    x += cw;
    rowH = Math.max(rowH, ch);
  }
  return { cells, height: y + rowH };
}

/** The next power of two >= n (atlas heights; textures like it for mip chains). */
export const ceilPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** UV rectangle [u0, v0, u1, v1] of a cell in an atlas of W x H px (v up, like a canvas texture with flipY). */
export function uvRect(cell, W, H) {
  return [cell.x / W, 1 - (cell.y + cell.h) / H, (cell.x + cell.w) / W, 1 - cell.y / H];
}

/**
 * Draw `image` into `cell` of a canvas 2D context and replicate its outermost pixel rows / columns `pad` px into the gutter around it
 * (four strips and four corners), so sampling the very edge of the cell (bilinear, mips) reads the sign's own border colour.
 */
export function drawCell(g, image, cell, pad = 8) {
  const { x, y, w, h } = cell;
  g.drawImage(image, x, y, w, h);
  const iw = image.width;
  const ih = image.height;
  g.drawImage(image, 0, 0, iw, 1, x, y - pad, w, pad); // top strip
  g.drawImage(image, 0, ih - 1, iw, 1, x, y + h, w, pad); // bottom
  g.drawImage(image, 0, 0, 1, ih, x - pad, y, pad, h); // left
  g.drawImage(image, iw - 1, 0, 1, ih, x + w, y, pad, h); // right
  g.drawImage(image, 0, 0, 1, 1, x - pad, y - pad, pad, pad); // corners
  g.drawImage(image, iw - 1, 0, 1, 1, x + w, y - pad, pad, pad);
  g.drawImage(image, 0, ih - 1, 1, 1, x - pad, y + h, pad, pad);
  g.drawImage(image, iw - 1, ih - 1, 1, 1, x + w, y + h, pad, pad);
}
