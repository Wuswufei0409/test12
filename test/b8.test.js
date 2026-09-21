// B8 (MUL-104) performance evidence test — verifies the recorded measurement
// deliverable for criterion 19 is present and self-consistent.
//
// Criterion 19: view-distance 6 chunks, 30 active entities, 5-minute sampling;
// avg >=30 FPS, P95 frame time <=50 ms, no unbounded memory growth; method and
// raw data recorded in the repo.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(__dirname, '..', 'perf', 'results');

function latestSummary() {
  const f = join(RESULTS, 'latest-summary.json');
  return JSON.parse(readFileSync(f, 'utf8'));
}

describe('crit 19 · recorded performance evidence', () => {
  it('has a recorded latest-summary deliverable', () => {
    const s = latestSummary();
    expect(s).toBeTruthy();
    expect(s.stats).toBeTruthy();
  });

  it('met the 5-minute steady-state FPS + P95 targets', () => {
    const s = latestSummary();
    expect(s.durationSeconds).toBeGreaterThanOrEqual(299); // ~5 min
    expect(s.forcedEntities).toBeGreaterThanOrEqual(30);   // 30 active entities
    expect(s.crit19.avgFps).toBeGreaterThanOrEqual(30);    // avg >= 30 FPS
    expect(s.crit19.p95Ms).toBeLessThanOrEqual(50);        // P95 <= 50 ms
    expect(s.pageErrorCount).toBe(0);                      // no blocking errors
  });

  it('shows no unbounded memory growth (RSS does not balloon)', () => {
    const s = latestSummary();
    expect(s.memory).toBeTruthy();
    // absorbed / released or only slowly growing — not unbounded. We assert the
    // tail does not grow many-tens-of-% beyond the head within 5 minutes.
    const deltaMB = s.memory.deltaMB;
    const avgStartMB = s.memory.avgStartMB;
    // allow small jitter; reject unbounded growth (e.g. +50% in 5 min).
    expect(deltaMB).toBeLessThan(avgStartMB * 0.5);
  });

  it('records raw per-frame data in the repo (reproducible)', () => {
    const raws = readdirSync(RESULTS).filter((f) => f.startsWith('raw-') && f.endsWith('.json'));
    expect(raws.length).toBeGreaterThan(0);
    const raw = JSON.parse(readFileSync(join(RESULTS, raws[raws.length - 1]), 'utf8'));
    expect(raw.rawFrames.length).toBeGreaterThan(1000); // many steady-state frames
    expect(raw.method.viewDistance).toBe(6);            // 6 chunks documented
    expect(raw.method.sampleDurationSeconds).toBeGreaterThanOrEqual(299);
  });
});
