// The board camera for phone-sized boards (docs/MOBILE_CAMERA.md).
//
// On a phone the board is ~340-400 px wide, so a tile is 30-38 px and a name prints at ~7 px. This wrapper puts ONE
// transform (`translate(tx, ty) scale(s)`, origin 0 0) around the board and drives it two ways:
//   AUTO    cameraPolicy.js decides what to look at (follow the walking pawn, hold on the tile just landed on, frame
//           my buy prompt, whole board for everything else); a critically damped spring eases the camera there
//   MANUAL  pinch / drag / double tap / the HUD buttons / keys (useBoardGestures.js); any touch pauses the auto camera
//           until Fit, the next turn, or 8 s without a touch
// Every frame is an imperative style write from requestAnimationFrame (cameraController.js): React only hears about
// coarse changes (zoomed or not, the HUD line). On boards wider than NARROW_MAX nothing is added to the DOM but this
// wrapper and nothing ever moves, so desktop looks and behaves exactly as before.
//
// The `boardCamera` setting: 'auto' (default) | 'manual' (pinch only, no automatic moves) | 'off' (no camera, no
// gestures). Reduced motion (OS, the in-game switch, [data-motion='reduced']) turns the automatic camera off; manual
// zoom still works, instantly.

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings } from '@/lib/storage.js';
import { useReducedMotion } from '../ui/helpers.js';
import AvatarToken from '../ui/AvatarToken.jsx';
import PhoneBoardContext from '../phone/PhoneBoardContext.js';
import CameraHud from './CameraHud.jsx';
import { createCameraController } from './cameraController.js';
import { announceFor, hudModel } from './cameraHudModel.js';
import { AUTO_MAX_SCALE, FIT, ZOOMED_AT, boardPoint, doubleTapCam, focusCam, followCam, inTopBand, panStep, zoomStep } from './cameraMath.js';
import { CAMERA, cameraModeOf, createDirector, situationKey, situationOf, smoothFor } from './cameraPolicy.js';
import { useBoardGestures } from './useBoardGestures.js';
import '@/styles/fx.css';
import '@/styles/camera.css';

