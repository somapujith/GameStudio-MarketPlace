// The post-processing pipeline (medium and high tiers). Everything is hand-rolled so each effect costs only what it must:
//   scene (HDR, MSAA on high, depth texture)  ->  [high] depth-of-field  ->  bloom (dual-Kawase pyramid, thresholded on emissives and sun glints)
//   -> final: ambient occlusion (high) x scene + bloom, exposure, filmic tone map (AgX), daypart colour grade, heat shimmer, chromatic fringe,
//      vignette, film grain, sRGB  ->  [medium] FXAA  ->  canvas.
// GTAO-lite: a 12-tap horizon-ish occlusion from the depth buffer at half resolution with a depth-aware blur; no second geometry pass.
//
// DYNAMIC RESOLUTION WITHOUT RE-ALLOCATION (src/platform/gfx/dynamicRes.js, docs/GFX_ENGINE.md section 5): every target is allocated ONCE, at the size the
// tier asks for (css size x min(tier pixel ratio, device ratio)); a render scale below 1 renders into the lower-left `scale x scale` sub-rect of each
// (viewport + scissor, free) and every fetch from a target goes through `dynUv()`, which maps the virtual uv of the smaller picture to the allocated texture
// and keeps taps inside the used area. Texel-size uniforms are computed from the USED size. A scale step is therefore a few uniform writes: no setSize, no
// target re-creation, no program change. The last pass (FXAA, or the final composite on high) draws on the canvas at full size and upsamples the used
// sub-rect with the target's linear filter.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DepthTexture, HalfFloatType, LinearFilter, NoBlending, NoColorSpace, OrthographicCamera, RGBAFormat,
  ShaderMaterial, UnsignedByteType, Vector2, WebGLRenderTarget, DataTexture, UnsignedIntType, DepthFormat, Scene, Mesh,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { DYNRES_GLSL, createDynamicRes, rewriteSamples } from '../../../platform/gfx/dynamicRes.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// FXAA (the edge-search variant of three's FXAAShader, rewritten): every fetch is an explicit-LOD `textureLod`, so the search loops do not need screen-space
