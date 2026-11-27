// OWNER: customisation agent. Makes the workshop catalogue real on the auto (paint, plate, lights, props, rear parts...) and plays
// the horn. `applyLoadout(auto, loadout)` is idempotent and cheap: it diffs against what the auto already wears and rebuilds only
// the parts whose loadout fields changed (a preview that swaps one colour touches one material). Everything it creates is tracked
// and disposed when replaced, so flicking through the garage never leaks.
//
// Events consumed (ctx.game.on):  loadout { loadout, preview }  -> re-apply;  honk -> play the saved horn.
import { Color, HalfFloatType, MeshBasicMaterial, PMREMGenerator, PerspectiveCamera, WebGLRenderTarget } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { playHorn, stopHorn } from '../audio/horns.js';
import {
  GLOW_MAX,
  diffLoadout,
  finishParams,
  mudflapText,
  resolveLook,
  tintSpec,
  underglowRgb,
  hslInto,
  FIELDS,
} from './custom-logic.js';
import {
  disposeTexture,
  makeBannerTexture,
  makeCurtainTexture,
  makeMudflapTexture,
  makePlateTexture,
  makePoolTexture,
  makeSeatTexture,
  makeStripeTexture,
} from './custom-art.js';
import { makeBadgeTexture, makeCoverTexture, makeFlapTexture, makeRearWindowTexture, makeSwishTexture } from './custom-art-rear.js';
import { buildDashGarland, buildDashToy, buildRoofProp } from './custom-props.js';
import { buildAntenna, buildBumper, buildLadder, buildSideGuards } from './custom-rear.js';
import { find, STRIPES } from '../gameplay/catalog.js';
import { CANOPY_LIFT, canopyScales } from './auto-canopy.js';
import { installPersonWarmup } from './person-mesh.js';

export { diffLoadout, FIELDS };

const _rgb = [0, 0, 0]; // scratch for the per-frame rainbow (no allocation)
const GLOW_BASE = 1.2; // underglow tube brightness (<= GLOW_MAX)

// ------------------------------------------------------------------------------------------------------------ bookkeeping

/** Per-auto customisation state, kept on auto.userData.custom. */
function stateOf(auto) {
  const ud = auto.userData;
  if (!ud.custom) {
    ud.custom = {
      applied: null, // the normalised loadout the auto wears now
      res: {}, // key -> [() => void] disposers of what was built for that key
      anims: {}, // key -> (env) => void
      animList: [], // the same functions as a flat array (no per-frame allocation)
      envMap: null,
      envScale: 0,
      envMats: new Set(),
      tail: [1, 0.16, 0.23],
      under: null,
      cover: null,
      canopy: false,
      poolTex: null,
    };
  }
  return ud.custom;
}

const own = (st, key, fn) => {
  (st.res[key] ||= []).push(fn);
};
function free(st, key) {
  const list = st.res[key];
  if (!list) return;
  st.res[key] = [];
  for (const fn of list) {
    try {
      fn();
    } catch {
      /* already gone */
    }
  }
  delete st.anims[key];
  st.animList = Object.values(st.anims);
}

/** Put (or clear) a texture on a material slot, disposing the previous one. Flags a shader rebuild only when the slot toggles. */
function setMap(m, slot, tex, st, key) {
  const had = !!m[slot];
  free(st, key);
  m[slot] = tex || null;
  if (tex) own(st, key, () => disposeTexture(tex));
  if (had !== !!tex) m.needsUpdate = true;
}

/** Mount a prop {group, update, dispose} under `parent` (replacing whatever `key` held). Returns the prop or null. */
function mountProp(st, key, parent, prop) {
  free(st, key);
  if (!prop) return null;
  parent.add(prop.group);
  // bolt-on parts are thin and sit under or beside the big shell parts, so they never cast a shadow (each caster is a draw call in the shadow pass)
  prop.group.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  own(st, key, () => {
    parent.remove(prop.group);
    prop.dispose();
  });
  st.anims[key] = prop.update;
  st.animList = Object.values(st.anims);
  // props are built with their own materials: make them pick up the environment like the rest of the auto
  st.dirtyEnv = true;
  return prop;
}