/** Same width as the narrow-board tile labels in board.css (`@container (max-width: 520px)`). */
export const NARROW_MAX = 520;

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function BoardCamera({ session = null, children }) {
  const [settings] = useSettings();
  const mode = cameraModeOf(settings?.boardCamera);
  const reduced = useReducedMotion();
  const speed = Number(settings?.playbackSpeed) > 0 ? Number(settings.playbackSpeed) : 1;

  const viewportRef = useRef(null);
  const layerRef = useRef(null);
  const ctrlRef = useRef(null);
  const directorRef = useRef(null);
  if (directorRef.current === null) directorRef.current = createDirector();

  const [narrow, setNarrow] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [edge, setEdge] = useState('top');
  const [announce, setAnnounce] = useState('');
  const [level, setLevel] = useState(1); // the scale the camera last settled at (the HUD greys out + / - at the ends)
  const enabled = narrow && mode !== 'off';

  // ---- facts for the policy ------------------------------------------------------------------------------------
  const moveFromRef = useRef(null); // where the pawn stood before the move that is playing now
  const decisionCard = useContext(PhoneBoardContext); // portrait phone table: the buy prompt is a card over the board
  const sit = situationOf(session, { mode, reduced, speed, moveFrom: moveFromRef.current, decisionCard });
  const sitKey = situationKey(sit);
  const sitRef = useRef(sit);
  sitRef.current = sit;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ---- measure the board: narrow or not -------------------------------------------------------------------------
  useIsoLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.offsetWidth;
      setNarrow(w > 0 && w <= NARROW_MAX);
      ctrlRef.current?.setSize(w, el.offsetHeight);
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // ---- the engine: one transform on the layer, written from rAF ------------------------------------------------
  const focusTile = useRef(null);
  const pausedRef = useRef(false); // the user has taken over (until Fit / next turn / RESUME_MS without a touch)
  const suppressRef = useRef(false); // Fit was pressed mid-shot: no automatic zoom until the overview comes round
  const targetRef = useRef(null);
  const resumeTimer = useRef(0);
  const recheckTimer = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = viewportRef.current;
    const layer = layerRef.current;
    if (!el || !layer) return undefined;
    const ctrl = createCameraController({
      apply: ({ s, tx, ty, moving }) => {
        if (s <= 1.0005 && !moving) {
          layer.style.transform = '';
          layer.style.willChange = '';
          delete el.dataset.lens;
          return;
        }
        el.dataset.lens = ''; // clip tightly while the content is scaled
        if (moving) {
          layer.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
          layer.style.willChange = 'transform';
        } else {
          // settled: a plain 2D transform on whole device pixels, no layer promotion, so the text is rasterised crisp
          const dpr = window.devicePixelRatio || 1;
          const snap = (v) => Math.round(v * dpr) / dpr;
          layer.style.transform = `translate(${snap(tx)}px, ${snap(ty)}px) scale(${s.toFixed(4)})`;
          layer.style.willChange = '';
        }
      },
      onZoomChange: (z) => {
        setZoomed(z);
        setAnnounce(announceFor(z, focusTile.current));
      },
      onSettle: (cam) => setLevel(Math.round(cam.s * 100) / 100),
    });
    ctrl.setSize(el.offsetWidth, el.offsetHeight);
    ctrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      ctrlRef.current = null;
      layer.style.transform = '';
      layer.style.willChange = '';
      delete el.dataset.lens;
      setZoomed(false);
      setLevel(1);
    };
  }, [enabled]);

  useEffect(
    () => () => {
      clearTimeout(resumeTimer.current);
      clearTimeout(recheckTimer.current);
    },
    [],
  );

  // ---- the automatic camera ----------------------------------------------------------------------------------
  const applyShot = useCallback((d) => {
    const ctrl = ctrlRef.current;
    if (!ctrl || d.kind === 'off' || d.kind === 'none') return;
    const spd = sitRef.current.speed;
    if (d.kind === 'overview') {
      targetRef.current = null;
      focusTile.current = null;
      ctrl.setTarget(FIT, { smooth: smoothFor(d, spd) });
      return;
    }
    const point = boardPoint(d.tile);
    const next = d.kind === 'follow' ? followCam(targetRef.current, point, d.scale) : focusCam(point, d.scale, AUTO_MAX_SCALE);
    targetRef.current = next;
    // a screen reader hears the tile for a hold / pan / decision; "Zoomed in" is enough while the camera tracks a pawn
    focusTile.current = d.kind === 'follow' ? null : d.tile;
    if (focusTile.current !== null) setAnnounce(announceFor(true, focusTile.current));
    setEdge(inTopBand(next, point) ? 'bottom' : 'top');
    ctrl.setTarget(next, { smooth: smoothFor(d, spd) });
  }, []);

  const run = useCallback(() => {
    if (!ctrlRef.current) return;
    const { directive, recheckIn } = directorRef.current.update(sitRef.current, performance.now());
    clearTimeout(recheckTimer.current);
    if (recheckIn != null) recheckTimer.current = setTimeout(run, recheckIn + 4);
    if (pausedRef.current) return;
    if (suppressRef.current) {
      if (directive.kind !== 'overview') return;
      suppressRef.current = false;
    }
    applyShot(directive);
  }, [applyShot]);

  // a new turn gives control back to the automatic camera
  useEffect(() => {
    pausedRef.current = false;
    suppressRef.current = false;
    clearTimeout(resumeTimer.current);
  }, [sit.actor]);

  // the square the pawn stood on before it started moving (for the long-trip check)
  useEffect(() => {
    if (!sit.moving) moveFromRef.current = sit.pos;
  }, [sit.moving, sit.pos]);

  useEffect(() => {
    if (!enabled) return;
    if (reduced && !pausedRef.current) ctrlRef.current?.setTarget(FIT, { instant: true }); // reduced motion: never leave the view zoomed on its own
    run();
  }, [enabled, sitKey, run, reduced]);

  // ---- manual control ----------------------------------------------------------------------------------------
  const touchStart = useCallback(() => {
    pausedRef.current = true;
    clearTimeout(resumeTimer.current);
  }, []);
  const touchEnd = useCallback(() => {
    clearTimeout(resumeTimer.current);
    if (modeRef.current !== 'auto') return;
    resumeTimer.current = setTimeout(() => {
      pausedRef.current = false;
      targetRef.current = null;
      run(); // from wherever the user left the view, back towards the policy
    }, CAMERA.RESUME_MS);
  }, [run]);

  const goTo = useCallback((cam, smooth = 0.3) => ctrlRef.current?.setTarget(cam, { smooth, instant: reducedRef.current }), []);

  const fit = useCallback(() => {
    pausedRef.current = false;
    clearTimeout(resumeTimer.current);
    targetRef.current = null;
    suppressRef.current = ['follow', 'pan', 'land', 'decision'].includes(directorRef.current.current().kind);
    goTo(FIT, smoothFor({ kind: 'overview' }, sitRef.current.speed));
  }, [goTo]);

  const step = useCallback(
    (dir) => {
      const ctrl = ctrlRef.current;
      if (!ctrl) return;
      touchStart();
      goTo(zoomStep(ctrl.getCam(), dir), 0.25);
      touchEnd();
    },
    [goTo, touchStart, touchEnd],
  );

  useBoardGestures(viewportRef, {
    enabled,
    getCam: () => ctrlRef.current?.getCam() || FIT,
    onBegin: () => {
      ctrlRef.current?.freeze(); // the finger takes the view exactly where it is
      touchStart();
    },
    onCam: (cam) => ctrlRef.current?.drag(cam),
    onEnd: (velocity) => {
      const ctrl = ctrlRef.current;
      if (ctrl) {
        ctrl.release(velocity, { inertia: !reducedRef.current });
        if (ctrl.getCam().s <= ZOOMED_AT) goTo(FIT, 0.3); // pinched (almost) all the way out: snap to the whole board
      }
      touchEnd();
    },
    onDoubleTap: ({ x, y }) => {
      const ctrl = ctrlRef.current;
      const el = viewportRef.current;
      if (!ctrl || !el) return;
      const next = doubleTapCam(ctrl.getCam(), x, y, el.offsetWidth, el.offsetHeight);
      if (next.s <= 1) {
        fit();
        return;
      }
      touchStart();
      goTo(next, 0.32);
      touchEnd();
    },
    onKey: (action, dx, dy) => {
      const ctrl = ctrlRef.current;
      if (!ctrl) return false;
      if (action === 'in') step(1);
      else if (action === 'out') step(-1);
      else if (action === 'fit') fit();
      else if (action === 'pan') {
        if (!ctrl.isZoomed()) return false;
        touchStart();
        goTo(panStep(ctrl.getCam(), dx, dy), 0.18);
        touchEnd();
      }
      return true;
    },
  });

  // ---- render ---------------------------------------------------------------------------------------------------
  const hud = enabled ? hudModel(session) : null;
  return (
    <div
      ref={viewportRef}
      className="bc"
      data-bc-viewport=""
      data-camera={enabled ? mode : 'off'}
      data-zoomed={zoomed ? '' : undefined}
      tabIndex={enabled ? 0 : undefined}
      role={enabled ? 'group' : undefined}
      aria-label={enabled ? 'Board. Plus and minus zoom, arrow keys pan, zero shows the whole board.' : undefined}
    >
      <div className="bc-layer" ref={layerRef}>
        {children}
      </div>
      {enabled ? (
        <CameraHud
          on={zoomed}
          text={hud?.text || ''}
          token={zoomed && hud?.player ? <AvatarToken session={session} player={hud.player} size={26} /> : null}
          edge={edge}
          announce={announce}
          canIn={level < 2.99}
          canOut={level > 1.01}
          onIn={() => step(1)}
          onOut={() => step(-1)}
          onFit={fit}
        />
      ) : null}
    </div>
  );
}

export { BoardCamera };
