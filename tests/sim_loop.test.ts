import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SimClock } from '../src/sim/clock';
import { computeInterpolatedPose } from '../src/sim/interpolation';
import { VehicleStageController } from '../src/sim/stageController';
import { Vehicle3D } from '../src/render/vehicle3d';
import { VehicleBody } from '../src/vehicle/body';
import { stepVehicleSubstepped, stepVehicleRigidBody } from '../src/vehicle/integrator';
import { VehicleFluidCoupler } from '../src/vehicle/coupling';
import { PropellerArray } from '../src/prop/array';
import { FluidSolver } from '../src/fluid/FluidSolver';
import { defaultConfig } from '../src/core/config';

const FREE_SPACE = {
  floorElevationM: -50,
  surfaceElevationM: 50,
  radiusM: 50
};

describe('fixed_dt_stability', () => {
  it('advances physics only in exact fixed slices regardless of frame delta jitter', () => {
    const clock = new SimClock(1 / 60, 4);
    clock.start(0);

    let elapsedS = 0;
    let maxDeviationS = 0;
    const step = (dt: number) => {
      elapsedS += dt;
      maxDeviationS = Math.max(maxDeviationS, Math.abs(dt - 1 / 60));
    };

    const frameDeltasMs = [10, 12, 33, 41, 8, 100, 15, 27, 64, 5, 23, 90, 16, 14, 100, 11];
    let timeMs = 0;
    let totalSubsteps = 0;

    for (const deltaMs of frameDeltasMs) {
      timeMs += deltaMs;
      const alpha = clock.tick(timeMs, step);
      totalSubsteps += clock.getSubstepsExecuted();
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }

    expect(maxDeviationS).toBe(0);
    const expectedSimSeconds = (totalSubsteps * 1) / 60;
    expect(elapsedS).toBeCloseTo(expectedSimSeconds, 12);
    expect(totalSubsteps).toBeGreaterThan(10);
  });

  it('drops accumulated time instead of spiraling when the frame budget collapses', () => {
    const clock = new SimClock(1 / 60, 4);
    clock.start(0);

    let substeps = 0;
    for (let frame = 1; frame <= 5; frame++) {
      clock.tick(frame * 250, () => substeps++);
    }

    expect(clock.getSubstepsExecuted()).toBe(4);
    expect(substeps).toBe(20);
    expect(clock.getDroppedTimeS()).toBeGreaterThan(0);
    expect(clock.getAlpha()).toBeLessThan(1);
  });

  it('reproduces the same simulated elapsed time for any frame pacing that covers the same wall time', () => {
    const fast = new SimClock(1 / 60, 4);
    const slow = new SimClock(1 / 60, 4);
    fast.start(0);
    slow.start(0);

    let fastAdvancedS = 0;
    let slowAdvancedS = 0;
    for (let frame = 1; frame <= 120; frame++) {
      fast.tick(frame * 16.6, (dt) => {
        fastAdvancedS += dt;
      });
      if (frame % 2 === 0) {
        slow.tick((frame / 2) * 33.2, (dt) => {
          slowAdvancedS += dt;
        });
      }
    }

    expect(Math.abs(fastAdvancedS - slowAdvancedS)).toBeLessThan(0.01);
    expect(fast.getFixedDeltaTime()).toBe(slow.getFixedDeltaTime());
  });

  it('interpolates render poses between physics states without mutating them', () => {
    const previous = { position: [0, 0, 0] as [number, number, number], yawRad: 0, scale: 1 };
    const current = { position: [2, -4, 6] as [number, number, number], yawRad: 1.2, scale: 1 };

    const half = computeInterpolatedPose(previous, current, 0.5);
    expect(half.position[0]).toBeCloseTo(1, 12);
    expect(half.position[1]).toBeCloseTo(-2, 12);
    expect(half.position[2]).toBeCloseTo(3, 12);
    expect(half.yawRad).toBeCloseTo(0.6, 12);

    expect(previous.position).toEqual([0, 0, 0]);
    expect(current.position).toEqual([2, -4, 6]);

    const past = computeInterpolatedPose(previous, current, -0.5);
    const future = computeInterpolatedPose(previous, current, 1.5);
    expect(past.position[0]).toBe(0);
    expect(future.position[0]).toBe(2);
    expect(future.yawRad).toBeCloseTo(previous.yawRad + (1.2 - 0) * 1, 12);
  });
});