const hex3 = (hex, k = 1) => new Color(hex).multiplyScalar(k);

// ------------------------------------------------------------------------------------------------------------ applying

/**
 * Dress `auto` in `loadout` (any shape: it is normalised first, junk falls back to the stock look). Returns the list of loadout
 * fields that actually changed. `opts.force` rebuilds everything. Safe to call every frame (a no-op when nothing changed).
 */
export function applyLoadout(auto, loadout, opts = {}) {
  const ud = auto && auto.userData;
  if (!ud || !ud.paint) return [];
  const look = resolveLook(loadout);
  const st = stateOf(auto);
  const changed = opts.force ? [...FIELDS] : diffLoadout(st.applied, look.loadout);
  if (!changed.length) return [];
  const has = (...keys) => keys.some((k) => changed.includes(k));
  const L = look.loadout;
  const detail = !!ud.detail;
  const step = (name, fn) => {
    try {
      fn();
    } catch (err) {
      console.error(`[autowala] customisation step "${name}" failed`, err);
    }
  };

  // ---- paint: colour + finish (clearcoat / metal / pearl sheen), roof colour
  if (has('paint.body', 'paint.finish')) {
    step('paint', () => {
      const p = ud.paint;
      const f = finishParams(look.finish.id);
      p.color.set(look.body.hex);
      p.roughness = f.roughness;
      p.metalness = f.metalness;
      if (p.isMeshPhysicalMaterial) {
        p.clearcoat = f.clearcoat;
        p.clearcoatRoughness = f.clearcoatRoughness;
        const wasFancy = p.sheen > 0 || p.iridescence > 0;
        p.sheen = f.sheen ? 1 : 0;
        p.sheenRoughness = 0.4;
        p.sheenColor.set(look.body.hex).lerp(new Color('#ffffff'), 0.55);
        p.iridescence = f.iridescence;
        p.iridescenceIOR = 1.35;
        p.iridescenceThicknessMinimum = 180;
        p.iridescenceThicknessMaximum = 480;
        if (wasFancy !== (f.sheen || f.iridescence > 0)) p.needsUpdate = true;
      }
      p.userData.envK = f.envK;
      st.dirtyEnv = true;
    });
  }
  // (traffic autos share most materials: they only take a body paint, everything else needs the player's rig)
  if (detail && has('paint.roof')) ud.roofM.color.set(look.roof.hex);

  // ---- curtains, seats, tint, wheels (all available on every auto)
  if (detail && has('curtains')) {
    step('curtains', () => {
      const c = look.curtain;
      const m = ud.curtainM;
      if (c.pattern) {
        m.color.set('#ffffff');
        setMap(m, 'map', makeCurtainTexture(c.pattern, c.hex), st, 'curtains');
      } else {
        m.color.set(c.hex);
        setMap(m, 'map', null, st, 'curtains');
      }
    });
  }
  if (detail && has('interior.seats')) {
    step('seats', () => {
      const s = look.seat;
      if (s.pattern === 'leopard') {
        ud.seatM.color.set('#ffffff');
        setMap(ud.seatM, 'map', makeSeatTexture(s.hex), st, 'seats');
      } else {
        ud.seatM.color.set(s.hex);
        setMap(ud.seatM, 'map', null, st, 'seats');
      }
    });
  }
  if (detail && has('tint')) {
    const t = tintSpec(look.tint.id);
    ud.glassM.color.set(t.color);
    ud.glassM.opacity = t.opacity;
  }
  if (detail && has('wheels')) {
    step('wheels', () => {
      const w = look.wheel;
      ud.rimM.color.set(w.hex);
      ud.rimM.metalness = w.metalness;
      ud.rimM.roughness = w.metalness > 0.8 ? 0.2 : 0.4;
      ud.rimM.emissive.set(w.glow ? w.hex : '#000000');
      ud.rimM.emissiveIntensity = w.glow ? 1.4 : 0;
      ud.rimM.userData.envK = w.metalness > 0.8 ? 1.1 : 0.4;
      ud.spokeM.color.set(w.hex).multiplyScalar(w.glow ? 0.5 : 0.62);
      ud.spokeM.metalness = w.metalness;
      ud.spokeM.emissive.set(w.glow ? w.hex : '#000000');
      ud.spokeM.emissiveIntensity = w.glow ? 0.9 : 0;
      for (const part of ud.wheelParts || []) for (const wh of part.whites) wh.visible = !!w.whitewall;
    });
  }

  // ---- lamps
  if (detail && has('lights.head')) {
    ud.hlM.color.set(look.head.hex).multiplyScalar(2.2);
    ud.headlight?.color.set(look.head.hex);
  }
  if (detail && has('lights.tail')) {
    const c = new Color(look.tail.hex);
    st.tail = [c.r, c.g, c.b];
    ud.tailRefM?.color.copy(c).lerp(new Color('#ffffff'), 0.55).multiplyScalar(0.95);
    if (!st.live) ud.tailLampM.color.copy(c).multiplyScalar(0.95); // before the game loop drives it
  }

  if (detail) {
    // ---- plates (rear + front share one texture), banner, rear window, badge
    if (has('plate.text', 'plate.style')) {
      step('plate', () => {
        const tex = makePlateTexture(L.plate.text, look.plateStyle.id);
        const glow = !!look.plateStyle.glow;
        free(st, 'plate');
        for (const m of [ud.plateRearM, ud.plateFrontM]) {
          const had = !!m.map;
          m.map = tex;
          m.emissiveMap = glow ? tex : null;
          m.emissive.set(glow ? '#ffffff' : '#000000');
          m.emissiveIntensity = glow ? 1.15 : 0;
          if (!had || m.userData.glow !== glow) m.needsUpdate = true;
          m.userData.glow = glow;
        }
        own(st, 'plate', () => disposeTexture(tex));
      });
    }
    if (has('decals.banner')) step('banner', () => setMap(ud.bannerM, 'map', makeBannerTexture(L.decals.banner), st, 'banner'));
    if (has('decals.rearWindow', 'decals.rearWindowFrame')) {
      step('rearWindow', () => setMap(ud.rearWin.centerM, 'map', makeRearWindowTexture(L.decals.rearWindow, look.frame.id), st, 'rearWindow'));
    }
    if (has('decals.badge')) step('badge', () => setMap(ud.badgeM, 'map', makeBadgeTexture(L.decals.badge), st, 'badge'));

    // ---- engine cover: louvres / mesh / grille / jali / royal (painted door + art) or a glowing LED panel
    if (has('rear.cover')) {
      step('cover', () => {
        const cv = ud.cover;
        const id = look.cover.id;
        const led = id.startsWith('led-');
        free(st, 'cover');
        const tex = makeCoverTexture(id);
        own(st, 'cover', () => disposeTexture(tex));
        if (led) {
          const m = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
          cv.face.material = m;
          own(st, 'cover', () => {
            cv.face.material = cv.faceM;
            m.dispose();
          });
          st.cover = look.cover.cycle ? { cycle: true } : { rgb: hex3(look.cover.hex, 1.1) };
          if (!look.cover.cycle) m.color.copy(st.cover.rgb);
        } else {
          cv.face.material = cv.faceM;
          cv.faceM.map = tex;
          cv.faceM.needsUpdate = true;
          own(st, 'cover', () => {
            cv.faceM.map = null;
          });
          st.cover = null;
        }
        cv.emblem.visible = !led && id !== 'royal';
      });
    }

    // ---- stripes: side planes, or the rainbow swish on the rear pillars
    if (has('decals.stripe')) {
      step('stripe', () => {
        const id = look.stripe.id;
        const { left, right, material } = ud.stripes;
        const sw = ud.swish;
        free(st, 'stripe');
        left.visible = right.visible = sw.left.visible = sw.right.visible = false;
        if (id === 'rainbow-swish') {
          const tex = makeSwishTexture(find(STRIPES, id)?.colors);
          sw.material.map = tex;
          sw.material.needsUpdate = true;
          own(st, 'stripe', () => {
            sw.material.map = null;
            disposeTexture(tex);
          });
          sw.left.visible = sw.right.visible = true;
        } else if (id !== 'none') {
          const tex = makeStripeTexture(id);
          if (tex) {
            material.map = tex;
            material.needsUpdate = true;
            own(st, 'stripe', () => {
              material.map = null;
              disposeTexture(tex);
            });
            left.visible = right.visible = true;
          }
        }
      });
    }

    // ---- mud-flaps (art behind the wheels) and the message apron
    if (has('rear.flaps')) {
      step('flaps', () => {
        const m = ud.flaps.decalM;
        const tex = makeFlapTexture(look.flaps.id);
        setMap(m, 'map', tex, st, 'flaps');
      });
    }
    if (has('decals.mudflap')) {
      step('apron', () => {
        const text = mudflapText(look.mudflap.id);
        const mg = ud.mudguard;
        mg.group.visible = !!text;
        setMap(mg.textM, 'map', text ? makeMudflapTexture(text) : null, st, 'apron');
      });
    }

    // ---- rear parts
    if (has('rear.bumper')) step('bumper', () => mountProp(st, 'bumper', ud.bumperMount, buildBumper(look.bumper.id)));
    if (has('rear.ladder')) step('ladder', () => mountProp(st, 'ladder', ud.rearMount, L.rear.ladder ? buildLadder() : null));
    if (has('rear.antenna', 'roofStyle')) {
      step('antenna', () => {
        const p = mountProp(st, 'antenna', ud.rearMount, L.rear.antenna ? buildAntenna() : null);
        if (p) p.group.position.y = look.roofStyle.id === 'high-canopy' ? CANOPY_LIFT : 0;
      });
    }
    if (has('rear.sideGuards')) step('guards', () => mountProp(st, 'guards', ud.rearMount, L.rear.sideGuards ? buildSideGuards() : null));

    // ---- roof style: props on the roof, or the raised canopy
    if (has('roofStyle')) {
      step('roofStyle', () => {
        const id = look.roofStyle.id;
        mountProp(st, 'roofStyle', ud.roofMount, buildRoofProp(id));
        setCanopy(ud, st, id === 'high-canopy');
      });
    }

    // ---- dash: bobblehead, windscreen garland
    if (has('decals.dash')) step('toy', () => mountProp(st, 'toy', ud.dashAnchor, buildDashToy(look.toy.id)));
    if (has('interior.garland')) step('garland', () => mountProp(st, 'garland', ud.garlandAnchor, L.interior.garland ? buildDashGarland() : null));

    // ---- underglow
    if (has('lights.under')) {
      step('under', () => {
        const ug = ud.underglow;
        const rgb = underglowRgb(look.under, 0);
        st.under = rgb ? { cycle: !!look.under.cycle, rgb } : null;
        ug.group.visible = !!rgb;
        if (rgb && !ug.poolM.map) {
          st.poolTex = makePoolTexture();
          ug.poolM.map = st.poolTex;
          ug.poolM.needsUpdate = true;
        }
        if (rgb) paintUnderglow(ud, st, rgb, st.night || 0);
      });
    }
  }

  st.applied = JSON.parse(JSON.stringify(L));
  ud.syncParts?.(); // (the player's rig: show the textured stand-ins a pattern / LED cover needs, see autoModel.js)
  if (st.dirtyEnv) refreshEnv(auto);
  return changed;
}

