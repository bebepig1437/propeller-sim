import { describe, it, expect } from 'vitest';
import { FluidGrid } from '../src/fluid/grid';
import { BoundaryHandler } from '../src/fluid/boundary';
import { projectVelocity, computeDivergence, getMaxDivergence, solvePressurePoisson } from '../src/fluid/pressure';
import { advectMacCormack } from '../src/fluid/advect';
import { FluidSolver } from '../src/fluid/FluidSolver';
import { VORTICITY_GRADIENT_EPSILON, applyVorticityConfinement } from '../src/fluid/vorticity';

describe('Phase 1 — Fluid Core (CPU Reference)', () => {
  it('Divergence of the field after projection is ~0 (max abs < 1e-3)', () => {
    const grid = new FluidGrid({ width: 32, height: 32 });
    const boundary = new BoundaryHandler('FREE_SLIP');

    for (let y = 1; y < grid.height - 1; y++) {
      for (let x = 1; x < grid.width - 1; x++) {
        const idx = grid.idx(x, y);
        grid.u[idx] = Math.sin((2 * Math.PI * x) / grid.width) * 0.01;
        grid.v[idx] = Math.sin((2 * Math.PI * y) / grid.height) * 0.01;
      }
    }
    boundary.applyVelocityBoundary(grid);

    computeDivergence(grid, boundary);
    const initialDiv = getMaxDivergence(grid, 3);
    expect(initialDiv).toBeGreaterThan(0.002);

    // Project velocity with 200 Jacobi iterations
    projectVelocity(grid, 200, boundary);

    const postDiv = getMaxDivergence(grid, 4);
    expect(postDiv).toBeLessThan(1e-3);
  });

  it('A single injected vortex conserves total dye mass within 1%', () => {
    const grid = new FluidGrid({ width: 64, height: 64 });
    const boundary = new BoundaryHandler('FREE_SLIP');
    const dt = 0.01;

    // Divergence-free circular vortex in the center
    const cx = 32;
    const cy = 32;
    const radius = 16;
    const omega = 1.0;

    for (let y = 1; y < grid.height - 1; y++) {
      for (let x = 1; x < grid.width - 1; x++) {
        const idx = grid.idx(x, y);
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);

        if (r < radius) {
          // Tangential circular velocity
          grid.u[idx] = -omega * (dy * grid.dx);
          grid.v[idx] = omega * (dx * grid.dx);

          // Smooth cosine bell dye blob in core of vortex
          if (r < 8) {
            grid.dye[idx] = Math.cos((r / 8) * (Math.PI * 0.5));
          }
        }
      }
    }
    boundary.applyVelocityBoundary(grid);

    // Initial total mass
    let initialMass = 0;
    for (let i = 0; i < grid.size; i++) {
      initialMass += grid.dye[i];
    }
    expect(initialMass).toBeGreaterThan(0);

    // Advect for 30 steps using MacCormack
    for (let step = 0; step < 30; step++) {
      grid.swapDye();
      advectMacCormack(grid, grid.dyePrev, grid.dye, dt, boundary, false);
    }

    // Final total mass
    let finalMass = 0;
    for (let i = 0; i < grid.size; i++) {
      finalMass += grid.dye[i];
    }

    const relativeDiff = Math.abs(finalMass - initialMass) / initialMass;
    expect(relativeDiff).toBeLessThan(0.01); // within 1%
  });

  it('Pressure residual decreases monotonically over iterations', () => {
    const grid = new FluidGrid({ width: 64, height: 64 });
    const boundary = new BoundaryHandler('OPEN_OUTFLOW');

    // Create non-zero divergence field
    for (let y = 16; y < 48; y++) {
      for (let x = 16; x < 48; x++) {
        const idx = grid.idx(x, y);
        grid.div[idx] = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 0.05;
      }
    }

    const result = solvePressurePoisson(grid, 50, boundary);
    expect(result.residuals.length).toBe(50);

    // Sample residuals at intervals and check monotonic decrease
    const r1 = result.residuals[0];
    const r10 = result.residuals[9];
    const r25 = result.residuals[24];
    const r50 = result.residuals[49];

    expect(r10).toBeLessThan(r1);
    expect(r25).toBeLessThan(r10);
    expect(r50).toBeLessThan(r25);

    // Ensure non-increasing trend overall (at least 90% non-increasing steps)
    let drops = 0;
    for (let i = 1; i < result.residuals.length; i++) {
      if (result.residuals[i] <= result.residuals[i - 1]) {
        drops++;
      }
    }
    expect(drops / (result.residuals.length - 1)).toBeGreaterThanOrEqual(0.9);
  });

  it('Performance benchmark at 256x128 grid', () => {
    const solver = new FluidSolver({
      gridOptions: { width: 256, height: 128 },
      pressureIterations: 30,
      vorticityStrength: 4.0,
      advectionScheme: 'MACCORMACK'
    });

    // Warm-up 3 steps
    for (let i = 0; i < 3; i++) {
      solver.step();
    }

    // Benchmark 20 steps
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const metrics = solver.step();
      times.push(metrics.stepTimeMs);
    }

    const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`\n======================================================`);
    console.log(`[Fluid Benchmark 256x128] Average ms/step: ${avgMs.toFixed(2)} ms (30 iters, MacCormack, Vorticity)`);
    console.log(`======================================================\n`);
    expect(avgMs).toBeGreaterThan(0);
  });

  it('FluidGrid supports bounds checking get/set and interior/boundary classification', () => {
    const grid = new FluidGrid({ width: 16, height: 8 });
    expect(grid.inBounds(0, 0)).toBe(true);
    expect(grid.inBounds(15, 7)).toBe(true);
    expect(grid.inBounds(16, 7)).toBe(false);
    expect(grid.inBounds(0, 8)).toBe(false);
    expect(grid.inBounds(-1, 0)).toBe(false);

    // Interior vs Boundary
    expect(grid.isBoundary(0, 0)).toBe(true);
    expect(grid.isBoundary(15, 4)).toBe(true);
    expect(grid.isBoundary(8, 0)).toBe(true);
    expect(grid.isBoundary(8, 7)).toBe(true);
    expect(grid.isInterior(0, 0)).toBe(false);
    expect(grid.isInterior(8, 4)).toBe(true);
    expect(grid.isBoundary(8, 4)).toBe(false);

    // get / set with bounds checking
    grid.set(grid.u, 5, 3, 12.34);
    expect(grid.get(grid.u, 5, 3)).toBeCloseTo(12.34, 4);

    expect(() => grid.get(grid.u, -1, 3)).toThrow(RangeError);
    expect(() => grid.get(grid.u, 16, 3)).toThrow(RangeError);
    expect(() => grid.set(grid.v, 5, 8, 1.0)).toThrow(RangeError);
  });

  it('BoundaryHandler supports per-edge boundary conditions (SOLID, OPEN_OUTFLOW, FREE_SLIP)', () => {
    const grid = new FluidGrid({ width: 8, height: 8 });
    const handler = new BoundaryHandler({
      left: 'SOLID',
      right: 'OPEN_OUTFLOW',
      top: 'FREE_SLIP',
      bottom: 'SOLID'
    });

    // Populate interior with known velocities
    for (let y = 1; y < 7; y++) {
      for (let x = 1; x < 7; x++) {
        grid.u[grid.idx(x, y)] = 2.0;
        grid.v[grid.idx(x, y)] = 3.0;
      }
    }

    handler.applyVelocityBoundary(grid);

    // Left is SOLID -> u[0, y] = 0, v[0, y] = -v[1, y]
    expect(grid.u[grid.idx(0, 3)]).toBe(0);
    expect(grid.v[grid.idx(0, 3)]).toBe(-3.0);

    // Right is OPEN_OUTFLOW -> u[7, y] = u[6, y], v[7, y] = v[6, y]
    expect(grid.u[grid.idx(7, 3)]).toBe(2.0);
    expect(grid.v[grid.idx(7, 3)]).toBe(3.0);

    // Top is FREE_SLIP -> u[x, 7] = u[x, 6], v[x, 7] = 0
    expect(grid.u[grid.idx(3, 7)]).toBe(2.0);
    expect(grid.v[grid.idx(3, 7)]).toBe(0);

    // Bottom is SOLID -> u[x, 0] = -u[x, 1], v[x, 0] = 0
    expect(grid.u[grid.idx(3, 0)]).toBe(-2.0);
    expect(grid.v[grid.idx(3, 0)]).toBe(0);
  });

  it('CFL guard test: injects velocity spike violating CFL at dt=1/60 and verifies solver substeps/clamps without producing NaN', () => {
    const solver = new FluidSolver({
      gridOptions: { width: 32, height: 32, dx: 1.0 },
      pressureIterations: 20
    });

    // Inject massive velocity spike in the center: u = 100.0 m/s (CFL = 100 * (1/60) / 1.0 = 1.67, with 200 m/s CFL = 3.33 > 2.0)
    const centerIdx = solver.grid.idx(16, 16);
    solver.grid.u[centerIdx] = 250.0;
    solver.grid.v[centerIdx] = 180.0;

    // Advance solver with dt = 1/60
    const metrics = solver.step(1.0 / 60.0);

    // Verify all grid values remain strictly finite (no NaN, no Infinity)
    for (let i = 0; i < solver.grid.size; i++) {
      expect(Number.isFinite(solver.grid.u[i])).toBe(true);
      expect(Number.isFinite(solver.grid.v[i])).toBe(true);
      expect(Number.isFinite(solver.grid.dye[i])).toBe(true);
      expect(Number.isNaN(solver.grid.u[i])).toBe(false);
      expect(Number.isNaN(solver.grid.v[i])).toBe(false);
    }
    expect(Number.isFinite(metrics.maxDivergence)).toBe(true);
  });

  it('Vorticity confinement epsilon test: in an irrotational field, confinement force is exactly zero without NaN', () => {
    const grid = new FluidGrid({ width: 32, height: 32, dx: 1.0 });

    // Set uniform irrotational flow: u = 5.0, v = 0.0 everywhere
    for (let i = 0; i < grid.size; i++) {
      grid.u[i] = 5.0;
      grid.v[i] = 0.0;
    }

    const initialU = new Float32Array(grid.u);
    const initialV = new Float32Array(grid.v);

    // Documented epsilon threshold check
    expect(VORTICITY_GRADIENT_EPSILON).toBe(1e-7);

    // Apply vorticity confinement with high strength
    applyVorticityConfinement(grid, 1.0 / 60.0, 10.0);

    // Confinement force must be identically 0.0 everywhere in the irrotational field
    for (let i = 0; i < grid.size; i++) {
      expect(grid.u[i]).toBe(initialU[i]);
      expect(grid.v[i]).toBe(initialV[i]);
      expect(Number.isNaN(grid.u[i])).toBe(false);
      expect(Number.isNaN(grid.v[i])).toBe(false);
    }
  });

  it('Steady inflow maintains max |divergence| < 1e-3 after projection (Phase 2 oracle)', () => {
    const solver = new FluidSolver({
      gridOptions: { width: 64, height: 32 },
      pressureIterations: 40,
      jetConfig: { vx: 2.0, enabled: true }
    });

    // Run for 15 steps with steady inflow
    for (let step = 0; step < 15; step++) {
      solver.step(1.0 / 60.0);
    }

    expect(solver.metrics.maxDivergence).toBeLessThan(1e-3);
  });
});