// derivatives (the D3D compiler warned "gradient instruction used in a loop with varying iteration" and took a slow path for three's version), and the four
// corner taps are only fetched for the pixels that sit on an edge (most of the picture returns after five taps).
const FXAA_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse; uniform vec2 resolution;
  varying vec2 vUv;
  const float EDGE_STEPS[6] = float[6](1.0, 1.5, 2.0, 2.0, 2.0, 4.0);
  const float EDGE_GUESS = 8.0;
  float lumaAt(vec2 uv) { return dot(textureLod(tDiffuse, dynUv(uv), 0.0).rgb, vec3(0.3, 0.59, 0.11)); }
  void main() {
    vec2 uv = vUv; vec2 t = resolution;
    vec4 c0 = textureLod(tDiffuse, dynUv(uv), 0.0);
    float m = dot(c0.rgb, vec3(0.3, 0.59, 0.11));
    float n = lumaAt(uv + vec2(0.0, t.y)); float e = lumaAt(uv + vec2(t.x, 0.0));
    float s = lumaAt(uv - vec2(0.0, t.y)); float w = lumaAt(uv - vec2(t.x, 0.0));
    float hi = max(max(max(max(n, e), s), w), m); float lo = min(min(min(min(n, e), s), w), m);
    float contrast = hi - lo;
    if (contrast < max(0.0312, 0.063 * hi)) { gl_FragColor = c0; return; }
    float ne = lumaAt(uv + t); float nw = lumaAt(uv + vec2(-t.x, t.y)); float se = lumaAt(uv + vec2(t.x, -t.y)); float sw = lumaAt(uv - t);
    float f = (2.0 * (n + e + s + w) + ne + nw + se + sw) * (1.0 / 12.0);
    f = clamp(abs(f - m) / contrast, 0.0, 1.0);
    float pixelBlend = smoothstep(0.0, 1.0, f); pixelBlend *= pixelBlend;
    float horizontal = abs(n + s - 2.0 * m) * 2.0 + abs(ne + se - 2.0 * e) + abs(nw + sw - 2.0 * w);
    float vertical = abs(e + w - 2.0 * m) * 2.0 + abs(ne + nw - 2.0 * n) + abs(se + sw - 2.0 * s);
    bool isH = horizontal >= vertical;
    float pL = isH ? n : e; float nL = isH ? s : w;
    float pG = abs(pL - m); float nG = abs(nL - m);
    float pixelStep = isH ? t.y : t.x;
    float oppL; float grad;
    if (pG < nG) { pixelStep = -pixelStep; oppL = nL; grad = nG; } else { oppL = pL; grad = pG; }
    vec2 uvE = uv; vec2 stepV;
    if (isH) { uvE.y += pixelStep * 0.5; stepV = vec2(t.x, 0.0); } else { uvE.x += pixelStep * 0.5; stepV = vec2(0.0, t.y); }
    float edgeL = (m + oppL) * 0.5; float thr = grad * 0.25;
    vec2 puv = uvE + stepV * EDGE_STEPS[0];
    float pD = lumaAt(puv) - edgeL; bool pEnd = abs(pD) >= thr;
    for (int i = 1; i < 6; i++) { if (pEnd) break; puv += stepV * EDGE_STEPS[i]; pD = lumaAt(puv) - edgeL; pEnd = abs(pD) >= thr; }
    if (!pEnd) puv += stepV * EDGE_GUESS;
    vec2 nuv = uvE - stepV * EDGE_STEPS[0];
    float nD = lumaAt(nuv) - edgeL; bool nEnd = abs(nD) >= thr;
    for (int i = 1; i < 6; i++) { if (nEnd) break; nuv -= stepV * EDGE_STEPS[i]; nD = lumaAt(nuv) - edgeL; nEnd = abs(nD) >= thr; }
    if (!nEnd) nuv -= stepV * EDGE_GUESS;
    float pDist = isH ? puv.x - uv.x : puv.y - uv.y;
    float nDist = isH ? uv.x - nuv.x : uv.y - nuv.y;
    float shortest; bool dSign;
    if (pDist <= nDist) { shortest = pDist; dSign = pD >= 0.0; } else { shortest = nDist; dSign = nD >= 0.0; }
    float edgeBlend = (dSign == (m - edgeL >= 0.0)) ? 0.0 : 0.5 - shortest / (pDist + nDist);
    float blend = max(pixelBlend, edgeBlend);
    if (isH) uv.y += pixelStep * blend; else uv.x += pixelStep * blend;
    gl_FragColor = textureLod(tDiffuse, dynUv(uv), 0.0);
  }
`;

const LINEARIZE = /* glsl */ `
  uniform float uNear; uniform float uFar;
  float linZ(float d) { float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
`;

const AO_FRAG = /* glsl */ `
  uniform sampler2D tDepth; uniform vec2 uProj; uniform vec2 uInv; uniform float uRadius; uniform float uTime;
  varying vec2 vUv;
  ${LINEARIZE}
  vec3 viewPos(vec2 uv) { float z = linZ(textureLod(tDepth, dynUv(uv), 0.0).x); return vec3((uv * 2.0 - 1.0) * vec2(1.0 / uProj.x, 1.0 / uProj.y) * z, -z); }
  void main() {
    float d0 = textureLod(tDepth, dynUv(vUv), 0.0).x;
    if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewPos(vUv);
    vec3 pl = viewPos(vUv - vec2(uInv.x, 0.0)); vec3 pr = viewPos(vUv + vec2(uInv.x, 0.0));
    vec3 pu = viewPos(vUv + vec2(0.0, uInv.y)); vec3 pd = viewPos(vUv - vec2(0.0, uInv.y));
    vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
    vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
    vec3 n = normalize(cross(dx, dy));
    if (dot(n, -p) < 0.0) n = -n;
    float rs = uRadius * uProj.y / max(-p.z, 0.1) * 0.5;
    rs = min(rs, 0.12);
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float occ = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float a = (fi + ign) * 2.39996323;
      float r = (fi + 0.5) / 12.0;
      vec2 off = vec2(cos(a) * uInv.x / uInv.y, sin(a)) * r * rs;
      vec3 s = viewPos(vUv + off);
      vec3 v = s - p;
      float dist = length(v);
      float ndv = dot(n, v) / max(dist, 1e-4);
      occ += max(ndv - 0.12, 0.0) * (1.0 - smoothstep(0.0, uRadius, dist));
    }
    float ao = 1.0 - clamp(occ / 12.0 * 2.6, 0.0, 1.0);
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  }
`;

const AO_BLUR_FRAG = /* glsl */ `
  uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 uDir;
  varying vec2 vUv;
  ${LINEARIZE}
  void main() {
    float z0 = linZ(textureLod(tDepth, dynUv(vUv), 0.0).x);
    float sum = textureLod(tAO, dynUv(vUv), 0.0).x * 0.2;
    float wsum = 0.2;
    for (int i = 1; i <= 3; i++) {
      for (int s = -1; s <= 1; s += 2) {
        vec2 uv = vUv + uDir * float(i * s) * 1.5;
        float z = linZ(textureLod(tDepth, dynUv(uv), 0.0).x);
        float w = (0.2 / (1.0 + float(i))) * (1.0 - smoothstep(0.0, 0.08, abs(z - z0) / max(z0, 0.1)));
        sum += textureLod(tAO, dynUv(uv), 0.0).x * w;
        wsum += w;
      }
    }
    float v = sum / wsum;
    gl_FragColor = vec4(v, v, v, 1.0);
  }
