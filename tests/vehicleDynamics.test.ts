import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { calculateBuoyancy, metacentricRestoringTorqueBodyMarine, type Marine3 } from '../src/vehicle/buoyancy';
import { computeHydrodynamicDamping, CANDIDATE_A_DRAG, CANDIDATE_A_ADDED_MASS } from '../src/vehicle/drag';
import { VehicleBody, marineToThreeVector } from '../src/vehicle/body';
import { stepVehicleRigidBody, stepVehicleSubstepped, DEFAULT_TANK_BOUNDARIES } from '../src/vehicle/integrator';
import { FlowOverlays } from '../src/render/legacy/flowOverlays';
import { PropellerArray } from '../src/prop/array';
import { VehicleFluidCoupler } from '../src/vehicle/coupling';
import { FluidSolver } from '../src/fluid/FluidSolver';
import { FluidGrid } from '../src/fluid/grid';
import { defaultConfig } from '../src/core/config';

const FREE_SPACE = {
  floorElevationM: -50,
  surfaceElevationM: 50,
  radiusM: 50
};

function makeBuoyancyFreeVehicle(): VehicleBody {
  const vehicle = new VehicleBody(defaultConfig.vehicle);
  vehicle.buoyancyForces.netBuoyancyForceN = 0;
  return vehicle;
}

function torqueAboutWorld(marineTorque: Marine3, quaternion: THREE.Quaternion): THREE.Vector3 {
  return marineToThreeVector(marineTorque, new THREE.Vector3()).applyQuaternion(quaternion);
}

describe('Hydrostatics & Buoyancy (buoyancy.ts)', () => {
  it('computes Candidate A mass and net positive buoyancy (+0.197 N)', () => {
    const buoyancy = calculateBuoyancy(defaultConfig.vehicle, 1.80);

    expect(buoyancy.dryMassKg).toBeCloseTo(0.1799, 4);
    expect(buoyancy.displacedMassKg).toBeCloseTo(0.2, 4);
    expect(buoyancy.netBuoyancyForceN).toBeGreaterThan(0.19);
    expect(buoyancy.netBuoyancyForceN).toBeLessThan(0.21);
    expect(buoyancy.cobOffsetMarineM).toEqual([0, 0, 0.0125]);
  });

  it('calculates zero metacentric righting moment when upright', () => {
    const buoyancy = calculateBuoyancy(defaultConfig.vehicle);
    const torque: Marine3 = [0, 0, 0];
    metacentricRestoringTorqueBodyMarine(new THREE.Quaternion(0, 0, 0, 1), buoyancy, torque);

    expect(torque[0]).toBeCloseTo(0, 12);
    expect(torque[1]).toBeCloseTo(0, 12);
    expect(torque[2]).toBeCloseTo(0, 12);
  });

  it('generates a restoring roll moment about world Z when perturbed in roll (+30 deg)', () => {
    const buoyancy = calculateBuoyancy(defaultConfig.vehicle);
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 6);
    const torque: Marine3 = [0, 0, 0];
    metacentricRestoringTorqueBodyMarine(rollQuat, buoyancy, torque);

    const expected = -Math.sin(Math.PI / 6) * 0.0125 * buoyancy.buoyantForceWorldN[1];
    expect(torque[0]).toBeCloseTo(expected, 12);
    expect(torque[0]).toBeLessThan(0);
    expect(torque[1]).toBeCloseTo(0, 12);
    expect(torque[2]).toBeCloseTo(0, 12);

    expect(torqueAboutWorld(torque, rollQuat).z).toBeLessThan(0);
  });

  it('generates a restoring pitch moment about world X when perturbed in pitch (+20 deg)', () => {
    const buoyancy = calculateBuoyancy(defaultConfig.vehicle);
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (20 * Math.PI) / 180);
    const torque: Marine3 = [0, 0, 0];
    metacentricRestoringTorqueBodyMarine(pitchQuat, buoyancy, torque);

    const expected = -Math.sin((20 * Math.PI) / 180) * 0.0125 * buoyancy.buoyantForceWorldN[1];
    expect(torque[1]).toBeCloseTo(expected, 12);
    expect(torque[1]).toBeLessThan(0);
    expect(torque[0]).toBeCloseTo(0, 12);
    expect(torque[2]).toBeCloseTo(0, 12);

    expect(torqueAboutWorld(torque, pitchQuat).x).toBeLessThan(0);
  });

  it('never produces a moment about the vertical (world Y) axis', () => {
    const buoyancy = calculateBuoyancy(defaultConfig.vehicle);
    const attitude = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.7, -0.3, 'YXZ'));
    const torque: Marine3 = [0, 0, 0];
    metacentricRestoringTorqueBodyMarine(attitude, buoyancy, torque);

    expect(torqueAboutWorld(torque, attitude).y).toBeCloseTo(0, 12);
  });
});

