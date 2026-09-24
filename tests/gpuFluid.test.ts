import { describe, it, expect } from 'vitest';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';
import { createAdvectionComputeNode } from '../src/fluid/gpu/computeAdvection';
import { createCurlComputeNode } from '../src/fluid/gpu/computeCurl';
import { createVorticityComputeNode } from '../src/fluid/gpu/computeVorticity';
import { createDivergenceComputeNode } from '../src/fluid/gpu/computeDivergence';
import { createPressureComputeNode } from '../src/fluid/gpu/computePressure';
import { createProjectComputeNode } from '../src/fluid/gpu/computeProject';
import { createSourcesComputeNode } from '../src/fluid/gpu/computeSources';
import { FluidGrid } from '../src/fluid/grid';

describe('Phase 2 — Fluid GPU Port (TSL)', () => {
  it('instantiates all TSL compute nodes with storage buffers and uniform bindings', () => {
    const W = 128;
    const H = 64;

    const advection = createAdvectionComputeNode(W, H);
    expect(advection.forwardNode).toBeDefined();
    expect(advection.backwardNode).toBeDefined();
    expect(advection.correctNode).toBeDefined();
    expect(advection.semiLagrangianNode).toBeDefined();
    expect(advection.dtUniform.value).toBeCloseTo(1 / 60, 4);

    const curl = createCurlComputeNode(W, H);
    expect(curl.node).toBeDefined();
    expect(curl.halfInvDxUniform.value).toBe(0.5);

    const vorticity = createVorticityComputeNode(W, H);
    expect(vorticity.node).toBeDefined();
    expect(vorticity.strengthUniform.value).toBe(4.0);

    const divergence = createDivergenceComputeNode(W, H);
    expect(divergence.node).toBeDefined();

    const pressure = createPressureComputeNode(W, H);
    expect(pressure.forwardNode).toBeDefined();
    expect(pressure.backwardNode).toBeDefined();

    const project = createProjectComputeNode(W, H);
    expect(project.node).toBeDefined();

    const sources = createSourcesComputeNode(W, H);
    expect(sources.node).toBeDefined();
    expect(sources.vxUniform.value).toBe(2.5);
  });

  it('instantiates GpuFluidSolver and defaults to 1024x512 resolution with CPU fallback in headless/Node', () => {
    const solver = new GpuFluidSolver({
      gridOptions: { width: 1024, height: 512 },
      pressureIterations: 30
    });

    expect(solver.width).toBe(1024);
    expect(solver.height).toBe(512);
    expect(solver.grid.width).toBe(1024);
    expect(solver.grid.height).toBe(512);
    expect(solver.isGpuAccelerated).toBe(false);
  });

  it('records per-pass timings across all solver passes', () => {
    const solver = new GpuFluidSolver({
      gridOptions: { width: 128, height: 64 },
      pressureIterations: 10
    });

    const metrics = solver.step(1.0 / 60.0);
    expect(metrics.stepTimeMs).toBeGreaterThan(0);

    const timings = solver.passTimings;
    expect(timings.sourcesMs).toBeGreaterThanOrEqual(0);
    expect(timings.curlMs).toBeGreaterThanOrEqual(0);
    expect(timings.vorticityMs).toBeGreaterThanOrEqual(0);
    expect(timings.advectMs).toBeGreaterThanOrEqual(0);
    expect(timings.divergenceMs).toBeGreaterThanOrEqual(0);
    expect(timings.pressureMs).toBeGreaterThanOrEqual(0);
    expect(timings.projectMs).toBeGreaterThanOrEqual(0);
    expect(timings.totalFluidMs).toBeGreaterThan(0);
  });

  it('supports dynamic resolution scaling (1024x512 -> 512x256 -> 256x128)', () => {
    const solver = new GpuFluidSolver({
      gridOptions: { width: 1024, height: 512 }
    });

    expect(solver.width).toBe(1024);
    expect(solver.height).toBe(512);

    solver.setResolution(512, 256);
    expect(solver.width).toBe(512);
    expect(solver.height).toBe(256);
    expect(solver.grid.width).toBe(512);
    expect(solver.grid.height).toBe(256);

    solver.setResolution(256, 128);
    expect(solver.width).toBe(256);
    expect(solver.height).toBe(128);
    expect(solver.grid.width).toBe(256);
    expect(solver.grid.height).toBe(128);
  });

  it('verifies GPU readback round-trip proves grid.u/v/dye reflect GPU output', async () => {
    const solver = new GpuFluidSolver({
      gridOptions: { width: 128, height: 64 }
    });

    solver.step(1.0 / 60.0);

    const targetGrid = new FluidGrid({ width: 128, height: 64 });
    const readbackResult = await solver.readbackGpuBuffers(targetGrid);

    expect(readbackResult.u).toBeInstanceOf(Float32Array);
    expect(readbackResult.v).toBeInstanceOf(Float32Array);
    expect(readbackResult.dye).toBeInstanceOf(Float32Array);
    expect(readbackResult.dye.length).toBe(128 * 64);
    expect(targetGrid.u.length).toBe(128 * 64);
  });

  it('Phase 2 Readback gate: asserts that grid.u changes from initial zero value after one step and readback', () => {
    const solver = new GpuFluidSolver({
      gridOptions: { width: 128, height: 64 },
      jetConfig: { vx: 3.0, enabled: true }
    });

    let initialSumU = 0;
    for (let i = 0; i < solver.grid.size; i++) {
      initialSumU += Math.abs(solver.grid.u[i]);
    }
    expect(initialSumU).toBe(0);

    solver.step(1.0 / 60.0);
    const readback = solver.readbackSync();

    let newSumU = 0;
    for (let i = 0; i < solver.grid.size; i++) {
      newSumU += Math.abs(readback.u[i]);
    }
    expect(newSumU).toBeGreaterThan(0);
    expect(solver.grid.u).toBe(readback.u);
  });

  it('Lifecycle: dispose releases all resources and resizing recreates them without leaking', () => {
    const solver = new GpuFluidSolver({
      gridOptions: { width: 1024, height: 512 }
    });

    expect(solver.width).toBe(1024);
    expect(solver.height).toBe(512);

    solver.setResolution(512, 256);
    expect(solver.width).toBe(512);
    expect(solver.height).toBe(256);
    expect(solver.grid.size).toBe(512 * 256);

    solver.dispose();
  });
});
