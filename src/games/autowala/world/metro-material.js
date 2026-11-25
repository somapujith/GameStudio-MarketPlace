// OWNER: metro agent. The metro's standard material: vertex colours, an instance-colour "tint" (the line colour) on the vertices that
// ask for it (`aTint`), and a night glow on the vertices that ask for it (`aGlow`: 1 = lit at night, 2 = door light that follows the
// per-instance `aOpen` attribute). One program serves the deck, the pillars, the stations and the trains.
import { MeshStandardMaterial } from 'three';

const HEAD_FIX = ['#ifdef USE_INSTANCING', 'float sy = length(instanceMatrix[1].xyz);', 'if (aTint > 0.5) transformed.y = 1.0 + (position.y - 1.0) / sy;', '#endif'].join('\n');

/** @param glow a shared { value } uniform (0.07 by day .. ~1.25 at night) */
export function metroMaterial(glow, { doors = false, headFix = false, roughness = 0.85, metalness = 0.05, key = 'm' } = {}) {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness, metalness });
  m.customProgramCacheKey = () => `metro-${key}-${doors ? 'd' : 'n'}${headFix ? 'h' : ''}`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aTint; attribute float aGlow; varying float vGlow; varying float vDoor;
         ${doors ? 'attribute float aOpen;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         ${headFix ? HEAD_FIX : ''}`,
      )
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(1.0);
         vColor.rgb *= color;
         #ifdef USE_INSTANCING_COLOR
           vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
         #endif
         vGlow = aGlow >= 1.5 ? 0.0 : aGlow;
         vDoor = ${doors ? 'aGlow >= 1.5 ? aOpen : 0.0' : '0.0'};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow; varying float vGlow; varying float vDoor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.12, step(0.5, vGlow + vDoor));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (vGlow * uGlow + vDoor * 1.0);');
  };
  return m;
}