describe('Hydrodynamic Damping (drag.ts, marine order)', () => {
  it('returns zero damping forces at rest', () => {
    const damping = computeHydrodynamicDamping([0, 0, 0], [0, 0, 0]);
    expect(damping.forceBodyN).toEqual([-0, -0, -0]);
    expect(damping.torqueBodyNm).toEqual([-0, -0, -0]);
  });

  it('opposes forward surge motion on the surge axis only', () => {
    const damping = computeHydrodynamicDamping([0.5, 0, 0], [0, 0, 0]);

    expect(damping.forceBodyN[0]).toBeCloseTo(-(0.5 * 1000 * 0.0079 * 0.5 + 0.15) * 0.5, 4);
    expect(damping.forceBodyN[1]).toBe(-0);
    expect(damping.forceBodyN[2]).toBe(-0);
  });

  it('opposes sway and heave on their own axes', () => {
    const sway = computeHydrodynamicDamping([0, 0.5, 0], [0, 0, 0]);
    expect(sway.forceBodyN[1]).toBeCloseTo(-(0.5 * 1000 * 0.0129 * 0.5 + 0.35) * 0.5, 4);
    expect(sway.forceBodyN[0]).toBe(-0);
    expect(sway.forceBodyN[2]).toBe(-0);

    const heave = computeHydrodynamicDamping([0, 0, 0.5], [0, 0, 0]);
    expect(heave.forceBodyN[2]).toBeCloseTo(-(0.5 * 1000 * 0.0227 * 0.5 + 0.45) * 0.5, 4);
    expect(heave.forceBodyN[0]).toBe(-0);
  });

  it('opposes each angular rate on its own marine axis', () => {
    const roll = computeHydrodynamicDamping([0, 0, 0], [2, 0, 0]);
    expect(roll.torqueBodyNm[0]).toBeCloseTo(-(4.5e-4 * 2 + 0.005) * 2, 12);
    expect(roll.torqueBodyNm[1]).toBe(-0);
    expect(roll.torqueBodyNm[2]).toBe(-0);

    const yaw = computeHydrodynamicDamping([0, 0, 0], [0, 0, 2]);
    expect(yaw.torqueBodyNm[2]).toBeLessThan(0);
    expect(yaw.torqueBodyNm[0]).toBe(-0);
  });

  it('is strictly dissipative: F·v + tau·omega <= 0 for random states', () => {
    for (let sample = 0; sample < 50; sample++) {
      const velocity: Marine3 = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
      const rate: Marine3 = [Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2];
      const damping = computeHydrodynamicDamping(velocity, rate);
      const power =
        damping.forceBodyN[0] * velocity[0] +
        damping.forceBodyN[1] * velocity[1] +
        damping.forceBodyN[2] * velocity[2] +
        damping.torqueBodyNm[0] * rate[0] +
        damping.torqueBodyNm[1] * rate[1] +
        damping.torqueBodyNm[2] * rate[2];
      expect(power).toBeLessThanOrEqual(0);
    }
  });

  it('exposes marine-ordered tunable tables that mirror the config defaults', () => {
    expect(CANDIDATE_A_DRAG.quadraticTranslationalM2).toEqual([
      defaultConfig.vehicle.dragCdASurge,
      defaultConfig.vehicle.dragCdASway,
      defaultConfig.vehicle.dragCdAHeave
    ]);
    expect(CANDIDATE_A_DRAG.linearTranslationalNPerMs).toEqual([
      defaultConfig.vehicle.dragLinSurge,
      defaultConfig.vehicle.dragLinSway,
      defaultConfig.vehicle.dragLinHeave
    ]);
    expect(CANDIDATE_A_DRAG.linearRotationalNmPerRadS[0]).toBe(defaultConfig.vehicle.rotDragLinRoll);
    expect(CANDIDATE_A_ADDED_MASS.translationalKg).toEqual([0.085, 0.1, 0.12]);
  });
});

