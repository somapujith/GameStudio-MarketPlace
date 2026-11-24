// Street set dressing: buildStreetProp(id, opts) -> { group, id, update(dt, t), dispose(), ... }.
// Original ids: lpg, tiffin-drum, batter-bucket, plate-stack, stool, bench, thela, tube-light, pole-with-wires, panipuri-cart,
// auto-rickshaw ({body, roof}), scooter ({body}), dog, cow, flex-banner ({text, te, colors:[bg, ink, accent], width}), money-box.
// Extra ids (STREET_EXTRA_IDS): motorbike, tin-roof, tarpaulin, bamboo-pole, brick-wall, footpath, road, shutter, banana-bunch,
// lemon-chilli, hoarding, film-poster, wall-advert, signboard, bulb-string, newspaper-basket, jute-sacks, cable-tangle.
// Origin = ground centre, front = +z (rotate for traffic). Static geometry is merged, UV-mapped, cached and shared (street-kit.js bundles);
// materials are shared PBR sets (materials-street.js). dispose() frees only what the instance owns.
import { Group } from 'three';
import { disposeObject, getTextureQuality, num } from './util.js';
import { Kit, bundleTriangles, getBundle, instantiate } from './street-kit.js';
import { PROPS_A } from './street-props.js';
import { PROPS_VEH } from './street-vehicles.js';
import { PROPS_ANIMALS } from './street-animals.js';
import { PROPS_MISC } from './street-misc.js';
import { PROPS_ENV } from './street-env.js';

const DEFS = { ...PROPS_A, ...PROPS_VEH, ...PROPS_ANIMALS, ...PROPS_MISC, ...PROPS_ENV };

/** Register more defs (street-*.js sets register themselves through this when imported by street.js). */
export function registerStreetProps(defs) {
  Object.assign(DEFS, defs);
}

export const STREET_PROP_IDS = ['lpg', 'tiffin-drum', 'batter-bucket', 'plate-stack', 'stool', 'bench', 'thela', 'tube-light', 'pole-with-wires', 'panipuri-cart', 'auto-rickshaw', 'scooter', 'dog', 'cow', 'flex-banner', 'money-box'];
export const STREET_EXTRA_IDS = ['motorbike', 'tin-roof', 'tarpaulin', 'bamboo-pole', 'brick-wall', 'footpath', 'road', 'shutter', 'banana-bunch', 'lemon-chilli', 'hoarding', 'film-poster', 'wall-advert', 'signboard', 'bulb-string', 'newspaper-basket', 'jute-sacks', 'cable-tangle'];
export const STREET_ALL_IDS = [...STREET_PROP_IDS, ...STREET_EXTRA_IDS];

/** Triangle count of one prop's cached geometry (all instances share it). 0 when unknown. */
export function streetPropTriangles(id, opts = {}) {
  const def = DEFS[id];
  if (!def) return 0;
  return bundleTriangles(getBundle(bundleKey(id, def, opts), () => makeBundle(def, opts)));
}

const bundleKey = (id, def, opts) => `street:${id}:${def.key ? def.key(opts) : ''}:q${getTextureQuality()}`;
function makeBundle(def, opts) {
  const k = new Kit();
  const bo = def.build(k, opts) || {};
  return k.build(bo);
}

/** buildStreetProp(id, opts) */
export function buildStreetProp(id, opts = {}) {
  const group = new Group();
  group.name = `street-${id}`;
  group.userData.prop = id;
  const ticks = [];
  const owned = [];
  const api = {
    anim: (fn) => ticks.push(fn),
    own: (r) => owned.push(r),
  };
  const out = { group, id };
  const def = DEFS[id];
  if (def) {
    const bundle = getBundle(bundleKey(id, def, opts), () => makeBundle(def, opts));
    const inst = instantiate(bundle, group);
    if (def.rig) def.rig({ group, sub: inst.sub, out }, opts, api);
    if (def.extra) def.extra(group, opts, api, out);
  }
  let disposed = false;
  out.update = (dt, t) => {
    if (disposed) return;
    const d = num(dt, 0);
    const tt = num(t, 0);
    for (const fn of ticks) fn(d, tt);
  };
  out.dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeObject(group);
    for (const r of owned) r.dispose?.();
  };
  return out;
}
