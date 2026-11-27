// Heap snapshot helpers shared by aw-heapdiff.mjs and aw-hitch.mjs (--snapcycles).

/** Heap snapshot -> Map(name -> { n, size }) for objects and closures (the flat `nodes` array, see the V8 heap snapshot format). */
export async function takeClasses(c) {
  const chunks = [];
  const off = c.on;
  let handler;
  const done = new Promise((resolve) => {
    handler = (d) => { if (d.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(d.params.chunk); };
    off(handler);
    resolve();
  });
  await done;
  await c.send('HeapProfiler.collectGarbage');
  await c.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  const snap = JSON.parse(chunks.join(''));
  const f = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const stride = f.length;
  const iT = f.indexOf('type');
  const iN = f.indexOf('name');
  const iS = f.indexOf('self_size');
  const out = new Map();
  for (let i = 0; i < snap.nodes.length; i += stride) {
    const t = types[snap.nodes[i + iT]];
    if (t !== 'object' && t !== 'closure' && t !== 'array' && t !== 'native') continue;
    const key = `${t}:${snap.strings[snap.nodes[i + iN]]}`.slice(0, 90);
    const e = out.get(key) || { n: 0, size: 0 };
    e.n++;
    e.size += snap.nodes[i + iS];
    out.set(key, e);
  }
  return out;
}

/** Rows that grew between two takeClasses() maps, biggest first. */
export function grew(first, last) {
  const rows = [];
  for (const [k, v] of last) {
    const a = first.get(k) || { n: 0, size: 0 };
    if (v.n > a.n || v.size > a.size) rows.push({ k, dn: v.n - a.n, dsize: v.size - a.size, n: v.n });
  }
  return rows.sort((x, y) => y.dsize - x.dsize);
}

export const totalBytes = (m) => [...m.values()].reduce((a, e) => a + e.size, 0);

/** A raw parsed V8 heap snapshot (after a forced GC). */
export async function takeSnapshot(c) {
  const chunks = [];
  c.on((d) => { if (d.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(d.params.chunk); });
  await c.send('HeapProfiler.collectGarbage');
  await c.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  return JSON.parse(chunks.join(''));
}

/**
 * The shortest retaining paths from the GC roots to up to `limit` nodes whose name matches `re` (what DevTools shows under "Retainers"):
 * a breadth first search from the root over every edge except weak ones. Returns one array of "node --edge--> node" steps per target.
 */
export function retainerPaths(snap, re, limit = 3, maxSteps = 40) {
  const nf = snap.snapshot.meta.node_fields;
  const ef = snap.snapshot.meta.edge_fields;
  const nTypes = snap.snapshot.meta.node_types[0];
  const eTypes = snap.snapshot.meta.edge_types[0];
  const NS = nf.length;
  const ES = ef.length;
  const iName = nf.indexOf('name');
  const iType = nf.indexOf('type');
  const iEdges = nf.indexOf('edge_count');
  const eType = ef.indexOf('type');
  const eName = ef.indexOf('name_or_index');
  const eTo = ef.indexOf('to_node');
  const nodes = snap.nodes;
  const edges = snap.edges;
  const count = nodes.length / NS;
  const firstEdge = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += nodes[i * NS + iEdges]; }
  firstEdge[count] = edges.length / ES;
  const weak = eTypes.indexOf('weak');
  const parent = new Int32Array(count).fill(-1);
  const parentEdge = new Int32Array(count).fill(-1);
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  queue[tail++] = 0;
  seen[0] = 1;
  while (head < tail) {
    const n = queue[head++];
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
      const o = e * ES;
      if (edges[o + eType] === weak) continue;
      const to = edges[o + eTo] / NS;
      if (seen[to]) continue;
      seen[to] = 1;
      parent[to] = n;
      parentEdge[to] = e;
      queue[tail++] = to;
    }
  }
  const nameOf = (n) => `${nTypes[nodes[n * NS + iType]]}:${String(snap.strings[nodes[n * NS + iName]]).slice(0, 60)}`;
  const edgeName = (e) => {
    const t = eTypes[edges[e * ES + eType]];
    const v = edges[e * ES + eName];
    return t === 'element' || t === 'hidden' ? `[${v}]` : String(snap.strings[v]).slice(0, 50);
  };
  const out = [];
  const paths = new Set();
  for (let n = 0; n < count && out.length < limit; n++) {
    if (!seen[n] || !re.test(String(snap.strings[nodes[n * NS + iName]]))) continue;
    const steps = [];
    for (let x = n, k = 0; x > 0 && k < maxSteps; x = parent[x], k++) steps.push(`${nameOf(x)}  <-${edgeName(parentEdge[x])}-`);
    const key = steps.slice(1).join('|');
    if (paths.has(key)) continue; // the same chain for another instance of the class
    paths.add(key);
    out.push(steps.reverse());
  }
  return out;
}
