
import { describe, it, expect } from "vitest";
import { defaultConfig } from "../src/core/config";
import { FluidSolver } from "../src/fluid/FluidSolver";
import { solveBEMT } from "../src/prop/bemt";
import { PowerBus } from "../src/power/bus";
import { ActuatorDiscCoupler } from "../src/prop/coupling";
import { PropellerArray } from "../src/prop/array";
import { VehicleBody } from "../src/vehicle/body";
import { stepVehicleRigidBody } from "../src/vehicle/integrator";

export interface StageTiming {
  stage: string;
  description: string;
  totalMs: number;
  avgMs: number;
  percentage: number;
}

export function runPhysicsTickProfiler(steps = 60, warmup = 10): StageTiming[] {
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

  for (let i = 0; i < warmup; i++) {
    fluidSolver.step(dt);
    const va = coupler.sampleInflowVelocity(grid);
    const bemt = solveBEMT(4140, va);
    bus.solveBusNetwork([1.0, 0.75, 0.75], [() => bemt.torqueNm, () => bemt.torqueNm, () => bemt.torqueNm]);
    coupler.injectCouplingForces(grid, bemt, dt);
    const summary = array.evaluate([1.0, 1.0, 0.0], [va, va, 0]);
    stepVehicleRigidBody(vehicle, dt, summary.totalForceN, summary.totalMomentNm);
  }

  const times = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };

  for (let i = 0; i < steps; i++) {
    let t0 = performance.now();
    fluidSolver.step(dt);
    times.A += performance.now() - t0;

    t0 = performance.now();
    const va = coupler.sampleInflowVelocity(grid);
    times.B += performance.now() - t0;

    t0 = performance.now();
    const bemt = solveBEMT(4140, va);
    times.C += performance.now() - t0;

    t0 = performance.now();
    bus.solveBusNetwork([1.0, 0.8, 0.8], [() => bemt.torqueNm, () => bemt.torqueNm, () => bemt.torqueNm]);
    bus.stepThermal(dt);
    times.D += performance.now() - t0;

    t0 = performance.now();
    coupler.injectCouplingForces(grid, bemt, dt);
    times.E += performance.now() - t0;

    t0 = performance.now();
    const summary = array.evaluate([1.0, 0.9, 0.1], [va, va, 0]);
    times.F += performance.now() - t0;

    t0 = performance.now();
    stepVehicleRigidBody(vehicle, dt, summary.totalForceN, summary.totalMomentNm);
    times.G += performance.now() - t0;
  }

  const total = Object.values(times).reduce((a, b) => a + b, 0);

  const stages: StageTiming[] = [
    { stage: "A", description: "Fluid Core (Advect/Pressure/Vort)", totalMs: times.A, avgMs: times.A / steps, percentage: (times.A / total) * 100 },
    { stage: "B", description: "Actuator Disc Inflow Sampling", totalMs: times.B, avgMs: times.B / steps, percentage: (times.B / total) * 100 },
    { stage: "C", description: "BEMT Inflow Solve (20 elements)", totalMs: times.C, avgMs: times.C / steps, percentage: (times.C / total) * 100 },
    { stage: "D", description: "DC Motor & Electrical Tether Bus", totalMs: times.D, avgMs: times.D / steps, percentage: (times.D / total) * 100 },
    { stage: "E", description: "Momentum & Swirl Disc Coupling", totalMs: times.E, avgMs: times.E / steps, percentage: (times.E / total) * 100 },
    { stage: "F", description: "3-Thruster Array + Stator Ledger", totalMs: times.F, avgMs: times.F / steps, percentage: (times.F / total) * 100 },
    { stage: "G", description: "6-DOF Vehicle Rigid Body Dynamics", totalMs: times.G, avgMs: times.G / steps, percentage: (times.G / total) * 100 }
  ];

  console.log("\n================================================================================");
  console.log(`[Physics Tick Profiler] ${steps} steps @ 60 Hz (Warmup: ${warmup} steps)`);
  console.log("--------------------------------------------------------------------------------");
  console.log(`Stage | Description                          | Avg ms/step | % Total | Status`);
  console.log("--------------------------------------------------------------------------------");
  for (const s of stages) {
    const status = s.avgMs > 4.0 ? "EXCEEDS 4MS" : "OK (<4ms)";
    console.log(
      `  ${s.stage}   | ${s.description.padEnd(36)} | ${s.avgMs.toFixed(3).padStart(8)} ms | ${s.percentage.toFixed(1).padStart(5)}%  | ${status}`
    );
  }
  console.log("--------------------------------------------------------------------------------");
  const totalAvg = total / steps;
  console.log(`TOTAL | End-to-End Multi-Physics Step        | ${totalAvg.toFixed(3).padStart(8)} ms | 100.0%  | Budget: 16.67 ms`);
  console.log(`Real-Time Headroom Factor: ${(16.67 / totalAvg).toFixed(2)}x real-time`);
  console.log("================================================================================\n");

  return stages;
}

describe("Physics Tick Profiler", () => {
  it("profiles all 7 multi-physics pipeline stages", () => {
    const results = runPhysicsTickProfiler(60, 10);
    const totalAvg = results.reduce((sum, s) => sum + s.avgMs, 0);
    // Check that profiler produces valid non-zero results
    expect(totalAvg).toBeGreaterThan(0);
  });
});