describe('Vehicle 6-DOF Rigid Body State (body.ts)', () => {
  it('initializes Candidate A mass properties and marine-ordered added mass', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);

    expect(vehicle.dryMassKg).toBeCloseTo(0.1799, 3);
    expect(vehicle.spatialMass.translationalKg[0]).toBeCloseTo(0.1799 + CANDIDATE_A_ADDED_MASS.translationalKg[0], 6);
    expect(vehicle.spatialMass.translationalKg[1]).toBeCloseTo(0.1799 + CANDIDATE_A_ADDED_MASS.translationalKg[1], 6);
    expect(vehicle.spatialMass.translationalKg[2]).toBeCloseTo(0.1799 + CANDIDATE_A_ADDED_MASS.translationalKg[2], 6);
    expect(vehicle.spatialMass.rotationalKgM2[0]).toBeGreaterThan(CANDIDATE_A_ADDED_MASS.rotationalKgM2[0]);
  });

  it('remaps marine body vectors and angular rates through three.js', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);

    expect(vehicle.localToWorldVector(new THREE.Vector3(0, 0, 1)).z).toBeCloseTo(1, 12);
    expect(vehicle.localToWorldVector(new THREE.Vector3(1, 0, 0)).x).toBeCloseTo(1, 12);
    expect(vehicle.localToWorldVector(new THREE.Vector3(0, 1, 0)).y).toBeCloseTo(1, 12);
  });

  it('transforms points between local and world coordinates', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.position.set(0.5, -0.1, 0.2);

    const worldPoint = vehicle.localToWorldPoint(new THREE.Vector3(0, 0, 0));
    expect(worldPoint.x).toBeCloseTo(0.5, 4);
    expect(worldPoint.y).toBeCloseTo(-0.1, 4);
    expect(worldPoint.z).toBeCloseTo(0.2, 4);
  });

  it('reports marine Euler angles (roll = X, pitch = Y, yaw = Z)', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    expect(vehicle.getEulerDegrees().rollDeg).toBeCloseTo(0, 6);

    vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (25 * Math.PI) / 180);
    expect(vehicle.getEulerDegrees().yawDeg).toBeCloseTo(25, 6);

    vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (10 * Math.PI) / 180);
    expect(vehicle.getEulerDegrees().rollDeg).toBeCloseTo(10, 6);

    vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (-15 * Math.PI) / 180);
    expect(vehicle.getEulerDegrees().pitchDeg).toBeCloseTo(-15, 6);
  });

  it('reports body velocity in marine component order', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.setBodyVelocityFromWorld(new THREE.Vector3(0.3, -0.2, 0.5));

    expect(vehicle.velocityBodyMs[0]).toBeCloseTo(0.5, 12);
    expect(vehicle.velocityBodyMs[1]).toBeCloseTo(0.3, 12);
    expect(vehicle.velocityBodyMs[2]).toBeCloseTo(-0.2, 12);
  });
});

