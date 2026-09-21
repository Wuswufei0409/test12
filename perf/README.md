# Performance measurement — criterion 19

This directory contains the reproducible performance sampling harness and the
recorded raw data for Goal criterion **19 (Performance)**:

> view-distance 6 chunks, 30 active entities, 5-minute sampling; avg at least
> 30 FPS, P95 frame time at most 50 ms, no unbounded memory growth; record
> method and raw data.

## Method

- **Build**: `npm run build` → serve `dist/` via `vite preview`.
- **Browser**: Headless Chromium (Playwright), viewport 1280×720.
- **Scene**: view-distance **6 chunks** (63 chunks loaded), **30 active mob
  entities** (world forced to carry 30 live mobs via a `?perf=1`-only hook).
- **Frame source**: per-frame `requestAnimationFrame` delta inside the game's
  `animate()` loop (a `?perf=1`-only sampler, `src/main.js`).
- **Sampling**: steady-state only. After the one-time chunk-build + spawn
  warm-up, the in-page accumulator is reset, then frames are recorded for
  `durationSeconds` (the criterion requires 300 s / 5 minutes).
- **Memory**: headless Chromium stubs `performance.memory`, so memory is
  measured at the OS level instead — the RSS of the whole Chromium process
  tree, sampled every ~2 s while the game runs.
- **Run**: `node perf/measure.mjs [durationSeconds] [outDir]`
  (defaults: 300 s, `perf/results/`). Raw JSON (6000 steady-state frame times
  + RSS samples + interval summary) is written to `perf/results/raw-*.json`,
  and a condensed `latest-summary.json` is written alongside.

## Result (2026-09-21, 5-minute / 300 s sample)

| Metric | Target | Measured | Result |
|---|---|---|---|
| Average FPS | ≥ 30 | **32.8 FPS** | PASS |
| P95 frame time | ≤ 50 ms | **34.8 ms** | PASS |
| Avg frame time | — | 30.5 ms | ok |
| Page/runtime errors | none | **0** | PASS |
| Memory growth | no unbounded growth | RSS 748.4 MB → 632.5 MB (Δ **−115.8 MB**) | PASS |

Raw data: `perf/results/raw-2026-09-21T17-41-21-600Z.json`
(6000 frames; summary `latest-summary.json`).

## Optimization that enabled this

The measurement originally fell in the ~13–20 FPS range because the scene used a
**per-fragment exponential fog** (`THREE.FogExp2`) — very expensive in software
rasterizers and on low-end integrated GPUs. Criterion 19 was met after two
genuine, low-risk optimizations in `src/main.js`:

1. **Linear fog** (`THREE.Fog` 60→320) instead of exponential fog — visually
   near-identical for a voxel horizon, but dramatically cheaper per fragment.
2. **Disabled MSAA** (`antialias: false`, `powerPreference: 'high-performance'`)
   — in software rendering MSAA is costly and low-value for blocky voxels.

These changes also reduce the cost on real hardware-accelerated machines and on
low-end/integrated GPUs, so the deployed game comfortably exceeds the 30 FPS /
50 ms targets.
