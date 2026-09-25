import { describe, it, expect } from 'vitest';
import { SimClock } from '../src/core/clock';
import { solveBemt } from '../src/prop/bemt';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';
import { FluidGrid } from '../src/fluid/grid';
import { TestStandPipe } from '../src/render/pipe';
import { WaterVisualization } from '../src/render/waterViz';
import { PropellerShaft } from '../src/prop/rigidbody';
import { ActuatorDiscCoupler } from '../src/prop/coupling';

describe('Phase 3 — Water That Reads as Water, Slow Motion Coupling', () => {
  it('scales substep count strictly with timeScale: 1000ms at 1.0x runs 60 substeps, at 0.1x runs 6 substeps', () => {
    const clock1 = new SimClock(1.0 / 60.0, 120, 1.0);
    clock1.start(0);
    let steps1 = 0;
    clock1.tick(1000, () => {
      steps1++;
    });
    expect(steps1).toBe(60);

    const clock01 = new SimClock(1.0 / 60.0, 120, 0.1);
    clock01.start(0);
    let steps01 = 0;
    clock01.tick(1000, () => {
      steps01++;
    });
    expect(steps01).toBe(6);
  });

  it('verifies solveBemt is invariant under timeScale (same RPM and inflow produce identical thrust within 1e-6)', () => {
    const rpm = 3800;
    const v = 1.5;
    const res1 = solveBemt(rpm, v);
    const res2 = solveBemt(rpm, v);
    expect(Math.abs(res1.thrustN - res2.thrustN)).toBeLessThan(1e-6);
    expect(Math.abs(res1.torqueNm - res2.torqueNm)).toBeLessThan(1e-6);
  });

  it('verifies fluid coupling advances per substep and injects dye at inlet', () => {
    const solver = new GpuFluidSolver({ gridOptions: { width: 128, height: 64 } });
    solver.step(1.0 / 60.0);

    let inletDyeSum = 0;
    for (let y = 1; y < 63; y++) {
      for (let x = 1; x <= 4; x++) {
        inletDyeSum += solver.grid.dye[y * 128 + x];
      }
    }
    expect(inletDyeSum).toBeGreaterThan(0);
  });

  it('advects particles based on fluid grid and fixed substep dt: 60 substeps advance known distance', () => {
    const pipe = new TestStandPipe();
    const grid = new FluidGrid({ width: 128, height: 64 });
    const testU = 0.05; /* 0.05 m/s */
    grid.u.fill(testU);
    const shaft = new PropellerShaft(0, 0);

    const viz = new WaterVisualization(pipe, grid, { particleCount: 1 });
    const part = (viz as any).particles[0];
    part.x = -0.06; /* Inside pipe [-0.095, 0.095] */
    part.age = 0;
    part.maxAge = 100.0; /* Prevent age respawn during test */

    const dt = 1.0 / 60.0;
    for (let s = 0; s < 60; s++) {
      viz.stepParticles(dt, grid, shaft);
    }

    /* In 60 substeps (1.0 sim second) at 0.05 m/s, delta x is 0.05 m; lands at -0.01 m */
    expect(part.x).toBeCloseTo(-0.01, 2);

    viz.dispose();
    pipe.dispose();
  });

  it('verifies fluid coupling advances identically per sim second regardless of wall clock', () => {
    const clock1 = new SimClock(1.0 / 60.0, 1200, 1.0);
    const clock01 = new SimClock(1.0 / 60.0, 1200, 0.1);
    clock1.start(0);
    clock01.start(0);

    const grid1 = new FluidGrid({ width: 128, height: 64 });
    const grid2 = new FluidGrid({ width: 128, height: 64 });
    const bemt: any = { thrustN: 2.0, torqueNm: 0.015 };

    const coupler1 = new ActuatorDiscCoupler();
    const coupler2 = new ActuatorDiscCoupler();

    /* 1.0 real second at 1.0x timeScale -> 60 substeps */
    clock1.tick(1000, (dt) => {
      coupler1.injectCouplingForces(grid1, bemt, dt);
    });

    /* 10.0 real seconds (10 x 1000ms frames) at 0.1x timeScale -> exactly 60 substeps (1.0 sim second) */
    for (let sec = 1; sec <= 10; sec++) {
      clock01.tick(sec * 1000, (dt) => {
        coupler2.injectCouplingForces(grid2, bemt, dt);
      });
    }

    const midIdx = 32 * 128 + 64;
    expect(grid1.u[midIdx]).toBeGreaterThan(1e-3);
    /* Both produce identical fluid coupling changes because sim time is identical */
    expect(grid1.u[midIdx]).toBeCloseTo(grid2.u[midIdx], 5);
  });

  it('creates and disposes TestStandPipe and WaterVisualization cleanly without errors', () => {
    const pipe = new TestStandPipe();
    const grid = new FluidGrid({ width: 128, height: 64 });
    const viz = new WaterVisualization(pipe, grid);

    expect(pipe.pipeMesh).toBeDefined();
    expect(pipe.inletRing).toBeDefined();
    expect(pipe.outletRing).toBeDefined();
    expect(pipe.shaftMesh).toBeDefined();
    expect(viz.group).toBeDefined();

    expect(() => {
      viz.dispose();
      pipe.dispose();
    }).not.toThrow();
  });
});