describe('6-DOF Semi-Implicit Integrator (integrator.ts)', () => {
  it('causes an unpowered positively-buoyant vehicle to rise', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.15, 0]);

    for (let step = 0; step < 30; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, [0, 0, 0]);
    }

    expect(vehicle.velocityBodyMs[2]).toBeGreaterThan(0.05);
    expect(vehicle.position.y).toBeGreaterThan(-0.15);
  });

  it('accelerates along world +Z under forward surge thrust and is bounded by drag', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, 0, -0.4]);

    for (let step = 0; step < 50; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, { surgeN: 3.0 });
    }

    expect(vehicle.velocityBodyMs[0]).toBeGreaterThan(0.4);
    expect(vehicle.velocityBodyMs[0]).toBeLessThan(1.6);
    const world = vehicle.worldVelocity(new THREE.Vector3());
    expect(Math.abs(world.x)).toBeLessThan(1e-12);
    expect(world.y).toBeGreaterThanOrEqual(-1e-12);
  });

  it('self-rights a vehicle perturbed by 30 degrees of roll', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, 0, 0]);
    vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 6);

    for (let step = 0; step < 240; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, [0, 0, 0]);
    }

    expect(Math.abs(vehicle.getEulerDegrees().rollDeg)).toBeLessThan(5);
    expect(Math.abs(vehicle.getEulerDegrees().pitchDeg)).toBeLessThan(1e-6);
  });

  it('enforces tank boundaries (floor clamping and surface limit)', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, 0.2, 0]);

    for (let step = 0; step < 120; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, [0, 0, 0]);
    }
    expect(vehicle.position.y).toBeLessThanOrEqual(DEFAULT_TANK_BOUNDARIES.surfaceElevationM + 1e-6);

    for (let step = 0; step < 300; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, { heaveN: -5 });
    }
    expect(vehicle.position.y).toBeGreaterThanOrEqual(DEFAULT_TANK_BOUNDARIES.floorElevationM - 1e-6);
  });

  it('applies a tether spring-damper back toward the anchor when attached', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0.4, -0.1, 0]);
    const tether = {
      attached: true,
      anchorWorld: [0, -0.1, 0] as Marine3,
      stiffnessNm: 2,
      dampingNPerMs: 0.4
    };

    for (let step = 0; step < 600; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, [0, 0, 0], undefined, DEFAULT_TANK_BOUNDARIES, tether);
    }

    expect(Math.abs(vehicle.position.x)).toBeLessThan(0.1);
  });
});

describe('3D Flow & Telemetry Overlays (legacy flowOverlays.ts)', () => {
  it('creates overlay groups and updates without errors', () => {
    const overlays = new FlowOverlays();
    expect(overlays.group.children.length).toBe(4);

    const vehicle = new VehicleBody(defaultConfig.vehicle);
    const propArray = new PropellerArray();
    const summary = propArray.evaluate([1, 1, 0]);

    expect(() => overlays.update(vehicle, summary, 0)).not.toThrow();
    expect(() => overlays.dispose()).not.toThrow();
  });
});

