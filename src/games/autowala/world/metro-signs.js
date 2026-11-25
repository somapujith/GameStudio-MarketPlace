// OWNER: metro agent. One canvas atlas holds every station name board (English big, Telugu below, a line-colour band) and the "M"
// roundels, so all signs of the metro are a single draw call. Browser only (canvas); the layout maths (`tileRect`) is pure.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

export const TILE_W = 512;
export const TILE_H = 128;
export const COLS = 4;

/** Pixel rect of tile `i` in an atlas of `rows` rows. */
export function tileRect(i, rows) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return { x: col * TILE_W, y: row * TILE_H, w: TILE_W, h: TILE_H, rows, uv: [col / COLS, 1 - (row + 1) / rows, (col + 1) / COLS, 1 - row / rows] };
}

const LATIN = '800 56px "Bricolage Grotesque Variable", "Segoe UI", Arial, sans-serif';
const TELUGU = '700 38px "Noto Sans Telugu Variable", "Nirmala UI", "Gautami", sans-serif';

function fitText(g, text, font, maxW) {
  const m = /(\d+)px/.exec(font);
  let size = +m[1];
  let f = font;
  g.font = f;
  while (g.measureText(text).width > maxW && size > 18) {
    size -= 2;
    f = font.replace(/\d+px/, `${size}px`);
    g.font = f;
  }
  return f;
}

function roundel(g, cx, cy, r, color) {
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(r * 1.25)}px "Bricolage Grotesque Variable", Arial, sans-serif`;
  g.fillText('M', cx, cy + r * 0.06);
}

/**
 * Build the atlas for a list of stations ({ id, name, te, color }) and line colours ({ red: '#..' ...}).
 * -> { texture, rows, board(id) -> uv rect, roundel(lineId) -> uv rect, dispose() }
 */
export function buildSignAtlas(stations, lineColors) {
  const lineIds = Object.keys(lineColors);
  const rows = Math.ceil((1 + stations.length / COLS) + 0.0001);
  const c = document.createElement('canvas');
  c.width = TILE_W * COLS;
  c.height = TILE_H * rows;
  const g = c.getContext('2d');
  // the roundel row stays transparent (alpha-tested), the name boards are opaque
  // tile 0..: roundels (128 px squares inside the first row, one per line plus a multicolour interchange disc)
  const roundels = {};
  lineIds.forEach((id, i) => {
    const cx = i * TILE_H + TILE_H / 2;
    roundel(g, cx, TILE_H / 2, 56, lineColors[id]);
    roundels[id] = [(cx - TILE_H / 2) / c.width, 1 - TILE_H / c.height, (cx + TILE_H / 2) / c.width, 1];
  });
  const boards = {};
  stations.forEach((st, i) => {
    const t = tileRect(i + COLS, rows); // first row is for the roundels
    g.save();
    g.translate(t.x, t.y);
    g.fillStyle = '#f5f5f7';
    g.fillRect(0, 0, TILE_W, TILE_H);
    g.fillStyle = st.color;
    g.fillRect(0, TILE_H - 20, TILE_W, 20);
    g.fillRect(0, 0, TILE_W, 8);
    roundel(g, 58, 56, 40, st.color);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#12151c';
    const nameFont = fitText(g, st.name, LATIN, 360);
    g.font = nameFont;
    g.fillText(st.name, 290, 42);
    g.fillStyle = '#2a2f3c';
    const teFont = fitText(g, st.te || '', TELUGU, 360);
    g.font = teFont;
    g.fillText(st.te || '', 290, 88);
    g.restore();
    boards[st.id] = t.uv;
  });
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return {
    texture,
    rows,
    board: (id) => boards[id],
    roundel: (lineId) => roundels[lineId],
    dispose() {
      texture.dispose();
    },
  };
}
