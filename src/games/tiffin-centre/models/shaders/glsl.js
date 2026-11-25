// Shared GLSL snippets (noise, colour helpers, bump). Names are prefixed `tc_` so they never clash with three's chunks.
export const GLSL_NOISE = /* glsl */ `
float tc_h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float tc_h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2  tc_h22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float tc_h31(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float tc_vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(tc_h21(i), tc_h21(i + vec2(1., 0.)), f.x), mix(tc_h21(i + vec2(0., 1.)), tc_h21(i + vec2(1., 1.)), f.x), f.y);
}
float tc_vn3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  float a = mix(mix(tc_h31(i), tc_h31(i + vec3(1,0,0)), f.x), mix(tc_h31(i + vec3(0,1,0)), tc_h31(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(tc_h31(i + vec3(0,0,1)), tc_h31(i + vec3(1,0,1)), f.x), mix(tc_h31(i + vec3(0,1,1)), tc_h31(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
float tc_fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * tc_vn(p); p = p * 2.03 + 17.1; a *= .5; } return s / .9375; }
float tc_fbm2(vec2 p){ return .66 * tc_vn(p) + .34 * tc_vn(p * 2.07 + 5.3); }
float tc_fbm3(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 3; i++){ s += a * tc_vn3(p); p = p * 2.02 + 11.7; a *= .5; } return s / .875; }
// worley: x = F1, y = F2 (cell units); z = id of the nearest cell
vec3 tc_wor(vec2 p){
  vec2 ip = floor(p), fp = fract(p); float d1 = 8., d2 = 8., id = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y)); vec2 o = tc_h22(ip + g); vec2 r = g + o - fp; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = tc_h21(ip + g + 7.7); } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 tc_wor3(vec3 p){
  vec3 ip = floor(p), fp = fract(p); float d1 = 8., d2 = 8., id = 0.;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(tc_h31(ip + g), tc_h31(ip + g + 19.3), tc_h31(ip + g + 41.7)); vec3 r = g + o - fp; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = tc_h31(ip + g + 7.7); } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 tc_lin(vec3 c){ return pow(c, vec3(2.2)); }
`;

export const GLSL_BUMP = /* glsl */ `
// bump from a screen-space height derivative (Mikkelsen); same maths as three's bumpmap chunk but for procedural heights
vec3 tc_bump(vec3 surfPos, vec3 surfNorm, vec2 dH, float fd){
  vec3 sx = normalize(dFdx(surfPos)); vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm); vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * surfNorm - g);
}
`;
