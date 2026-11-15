// The overlay's runtime: pooled nodes, tracked WAAPI animations (so unmount cancels everything), "scopes" (one effect =
// one root node + children that are all released together when the last animation ends) and tile followers.
// Plain JS, no React. FxLayer owns one runtime per mount.

import { createFollower, createPool, tileBox } from './fxDom.js';

export function createRuntime(layer) {
  const pool = createPool(72);
  const follower = createFollower();
  const live = new Set(); // every running animation
  let dead = false;

  /** One effect: a root, children made with scope.node, animations made with scope.anim. Released when all end. */
  function scope(root, onEnd) {
    let pending = 0;
    let ended = false;
    const nodes = [root];
    const anims = new Set();
    const finish = () => {
      if (ended) return;
      ended = true;
      for (let i = nodes.length - 1; i >= 0; i -= 1) pool.release(nodes[i]);
      if (onEnd) onEnd();
    };
    const api = {
      root,
      get ended() {
        return ended;
      },
      node(cls, parent = root) {
        const n = pool.acquire(cls);
        parent.appendChild(n);
        nodes.push(n);
        return n;
      },
      anim(el, frames, opts) {
        if (ended || dead || typeof el.animate !== 'function') return null;
        pending += 1;
        const a = el.animate(frames, { fill: 'both', ...opts });
        live.add(a);
        anims.add(a);
        const done = () => {
          live.delete(a);
          anims.delete(a);
          pending -= 1;
          if (pending <= 0) finish();
        };
        a.onfinish = done;
        a.oncancel = done;
        return a;
      },
      /** Nothing animated at all (e.g. every keyframe was skipped): release right away. */
      settle() {
        if (pending <= 0) finish();
      },
      cancel() {
        for (const a of [...anims]) {
          try {
            a.cancel();
          } catch {
            /* ignore */
          }
        }
        finish();
      },
    };
    return api;
  }

  /**
   * A scope glued to a board tile. `host` (inside the scope) has the tile's size (`--w --h --d` custom props, `d` = 82% of
   * the shorter side) and follows it every frame, so an effect stays on its tile while the camera zooms. When the board
   * is zoomed the whole effect is clipped to the camera's view. null when the tile is not on screen.
   */
  function tileScope(tile, onEnd) {
    const tb = tileBox(tile);
    if (!tb || dead) return null;
    const clip = !!tb.lens;
    const root = pool.acquire(clip ? 'fx-clip' : 'fx-tile');
    layer.appendChild(root);
    const sc = scope(root, onEnd);
    const host = clip ? sc.node('fx-tile') : root;
    let last = '';
    const place = () => {
      const t = tileBox(tile);
      if (!t) {
        root.style.visibility = 'hidden';
        return;
      }
      root.style.visibility = '';
      const { box, lens } = t;
      if (clip && lens) {
        const sig = `${lens.left}|${lens.top}|${lens.width}|${lens.height}`;
        if (sig !== last) {
          last = sig;
          root.style.width = `${lens.width}px`;
          root.style.height = `${lens.height}px`;
          root.style.borderRadius = `${(lens.width * 0.026).toFixed(1)}px`;
        }
        root.style.transform = `translate3d(${lens.left.toFixed(1)}px, ${lens.top.toFixed(1)}px, 0)`;
        host.style.transform = `translate3d(${(box.left - lens.left).toFixed(1)}px, ${(box.top - lens.top).toFixed(1)}px, 0)`;
      } else {
        host.style.transform = `translate3d(${box.left.toFixed(1)}px, ${box.top.toFixed(1)}px, 0)`;
      }
      const w = Math.round(box.width * 10) / 10;
      const h = Math.round(box.height * 10) / 10;
      if (host.__w !== w || host.__h !== h) {
        host.__w = w;
        host.__h = h;
        host.style.width = `${w}px`;
        host.style.height = `${h}px`;
        host.style.setProperty('--w', `${w}px`);
        host.style.setProperty('--h', `${h}px`);
        host.style.setProperty('--d', `${(Math.min(w, h) * 0.82).toFixed(1)}px`);
      }
    };
    host.__w = -1; // pooled nodes come back without their inline size: always write it the first time
    host.__h = -1;
    place();
    follower.add(() => {
      if (sc.ended) return false;
      place();
      return true;
    });
    return { scope: sc, host };
  }

  /** An animation on someone else's element (an avatar's ting): cancelled with the layer, forgotten when it ends. */
  function trackExternal(a) {
    if (!a || dead) return;
    live.add(a);
    const done = () => live.delete(a);
    a.onfinish = done;
    a.oncancel = done;
  }

  function destroy() {
    dead = true;
    follower.stop();
    for (const a of [...live]) {
      try {
        a.cancel();
      } catch {
        /* ignore */
      }
    }
    live.clear();
  }

  return { layer, pool, follower, scope, tileScope, trackExternal, destroy, liveCount: () => live.size };
}
