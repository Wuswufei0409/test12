#!/usr/bin/env node
// B8 (MUL-104) performance sampling harness (crit 19).
//
// Loads the production build in a headless Chromium, forces the world to carry
// ~30 live mob entities at view-distance 6 chunks (?perf=1), and samples the
// app's per-frame deltas for `durationSeconds` while concurrently capturing
// the OS RSS of the whole Chromium process tree (real memory evidence, since
// headless Chromium stubs performance.memory). Writes raw JSON + a summary
// into perf/results/.
//
// Run:  node perf/measure.mjs [durationSeconds] [outDir] [--snapshot]
//   default durationSeconds = 300 (5-minute criterion), outDir = perf/results.
//   --snapshot reduces the run for CI (n=7200 frames) without looping.
//   Use maxFrames=6000 since the in-page sampler keeps a rolling 6000-frame
//   window (this is the steady-state window we measure).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SNAPSHOT = process.argv.includes('--snapshot');
const durationSeconds = SNAPSHOT ? 90 : (Number(process.argv[2]) || 300);
const outDir = join(ROOT, process.argv[3] ?? 'perf/results');

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

function startPreview(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
      cwd: ROOT, stdio: 'ignore',
    });
    const deadline = Date.now() + 15000;
    const poll = () => {
      http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(child); })
        .on('error', () => (Date.now() > deadline ? reject(new Error('preview didn\'t start')) : setTimeout(poll, 300)));
    };
    poll();
  });
}

// Sum resident memory (RSS) of the browser + its renderer/gpu subprocesses.
// Chromium processes are identified by the executable path; we take the tree
// rooted on the biggest chrome-headless process to capture the whole page.
function chromiumRssMB() {
  try {
    const out = execFileSync('ps', ['-eo', 'pid,ppid,rss,args', '--no-headers'], { encoding: 'utf8' });
    const procs = [];
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      let [, pid, ppid, rss, args] = m;
      // only chromium processes (not the bash wrapper / node)
      if (!/chrom.+headless_shell|chrome-headless/.test(args)) continue;
      const rssB = Number(rss) * 1024;
      procs.push({ pid: Number(pid), ppid: Number(ppid), rss: rssB, args });
    }
    if (procs.length === 0) return null;
    const roots = procs.filter((p) => !procs.some((q) => q.ppid === p.pid));
    const pidSet = new Set(procs.map((p) => p.pid));
    // include every process whose ancestry reaches a root of the tree
    let total = 0;
    for (const p of procs) {
      let cur = p.ppid;
      let reach = p.ppid === 0;
      for (let i = 0; i < 20; i++) {
        if (cur === 0) { reach = true; break; }
        if (!pidSet.has(cur)) break;
        cur = procs.find((q) => q.pid === cur)?.ppid ?? 0;
      }
      total += p.rss;
    }
    return Math.round((total / 1048576) * 10) / 10; // MB
  } catch (e) {
    return null;
  }
}

async function main() {
  const { chromium } = await import('playwright');
  mkdirSync(outDir, { recursive: true });

  const port = await freePort();
  const server = await startPreview(port);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/?perf=1`, { waitUntil: 'networkidle', timeout: 60000 });
  // let the world generate and the first chunks render (one-time cost, not sampled)
  await page.waitForTimeout(4000);

  // force the 30-active-entity scenario
  const forced = await page.evaluate(() => window.__test12ForceMobs ? window.__test12ForceMobs(30) : -1);
  await page.waitForTimeout(1500);

  // reset the in-page accumulator so only steady-state frames are counted
  await page.evaluate(() => { if (window.__test12Perf) window.__test12Perf.reset(); });

  const t0 = Date.now();
  const end = t0 + durationSeconds * 1000;

  // sample in-page stats every 500ms + capture OS RSS every ~2s concurrently
  const samples = [];
  const rssSamples = [];
  let lastRss = 0;
  let lastReported = 0;
  let rssNow = chromiumRssMB();
  rssSamples.push({ t: 0, rssMB: rssNow });
  while (Date.now() < end) {
    const s = await page.evaluate(() => {
      const p = window.__test12Perf;
      return p ? { n: p.data.frames.length, stats: p.stats() } : null;
    }).catch(() => null);
    if (s && s.stats) samples.push(s);
    if (Date.now() - lastRss > 2000) {
      lastRss = Date.now();
      rssNow = chromiumRssMB();
      rssSamples.push({ t: Math.round((Date.now() - t0) / 1000), rssMB: rssNow });
    }
    await page.waitForTimeout(500);
    if (Date.now() - lastReported > 30000) { lastReported = Date.now(); console.log(`... ${Math.round((Date.now() - t0) / 1000)}s sampled`); }
  }

  // final buffered stats (the in-page buffer is a rolling 6000-frame window)
  const final = await page.evaluate(() => { const p = window.__test12Perf; return p ? { stats: p.stats(), frames: [...p.data.frames], mem: [...p.data.memory] } : null; });

  const raw = {
    method: {
      build: 'vite build -> dist, served via vite preview',
      browser: 'Chromium (Playwright headless) — viewport 1280x720',
      renderer: 'WebGL via browser (hardware-accelerated on user machines; truly headless here)',
      viewDistance: 6,
      entityCount: forced,
      sampleDurationSeconds: durationSeconds,
      frameSource: 'requestAnimationFrame per-frame dt inside the app animate() loop',
      memorySource: 'OS RSS of the whole Chromium process tree (ps), sampled ~every 2s (headless Chromium stubs performance.memory)',
      fpsNote: 'steady-state only: accumulated in-page frame window reset after chunk-build + spawn warm-up',
    },
    rawFrames: final ? final.frames : [],
    rawMemory: final ? final.mem : [], // in-page probe (stubbed in headless; kept for structure)
    rssMB: rssSamples,
    intervalSamples: samples,
    summary: final ? final.stats : null,
    pageErrors,
    server: 'vite preview',
  };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(outDir, `raw-${ts}.json`), JSON.stringify(raw, null, 2));

  const sum = raw.summary;
  // memory growth from OS RSS: first vs last portion of the run
  let memGrowth = null;
  const rssVals = rssSamples.map((s) => s.rssMB).filter((v) => v != null);
  if (rssVals.length >= 3) {
    const head = rssVals.slice(0, Math.max(3, Math.floor(rssVals.length * 0.2)));
    const tail = rssVals.slice(Math.max(0, rssVals.length - Math.floor(rssVals.length * 0.2)));
    memGrowth = {
      avgStartMB: Math.round((head.reduce((a, b) => a + b, 0) / head.length) * 10) / 10,
      avgEndMB: Math.round((tail.reduce((a, b) => a + b, 0) / tail.length) * 10) / 10,
      deltaMB: Math.round(((tail.reduce((a, b) => a + b, 0) / tail.length) - (head.reduce((a, b) => a + b, 0) / head.length)) * 10) / 10,
      peakMB: Math.max(...rssVals),
      minMB: Math.min(...rssVals),
    };
  }

  const report = {
    ts,
    durationSeconds,
    snapshot: SNAPSHOT,
    forcedEntities: forced,
    stats: sum,
    memory: memGrowth,
    crit19: sum ? {
      avgFps: Math.round(sum.fps * 10) / 10,
      p95Ms: Math.round(sum.p95Ms * 10) / 10,
      avgMs: Math.round(sum.avgMs * 10) / 10,
      pass: sum.fps >= 30 && sum.p95Ms <= 50,
    } : null,
    pageErrorCount: pageErrors.length,
    rawFile: `raw-${ts}.json`,
  };
  writeFileSync(join(outDir, 'latest-summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