describe('Vehicle-Fluid Coupling (coupling.ts)', () => {
  function makeCoupler(): VehicleFluidCoupler {
    return new VehicleFluidCoupler({
      gridCenter: new THREE.Vector3(0, 0, 0),
      gridDxM: 0.0015,
      depthM: 0.042,
      fluidDensity: 1000,
      inflowRelaxation: 1,
      injectionRadiusCells: 10
    });
  }

  it('samples the advance speed of the in-plane heave rotor from the fluid, not from the CoG motion', () => {
    const coupler = makeCoupler();
    const grid = new FluidGrid({ width: 64, height: 32, dx: 0.0015 });
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, 0, 0]);
    const vertical = [new PropellerArray().thrusters[2]];

    expect(coupler.sampleInflows(grid, vehicle, vertical, [], [])[0]).toBe(0);

    grid.v.fill(1);
    expect(coupler.sampleInflows(grid, vehicle, vertical, [], [])[0]).toBeCloseTo(-1, 4);

    grid.v.fill(0);
    vehicle.setBodyVelocityFromWorld(new THREE.Vector3(0, 0.25, 0));
    expect(coupler.sampleInflows(grid, vehicle, vertical, [], [])[0]).toBeCloseTo(0.25, 4);
  });

  it('injects exactly the in-plane thrust impulse back into the grid (momentum conservation)', () => {
    const coupler = makeCoupler();
    const grid = new FluidGrid({ width: 64, height: 32, dx: 0.0015 });
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, 0, 0]);
    const array = new PropellerArray();
    array.thrusters[2].throttle = 1;
    const summary = array.evaluate(undefined, [0, 0, 0], [0, 0, 0], 0);

    const dt = 1 / 60;
    const thrustN = Math.abs(summary.thrusters[2].netThrustN);
    expect(coupler.injectSlipstream(grid, vehicle, summary, dt)).toBeCloseTo(thrustN * dt, 12);

    const cellMassKg = 1000 * 0.0015 * 0.0015 * 0.042;
    let momentum = 0;
    for (let cell = 0; cell < grid.size; cell++) {
      momentum += Math.hypot(grid.u[cell], grid.v[cell]) * cellMassKg;
    }
    expect(momentum).toBeCloseTo(thrustN * dt, 9);
    expect(grid.dye.some((concentration) => concentration > 0)).toBe(true);
  });

  it('drag acts on flow-relative velocity, so a co-flowing slipstream unloads the frame', () => {
    const still = new VehicleBody(defaultConfig.vehicle);
    still.reset([0, 0, 0]);
    still.setBodyVelocityFromWorld(new THREE.Vector3(0, 0.2, 0));
    const stillTelemetry = stepVehicleRigidBody(still, 1 / 60, [0, 0, 0], undefined, FREE_SPACE);
    expect(stillTelemetry.dragForceBodyN[2]).toBeLessThan(-0.5);

    const carried = new VehicleBody(defaultConfig.vehicle);
    carried.reset([0, 0, 0]);
    carried.setBodyVelocityFromWorld(new THREE.Vector3(0, 0.2, 0));
    const carriedTelemetry = stepVehicleRigidBody(
      carried,
      1 / 60,
      [0, 0, 0],
      undefined,
      FREE_SPACE,
      undefined,
      [0, 0.2, 0]
    );
    expect(Math.abs(carriedTelemetry.dragForceBodyN[2])).toBeLessThan(1e-12);
  });

  function runClosedLoop(verticalThrottle: number, steps = 120) {
    const solver = new FluidSolver({
      gridOptions: { width: 160, height: 96, dx: 0.0015 },
      pressureIterations: 12,
      advectionScheme: 'MACCORMACK',
      jetConfig: { enabled: false }
    });
    const coupler = makeCoupler();
    const array = new PropellerArray();
    for (const unit of array.thrusters) unit.throttle = 0;
    array.thrusters[2].throttle = verticalThrottle;

    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.05, 0]);
    const startY = vehicle.position.y;
    const dt = 1 / 60;
    const ambient = new THREE.Vector3();
    let peakThrust = 0;
    let injectedTotal = 0;

    for (let step = 0; step < steps; step++) {
      const advances = coupler.update(solver.grid, vehicle, array.thrusters, ambient);
      const summary = array.evaluate(undefined, advances, vehicle.angularVelocityBodyRadS, 0);
      const forceMarine: Marine3 = [...summary.totalForceN] as Marine3;
      const momentMarine: Marine3 = [...summary.totalMomentNm] as Marine3;
      peakThrust = Math.max(peakThrust, Math.abs(forceMarine[2]));
      injectedTotal += coupler.injectSlipstream(solver.grid, vehicle, summary, dt);
      solver.step(dt);
      stepVehicleSubstepped(
        vehicle,
        dt,
        defaultConfig.vehicle.vehicleSubstepDivider,
        { forceBodyMarine: forceMarine, momentBodyMarine: momentMarine },
        undefined,
        { floorElevationM: -0.25, surfaceElevationM: 5, radiusM: 5 },
        undefined,
        [ambient.x, ambient.y, ambient.z]
      );
    }

    let gridMomentum = 0;
    for (let cell = 0; cell < solver.grid.size; cell++) {
      gridMomentum += Math.hypot(solver.grid.u[cell], solver.grid.v[cell]);
    }
    return {
      vehicle,
      rise: vehicle.position.y - startY,
      peakThrust,
      injectedTotal,
      gridMomentum,
      ambientMax: Math.hypot(ambient.x, ambient.y, ambient.z)
    };
  }

  it('runs the full loop against the CPU reference solver: finite, thrust-driven, and it leaves a wake', () => {
    const up = runClosedLoop(0.25);

    expect(Number.isFinite(up.vehicle.position.length())).toBe(true);
    expect(Number.isFinite(up.vehicle.velocityBodyMs[2])).toBe(true);
    expect(up.peakThrust).toBeGreaterThan(0.01);
    expect(up.injectedTotal).toBeGreaterThan(0);
    expect(up.gridMomentum).toBeGreaterThan(0);

    const down = runClosedLoop(-0.25);
    expect(Number.isFinite(down.vehicle.position.length())).toBe(true);
    expect(down.rise).toBeGreaterThan(0);
    expect(up.rise).toBeGreaterThan(down.rise + 0.05);

    expect(up.ambientMax).toBeLessThan(0.2);
  }, 30000);

  it('substepping the vehicle keeps the coupling stable over a long unforced run', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.1, 0]);

    for (let step = 0; step < 3600; step++) {
      stepVehicleSubstepped(
        vehicle,
        1 / 60,
        defaultConfig.vehicle.vehicleSubstepDivider,
        { heaveN: 0.1, yawNm: 1e-4 },
        undefined,
        FREE_SPACE
      );
    }

    expect(Number.isFinite(vehicle.position.length())).toBe(true);
    expect(Number.isFinite(vehicle.velocityBodyMs[0])).toBe(true);
    expect(vehicle.angularSpeedRadS).toBeLessThanOrEqual(defaultConfig.vehicle.angularRateClampRadS + 1e-9);
    expect(Math.hypot(vehicle.position.x, vehicle.position.z)).toBeLessThan(0.5);
  });
});

