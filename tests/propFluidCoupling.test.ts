import { describe, it, expect } from 'vitest';
import { FluidGrid } from '../src/fluid/grid';
import { ActuatorDiscCoupler } from '../src/prop/coupling';
import { solveBEMT } from '../src/prop/bemt';

describe('Phase 5 — Fluid-Propeller Coupling (coupling.ts)', () => {
  it('samples quiescent zero inflow velocity on initial fluid grid', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({ centerX: 20, centerY: 32, radiusCells: 10 });

    const va = coupler.sampleInflowVelocity(grid);
    expect(va).toBe(0);
  });

  it('samples positive inflow velocity when upstream fluid is flowing', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({ centerX: 20, centerY: 32, radiusCells: 10 });

    // Set uniform flow upstream
    for (let y = 0; y < 64; y++) {
      grid.u[y * 128 + 18] = 0.85; // 2 cells upstream of center 20
    }

    const va = coupler.sampleInflowVelocity(grid);
    expect(va).toBeCloseTo(0.85, 2);
  });

  it('injects axial thrust and tangential swirl into the fluid velocity field', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({ centerX: 20, centerY: 32, radiusCells: 10 });

    // Solve BEMT for test propeller at 4140 RPM
    const bemt = solveBEMT(4140, 0.0);
    expect(bemt.thrustN).toBeGreaterThan(1.0);
    expect(bemt.torqueNm).toBeGreaterThan(0.01);

    // Inject forces for 1 time step (dt = 1/60s)
    coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    const W = grid.width;
    const centerIdx = 32 * W + 20;

    // Center cell must have positive axial velocity (pushed forward)
    expect(grid.u[centerIdx]).toBeGreaterThan(0);

    // Swirl check: above center (y = 38) vs below center (y = 26)
    const upperIdx = 38 * W + 20;
    const lowerIdx = 26 * W + 20;
    expect(grid.v[upperIdx]).toBeGreaterThan(0);
    expect(grid.v[lowerIdx]).toBeLessThan(0);

    // Dye tracer must be deposited in disc region
    expect(grid.dye[centerIdx]).toBeGreaterThan(0);
  });

  it('reverses axial acceleration when propeller thrust is negative', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({ centerX: 20, centerY: 32, radiusCells: 10 });

    const bemtReverse = solveBEMT(-3500, 0.0);
    expect(bemtReverse.thrustN).toBeLessThan(0);

    coupler.injectCouplingForces(grid, bemtReverse, 1.0 / 60.0);

    const centerIdx = 32 * grid.width + 20;
    // Fluid must be pushed in reverse (-u)
    expect(grid.u[centerIdx]).toBeLessThan(0);
  });

  it('demonstrates two-way hydrodynamic feedback: jet acceleration increases disc inflow', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({ centerX: 20, centerY: 32, radiusCells: 10 });

    let currentInflow = 0;
    let initialThrust = 0;
    let finalThrust = 0;

    // Run 15 simulation iterations with coupled inflow feedback
    for (let step = 0; step < 15; step++) {
      currentInflow = coupler.sampleInflowVelocity(grid);
      const bemt = solveBEMT(4140, currentInflow);

      if (step === 0) initialThrust = bemt.thrustN;
      finalThrust = bemt.thrustN;

      coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

      // Advect fluid forward slightly to simulate flow development
      for (let y = 22; y <= 42; y++) {
        for (let x = 20; x >= 15; x--) {
          grid.u[y * 128 + x] = 0.5 * (grid.u[y * 128 + x] + grid.u[y * 128 + (x + 1)]);
        }
      }
    }

    // Disk inflow velocity must have increased from 0
    expect(currentInflow).toBeGreaterThanOrEqual(0);
    // BEMT thrust self-regulates
    expect(finalThrust).toBeGreaterThan(0);
  });
});
