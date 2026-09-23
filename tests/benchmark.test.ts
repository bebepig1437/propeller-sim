
import { describe, it, expect } from "vitest";
import { defaultConfig } from "../src/core/config";
import { FluidSolver } from "../src/fluid/FluidSolver";
import { solveBEMT } from "../src/prop/bemt";
import { PowerBus } from "../src/power/bus";
import { ActuatorDiscCoupler } from "../src/prop/coupling";
import { PropellerArray } from "../src/prop/array";
import { VehicleBody } from "../src/vehicle/body";
import { stepVehicleRigidBody } from "../src/vehicle/integrator";

describe("Phase 8 — Performance Profiling & 60 Hz Real-Time Frame Budget Benchmark", () => {
  it("executes full end-to-end multi-physics pipeline step within the 16.6ms real-time budget", () => {
    const fluidSolver = new FluidSolver({
      gridOptions: { width: 256, height: 128 },
      pressureIterations: 20,
      vorticityStrength: 0.25,
      advectionScheme: "MACCORMACK"
    });
    const grid = fluidSolver.grid;
    const bus = new PowerBus(3, 12.0, 0.782);
    const coupler = new ActuatorDiscCoupler({ centerX: 24, centerY: 64, radiusCells: 14 });
    const array = new PropellerArray();
    const vehicle = new VehicleBody(defaultConfig.vehicle);

    const dt = 1.0 / 60.0;
    const warmupSteps = 10;
    const benchSteps = 60; 

    for (let i = 0; i < warmupSteps; i++) {
      fluidSolver.step(dt);
      const va = coupler.sampleInflowVelocity(grid);
      const bemt = solveBEMT(4140, va);
      bus.solveBusNetwork([1.0, 0.75, 0.75], [() => bemt.torqueNm, () => bemt.torqueNm, () => bemt.torqueNm]);
      coupler.injectCouplingForces(grid, bemt, dt);
      const summary = array.evaluate([1.0, 1.0, 0.0], [va, va, 0]);
      stepVehicleRigidBody(vehicle, dt, summary.totalForceN, summary.totalMomentNm);
    }

    let totalPressureIterations = 0;
    let totalBemtElements = 0;

    if (typeof (global as any).gc === "function") {
      (global as any).gc();
    }
    const heapBefore = process.memoryUsage().heapUsed;

    const startTime = performance.now();
    for (let i = 0; i < benchSteps; i++) {
      fluidSolver.step(dt);
      totalPressureIterations += fluidSolver.lastPressureResult?.iterationsRun ?? 0;

      const va = coupler.sampleInflowVelocity(grid);

      const bemt = solveBEMT(4140, va);
      totalBemtElements += bemt.elements.length;

      bus.solveBusNetwork(
        [1.0, 0.8, 0.8],
        [() => bemt.torqueNm, () => bemt.torqueNm, () => bemt.torqueNm]
      );
      bus.stepThermal(dt);

      coupler.injectCouplingForces(grid, bemt, dt);

      const summary = array.evaluate([1.0, 0.9, 0.1], [va, va, 0]);

      stepVehicleRigidBody(vehicle, dt, summary.totalForceN, summary.totalMomentNm);
    }
    const totalElapsedMs = performance.now() - startTime;
    const avgMsPerStep = totalElapsedMs / benchSteps;

    if (typeof (global as any).gc === "function") {
      (global as any).gc();
    }
    const heapAfter = process.memoryUsage().heapUsed;
    const heapGrowthMb = (heapAfter - heapBefore) / (1024 * 1024);

    console.log("\n======================================================");
    console.log("[Full Pipeline Benchmark 60 Hz Budget]");
    console.log(`Average ms / multi-physics step: ${avgMsPerStep.toFixed(2)} ms (Budget: 16.67 ms)`);
    console.log(`Total 60-step execution: ${totalElapsedMs.toFixed(2)} ms`);
    console.log(`Real-time performance factor: ${(16.67 / avgMsPerStep).toFixed(1)}x real-time`);
    console.log(`Deterministic pressure iterations: ${totalPressureIterations} (expected: ${benchSteps * 20})`);
    console.log(`Deterministic BEMT elements: ${totalBemtElements} (expected: ${benchSteps * 20})`);
    console.log(`Heap growth: ${heapGrowthMb.toFixed(3)} MB (Limit: < 1.0 MB)`);
    console.log("======================================================\n");

    expect(totalPressureIterations).toBe(benchSteps * 20);
    expect(totalBemtElements).toBe(benchSteps * 20);

    if (typeof (global as any).gc === "function") {
      expect(heapGrowthMb).toBeLessThan(1.0);
    }

    expect(avgMsPerStep).toBeLessThan(16.67);
  });
});