`;

const DOF_FRAG = /* glsl */ `
  uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uInv; uniform float uFocus; uniform float uMax;
  varying vec2 vUv;
  ${LINEARIZE}
  float cocOf(float z) {
    float far = clamp((z - uFocus) / max(z, 0.1) * 1.15, 0.0, 1.0) * uMax;
    return far;
  }
  void main() {
    vec4 c0 = texture2D(tColor, dynUv(vUv));
    float d0 = texture2D(tDepth, dynUv(vUv)).x;
    float z0 = d0 >= 0.99999 ? 600.0 : linZ(d0);
    float coc0 = cocOf(z0);
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    // blur radius of the neighbourhood: the pixel's own coc, or the largest coc around it that reaches here
    vec3 acc = c0.rgb; float wsum = 1.0;
    float rad = max(coc0, 0.0);
    if (rad < 0.4) { gl_FragColor = c0; return; }
    // the blur is at most a few pixels wide (uMax = H * 0.0036): 24 taps inside a 4 px radius is far more than it can show, so the tap count follows the radius
    // (6 at the smallest blur, 24 at 13 px and more); the taps are explicit-LOD fetches (no screen-space derivatives in a loop)
    float nTaps = clamp(rad * 1.8, 6.0, 24.0);
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      if (fi >= nTaps) break;
      float a = (fi + ign) * 2.39996323;
      float r = sqrt((fi + 0.5) / nTaps) * rad;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uInv;
      float ds = textureLod(tDepth, dynUv(uv), 0.0).x;
      float zs = ds >= 0.99999 ? 600.0 : linZ(ds);
      float cs = cocOf(zs);
      // a sample in front of this pixel only counts when its own blur reaches this far; samples behind always count
      float w = zs >= z0 - 0.3 ? 1.0 : smoothstep(r - 1.0, r + 1.0, cs);
      acc += textureLod(tColor, dynUv(uv), 0.0).rgb * w;
      wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, 1.0);
  }
`;

const BLOOM_PRE_FRAG = /* glsl */ `
  uniform sampler2D tColor; uniform vec2 uInv; uniform float uThr;
  varying vec2 vUv;
  vec3 pre(vec3 c) {
    float l = max(c.r, max(c.g, c.b));
    float k = max(l - uThr, 0.0);
    k = k * k / (k + 0.5 + 1e-4) ; // soft knee
    return c * (k / max(l, 1e-4));
  }
  void main() {
    vec2 o = uInv;
    vec3 a = pre(texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb);
    vec3 b = pre(texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb);
    vec3 c = pre(texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb);
    vec3 d = pre(texture2D(tColor, vUv + vec2(o.x, o.y)).rgb);
    vec3 s = (a + b + c + d) * 0.25;
    s = min(s, vec3(24.0)); // tame fireflies from the sun disc
    gl_FragColor = vec4(s, 1.0);
  }
`;
const BLOOM_DOWN_FRAG = /* glsl */ `
  uniform sampler2D tColor; uniform vec2 uInv;
  varying vec2 vUv;
  void main() {
    vec2 o = uInv;
    vec3 s = texture2D(tColor, vUv).rgb * 4.0;
    s += texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb;
    s += texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb + texture2D(tColor, vUv + vec2(o.x, o.y)).rgb;
    gl_FragColor = vec4(s * 0.125, 1.0);
  }