describe('two_way_coupling_stability', () => {
  function runCoupledLoop(steps: number, throttle: number) {
    const solver = new FluidSolver({
      gridOptions: { width: 160, height: 96, dx: 0.0015 },
      pressureIterations: 12,
      advectionScheme: 'MACCORMACK',
      jetConfig: { enabled: false }
    });
    const coupler = new VehicleFluidCoupler({
      gridCenter: new THREE.Vector3(0, 0, 0),
      gridDxM: 0.0015,
      depthM: 0.042,
      fluidDensity: 1000,
      inflowRelaxation: 0.5,
      injectionRadiusCells: 10
    });
    const array = new PropellerArray();
    for (const unit of array.thrusters) unit.throttle = 0;
    array.thrusters[2].throttle = throttle;

    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.05, 0]);
    const dt = 1 / 60;

    let maxVehicleSpeed = 0;
    let maxGridSpeed = 0;
    let maxAdvanceAbs = 0;
    const advanceHistory: number[] = [];

    for (let i = 0; i < steps; i++) {
      const advances = coupler.update(solver.grid, vehicle, array.thrusters, new THREE.Vector3());
      maxAdvanceAbs = Math.max(maxAdvanceAbs, Math.abs(advances[2]));
      advanceHistory.push(advances[2]);

      const summary = array.evaluate(undefined, advances, vehicle.angularVelocityBodyRadS, 0);

      coupler.injectSlipstream(solver.grid, vehicle, summary, dt);

      stepVehicleSubstepped(
        vehicle,
        dt,
        defaultConfig.vehicle.vehicleSubstepDivider,
        {
          forceBodyMarine: summary.totalForceN as [number, number, number],
          momentBodyMarine: summary.totalMomentNm as [number, number, number]
        },
        undefined,
        { floorElevationM: -0.25, surfaceElevationM: 5, radiusM: 5 }
      );

      solver.step(dt);

      maxVehicleSpeed = Math.max(maxVehicleSpeed, Math.hypot(...vehicle.velocityBodyMs));
      for (let cell = 0; cell < solver.grid.size; cell += 37) {
        maxGridSpeed = Math.max(maxGridSpeed, Math.abs(solver.grid.u[cell]), Math.abs(solver.grid.v[cell]));
      }
    }

    return { vehicle, solver, maxVehicleSpeed, maxGridSpeed, maxAdvanceAbs, advanceHistory };
  }

  it('survives 1000 coupled steps without divergence or unstable oscillation', () => {
    const run = runCoupledLoop(1000, 0.35);

    expect(Number.isFinite(run.vehicle.position.length())).toBe(true);
    expect(Number.isFinite(run.vehicle.velocityBodyMs[0])).toBe(true);
    expect(Number.isFinite(run.solver.grid.u[0])).toBe(true);
    expect(run.maxVehicleSpeed).toBeLessThan(10);
    expect(run.maxGridSpeed).toBeLessThan(10);
    expect(run.maxAdvanceAbs).toBeLessThan(50);

    const tail = run.advanceHistory.slice(-100);
    const mean = tail.reduce((sum, value) => sum + value, 0) / tail.length;
    const variance = tail.reduce((sum, value) => sum + (value - mean) ** 2, 0) / tail.length;
    expect(Math.sqrt(variance)).toBeLessThan(5);
    expect(Number.isFinite(mean)).toBe(true);
  }, 120000);

  it('keeps reverse throttle bounded so the loop cannot run away backwards', () => {
    const run = runCoupledLoop(400, -0.35);

    expect(Number.isFinite(run.vehicle.position.length())).toBe(true);
    expect(run.maxVehicleSpeed).toBeLessThan(10);
    expect(run.maxGridSpeed).toBeLessThan(10);
  }, 120000);
});