/**
 * High canopy: lift the roof and stretch the posts, rear panel and windscreen to meet it, so there is no gap. The merged roof / chrome /
 * trim / curtain meshes swap to their canopy bake (autoModel.js); the nodes that carry decals and mounted props (roof, rear panel,
 * window, windscreen glass, garland) move as before.
 */
function setCanopy(ud, st, on) {
  if (st.canopy === on) return;
  st.canopy = on;
  const lift = on ? CANOPY_LIFT : 0;
  const k = canopyScales(CANOPY_LIFT);
  ud.canopyGeometry?.(on);
  ud.roofGroup.position.y = lift;
  const s = on ? k.upper : 1;
  ud.upperGroup.scale.y = s;
  ud.upperGroup.position.y = 1.05 * (1 - s);
  ud.windowGroup.position.y = lift / 2;
  ud.glass.scale.y = on ? k.glass : 1;
  ud.glass.position.y = 1.745 + lift / 2;
  ud.garlandAnchor.position.y = lift;
}

function paintUnderglow(ud, st, rgb, night) {
  const ug = ud.underglow;
  // gentle neon: tubes a little over 1, the road pool brighter at night and faint in daylight
  const tube = Math.min(GLOW_MAX, GLOW_BASE);
  ug.tubeM.color.setRGB(rgb[0] * tube, rgb[1] * tube, rgb[2] * tube);
  const pool = 0.22 + 0.7 * night;
  ug.poolM.color.setRGB(rgb[0] * pool, rgb[1] * pool, rgb[2] * pool);
}

