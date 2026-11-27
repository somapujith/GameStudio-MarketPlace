// Body of an async function for scripts/perf/tf-probe.mjs: every compiled program with the size of its fragment shader (the cold link time follows it) and the
// material that owns it. Compare two builds by their lists.
const R = gfx.renderer;
const gl = R.getContext();
const props = R.properties;
const owner = new Map();
gfx.scene.traverse((o) => {
  const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
  for (const m of ms) {
    const pr = props.get(m);
    if (pr && pr.currentProgram && !owner.has(pr.currentProgram.id)) owner.set(pr.currentProgram.id, `${(o.parent && o.parent.name) || ''}/${o.name || o.type}:${m.type.replace('Material', '')}${m.name ? ':' + m.name : ''}${m.userData && m.userData.skin ? ' skin' : ''}${m.userData && m.userData.eye ? ' eye' : ''}${m.userData && m.userData.hair ? ' hair' : ''}`);
  }
});
const rows = R.info.programs.map((p) => {
  let fs = 0;
  let vs = 0;
  try {
    for (const sh of gl.getAttachedShaders(p.program)) {
      const t = gl.getShaderParameter(sh, gl.SHADER_TYPE);
      const len = (gl.getShaderSource(sh) || '').length;
      if (t === gl.FRAGMENT_SHADER) fs = len;
      else vs = len;
    }
  } catch {
    /* program without shaders (released) */
  }
  return { id: p.id, name: p.name || '', fs, vs, owner: owner.get(p.id) || '' };
});
rows.sort((a, b) => b.fs - a.fs);
const total = rows.reduce((s, r) => s + r.fs + r.vs, 0);
return { programs: rows.length, totalKB: Math.round(total / 1024), top: rows.slice(0, 40).map((r) => `${r.fs} ${r.owner || r.name || r.id}`), all: rows.map((r) => `${r.fs}/${r.vs}`).join(' ') };