describe('direct_manipulation_zero_velocity', () => {
  function makeController() {
    const stage = new Vehicle3D();
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.1, 0.2], 0.4);
    vehicle.velocityBodyMs = [0.8, -0.6, 0.4];
    vehicle.angularVelocityBodyRadS = [1.5, -1.2, 0.9];
    const controller = new VehicleStageController(vehicle, stage);
    return { controller, stage, vehicle };
  }

  function kineticEnergyJ(vehicle: VehicleBody): number {
    const [m1, m2, m3] = vehicle.spatialMass.translationalKg;
    const [i1, i2, i3] = vehicle.spatialMass.rotationalKgM2;
    const [u, v, w] = vehicle.velocityBodyMs;
    const [p, q, r] = vehicle.angularVelocityBodyRadS;
    return 0.5 * (m1 * u * u + m2 * v * v + m3 * w * w + i1 * p * p + i2 * q * q + i3 * r * r);
  }

  it('clears linear and angular kinetic state on a horizontal drag write', () => {
    const { controller, stage, vehicle } = makeController();
    const energyBeforeJ = kineticEnergyJ(vehicle);
    expect(energyBeforeJ).toBeGreaterThan(0.001);

    controller.beginHorizontalDrag(new THREE.Vector3(0, 0, 0));
    controller.updateHorizontalDrag(new THREE.Vector3(0.3, 0, 0.4));

    expect(vehicle.position.x).toBeCloseTo(0.3, 9);
    expect(vehicle.position.z).toBeCloseTo(0.4, 9);
    expect(Math.hypot(...vehicle.velocityBodyMs)).toBe(0);
    expect(Math.hypot(...vehicle.angularVelocityBodyRadS)).toBe(0);
    expect(kineticEnergyJ(vehicle)).toBe(0);
    expect(stage.getPosition().y).toBeCloseTo(vehicle.position.y, 9);
  });

  it('clears kinetic state on heave drag and preserves the yaw-only constraint', () => {
    const { controller, vehicle } = makeController();
    controller.beginHeaveDrag(0);
    controller.updateHeaveDrag(-120, 0.002);

    expect(vehicle.position.y).toBeGreaterThan(-0.1);
    expect(Math.hypot(...vehicle.velocityBodyMs)).toBe(0);
    expect(Math.hypot(...vehicle.angularVelocityBodyRadS)).toBe(0);
    expect(kineticEnergyJ(vehicle)).toBe(0);
  });

  it('clears kinetic state on a yaw rotation without inducing pitch or roll', () => {
    const { controller, vehicle } = makeController();
    controller.beginYawDrag(new THREE.Vector3(1, 0, 0));
    controller.updateYawDrag(new THREE.Vector3(0, 0, 1));

    expect(Math.abs(vehicle.getEulerDegrees().pitchDeg)).toBeLessThan(1e-9);
    expect(Math.abs(vehicle.getEulerDegrees().rollDeg)).toBeLessThan(1e-9);
    expect(Math.hypot(...vehicle.velocityBodyMs)).toBe(0);
    expect(Math.hypot(...vehicle.angularVelocityBodyRadS)).toBe(0);
  });

  it('releasing a drag never launches the body: no velocity spike after the next steps', () => {
    const { controller, vehicle } = makeController();
    controller.beginHorizontalDrag(new THREE.Vector3(0, 0, 0));
    controller.updateHorizontalDrag(new THREE.Vector3(0.5, 0, 0.5));
    controller.commitDrag();

    for (let step = 0; step < 30; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, [0, 0, 0], undefined, FREE_SPACE);
    }

    expect(Math.hypot(...vehicle.velocityBodyMs)).toBeLessThan(0.2);
    expect(vehicle.position.z).toBeLessThan(0.55);
  });
});
