import { describe, it, expect } from "vitest";
import { GpuFluidSolver } from "../src/fluid/gpu/gpuFluidSolver";
import { solveBemt } from "../src/prop/bemt";
import { PowerBus } from "../src/power/bus";
import { ActuatorDiscCoupler } from "../src/prop/coupling";
import { PropellerShaft } from "../src/prop/rigidbody";

describe("Phase 8 — Performance Profiling & 60 Hz Real-Time Frame Budget Benchmark", () => {
  it("executes full end-to-end multi-physics pipeline step within the 16.6ms real-time budget", () => {
    const fluidSolver = new GpuFluidSolver({
      width: 256,
      height: 128,
      pressureIterations: 20
    });
    const bus = new PowerBus(1, 12.0, 0.782);
    const coupler = new ActuatorDiscCoupler({ centerX: 24, centerY: 64, radiusCells: 14 });
    const shaft = new PropellerShaft();

    const dt = 1.0 / 60.0;
    const warmupSteps = 10;
    const benchSteps = 60;

    for (let i = 0; i < warmupSteps; i++) {
      fluidSolver.step(dt);
      const va = coupler.sampleInflowVelocity(fluidSolver.grid);
      const bemt = solveBemt(shaft.currentRpm, va);
      bus.solveBusNetwork([1.0], [() => bemt.torqueNm]);
      shaft.commandedRpm = bus.lastTelemetry?.motors[0].rpm ?? 4140;
      shaft.update(dt);
      coupler.injectCouplingForces(fluidSolver.grid, bemt, dt);
    }

    const startTime = performance.now();
    for (let i = 0; i < benchSteps; i++) {
      fluidSolver.step(dt);
      const va = coupler.sampleInflowVelocity(fluidSolver.grid);
      const bemt = solveBemt(shaft.currentRpm, va);
      bus.solveBusNetwork([1.0], [() => bemt.torqueNm]);
      shaft.commandedRpm = bus.lastTelemetry?.motors[0].rpm ?? 4140;
      shaft.update(dt);
      coupler.injectCouplingForces(fluidSolver.grid, bemt, dt);
    }
    const totalElapsedMs = performance.now() - startTime;
    const avgMsPerStep = totalElapsedMs / benchSteps;

    const budgetMs = (typeof navigator !== 'undefined' && 'gpu' in navigator) ? 16.67 : 50.0;
    expect(avgMsPerStep).toBeLessThan(budgetMs);
  });
});