describe('Torque Ledger Consistency & Contra-Rotation (prop/array.ts)', () => {
  it('integrator applied roll torque equals the ledger Q_net within 1e-6', () => {
    const array = new PropellerArray();
    const summary = array.evaluate([1, 1, 0], [0, 0, 0], [0, 0, 0], 1);

    const vehicle = makeBuoyancyFreeVehicle();
    vehicle.reset([0, 0, 0]);
    const telemetry = stepVehicleRigidBody(
      vehicle,
      1 / 60,
      {
        forceBodyMarine: [...summary.totalForceN] as Marine3,
        momentBodyMarine: [...summary.totalMomentNm] as Marine3
      },
      undefined,
      FREE_SPACE
    );

    expect(Math.abs(telemetry.appliedTorqueBodyNm[0] - summary.ledgerSummary.Q_net)).toBeLessThan(1e-6);
    expect(telemetry.appliedTorqueBodyNm[0]).toBeCloseTo(summary.totalMomentNm[0], 12);
  });

  it('a coaxial contra-rotating pair nets ~zero roll on the vehicle body', () => {
    const array = new PropellerArray();
    array.applyHandednessPreset('contra_rotating_coaxial');
    for (const unit of array.thrusters) unit.throttle = 1;
    const summary = array.evaluate(undefined, [0.3, 0.3], [0, 0, 0], 0.3);

    expect(Math.abs(summary.totalMomentNm[0])).toBeLessThan(1e-6);
    expect(summary.totalForceN[0]).toBeGreaterThan(0);

    const vehicle = makeBuoyancyFreeVehicle();
    vehicle.reset([0, 0, 0]);
    stepVehicleRigidBody(
      vehicle,
      1 / 60,
      {
        forceBodyMarine: [...summary.totalForceN] as Marine3,
        momentBodyMarine: [...summary.totalMomentNm] as Marine3
      },
      undefined,
      FREE_SPACE
    );
    expect(Math.abs(vehicle.angularVelocityBodyRadS[0])).toBeLessThan(1e-6);
  });
});

