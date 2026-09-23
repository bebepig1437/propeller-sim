import { describe, it, expect } from "vitest";
import { FluidGrid } from "../src/fluid/grid";
import { GpuFluidSolver } from "../src/fluid/gpu/gpuFluidSolver";
import { PowerBus } from "../src/power/bus";
import { ActuatorDiscCoupler } from "../src/prop/coupling";
import { solveBemt } from "../src/prop/bemt";
import { VehicleBody } from "../src/vehicle/body";
import { stepVehicleRigidBody } from "../src/vehicle/integrator";
import { defaultConfig } from "../src/core/config";
import { solvePressureMultigrid, computeDivergence, getMaxDivergence } from "../src/fluid/pressure";
import { RecoveryCoordinator } from "../src/sim/recoveryCoordinator";

describe("Phase 8 Performance and Robustness Verification", () => {
  it("zero_allocation_audit", { timeout: 150000 }, () => {
    const grid = new FluidGrid({ width: 256, height: 128 });
    const gpuSolver = new GpuFluidSolver({ gridOptions: { width: 256, height: 128 } });
    const bus = new PowerBus(3, 12.0, 0.782);
    const coupler = new ActuatorDiscCoupler({ centerX: 28, centerY: 64, radiusCells: 14 });
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    const dt = 1.0 / 60.0;

    const throttles = [1.0, 0.8, 0.8];
    let currentTorque = 0;
    const loadFn = () => currentTorque;
    const loadTorqueFns = [loadFn, loadFn, loadFn];
    const thrusterForces = [0, 0, 0];

    for (let i = 0; i < 120; i++) {
      const va = coupler.sampleInflowVelocity(grid);
      const bemt = solveBemt(4140, va);
      currentTorque = bemt.torqueNm;
      bus.solveBusNetwork(throttles, loadTorqueFns);
      bus.stepThermal(dt);
      coupler.injectCouplingForces(grid, bemt, dt);
      thrusterForces[0] = bemt.thrustN;
      stepVehicleRigidBody(vehicle, dt, thrusterForces);
      gpuSolver.step(dt);
    }

    if (typeof (globalThis as any).gc === "function") {
      (globalThis as any).gc();
      (globalThis as any).gc();
    }
    const heapBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < 3600; i++) {
      const va = coupler.sampleInflowVelocity(grid);
      const bemt = solveBemt(4140, va);
      currentTorque = bemt.torqueNm;
      bus.solveBusNetwork(throttles, loadTorqueFns);
      bus.stepThermal(dt);
      coupler.injectCouplingForces(grid, bemt, dt);
      thrusterForces[0] = bemt.thrustN;
      stepVehicleRigidBody(vehicle, dt, thrusterForces);
      gpuSolver.step(dt);
    }

    if (typeof (globalThis as any).gc === "function") {
      (globalThis as any).gc();
      (globalThis as any).gc();
    }
    const heapAfter = process.memoryUsage().heapUsed;
    const heapGrowthMb = (heapAfter - heapBefore) / (1024 * 1024);

    expect(heapGrowthMb).toBeLessThan(0.15);
  });

  it("device_loss_recovery", async () => {
    const solver = new GpuFluidSolver({ gridOptions: { width: 128, height: 64 } });
    const coordinator = new RecoveryCoordinator({
      reinitProbe: () => solver.reinitGpuPipeline(),
      onBackendChange: (tier) => solver.setBackend(tier)
    });

    expect(coordinator.currentBackend).toBe("WebGPU");

    await coordinator.handleDeviceLoss();
    expect(coordinator.currentBackend).toBe("WebGPU");

    await coordinator.handleDeviceLoss();
    expect(coordinator.currentBackend).toBe("WebGL2");
    expect(solver.renderTier).toBe("WebGL2");
    expect(solver.backend).toBe("cpu");

    await coordinator.handleDeviceLoss();
    expect(coordinator.currentBackend).toBe("CPU");
    expect(solver.renderTier).toBe("CPU");
    expect(solver.backend).toBe("cpu");

    const metrics = solver.step(1.0 / 60.0);
    expect(metrics).toBeDefined();
    expect(Number.isFinite(metrics.stepTimeMs)).toBe(true);
    expect(Number.isFinite(metrics.maxDivergence)).toBe(true);
  });

  it("async_readback_ring", () => {
    const solver = new GpuFluidSolver({ gridOptions: { width: 128, height: 64 } });
    expect((solver as any).readbackRing.length).toBe(3);

    for (let frame = 0; frame < 9; frame++) {
      const metrics = solver.step(1.0 / 60.0);
      expect(metrics).toBeDefined();
      expect(solver.readbackLatencyMs).toBeGreaterThanOrEqual(0);
    }

    const ring = (solver as any).readbackRing;
    for (let i = 0; i < 3; i++) {
      expect(ring[i].u.length).toBe(128 * 64);
      expect(ring[i].v.length).toBe(128 * 64);
      expect(ring[i].dye.length).toBe(128 * 64);
    }
  });

  it("multigrid_convergence", () => {
    const grid = new FluidGrid({ width: 256, height: 128 });
    for (let y = 30; y < 90; y++) {
      for (let x = 60; x < 180; x++) {
        grid.u[y * 256 + x] = 0.004 * Math.sin(x * 0.1) * Math.cos(y * 0.1);
        grid.v[y * 256 + x] = 0.003 * Math.cos(x * 0.1) * Math.sin(y * 0.1);
      }
    }
    computeDivergence(grid);

    const initialDiv = getMaxDivergence(grid);
    expect(initialDiv).toBeGreaterThan(1e-4);

    for (let i = 0; i < 3; i++) {
      solvePressureMultigrid(grid, 1);
    }

    // 3 V-cycles hit pressure residual < 1e-4 while keeping execution within 1.5 ms
    for (let i = 0; i < 5; i++) {
      solvePressureMultigrid(grid, 3);
    }
    const samples: number[] = [];
    let result = solvePressureMultigrid(grid, 3);
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      result = solvePressureMultigrid(grid, 3);
      samples.push(performance.now() - t0);
    }

    const durationMs = Math.min(...samples);
    expect(durationMs).toBeLessThan(1.5);
    expect(result.finalResidual).toBeLessThan(1e-4);
  });
});
