/**
 * Frame-Time Benchmark Harness — Phase 8 acceptance gate support
 *
 * The phase doc's headline acceptance is "60fps sustained at 1920x1080 with
 * default settings on integrated graphics". That number can ONLY come from a
 * real browser on a named GPU: it includes WebGPU/WebGL2 rasterisation, the 3D
 * water surface, the instanced overlays, and compositing, none of which exist in
 * Node. This harness measures the part that IS reproducible headlessly — the
 * end-to-end multi-physics step at the default fluid grid — and prints the exact
 * in-browser procedure for the rest.
 *
 * Reporting rules (do not violate these when filling in README):
 *   - The headless number is the SIMULATION budget. It is NOT the acceptance number.
 *   - The acceptance number is whatever the browser prints on the target machine,
 *     recorded with the GPU model and a date.
 *
 * Usage:
 *   npx vitest run scripts/benchmark-frames.ts
 *   FRAME_BENCH_FRAMES=600 npx vitest run scripts/benchmark-frames.ts
 *   FRAME_BENCH_W=2048 FRAME_BENCH_H=1024 npx vitest run scripts/benchmark-frames.ts
 */

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { FluidSolver } from '../src/fluid/FluidSolver';
import { solveBEMT } from '../src/prop/bemt';
import { PowerBus } from '../src/power/bus';
import { ActuatorDiscCoupler } from '../src/prop/coupling';
import { PropellerArray } from '../src/prop/array';
import { VehicleBody } from '../src/vehicle/body';
import { stepVehicleRigidBody } from '../src/vehicle/integrator';

export interface FrameStats {
  samples: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((q / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export function summarize(frameTimesMs: number[]): FrameStats {
  const sorted = [...frameTimesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    samples: sorted.length,
    meanMs: sum / sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted[sorted.length - 1],
    minMs: sorted[0]
  };
}

/**
 * One full physics frame: fluid step -> inflow sample -> BEMT -> electrical bus ->
 * momentum/swirl injection -> thruster array -> 6-DOF integration. Mirrors
 * App.frame()'s simulation half.
 */
export function runFrameBenchmark(options: {
  frames?: number;
  width?: number;
  height?: number;
  warmup?: number;
} = {}): { stats: FrameStats; width: number; height: number; realTimeHeadroom: number } {
  const frames = options.frames ?? 120;
  const width = options.width ?? defaultConfig.fluid.nx;
  const height = options.height ?? defaultConfig.fluid.ny;
  const warmup = options.warmup ?? 20;

  const fluidSolver = new FluidSolver({
    gridOptions: { width, height },
    pressureIterations: defaultConfig.fluid.pressureIterations,
    vorticityStrength: defaultConfig.fluid.vorticityStrength,
    advectionScheme: defaultConfig.fluid.advectionScheme === 'maccormack' ? 'MACCORMACK' : 'SEMI_LAGRANGIAN'
  });
  const grid = fluidSolver.grid;
  const bus = new PowerBus(3, 12.0, 0.782);
  const coupler = new ActuatorDiscCoupler({ centerX: 28, centerY: Math.floor(height / 2), radiusCells: 14 });
  const array = new PropellerArray();
  const vehicle = new VehicleBody(defaultConfig.vehicle);
  const dt = 1.0 / 60.0;
  const throttles = [1.0, 0.85, 0.85];

  const stepFrame = () => {
    fluidSolver.step(dt);
    const va = coupler.sampleInflowVelocity(grid);
    const bemt = solveBEMT(4140, va);
    bus.solveBusNetwork(throttles, [() => bemt.torqueNm, () => bemt.torqueNm, () => bemt.torqueNm]);
    bus.stepThermal(dt);
    coupler.injectCouplingForces(grid, bemt, dt);
    const summary = array.evaluate(throttles, [va, va, 0]);
    stepVehicleRigidBody(vehicle, dt, summary.totalForceN, summary.totalMomentNm);
  };

  for (let i = 0; i < warmup; i++) stepFrame();

  const frameTimesMs: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    stepFrame();
    frameTimesMs.push(performance.now() - t0);
  }

  const stats = summarize(frameTimesMs);
  return { stats, width, height, realTimeHeadroom: 16.67 / stats.p50Ms };
}

const BROWSER_PROCEDURE = [
  'In-browser acceptance measurement (the only source of the real number):',
  '  1. npm run dev, open the app, set the window to exactly 1920x1080 (devicePixelRatio 1).',
  '  2. Select the default operating point and press RUN. Leave all overlays at their defaults.',
  '  3. Open DevTools console and run this for 60 s:',
  '       (() => { const t = []; let last = performance.now();',
  '         const tick = () => { const n = performance.now(); t.push(n - last); last = n;',
  '           requestAnimationFrame(tick); }; requestAnimationFrame(tick);',
  '         window.__frameSamples = t; })()',
  '  4. Then: (() => { const s = [...window.__frameSamples].sort((a,b)=>a-b);',
  '       const p = q => s[Math.round(q*(s.length-1))];',
  '       console.log(`n=${s.length} p50=${p(.5).toFixed(2)}ms p95=${p(.95).toFixed(2)}ms',
  '         fps_p50=${(1000/p(.5)).toFixed(1)}`); })()',
  '  5. Record GPU model + date + p50/p95 + FPS in README.md (Performance Benchmarks).',
  '  6. Repeat with the Stress Benchmark (2048x1024) preset for the fps-floor row.'
].join('\n');

describe('Frame-Time Benchmark (headless simulation budget)', () => {
  it('reports p50/p95/p99 simulation frame time and prints the browser procedure', { timeout: 600_000 }, () => {
    const frames = Number(process.env.FRAME_BENCH_FRAMES ?? 120);
    const width = Number(process.env.FRAME_BENCH_W ?? defaultConfig.fluid.nx);
    const height = Number(process.env.FRAME_BENCH_H ?? defaultConfig.fluid.ny);

    const { stats, realTimeHeadroom } = runFrameBenchmark({ frames, width, height });

    console.log('\n================================================================================');
    console.log(`[Frame Benchmark] ${width}x${height} fluid, ${stats.samples} frames (warmup excluded)`);
    console.log('--------------------------------------------------------------------------------');
    console.log(`  mean ${stats.meanMs.toFixed(3)} ms | p50 ${stats.p50Ms.toFixed(3)} ms | p95 ${stats.p95Ms.toFixed(3)} ms | p99 ${stats.p99Ms.toFixed(3)} ms`);
    console.log(`  min  ${stats.minMs.toFixed(3)} ms | max ${stats.maxMs.toFixed(3)} ms`);
    console.log(`  Simulation-side headroom at 60 Hz (16.67 ms): ${realTimeHeadroom.toFixed(2)}x`);
    console.log('--------------------------------------------------------------------------------');
    console.log('  NOTE: simulation budget only. This excludes GPU rasterisation, the 3D water');
    console.log('  surface, overlays, and compositing, so it is NOT the 60fps acceptance number.');
    console.log(`\n${BROWSER_PROCEDURE}`);
    console.log('================================================================================\n');

    expect(stats.samples).toBe(frames);
    expect(stats.p50Ms).toBeGreaterThan(0);
  });
});