describe('Validation Against Independent References', () => {
  function rk4SurgeReference(
    thrustN: number,
    effectiveMassKg: number,
    quadraticDrag: number,
    linearDrag: number,
    sampleDt: number,
    endTimeS: number
  ): { t: number; v: number }[] {
    const acceleration = (velocity: number) =>
      (thrustN - (quadraticDrag * Math.abs(velocity) + linearDrag) * velocity) / effectiveMassKg;
    const h = 1e-4;
    const stride = Math.round(sampleDt / h);
    const samples: { t: number; v: number }[] = [{ t: 0, v: 0 }];
    let velocity = 0;
    const totalSteps = Math.round(endTimeS / h);
    for (let step = 1; step <= totalSteps; step++) {
      const k1 = acceleration(velocity);
      const k2 = acceleration(velocity + (h / 2) * k1);
      const k3 = acceleration(velocity + (h / 2) * k2);
      const k4 = acceleration(velocity + h * k3);
      velocity += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      if (step % stride === 0) samples.push({ t: step * h, v: velocity });
    }
    return samples;
  }

  function crossingTime(trajectory: { t: number; v: number }[], target: number): number {
    for (let index = 1; index < trajectory.length; index++) {
      if (trajectory[index].v >= target) {
        const previous = trajectory[index - 1];
        const span = trajectory[index].v - previous.v;
        const fraction = span > 0 ? (target - previous.v) / span : 0;
        return previous.t + fraction * (trajectory[index].t - previous.t);
      }
    }
    return NaN;
  }

  it('step surge matches the RK4 reference of the 1-DOF Fossen surge model (5% final, 10% rise time)', () => {
    const config = defaultConfig.vehicle;
    const thrustN = 1.5;
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.4, 0]);
    const effectiveMassKg = vehicle.spatialMass.translationalKg[0];
    const quadraticDrag = 0.5 * config.fluidDensityKgM3 * config.dragCdASurge;
    const linearDrag = config.dragLinSurge;

    const dt = 1 / 60;
    const endTimeS = 10;
    const totalSteps = Math.round(endTimeS / dt);
    const simulated: { t: number; v: number }[] = [{ t: 0, v: 0 }];
    for (let step = 0; step < totalSteps; step++) {
      stepVehicleRigidBody(vehicle, dt, { surgeN: thrustN }, undefined, FREE_SPACE);
      simulated.push({ t: (step + 1) * dt, v: vehicle.velocityBodyMs[0] });
    }

    const reference = rk4SurgeReference(thrustN, effectiveMassKg, quadraticDrag, linearDrag, dt, endTimeS);
    const finalSimulated = simulated[simulated.length - 1].v;
    const finalReference = reference[reference.length - 1].v;

    expect(Math.abs(finalSimulated - finalReference) / finalReference).toBeLessThan(0.05);

    const riseSimulated = crossingTime(simulated, 0.9 * finalReference) - crossingTime(simulated, 0.1 * finalReference);
    const riseReference = crossingTime(reference, 0.9 * finalReference) - crossingTime(reference, 0.1 * finalReference);
    expect(riseSimulated).toBeGreaterThan(0);
    expect(Math.abs(riseSimulated - riseReference) / riseReference).toBeLessThan(0.1);

    for (let index = 0; index < reference.length; index++) {
      const sample = simulated[Math.min(simulated.length - 1, Math.round(reference[index].t / dt))];
      if (Math.abs(sample.t - reference[index].t) < 1e-9) {
        expect(Math.abs(sample.v - reference[index].v) / finalReference).toBeLessThan(0.02);
      }
    }
  }, 30000);

  it('array thrust follows the published quadratic rpm scaling and lands in the small-thruster K_T band', () => {
    const array = new PropellerArray();
    const propellerDiameterM = 0.042;
    const ratedRevolutionsPerSecond = array.thrusters[2].ratedRpm / 60;

    const sampleThrust = (throttle: number): number =>
      Math.abs(array.evaluate([0, 0, throttle], [0, 0, 0], [0, 0, 0], 0).totalForceN[2]);

    const fullThrottleThrustN = sampleThrust(1);
    const halfThrottleThrustN = sampleThrust(0.5);

    expect(halfThrottleThrustN / fullThrottleThrustN).toBeGreaterThan(0.22);
    expect(halfThrottleThrustN / fullThrottleThrustN).toBeLessThan(0.28);

    const thrustCoefficient = fullThrottleThrustN / (1000 * ratedRevolutionsPerSecond ** 2 * propellerDiameterM ** 4);
    expect(thrustCoefficient).toBeGreaterThan(0.05);
    expect(thrustCoefficient).toBeLessThan(0.5);
  });
});