`;
const BLOOM_UP_FRAG = /* glsl */ `
  uniform sampler2D tColor; uniform vec2 uInv; uniform float uGain;
  varying vec2 vUv;
  void main() {
    vec2 o = uInv;
    vec3 s = texture2D(tColor, vUv + vec2(-o.x * 2.0, 0.0)).rgb;
    s += texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb * 2.0;
    s += texture2D(tColor, vUv + vec2(0.0, o.y * 2.0)).rgb;
    s += texture2D(tColor, vUv + vec2(o.x, o.y)).rgb * 2.0;
    s += texture2D(tColor, vUv + vec2(o.x * 2.0, 0.0)).rgb;
    s += texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb * 2.0;
    s += texture2D(tColor, vUv + vec2(0.0, -o.y * 2.0)).rgb;
    s += texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
    gl_FragColor = vec4(s * (uGain / 12.0), 1.0);
  }
`;

const FINAL_FRAG = /* glsl */ `
  uniform sampler2D tColor; uniform sampler2D tBloom; uniform sampler2D tAO;
  uniform float uExposure; uniform float uBloom; uniform float uAO; uniform float uTime;
  uniform vec3 uLift; uniform vec3 uGain; uniform float uSat; uniform float uContrast; uniform float uVig; uniform float uGrain;
  uniform float uHeat; uniform float uHorizon; uniform float uCA; uniform vec2 uRes; uniform float uAspect; uniform float uTone;
  varying vec2 vUv;
  const mat3 R2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 SRGB_TO_R2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x; vec3 x4 = x2 * x2;
    return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 color) {
    const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
    color = SRGB_TO_R2020 * color;
    color = inset * color;
    color = max(color, 1e-10);
    color = log2(color);
    color = (color + 12.47393) / (4.026069 + 12.47393);
    color = clamp(color, 0.0, 1.0);
    color = agxContrast(color);
    color = outset * color;
    color = pow(max(vec3(0.0), color), vec3(2.2));
    color = R2020_TO_SRGB * color;
    return clamp(color, 0.0, 1.0);
  }
  vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
  vec3 aces(vec3 color) {
    const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color = inM * (color / 0.6);
    color = rrt(color);
    return clamp(outM * color, 0.0, 1.0);
  }
  vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    vec2 uv = vUv;
    // heat shimmer just under the horizon
    if (uHeat > 0.001) {
      float m = exp(-pow((uv.y - uHorizon + 0.05) / 0.11, 2.0));
      uv.x += (sin(uv.y * 380.0 + uTime * 3.1) * 0.6 + sin(uv.y * 150.0 - uTime * 2.2) * 0.4) * 0.0016 * uHeat * m;
      uv.y += sin(uv.x * 90.0 + uTime * 1.7) * 0.0007 * uHeat * m;
    }
    vec2 cc = (uv - 0.5) * vec2(uAspect, 1.0);
    float r2 = dot(cc, cc);
    vec3 col;
    if (uCA > 0.001) {
      vec2 sh = (uv - 0.5) * r2 * uCA;
      col = vec3(texture2D(tColor, uv + sh).r, texture2D(tColor, uv).g, texture2D(tColor, uv - sh).b);
    } else col = texture2D(tColor, uv).rgb;
    float ao = uAO > 0.0 ? mix(1.0, texture2D(tAO, uv).x, uAO) : 1.0;
    col *= ao;
    col += texture2D(tBloom, uv).rgb * uBloom;
    col *= uExposure;
    col = uTone > 0.5 ? agx(col) : aces(col);
    vec3 s = toSrgb(col);
    // grade in display space: lift the shadows, gain the highlights, contrast around mid grey, saturation
    s = s * uGain + uLift * (1.0 - s);
    s = (s - 0.4) * uContrast + 0.4;
    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
    s = mix(vec3(l), s, uSat);
    // vignette: stronger at the corners, softly
    s *= 1.0 - uVig * smoothstep(0.12, 0.85, r2 * 1.6);
    // film grain, heavier in the shadows (high ISO at night)
    float gr = hash(gl_FragCoord.xy + fract(uTime) * 91.7) + hash(gl_FragCoord.xy * 1.37 + fract(uTime * 1.3) * 53.1) - 1.0;
    s += gr * uGrain * (1.0 - 0.6 * l);
    gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
  }