// ------------------------------------------------------------------------------------------------------------ environment

/** (Re)apply the environment map and per-material strength to every standard material on the auto. */
function refreshEnv(auto) {
  const st = stateOf(auto);
  st.dirtyEnv = false;
  st.envMats.clear();
  const take = (m) => {
    if (!m.isMeshStandardMaterial) return;
    st.envMats.add(m);
    if (m.envMap !== st.envMap) {
      m.envMap = st.envMap;
      m.needsUpdate = true;
    }
  };
  auto.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) take(m);
  });
  // the player's part materials that are data for the merged meshes (not on a mesh): their per-part env strength is still read
  for (const m of auto.userData.envBag || []) take(m);
  st.envScale = -1; // force the per-material intensities to refresh on the next update
  setEnvIntensity(auto, st.envLevel ?? 1);
}

/** envMapIntensity = material strength x level (level falls at night so the dusk and night lighting is not washed out). */
function setEnvIntensity(auto, level) {
  const st = stateOf(auto);
  if (Math.abs(level - st.envScale) < 0.015) return;
  st.envScale = level;
  for (const m of st.envMats) {
    const k = m.userData.envK ?? (m.metalness >= 0.7 ? 0.9 : m.transparent ? 0.6 : 0.3);
    m.envMapIntensity = k * 0.32 * level;
  }
}

