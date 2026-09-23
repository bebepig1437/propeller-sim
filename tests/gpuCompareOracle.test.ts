import { describe, it, expect } from 'vitest';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';

const BULK_MARGIN_CELLS = 12;

/**
 * F4 contract: a GPU-vs-CPU oracle row is only meaningful when a real WebGPU device
 * exists. In CI/Node there is none, so `runCompareValidation` degenerates to a
 * CPU-vs-CPU self-comparison (its two legs are the same `FluidSolver` code path).
 * That case asserts the *metric contract* only and is reported as a skip for the
 * oracle leg, never as a 0.000%-agreement GPU result.
 */
const HAS_WEBGPU =
  typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu;

function divergenceStats(grid: { width: number; height: number; div: Float32Array }, margin: number) {
  const W = grid.width;
  const H = grid.height;
  let maxV = 0;
  let sum = 0;
  let n = 0;
  for (let y = margin; y < H - margin; y++) {
    const row = y * W;
    for (let x = margin; x < W - margin; x++) {
      const a = Math.abs(grid.div[row + x]);
      if (a > maxV) maxV = a;
      sum += a;
      n++;
    }
  }
  return { max: maxV, mean: sum / Math.max(1, n) };
}

function makeSolver() {
  return new GpuFluidSolver({
    gridOptions: { width: 256, height: 64 },
    jetConfig: { vx: 2.5, enabled: true },
    pressureIterations: 24
  });
}

function peakAbs(values: Float32Array): number {
  let p = 0;
  for (let i = 0; i < values.length; i++) p = Math.max(p, Math.abs(values[i]));
  return p;
}

describe('F4 — compare-metric contract (CPU path; NOT a GPU-agreement result)', () => {
  it('L-inf per field normalized by max|u|; bulk divergence gated; live grid unmutated', () => {
    const solver = makeSolver();
    solver.step(1 / 60);
    solver.step(1 / 60);

    const divergenceAfterStep = solver.cpuFallback.metrics.maxDivergence;
    const peakU = peakAbs(solver.grid.u);

    const uSnapshot = new Float32Array(solver.grid.u);
    const vSnapshot = new Float32Array(solver.grid.v);

    const m = solver.runCompareValidation(1 / 60);

    const relU = m.maxDiffU / peakU;
    const relV = m.maxDiffV / peakU;
    const relRms = m.rmsDiff / peakU;

    const bulk = divergenceStats(solver.grid, BULK_MARGIN_CELLS);

    console.log('[compare-metric-contract]', {
      gpuAccelerated: solver.isGpuAccelerated,
      metric:
        'L-inf per field normalized by max|u|; divergence stats exclude 12-cell inlet forcing band (Dirichlet inflow faces excluded)',
      peakU: peakU.toFixed(4),
      maxDiffU: m.maxDiffU.toExponential(3),
      maxDiffV: m.maxDiffV.toExponential(3),
      relDiffU_pct: (relU * 100).toFixed(3),
      relDiffV_pct: (relV * 100).toFixed(3),
      relRmsDye_pct: (relRms * 100).toFixed(3),
      interiorMaxDiv_inclInletBand_abs: divergenceAfterStep.toExponential(3),
      bulkMaxDiv_abs: bulk.max.toExponential(3),
      bulkMeanDiv_abs: bulk.mean.toExponential(3)
    });

    expect(relU * 100).toBeLessThanOrEqual(5.0);
    expect(relV * 100).toBeLessThanOrEqual(5.0);
    expect(relRms * 100).toBeLessThanOrEqual(5.0);
    expect(bulk.max).toBeLessThan(5e-2);
    expect(bulk.mean).toBeLessThan(1e-3);

    for (let i = 0; i < solver.grid.size; i++) {
      expect(solver.grid.u[i]).toBe(uSnapshot[i]);
      expect(solver.grid.v[i]).toBe(vSnapshot[i]);
    }
  });
});

describe.skipIf(!HAS_WEBGPU)(
  'GPU-vs-CPU oracle gate — SKIPPED: WebGPU device unavailable in CI/Node, so GPU↔CPU L∞ agreement is UNVERIFIED (tracked in Open Risks)',
  () => {
    it('one-step L-inf agreement <= 5% of peak |u| between the real GPU solve and the independent CPU solve', () => {
      const solver = makeSolver();
      expect(solver.isGpuAccelerated).toBe(true);
      solver.step(1 / 60);
      const peakU = peakAbs(solver.grid.u);
      const m = solver.runCompareValidation(1 / 60);
      const relPct = (m.maxDiffU / peakU) * 100;
      console.log('[gpu-vs-cpu-oracle] relDiffU_pct =', relPct.toFixed(4));
      expect(relPct).toBeLessThanOrEqual(5.0);
    });
  }
);
