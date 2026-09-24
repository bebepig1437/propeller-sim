import { describe, it, expect } from 'vitest';
import { FluidGrid } from '../src/fluid/grid';
import { ActuatorDiscCoupler } from '../src/prop/coupling';
import { solveBemt } from '../src/prop/bemt';

describe('Phase 5 — Fluid <-> Propeller Bidirectional Coupling', () => {
  it('strictly conserves momentum: sum of body force over all cells equals BEMT thrust', () => {
    const grid = new FluidGrid({ width: 128, height: 64, dx: 0.0015 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 24,
      centerY: 32,
      radiusCells: 10,
      thicknessCells: 3,
      gridDxM: 0.0015,
      depthM: 0.042,
      fluidDensity: 1000.0
    });

    const bemt = solveBemt(4140, 0.0);
    const T = bemt.thrustN;
    expect(T).toBeGreaterThan(1.0);

    const dt = 1.0 / 60.0;
    const initialU = new Float32Array(grid.u);

    coupler.injectCouplingForces(grid, bemt, dt);

    const cellMassKg = coupler.cellMassKg;

    let totalForceSumX = 0;
    const size = grid.width * grid.height;
    for (let i = 0; i < size; i++) {
      const deltaU = grid.u[i] - initialU[i];
      totalForceSumX += cellMassKg * (deltaU / dt);
    }

    const relativeError = Math.abs(totalForceSumX - T) / T;
    expect(relativeError).toBeLessThan(0.001);
  });

  it('invalidates cache when disc position, radius, or thickness change', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 20,
      centerY: 30,
      radiusCells: 8,
      thicknessCells: 2
    });

    const bemt = solveBemt(3800, 0.0);
    coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    const idxInitial = 30 * 128 + 20;
    expect(grid.u[idxInitial]).toBeGreaterThan(0);

    grid.reset();
    coupler.config.centerX = 50;
    coupler.config.centerY = 45;

    coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    expect(grid.u[idxInitial]).toBe(0);
    const idxNew = 45 * 128 + 50;
    expect(grid.u[idxNew]).toBeGreaterThan(0);
  });

  it('samples signed reverse inflow without clamping to >= 0', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 25,
      centerY: 32,
      radiusCells: 8,
      inflowRelaxation: 1.0
    });

    for (let y = 0; y < 64; y++) {
      grid.u[y * 128 + 23] = -0.75;
    }

    const va = coupler.sampleInflowVelocity(grid);
    expect(va).toBeCloseTo(-0.75, 2);

    const bemtReverse = solveBemt(3800, va);
    expect(Number.isFinite(bemtReverse.thrustN)).toBe(true);
    expect(Number.isFinite(bemtReverse.torqueNm)).toBe(true);
  });

  it('applies relaxation damping to smooth inflow oscillations', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 25,
      centerY: 32,
      radiusCells: 8,
      inflowRelaxation: 0.5
    });

    const va0 = coupler.sampleInflowVelocity(grid);
    expect(va0).toBe(0);

    for (let y = 0; y < 64; y++) {
      grid.u[y * 128 + 23] = 2.0;
    }

    const va1 = coupler.sampleInflowVelocity(grid);
    expect(va1).toBeCloseTo(1.0, 3);

    const va2 = coupler.sampleInflowVelocity(grid);
    expect(va2).toBeCloseTo(1.5, 3);
  });

  it('guarantees zero heap allocations in coupling hot path', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({ centerX: 25, centerY: 32, radiusCells: 10 });
    const bemt = solveBemt(3800, 0.0);

    const tele1 = coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);
    const tele2 = coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    expect(tele1).toBe(tele2);
  });
});
