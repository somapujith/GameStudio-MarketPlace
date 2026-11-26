// A machine-wide mutex for benchmarks: several people (or agents) share one GPU, and two benchmarks at once make both numbers meaningless.
//   await withBenchLock(async () => { ...measure... })
// A lock older than 10 minutes is treated as abandoned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.tmpdir(), 'jalebi-bench.lock');

export async function withBenchLock(fn, { maxWaitMs = 25 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(DIR);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(DIR).mtimeMs > 10 * 60 * 1000) fs.rmSync(DIR, { recursive: true, force: true });
      } catch {
        /* raced with the owner releasing it */
      }
      if (Date.now() - t0 > maxWaitMs) throw new Error('bench lock timeout');
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* already gone */ }
  }
}
