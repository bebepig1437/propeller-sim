import { describe, it, expect } from 'vitest';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';

describe('F3 — compare-mode consistency (solver defaults on both sides)', () => {
  it('compare-mode diff < 1% of peak |u|', () => {
    // Both legs must run the shipped defaults: the regression was that
    // runCompareValidation built its independent solver without propagating
    // `pressureMethod`, so the two solves used different solvers.
    const solver = new GpuFluidSolver({
      gridOptions: { width: 256, height: 64 },
      jetConfig: { vx: 2.5, enabled: true },
      pressureIterations: 24
    });
    solver.step(1 / 60);
    solver.step(1 / 60);

    let peakU = 0;
    for (let i = 0; i < solver.grid.u.length; i++) peakU = Math.max(peakU, Math.abs(solver.grid.u[i]));

    const m = solver.runCompareValidation(1 / 60);
    const relPct = (m.maxDiffU / peakU) * 100;
    console.log('[compare-mode] maxDiffU =', m.maxDiffU.toExponential(3), 'relPct =', relPct.toFixed(4));
    expect(relPct).toBeLessThan(1.0);
  });
});
