// Body of an async function for scripts/perf/tf-probe.mjs: per-section main-thread ms of a frame (scene.debug.profile) and the frame distribution, with the
// governor held at a fixed scale so two builds are comparable:
//   node scripts/perf/tf-probe.mjs --base http://127.0.0.1:5852 --port 9990 --tier medium --level 1 --warm 30 --js scripts/perf/tf-cpu.probe.js
const R = gfx.renderer;
gfx.holdAdaptation(1e6);
gfx.setScale(args && args.scale ? args.scale : 0.7);
await h.sleep(1500);
const customers = (() => {
  let n = 0;
  gfx.scene.traverse((o) => {
    if (/^customer-/.test(o.name || '')) {
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      n++;
    }
  });
  return n;
})();
const a = await h.cpu(8);
const m = await h.measure(8);
const gpu = await h.gpu(6);
const i = R.info;
return { tier: gfx.quality, scale: gfx.scale, customers, sections: a.sections, passes: a.passes, frame: m, gpu, calls: i.render.calls, programs: i.programs.length, geometries: i.memory.geometries, textures: i.memory.textures };
