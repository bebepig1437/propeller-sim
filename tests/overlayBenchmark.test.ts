import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  OverlaySystem,
  DEFAULT_OVERLAY_STATE,
  OVERLAY_KEYS,
  type OverlayUpdateContext
} from '../src/render/overlays';
import { PropellerArray } from '../src/prop/array';
import { FluidSolver } from '../src/fluid/FluidSolver';
import { FluidGrid } from '../src/fluid/grid';
import { VehicleBody } from '../src/vehicle/body';
import { defaultConfig } from '../src/core/config';

const BUDGET_MS_PER_FRAME = 16.0;

function seedInflow(grid: FluidGrid): void {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      grid.u[i] = 1.5 + 0.4 * Math.sin((x / grid.width) * Math.PI * 2);
      grid.v[i] = 0.15 * Math.cos((y / grid.height) * Math.PI * 2);
      grid.dye[i] = x < 8 ? 1.0 : 0.0;
    }
  }
}

function makeCtx(grid: FluidGrid): OverlayUpdateContext {
  const vehicle = new VehicleBody(defaultConfig.vehicle);
  const summary = new PropellerArray().evaluate([1.0, 0.881, 0.67]);
  return {
    dt: 1 / 60,
    elapsed: 0,
    grid,
    gridCenter: new THREE.Vector3(0, 0, 0),
    gridDxM: 0.0015,
    vehicle,
    summary,
    motorTempsC: summary.thrusters.map(() => 42.0),
    motorCurrentsA: summary.thrusters.map(() => 1.1)
  };
}

function buildScenarios(grid: FluidGrid, ctx: OverlayUpdateContext) {
  const allOn = new OverlaySystem();
  for (const k of OVERLAY_KEYS) allOn.setVisible(k, true);

  const thrustOnly = new OverlaySystem();
  thrustOnly.setVisible('thrustArrows', true);
  thrustOnly.setVisible('velocityVectors', true);

  const fluidOnly = new OverlaySystem();
  fluidOnly.setVisible('streamlines', true);
  fluidOnly.setVisible('particles', true);

  return {
    all_on: () => {
      allOn.update(1 / 60, ctx);
    },
    thrust_and_vectors: () => {
      thrustOnly.update(1 / 60, ctx);
    },
    fluid_streams: () => {
      fluidOnly.update(1 / 60, ctx);
    },
    solver_baseline: () => {
      grid.sampleBilinear(grid.u, grid.width / 2, grid.height / 2);
    },
    cleanup: () => {
      allOn.dispose();
      thrustOnly.dispose();
      fluidOnly.dispose();
    }
  };
}

function medianFrameMs(run: () => void): number {
  for (let i = 0; i < 50; i++) run();
  const samples: number[] = [];
  for (let i = 0; i < 240; i++) {
    const t0 = performance.now();
    run();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

describe('Overlay frame budget (scenarized)', () => {
  it('median frame cost stays under 16 ms at default resolution, all overlays on', () => {
    const solver = new FluidSolver({
      gridOptions: { width: 256, height: 64 },
      pressureIterations: 24,
      jetConfig: { vx: 1.5, enabled: true }
    });
    seedInflow(solver.grid);
    for (let s = 0; s < 20; s++) solver.step(1 / 60);

    const ctx = makeCtx(solver.grid);
    const scenarios = buildScenarios(solver.grid, ctx);

    const results: Record<string, number> = {};
    for (const name of ['all_on', 'thrust_and_vectors', 'fluid_streams', 'solver_baseline'] as const) {
      results[name] = medianFrameMs(scenarios[name]);
    }

    scenarios.cleanup();

    const overheadAll = results.all_on - results.solver_baseline;
    const overheadThrust = results.thrust_and_vectors - results.solver_baseline;
    const overheadFluid = results.fluid_streams - results.solver_baseline;

    console.log('[overlay-frame-budget] median ms per scenario:', {
      all_on: results.all_on.toFixed(3),
      thrust_and_vectors: results.thrust_and_vectors.toFixed(3),
      fluid_streams: results.fluid_streams.toFixed(3),
      solver_baseline: results.solver_baseline.toFixed(3),
      overlay_overhead_ms: overheadAll.toFixed(3)
    });

    expect(results.all_on).toBeLessThan(BUDGET_MS_PER_FRAME);
    expect(overheadThrust).toBeLessThan(2.0);
    expect(overheadFluid).toBeLessThan(8.0);
  });

  it('default overlay state at rest stays under a 4 ms frame budget', () => {
    const solver = new FluidSolver({
      gridOptions: { width: 256, height: 64 },
      pressureIterations: 24,
      jetConfig: { vx: 1.5, enabled: true }
    });
    seedInflow(solver.grid);

    const system = new OverlaySystem();
    for (const k of OVERLAY_KEYS) {
      system.setVisible(k, DEFAULT_OVERLAY_STATE[k]);
    }

    const ctx = makeCtx(solver.grid);
    const median = medianFrameMs(() => system.update(1 / 60, ctx));
    console.log('[overlay-frame-budget] at-rest median ms:', median.toFixed(3));

    expect(median).toBeLessThan(4.0);
    system.dispose();
  });
});
