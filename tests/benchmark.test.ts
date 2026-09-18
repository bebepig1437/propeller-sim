import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { FluidSolver } from '../src/fluid/FluidSolver';
import { solveBEMT } from '../src/prop/bemt';
import { PowerBus } from '../src/power/bus';
import { ActuatorDiscCoupler } from '../src/prop/coupling';
import { PropellerArray } from '../src/prop/array';
import { VehicleBody } from '../src/vehicle/body';
import { stepVehicleRigidBody } from '../src/vehicle/integrator';

describe('Phase 8 — Performance Profiling & 60 Hz Real-Time Frame Budget Benchmark', () => {
  it('executes full end-to-end multi-physics pipeline step within the 16.6ms real-time budget', () => {
    // 1. Instantiate full multi-physics subsystems
    const fluidSolver = new FluidSolver({
      gridOptions: { width: 256, height: 128 },
      pressureIterations: 20,
      vorticityStrength: 0.25,
      advectionScheme: 'MACCORMACK'
    });
    const grid = fluidSolver.grid;
    const bus = new PowerBus(3, 12.0, 0.782);
    const coupler = new ActuatorDiscCoupler({ centerX: 24, centerY: 64, radiusCells: 14 });
    const array = new PropellerArray();
    const vehicle = new VehicleBody(defaultConfig.vehicle);

    const dt = 1.0 / 60.0;
    const warmupSteps = 5;
    const benchSteps = 60; // 1 full second of 60 Hz physical simulation

    // Warmup
    for (let i = 0; i < warmupSteps; i++) {
      fluidSolver.step(dt);
      const va = coupler.sampleInflowVelocity(grid);
      const bemt = solveBEMT(4140, va);
      bus.solveBusNetwork([1.0, 0.75, 0.75], [() => bemt.torqueNm, () => bemt.torqueNm, () => bemt.torqueNm]);
      coupler.injectCouplingForces(grid, bemt, dt);
      const summary = array.evaluate([1.0, 1.0, 0.0], [va, va, 0]);
      stepVehicleRigidBody(vehicle, dt, summary.totalForceN, summary.totalMomentNm);
    }

    // Benchmark full pipeline
    const startTime = performance.now();
    for (let i = 0; i < benchSteps; i++) {
      // Step A: 2D Eulerian Fluid Core (Advection + Vorticity + Pressure solve)
      fluidSolver.step(dt);

      // Step B: Actuator Disc Inflow Sampling
      const va = coupler.sampleInflowVelocity(grid);

      // Step C: Continuous Inflow BEMT
      const bemt = solveBEMT(4140, va);

      // Step D: DC Motor & Tether Electrical Network
      bus.solveBusNetwork(
        [1.0, 0.8, 0.8],
        [() => bemt.torqueNm, () => bemt.torqueNm, () => bemt.torqueNm]
      );
      bus.stepThermal(dt);

      // Step E: Two-way Momentum & Swirl Injection into Fluid
      coupler.injectCouplingForces(grid, bemt, dt);

      // Step F: 3-Thruster Array + Stator Swirl Recovery
      const summary = array.evaluate([1.0, 0.9, 0.1], [va, va, 0]);

      // Step G: 6-DOF Vehicle Rigid Body Dynamics Integration
      stepVehicleRigidBody(vehicle, dt, summary.totalForceN, summary.totalMomentNm);
    }
    const totalElapsedMs = performance.now() - startTime;
    const avgMsPerStep = totalElapsedMs / benchSteps;

    console.log(`\n======================================================`);
    console.log(`[Full Pipeline Benchmark 60 Hz Budget]`);
    console.log(`Average ms / multi-physics step: ${avgMsPerStep.toFixed(2)} ms (Budget: 16.67 ms)`);
    console.log(`Total 60-step execution: ${totalElapsedMs.toFixed(2)} ms`);
    console.log(`Real-time performance factor: ${(16.67 / avgMsPerStep).toFixed(1)}x real-time`);
    console.log(`======================================================\n`);

    // Must execute comfortably within the 16.67 ms frame budget for 60 FPS real-time capability
    expect(avgMsPerStep).toBeLessThan(16.67);
  });
});