`;


const rtOpts = (o = {}) => ({ type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, colorSpace: NoColorSpace, ...o });

/** The post-pass fragments with every fetch from a dynamic target routed through dynUv() (the header explains why). Exported for the tests. */
export const POST_FRAGMENTS = {
  ao: DYNRES_GLSL + AO_FRAG,
  aoBlur: DYNRES_GLSL + AO_BLUR_FRAG,
  dof: DYNRES_GLSL + DOF_FRAG,
  pre: rewriteSamples(BLOOM_PRE_FRAG, ['tColor']).source,
  down: rewriteSamples(BLOOM_DOWN_FRAG, ['tColor']).source,
  up: rewriteSamples(BLOOM_UP_FRAG, ['tColor']).source,
  fin: rewriteSamples(FINAL_FRAG, ['tColor', 'tBloom', 'tAO']).source,
  fxaa: DYNRES_GLSL + FXAA_FRAG,
};

/**
 * createPost(renderer, scene, camera, { dyn }) -> { build, render, setScale, ... }. `dyn` is the dynamic-resolution state (gfx createDynamicRes); the pipeline makes one
 * of its own when none is given. `build()` allocates the targets (tier change or window resize only); `setScale(s)` is free.
 */
export function createPost(renderer, scene, camera, { dyn = createDynamicRes() } = {}) {
  const quad = new FullScreenQuad(null);
  const black = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  black.needsUpdate = true;
  const white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  white.needsUpdate = true;
  const mat = (fragmentShader, uniforms, extra = {}) =>
    new ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms: { ...uniforms, ...dyn.uniforms }, depthTest: false, depthWrite: false, blending: NoBlending, ...extra });

  const U = {
    aoU: { tDepth: { value: null }, uProj: { value: new Vector2(1, 1) }, uInv: { value: new Vector2() }, uRadius: { value: 0.7 }, uTime: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 100 } },
    aoBlur: { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new Vector2() }, uNear: { value: 0.1 }, uFar: { value: 100 } },
    dof: { tColor: { value: null }, tDepth: { value: null }, uInv: { value: new Vector2() }, uFocus: { value: 2.6 }, uMax: { value: 7 }, uNear: { value: 0.1 }, uFar: { value: 100 } },
    pre: { tColor: { value: null }, uInv: { value: new Vector2() }, uThr: { value: 1 } },
    down: { tColor: { value: null }, uInv: { value: new Vector2() } },
    up: { tColor: { value: null }, uInv: { value: new Vector2() }, uGain: { value: 1 } },
    fin: {
      tColor: { value: null }, tBloom: { value: black }, tAO: { value: white }, uExposure: { value: 1 }, uBloom: { value: 0.2 }, uAO: { value: 0 }, uTime: { value: 0 },
      uLift: { value: [0, 0, 0] }, uGain: { value: [1, 1, 1] }, uSat: { value: 1 }, uContrast: { value: 1 }, uVig: { value: 0.2 }, uGrain: { value: 0.03 },
      uHeat: { value: 0 }, uHorizon: { value: 0.5 }, uCA: { value: 0 }, uRes: { value: new Vector2(1, 1) }, uAspect: { value: 1 }, uTone: { value: 1 },
    },
  };
  const mAO = mat(POST_FRAGMENTS.ao, U.aoU, { name: 'ao' });
  const mAOBlur = mat(POST_FRAGMENTS.aoBlur, U.aoBlur, { name: 'aoBlur' });
  const mDof = mat(POST_FRAGMENTS.dof, U.dof, { name: 'dof' });
  const mPre = mat(POST_FRAGMENTS.pre, U.pre, { name: 'bloomPre' });
  const mDown = mat(POST_FRAGMENTS.down, U.down, { name: 'bloomDown' });
  const mUp = mat(POST_FRAGMENTS.up, U.up, { name: 'bloomUp', blending: AdditiveBlending, transparent: true });
  const mFin = mat(POST_FRAGMENTS.fin, U.fin, { name: 'final' });
  const fxU = { tDiffuse: { value: null }, resolution: { value: new Vector2(1, 1) } };
  const mFxaa = mat(POST_FRAGMENTS.fxaa, fxU, { name: 'fxaa' });

  let cfg = null;
  let W = 2;
  let H = 2;
  let builtKey = '';
  let sceneRT = null;
  let rtA = null;
  let aoA = null;
  let aoB = null;
  let ldrRT = null;
  let pyramid = [];
  const look = { focus: 2.6, focusTarget: 2.6, bloom: 0.2, aoStrength: 0.5 };

  const disposeTargets = () => {
    for (const t of [sceneRT, rtA, aoA, aoB, ldrRT, ...pyramid]) t?.dispose();
    sceneRT?.depthTexture?.dispose();
    sceneRT = rtA = aoA = aoB = ldrRT = null;
    pyramid = [];
  };

  /**
   * Allocates every target at the size the tier asks for (`w` x `h` css px at `pixelRatio`, NO render scale: that is dyn.setScale). Does nothing when the tier's pipeline
   * and the size are the same as the last call (a resize event with an unchanged box, the second `resize` of the load).
   */
  function build(nextCfg, w, h, pixelRatio) {
    const nW = Math.max(2, Math.floor(w * pixelRatio));
    const nH = Math.max(2, Math.floor(h * pixelRatio));
    const key = `${nW}x${nH}|${nextCfg.msaa || 0}|${nextCfg.dof ? 1 : 0}${nextCfg.ao ? 1 : 0}${nextCfg.fxaa ? 1 : 0}${nextCfg.bloom ? 1 : 0}|${nextCfg.bloomScale || 0}`;
    cfg = nextCfg;
    if (key === builtKey && sceneRT) return false;
    disposeTargets();
    builtKey = key;
    W = nW;
    H = nH;
    const needDepth = cfg.ao || cfg.dof;
    const depthTexture = needDepth ? new DepthTexture(W, H, UnsignedIntType) : undefined;
    if (depthTexture) depthTexture.format = DepthFormat;
    sceneRT = new WebGLRenderTarget(W, H, rtOpts({ depthBuffer: true, samples: cfg.msaa || 0, ...(depthTexture ? { depthTexture } : {}) }));
    if (cfg.dof) rtA = new WebGLRenderTarget(W, H, rtOpts());
    if (cfg.ao) {
      const aw = Math.max(2, W >> 1);
      const ah = Math.max(2, H >> 1);
      aoA = new WebGLRenderTarget(aw, ah, rtOpts({ type: UnsignedByteType, format: RGBAFormat }));
      aoB = new WebGLRenderTarget(aw, ah, rtOpts({ type: UnsignedByteType, format: RGBAFormat }));
    }
    if (cfg.fxaa) ldrRT = new WebGLRenderTarget(W, H, rtOpts({ type: UnsignedByteType, minFilter: LinearFilter }));
    if (cfg.bloom) {
      const base = cfg.bloomScale || 0.5;
      const levels = cfg.msaa ? 6 : 5;
      let bw = Math.max(2, Math.floor(W * base));
      let bh = Math.max(2, Math.floor(H * base));
      for (let i = 0; i < levels && bw >= 2 && bh >= 2; i++) {
        pyramid.push(new WebGLRenderTarget(bw, bh, rtOpts()));
        bw = bw >> 1;
        bh = bh >> 1;
      }
    }
    U.fin.uAspect.value = W / H;
    return true;
  }

  let probe = null; // (passName, begin: boolean) => void, for GPU timing (timer queries) in the benchmark tooling; null in play
  /**
   * One fullscreen pass: material `m` into `dst` (a target, or null = the canvas at full size), reading `src` (the target it mostly samples: its used / allocated ratio
   * goes to the shared dynUv uniforms). The destination's viewport + scissor are set to its used sub-rect first.
   */
  const run = (m, dst, src, clear = true) => {
    quad.material = m;
    if (dst) dyn.apply(dst);
    if (src) dyn.bind(src);
    renderer.setRenderTarget(dst);
    const ac = renderer.autoClear;
    renderer.autoClear = clear;
    if (probe) probe(m.name, true);
    quad.render(renderer);
    if (probe) probe(m.name, false);
    renderer.autoClear = ac;
  };

  let time = 0;
  function render(dt) {
    time += dt;
    // 1. the scene, into the used sub-rect of the HDR target
    dyn.apply(sceneRT);
    renderer.setRenderTarget(sceneRT);
    if (probe) probe('scene', true);
    renderer.render(scene, camera);
    if (probe) probe('scene', false);
    const used = dyn.sizeOf(sceneRT);
    let curRT = sceneRT;
    const depth = sceneRT.depthTexture;
    const near = camera.near;
    const far = camera.far;
    // 2. depth of field (high)
    if (cfg.dof && depth) {
      look.focus += (look.focusTarget - look.focus) * Math.min(1, dt * 5);
      U.dof.tColor.value = curRT.texture;
      U.dof.tDepth.value = depth;
      U.dof.uInv.value.set(1 / used.w, 1 / used.h);
      U.dof.uMax.value = Math.max(2, used.h * 0.0036);
      U.dof.uFocus.value = look.focus;
      U.dof.uNear.value = near;
      U.dof.uFar.value = far;
      run(mDof, rtA, sceneRT);
      curRT = rtA;
    }
    // 3. occlusion (high): half-res from depth, then a depth-aware blur both ways
    let aoTex = white;
    if (cfg.ao && depth) {
      const ua = dyn.sizeOf(aoA);
      U.aoU.tDepth.value = depth;
      U.aoU.uProj.value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
      U.aoU.uNear.value = near;
      U.aoU.uFar.value = far;
      U.aoU.uTime.value = time;
      U.aoU.uInv.value.set(1 / ua.w, 1 / ua.h);
      run(mAO, aoA, sceneRT);
      U.aoBlur.tDepth.value = depth;
      U.aoBlur.uNear.value = near;
      U.aoBlur.uFar.value = far;
      U.aoBlur.tAO.value = aoA.texture;
      U.aoBlur.uDir.value.set(1 / ua.w, 0);
      run(mAOBlur, aoB, aoA);
      U.aoBlur.tAO.value = aoB.texture;
      U.aoBlur.uDir.value.set(0, 1 / ua.h);
      run(mAOBlur, aoA, aoB);
      aoTex = aoA.texture;
    }
    // 4. bloom
    let bloomTex = black;
    if (cfg.bloom && pyramid.length) {
      U.pre.tColor.value = curRT.texture;
      U.pre.uInv.value.set(1 / used.w, 1 / used.h);
      run(mPre, pyramid[0], curRT);
      for (let i = 1; i < pyramid.length; i++) {
        const us = dyn.sizeOf(pyramid[i - 1]);
        U.down.tColor.value = pyramid[i - 1].texture;
        U.down.uInv.value.set(1 / us.w, 1 / us.h);
        run(mDown, pyramid[i], pyramid[i - 1]);
      }
      for (let i = pyramid.length - 2; i >= 0; i--) {
        const us = dyn.sizeOf(pyramid[i + 1]);
        U.up.tColor.value = pyramid[i + 1].texture;
        U.up.uInv.value.set(1 / us.w, 1 / us.h);
        U.up.uGain.value = 1;
        run(mUp, pyramid[i], pyramid[i + 1], false);
      }
      bloomTex = pyramid[0].texture;
    }
    // 5. final (+ FXAA)
    const f = U.fin;
    f.tColor.value = curRT.texture;
    f.tBloom.value = bloomTex;
    f.tAO.value = aoTex;
    f.uAO.value = cfg.ao ? look.aoStrength : 0;
    f.uTime.value = time;
    f.uBloom.value = cfg.bloom ? look.bloom : 0;
    {
      const e = camera.matrixWorld.elements;
      const pitch = Math.asin(Math.max(-1, Math.min(1, -e[9]))); // y component of the forward vector (-z column)
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
      f.uHorizon.value = 0.5 + Math.tan(pitch) / (2 * tanHalf);
    }
    if (cfg.fxaa && ldrRT) {
      run(mFin, ldrRT, curRT);
      const ul = dyn.sizeOf(ldrRT);
      fxU.resolution.value.set(1 / ul.w, 1 / ul.h);
      fxU.tDiffuse.value = ldrRT.texture;
      run(mFxaa, null, ldrRT);
    } else run(mFin, null, curRT);
    renderer.setRenderTarget(null);
  }

  // the passes the current tier runs, with the target each one draws into (null = the canvas): what a pre-link has to compile (the output colour space is part of
  // the program key, so a pass is only worth compiling against the target it will really use)
  const passList = () => {
    const out = [];
    if (cfg?.dof) out.push([mDof, rtA]);
    if (cfg?.ao) out.push([mAO, aoA], [mAOBlur, aoB]);
    if (cfg?.bloom && pyramid.length) out.push([mPre, pyramid[0]], [mDown, pyramid[1] || pyramid[0]], [mUp, pyramid[0]]);
    out.push([mFin, cfg?.fxaa ? ldrRT : null]);
    if (cfg?.fxaa) out.push([mFxaa, null]);
    return out;
  };
  let warmGeo = null;
  let warmCam = null;

  return {
    build,
    render,
    /** The dynamic-resolution state: scale steps are `post.setScale(s)` (viewport and uniforms only: nothing is re-allocated, nothing recompiles). */
    dyn,
    setScale(s) {
      return dyn.setScale(s);
    },
    get scale() {
      return dyn.scale;
    },
    /** The used (rendered) size of the HDR scene target at the current scale, in pixels. */
    get usedSize() {
      return sceneRT ? { w: Math.max(1, Math.round(sceneRT.width * dyn.scale)), h: Math.max(1, Math.round(sceneRT.height * dyn.scale)) } : { w: 0, h: 0 };
    },
    /** Every post-pass material of this pipeline (all tiers: only the ones the current tier runs ever draw). tf-prog's loader may link them during the load. */
    getMaterials() {
      return [mAO, mAOBlur, mDof, mPre, mDown, mUp, mFin, mFxaa];
    },
    /**
     * Kicks the compile of every pass the CURRENT tier runs, each against the target it draws into, so the programs link on the browser's worker threads during the load
     * (renderer.programsStatus-style polling sees them) instead of at the first frame. `compile(scene, camera)` is the renderer's own compile (the caller passes the
     * unwrapped one: a wrapper that binds the scene target would give the canvas passes the wrong output colour space). Returns the number of passes handed over.
     */
    prelink(compile = (s, c) => renderer.compile(s, c)) {
      if (!cfg) return 0;
      if (!warmGeo) {
        warmGeo = new BufferGeometry();
        warmGeo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
        warmGeo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
        warmCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
      }
      const prev = renderer.getRenderTarget();
      let n = 0;
      for (const [m, target] of passList()) {
        const sc = new Scene();
        const mesh = new Mesh(warmGeo, m);
        mesh.frustumCulled = false;
        sc.add(mesh);
        try {
          renderer.setRenderTarget(target);
          compile(sc, warmCam);
          n++;
        } catch {
          /* a pass that cannot be pre-linked is linked on its first draw */
        } finally {
          renderer.setRenderTarget(prev);
        }
      }
      return n;
    },
    /** Per-frame look from a lighting snapshot (lighting.js). */
    setLook(L, exposure, cfgNow) {
      const f = U.fin;
      f.uExposure.value = exposure;
      f.uLift.value = L.gl;
      f.uGain.value = L.gg;
      f.uSat.value = L.sat;
      f.uContrast.value = L.contrast;
      f.uVig.value = L.vig;
      f.uGrain.value = cfgNow?.grain === false ? 0 : L.grain;
      f.uHeat.value = cfgNow?.heat ? L.heat : 0;
      f.uCA.value = cfg?.dof ? 0.005 : cfg?.post ? 0.0025 : 0;
      look.bloom = L.bloom;
      U.pre.uThr.value = L.thr;
      look.aoStrength = 0.35 + 0.35 * (1 - L.night);
    },
    /** Benchmark hook: fn(passName, begin) around every pass (see scripts/perf). */
    setProbe(fn) {
      probe = fn || null;
    },
    setFocus(d) {
      look.focusTarget = Math.max(0.6, Math.min(40, d));
    },
    setTone(id) {
      U.fin.uTone.value = id ? 1 : 0;
    },
    /** The allocated size (the used size is `usedSize`). */
    get size() {
      return { w: W, h: H };
    },
    /** The render targets as allocated (tests and tooling: identity must not change on a scale step). */
    get targets() {
      return { scene: sceneRT, dof: rtA, aoA, aoB, ldr: ldrRT, pyramid: pyramid.slice() };
    },
    /** The texel-size uniforms of the passes (the used size, not the allocated one): tests. */
    get uniforms() {
      return U;
    },
    /** The HDR scene target (null before build / without post): programs compiled against it are the ones the frame really uses. */
    get sceneTarget() {
      return sceneRT;
    },
    dispose() {
      disposeTargets();
      for (const m of [mAO, mAOBlur, mDof, mPre, mDown, mUp, mFin, mFxaa]) m.dispose();
      warmGeo?.dispose();
      black.dispose();
      white.dispose();
      quad.dispose();
    },
  };
}