/**
 * Start building the environment map's room shaders now, in the background: rendering the room is the first draw of its three or four
 * materials, and each first draw waits for the driver to compile and link (~100-300 ms apiece). Started at the beginning of the game's
 * boot, the driver has finished by the time `attachEnvironment` runs. Returns what to hand to it, or null (then it just does it all itself).
 */
export function prepareEnvironment(renderer) {
  try {
    const pm = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    // the room is drawn into a render target (PMREM's cube): a different program variant from drawing to the canvas
    const target = new WebGLRenderTarget(2, 2, { type: HalfFloatType });
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try {
      renderer.compile(room, new PerspectiveCamera(90, 1, 0.1, 100));
    } finally {
      renderer.setRenderTarget(prev);
    }
    return { pm, room, target };
  } catch {
    return null;
  }
}

/** Give the auto a subtle image-based reflection (PMREM of a neutral room). `prepared` comes from `prepareEnvironment`. Returns a disposer. */
export function attachEnvironment(auto, renderer, prepared = null) {
  const st = stateOf(auto);
  let pm = null;
  try {
    pm = prepared?.pm || new PMREMGenerator(renderer);
    const room = prepared?.room || new RoomEnvironment();
    st.envMap = pm.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  } catch (err) {
    console.warn('[autowala] environment map unavailable', err);
    st.envMap = null;
  } finally {
    pm?.dispose();
    prepared?.target?.dispose();
  }
  refreshEnv(auto);
  return () => {
    st.envMap?.dispose?.();
    st.envMap = null;
    refreshEnv(auto);
  };
}

// ------------------------------------------------------------------------------------------------------------ per-frame

/** Advance every animated part: env = { t, dt, speed, hornTime, jolt, night, braking }. */
export function updateCustomization(auto, env) {
  const ud = auto?.userData;
  const st = ud?.custom;
  if (!st) return;
  st.live = true;
  st.night = env.night;
  ud.syncParts?.();
  const anims = st.animList;
  for (let i = 0; i < anims.length; i++) anims[i](env);

  // tail lamps: the chosen colour, brighter on the brake (Game writes ud.tailM; the visible lamps are tailLampM)
  const k = env.braking ? 2.4 : 0.95;
  ud.tailLampM.color.setRGB(st.tail[0] * k, st.tail[1] * k, st.tail[2] * k);

  if (ud.detail) {
    if (st.under) {
      const u = st.under;
      const rgb = u.cycle ? hslInto(_rgb, env.t / 8, 0.95, 0.55) : u.rgb;
      paintUnderglow(ud, st, rgb, env.night);
    }
    if (st.cover?.cycle && ud.cover.face.material.isMeshBasicMaterial) {
      const c = hslInto(_rgb, env.t / 8, 0.95, 0.55);
      ud.cover.face.material.color.setRGB(c[0] * 1.1, c[1] * 1.1, c[2] * 1.1);
    }
  }
  setEnvIntensity(auto, 0.5 + 0.5 * (1 - env.night));
  if (st.dirtyEnv) refreshEnv(auto);
}

// ------------------------------------------------------------------------------------------------------------ teardown

/** Free everything customisation built on this auto (textures, props, environment). The auto's own base parts are not touched. */
export function disposeCustomization(auto) {
  const st = auto?.userData?.custom;
  if (!st) return;
  for (const key of Object.keys(st.res)) free(st, key);
  if (st.poolTex) {
    disposeTexture(st.poolTex);
    st.poolTex = null;
  }
  if (st.envMap) {
    st.envMap.dispose?.();
    st.envMap = null;
  }
  st.envMats.clear();
  st.applied = null;
}

// ------------------------------------------------------------------------------------------------------------ the system

export function installCustomization(ctx) {
  const auto = ctx.auto;
  const ud = auto?.userData;
  if (!ud) return;
  const profile = ctx.profile;

  installPersonWarmup(ctx); // (the customers' shader is compiled with everything else at boot)
  let disposeEnv = () => {};
  try {
    disposeEnv = attachEnvironment(auto, ctx.gfx.renderer, ctx.envPrep);
  } catch (err) {
    console.warn('[autowala] customisation environment failed', err);
  }
  applyLoadout(auto, profile.data.loadout, { force: true });

  const env = { t: 0, dt: 0, speed: 0, hornTime: 0, jolt: 0, night: 0, braking: false };
  const off = ctx.game.on((e) => {
    if (e.type === 'loadout') {
      applyLoadout(auto, e.loadout || profile.data.loadout);
    } else if (e.type === 'honk') {
      playHorn(profile.data.loadout?.horn);
    }
  });

  const sys = {
    update(dt) {
      env.t = ctx.clock.time;
      env.dt = dt;
      env.speed = ctx.v.speed;
      env.hornTime = ctx.v.hornTime;
      env.jolt = ctx.v.jolt;
      env.braking = ctx.v.braking;
      env.night = ctx.world?.sky?.state?.night ?? 0;
      updateCustomization(auto, env);
    },
    dispose() {
      off();
      stopHorn();
      disposeEnv();
      disposeCustomization(auto);
    },
  };
  ctx.addSystem(sys);
}

