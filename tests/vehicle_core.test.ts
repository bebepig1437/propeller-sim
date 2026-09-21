import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { defaultConfig } from '../src/core/config';
import {
  VehicleBody,
  buildRigidBodyGeometry,
  compileAddedMass,
  compileDragCoefficients,
  compileRigidBodyInertia,
  coriolisBodyForce,
  coriolisPower,
  type Marine3,
  type Marine6
} from '../src/vehicle/body';
import { metacentricRestoringTorqueBodyMarine } from '../src/vehicle/buoyancy';
import { CANDIDATE_A_ADDED_MASS, CANDIDATE_A_DRAG } from '../src/vehicle/drag';
import {
  DEFAULT_TANK_BOUNDARIES,
  stepVehicleRigidBody,
  stepVehicleSubstepped,
  thrusterInputToMarine,
  type TankBoundaries
} from '../src/vehicle/integrator';

const FREE_SPACE: TankBoundaries = { floorElevationM: -50, surfaceElevationM: 50, radiusM: 50 };

function neutralVehicle(): VehicleBody {
  const vehicle = new VehicleBody(defaultConfig.vehicle);
  vehicle.buoyancyForces.netBuoyancyForceN = 0;
  return vehicle;
}

function terminalHeaveVelocityMs(vehicle: VehicleBody): number {
  const c = defaultConfig.vehicle;
  const quadratic = 0.5 * c.fluidDensityKgM3 * c.dragCdAHeave;
  const linear = c.dragLinHeave;
  const net = vehicle.buoyancyForces.netBuoyancyForceN;
  return (-linear + Math.sqrt(linear * linear + 4 * quadratic * net)) / (2 * quadratic);
}

function angleDegreesBetween(a: Marine3, b: Marine3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const magA = Math.hypot(a[0], a[1], a[2]);
  const magB = Math.hypot(b[0], b[1], b[2]);
  return (Math.acos(Math.max(-1, Math.min(1, dot / (magA * magB)))) * 180) / Math.PI;
}

describe('axis_convention', () => {
  it('maps object inputs to marine degrees of freedom and the legacy array path onto the same axes', () => {
    const marine = thrusterInputToMarine({ surgeN: 1, swayN: 2, heaveN: 3, rollNm: 4, pitchNm: 5, yawNm: 6 });
    expect([...marine.forceMarine]).toEqual([1, 2, 3]);
    expect([...marine.momentMarine]).toEqual([4, 5, 6]);

    const legacy = thrusterInputToMarine([2, 3, 1], [5, 6, 4]);
    expect([...legacy.forceMarine]).toEqual([...marine.forceMarine]);
    expect([...legacy.momentMarine]).toEqual([...marine.momentMarine]);
  });

  it('moves a pure surge impulse strictly along world +Z with zero cross-axis bleed', () => {
    const vehicle = neutralVehicle();
    vehicle.reset([0, 0, 0]);
    stepVehicleRigidBody(vehicle, 1 / 60, { surgeN: 1 }, undefined, FREE_SPACE);
    expect(vehicle.velocityBodyMs[0]).toBeGreaterThan(0);
    expect(vehicle.velocityBodyMs[1]).toBe(0);
    expect(vehicle.velocityBodyMs[2]).toBe(0);
    expect([...vehicle.angularVelocityBodyRadS]).toEqual([0, 0, 0]);
    const world = vehicle.worldVelocity(new THREE.Vector3());
    expect(world.z).toBeGreaterThan(0);
    expect(world.x).toBe(0);
    expect(world.y).toBe(0);
  });

  it('moves a pure sway impulse strictly along world +X with zero cross-axis bleed', () => {
    const vehicle = neutralVehicle();
    vehicle.reset([0, 0, 0]);
    stepVehicleRigidBody(vehicle, 1 / 60, { swayN: 1 }, undefined, FREE_SPACE);
    expect(vehicle.velocityBodyMs[1]).toBeGreaterThan(0);
    expect(vehicle.velocityBodyMs[0]).toBe(0);
    expect(vehicle.velocityBodyMs[2]).toBe(0);
    const world = vehicle.worldVelocity(new THREE.Vector3());
    expect(world.x).toBeGreaterThan(0);
    expect(world.y).toBe(0);
    expect(world.z).toBe(0);
  });

  it('moves a pure heave impulse strictly along world +Y with zero cross-axis bleed', () => {
    const vehicle = neutralVehicle();
    vehicle.reset([0, 0, 0]);
    stepVehicleRigidBody(vehicle, 1 / 60, { heaveN: 1 }, undefined, FREE_SPACE);
    expect(vehicle.velocityBodyMs[2]).toBeGreaterThan(0);
    expect(vehicle.velocityBodyMs[0]).toBe(0);
    expect(vehicle.velocityBodyMs[1]).toBe(0);
    const world = vehicle.worldVelocity(new THREE.Vector3());
    expect(world.y).toBeGreaterThan(0);
    expect(world.x).toBe(0);
    expect(world.z).toBe(0);
  });

  it('excites exactly one angular degree of freedom per pure moment', () => {
    const axes = [
      { moment: { rollNm: 0.001 }, index: 0 },
      { moment: { pitchNm: 0.001 }, index: 1 },
      { moment: { yawNm: 0.001 }, index: 2 }
    ];

    for (const axis of axes) {
      const vehicle = neutralVehicle();
      vehicle.reset([0, 0, 0]);
      stepVehicleRigidBody(vehicle, 1 / 60, axis.moment, undefined, FREE_SPACE);
      for (let index = 0; index < 3; index++) {
        if (index === axis.index) {
          expect(Math.abs(vehicle.angularVelocityBodyRadS[index])).toBeGreaterThan(1e-4);
        } else {
          expect(vehicle.angularVelocityBodyRadS[index]).toBe(0);
        }
      }
      expect(Math.hypot(...vehicle.velocityBodyMs)).toBe(0);
    }
  });

  it('keeps the body-to-world transform orthonormal and parity preserving', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.quaternion.setFromEuler(new THREE.Euler(0.31, -0.77, 0.42, 'YXZ'));
    const world = new THREE.Vector3(0.31, -0.62, 1.27);
    vehicle.setBodyVelocityFromWorld(world);
    const roundTrip = vehicle.worldVelocity(new THREE.Vector3());
    expect(roundTrip.x).toBeCloseTo(world.x, 12);
    expect(roundTrip.y).toBeCloseTo(world.y, 12);
    expect(roundTrip.z).toBeCloseTo(world.z, 12);

    const surgeAxis = vehicle.localToWorldVector(new THREE.Vector3(0, 0, 1));
    const swayAxis = vehicle.localToWorldVector(new THREE.Vector3(1, 0, 0));
    const heaveAxis = vehicle.localToWorldVector(new THREE.Vector3(0, 1, 0));
    expect(surgeAxis.dot(swayAxis)).toBeCloseTo(0, 12);
    expect(surgeAxis.dot(heaveAxis)).toBeCloseTo(0, 12);
    expect(surgeAxis.length()).toBeCloseTo(1, 12);
    expect(heaveAxis.length()).toBeCloseTo(1, 12);
  });

  it('rights roll about world Z and pitch about world X for an upright body', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    const torque: Marine3 = [0, 0, 0];

    const buoyantForceN = vehicle.buoyancyForces.buoyantForceWorldN[1];
    const leverM = vehicle.buoyancyForces.cobOffsetMarineM[2];

    vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (30 * Math.PI) / 180);
    metacentricRestoringTorqueBodyMarine(vehicle.quaternion, vehicle.buoyancyForces, torque);
    expect(torque[0]).toBeCloseTo(-Math.sin((30 * Math.PI) / 180) * leverM * buoyantForceN, 12);
    expect(torque[0]).toBeLessThan(0);
    expect(angleDegreesBetween(torque, [-1, 0, 0])).toBeLessThan(1e-6);
    expect(torque[1]).toBe(0);
    expect(torque[2]).toBe(0);

    vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (20 * Math.PI) / 180);
    metacentricRestoringTorqueBodyMarine(vehicle.quaternion, vehicle.buoyancyForces, torque);
    expect(torque[1]).toBeCloseTo(-Math.sin((20 * Math.PI) / 180) * leverM * buoyantForceN, 12);
    expect(torque[1]).toBeLessThan(0);
    expect(angleDegreesBetween(torque, [0, -1, 0])).toBeLessThan(1e-6);
    expect(torque[0]).toBe(0);
    expect(torque[2]).toBe(0);
  });
});

describe('coriolis', () => {
  it('builds a workless spatial Coriolis force for arbitrary coupled motion', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    const force: Marine6 = [0, 0, 0, 0, 0, 0];

    for (let sample = 0; sample < 200; sample++) {
      const nu: Marine6 = [
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 4 - 2,
        Math.random() * 4 - 2,
        Math.random() * 4 - 2
      ];
      coriolisBodyForce(vehicle.spatialMass, nu, force);
      for (let index = 0; index < 6; index++) {
        expect(Number.isFinite(force[index])).toBe(true);
      }
      expect(Math.abs(coriolisPower(vehicle.spatialMass, nu))).toBeLessThan(1e-12);
    }
  });

  it('reproduces the munk moment from anisotropic translational added mass', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    const force: Marine6 = [0, 0, 0, 0, 0, 0];
    const surge = 0.9;
    const heave = 0.4;
    coriolisBodyForce(vehicle.spatialMass, [surge, 0, heave, 0, 0, 0], force);

    const added = vehicle.spatialMass.addedTranslationalKg;
    const expectedPitchNm = heave * surge * (added[0] - added[2]);
    expect(force[4]).toBeCloseTo(expectedPitchNm, 12);
    expect(force[0]).toBe(0);
    expect(force[1]).toBe(0);
    expect(force[2]).toBe(0);
    expect(force[3]).toBe(0);
    expect(force[5]).toBe(0);
  });

  it('derives the point-mass inertia, the added mass and the drag table from configuration', () => {
    const geometry = buildRigidBodyGeometry(defaultConfig.vehicle, 1.8);
    expect(geometry.pointMasses.length).toBe(8 + 12 + defaultConfig.vehicle.rotorMounts.length);
    expect(geometry.rotors.length).toBe(defaultConfig.vehicle.rotorMounts.length);

    const inertia = compileRigidBodyInertia(geometry);
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    expect(vehicle.rigidBodyInertiaKgM2[0]).toBeCloseTo(inertia[0], 12);
    expect(vehicle.rigidBodyInertiaKgM2[1]).toBeCloseTo(inertia[1], 12);
    expect(vehicle.rigidBodyInertiaKgM2[2]).toBeCloseTo(inertia[2], 12);

    let cornerCheck = 0;
    for (let sx of [-1, 1]) {
      for (let sy of [-1, 1]) {
        for (let sz of [-1, 1]) {
          cornerCheck += sy * sy + sz * sz;
        }
      }
    }
    const c = defaultConfig.vehicle.frameTrussCornerHalfGapM;
    const trussMassKg = (defaultConfig.vehicle.frameMassG + defaultConfig.vehicle.hardwareMassG) * 1e-3;
    const nodeMassKg = (trussMassKg * defaultConfig.vehicle.frameTrussNodeMassFraction) / 8;
    const railMassKg = (trussMassKg * defaultConfig.vehicle.frameTrussRailMassFraction) / 12;
    const expectedFrameRoll = nodeMassKg * cornerCheck * c * c + railMassKg * 16 * c * c;
    expect(inertia[0]).toBeGreaterThan(expectedFrameRoll);

    const added = compileAddedMass(defaultConfig.vehicle);
    expect(added.translationalKg[0]).toBeCloseTo(CANDIDATE_A_ADDED_MASS.translationalKg[0], 12);
    expect(added.translationalKg[1]).toBeCloseTo(CANDIDATE_A_ADDED_MASS.translationalKg[1], 12);
    expect(added.translationalKg[2]).toBeCloseTo(CANDIDATE_A_ADDED_MASS.translationalKg[2], 12);
    expect(added.rotationalKgM2).toEqual(CANDIDATE_A_ADDED_MASS.rotationalKgM2);
    expect(added.translationalKg[2]).toBeGreaterThan(added.translationalKg[1]);
    expect(added.translationalKg[1]).toBeGreaterThan(added.translationalKg[0]);
    expect(added.translationalKg[0] / vehicle.displacedMassKg).toBeGreaterThan(0.3);
    expect(added.translationalKg[2] / vehicle.displacedMassKg).toBeLessThan(2);

    const drag = compileDragCoefficients(defaultConfig.vehicle);
    expect(drag.quadraticTranslationalM2).toEqual(CANDIDATE_A_DRAG.quadraticTranslationalM2);
    expect(drag.fluidDensityKgM3).toBe(CANDIDATE_A_DRAG.fluidDensityKgM3);
  });
});

describe('free_decay', () => {
  it('decays total mechanical energy monotonically over 60 seconds from an initial angular velocity', () => {
    const vehicle = neutralVehicle();
    vehicle.reset([0, 0, 0]);
    vehicle.velocityBodyMs = [0.35, 0, 0];
    vehicle.angularVelocityBodyRadS = [0, 0, 1.2];

    const dt = 1 / 60;
    let previous = vehicle.kineticEnergyJ();
    const initial = previous;
    let largestIncrease = -Infinity;

    for (let step = 0; step < 3600; step++) {
      stepVehicleRigidBody(vehicle, dt, [0, 0, 0], undefined, FREE_SPACE);
      const current = vehicle.kineticEnergyJ();
      largestIncrease = Math.max(largestIncrease, current - previous);
      expect(current - previous).toBeLessThanOrEqual(1e-6);
      previous = current;
    }

    expect(largestIncrease).toBeLessThanOrEqual(1e-6);
    expect(previous).toBeLessThan(initial * 1e-3);
  });

  it('decays total mechanical energy monotonically with all three rates and a bias velocity excited', () => {
    const vehicle = neutralVehicle();
    vehicle.reset([0, 0, 0]);
    vehicle.velocityBodyMs = [0.2, -0.15, 0.1];
    vehicle.angularVelocityBodyRadS = [0.4, -0.35, 0.5];

    const dt = 1 / 120;
    let previous = vehicle.kineticEnergyJ();
    const initial = previous;

    for (let step = 0; step < 1200; step++) {
      stepVehicleRigidBody(vehicle, dt, [0, 0, 0], undefined, FREE_SPACE);
      const current = vehicle.kineticEnergyJ();
      expect(current - previous).toBeLessThanOrEqual(1e-6);
      previous = current;
    }

    expect(previous).toBeLessThan(initial);
    expect(Number.isFinite(previous)).toBe(true);
  });
});

describe('buoyancy_and_stability', () => {
  it('reports the Archimedean net force and the CoB offset above the CoG', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    expect(vehicle.dryMassKg).toBeCloseTo(0.1799, 4);
    expect(vehicle.displacedMassKg).toBeCloseTo(0.2, 4);
    expect(vehicle.buoyancyForces.netBuoyancyForceN).toBeCloseTo(0.1971, 3);
    expect(vehicle.buoyancyForces.cobOffsetMarineM).toEqual([0, 0, 0.0125]);
  });

  it('converges a zero-thrust ascent to the terminal velocity implied by the net buoyancy', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.4, 0]);
    const expected = terminalHeaveVelocityMs(vehicle);
    expect(expected).toBeCloseTo(0.1134, 4);

    for (let step = 0; step < 1200; step++) {
      stepVehicleRigidBody(vehicle, 1 / 120, [0, 0, 0], undefined, FREE_SPACE);
    }

    expect(vehicle.velocityBodyMs[2]).toBeCloseTo(expected, 4);
    expect(vehicle.velocityBodyMs[0]).toBe(0);
    expect(vehicle.velocityBodyMs[1]).toBe(0);
    expect(vehicle.position.y).toBeGreaterThan(-0.4);
  });

  it('holds station when commanded heave thrust cancels the net buoyancy', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.1, 0]);
    const net = vehicle.buoyancyForces.netBuoyancyForceN;

    for (let step = 0; step < 600; step++) {
      stepVehicleRigidBody(vehicle, 1 / 120, { heaveN: -net }, undefined, FREE_SPACE);
    }

    expect(Math.abs(vehicle.position.y - -0.1)).toBeLessThan(0.005);
    expect(Math.abs(vehicle.velocityBodyMs[2])).toBeLessThan(0.005);
  });

  it('self-rights a 30 degree roll perturbation on the metacentric restoring time constant', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.4, 0]);
    vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (30 * Math.PI) / 180);
    const initialRollRad = (30 * Math.PI) / 180;

    const effectiveRollInertiaKgM2 = vehicle.spatialMass.rotationalKgM2[0];
    const leverNm = vehicle.buoyancyForces.cobOffsetMarineM[2] * vehicle.buoyancyForces.buoyantForceWorldN[1];
    const linearRollDamping = vehicle.dragCoefficients.linearRotationalNmPerRadS[0];
    const expectedTimeConstantS = (2 * effectiveRollInertiaKgM2) / linearRollDamping;
    const naturalFrequencyRadS = Math.sqrt(leverNm / effectiveRollInertiaKgM2);

    expect(expectedTimeConstantS).toBeGreaterThan(0.7);
    expect(expectedTimeConstantS).toBeLessThan(0.8);
    expect(naturalFrequencyRadS).toBeGreaterThan(3.5);
    expect(naturalFrequencyRadS).toBeLessThan(3.7);

    const dt = 1 / 240;
    const peaks: { t: number; theta: number }[] = [];
    let previousRate = 0;
    let previousTheta = initialRollRad;

    for (let step = 1; step <= 960; step++) {
      stepVehicleRigidBody(vehicle, dt, [0, 0, 0], undefined, FREE_SPACE);
      const theta = Math.abs((vehicle.getEulerDegrees().rollDeg * Math.PI) / 180);
      const rate = vehicle.angularVelocityBodyRadS[0];
      if (step > 1 && ((previousRate > 0 && rate <= 0) || (previousRate < 0 && rate >= 0))) {
        peaks.push({ t: step * dt, theta: previousTheta });
      }
      previousRate = rate;
      previousTheta = theta;
    }

    expect(peaks.length).toBeGreaterThanOrEqual(3);
    for (const peak of peaks) {
      const envelope = initialRollRad * Math.exp(-peak.t / expectedTimeConstantS);
      expect(peak.theta).toBeLessThanOrEqual(envelope * 1.02);
      expect(peak.theta).toBeGreaterThan(envelope * 0.7);
    }
    for (let index = 1; index < peaks.length; index++) {
      expect(peaks[index].theta).toBeLessThan(peaks[index - 1].theta);
    }

    const count = peaks.length;
    const meanTime = peaks.reduce((sum, peak) => sum + peak.t, 0) / count;
    const meanLog = peaks.reduce((sum, peak) => sum + Math.log(peak.theta), 0) / count;
    let covariance = 0;
    let variance = 0;
    for (const peak of peaks) {
      covariance += (peak.t - meanTime) * (Math.log(peak.theta) - meanLog);
      variance += (peak.t - meanTime) * (peak.t - meanTime);
    }
    const fittedTimeConstantS = -1 / (covariance / variance);
    expect(fittedTimeConstantS).toBeGreaterThan(expectedTimeConstantS * 0.8);
    expect(fittedTimeConstantS).toBeLessThan(expectedTimeConstantS * 1.2);

    expect(Math.abs(vehicle.getEulerDegrees().rollDeg)).toBeLessThan(0.5);
    expect(Math.abs(vehicle.getEulerDegrees().pitchDeg)).toBeLessThan(1e-6);
  });

  it('bounds the angular rate when the perturbation exceeds the explicit step limit', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.4, 0]);
    vehicle.angularVelocityBodyRadS = [40, -40, 40];
    stepVehicleRigidBody(vehicle, 1 / 60, [0, 0, 0], undefined, FREE_SPACE);
    expect(vehicle.angularSpeedRadS).toBeLessThanOrEqual(defaultConfig.vehicle.angularRateClampRadS + 1e-9);
  });
});

describe('collision_sync', () => {
  it('removes the wall normal velocity from the body state without desynchronizing the frames', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    const bounds: TankBoundaries = { floorElevationM: -0.25, surfaceElevationM: 0.22, radiusM: 0.5 };
    vehicle.reset([0.49, 0, 0]);

    let telemetry = stepVehicleRigidBody(vehicle, 1 / 60, { swayN: 4 }, undefined, bounds);
    for (let step = 0; step < 4; step++) {
      telemetry = stepVehicleRigidBody(vehicle, 1 / 60, { swayN: 4 }, undefined, bounds);
    }

    expect(telemetry.isWallContact).toBe(true);
    expect(Math.hypot(vehicle.position.x, vehicle.position.z)).toBeLessThanOrEqual(bounds.radiusM + 1e-9);

    const normalX = vehicle.position.x / bounds.radiusM;
    const normalZ = vehicle.position.z / bounds.radiusM;
    const world = vehicle.worldVelocity(new THREE.Vector3());
    expect(world.x * normalX + world.z * normalZ).toBeLessThanOrEqual(1e-12);

    const inverse = vehicle.quaternion.clone().invert();
    const bodyNormal = new THREE.Vector3(normalX, 0, normalZ).applyQuaternion(inverse);
    const bodyVelocity: Marine3 = [vehicle.velocityBodyMs[0], vehicle.velocityBodyMs[1], vehicle.velocityBodyMs[2]];
    const bodyNormalMarine: Marine3 = [bodyNormal.z, bodyNormal.x, bodyNormal.y];
    const outwardBodyVelocity =
      bodyVelocity[0] * bodyNormalMarine[0] + bodyVelocity[1] * bodyNormalMarine[1] + bodyVelocity[2] * bodyNormalMarine[2];
    expect(outwardBodyVelocity).toBeLessThanOrEqual(1e-12);

    const positionAtContact = vehicle.position.x;
    for (let step = 0; step < 30; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, [0, 0, 0], undefined, bounds);
    }
    expect(vehicle.position.x).toBeLessThanOrEqual(positionAtContact + 1e-9);
    expect(Math.hypot(vehicle.position.x, vehicle.position.z)).toBeLessThanOrEqual(bounds.radiusM + 1e-9);
  });

  it('cannot tunnel through a wall under sustained thrust at the substep rate', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    const bounds: TankBoundaries = { floorElevationM: -0.25, surfaceElevationM: 0.22, radiusM: 0.35 };
    vehicle.reset([0.1, 0, 0]);

    for (let step = 0; step < 600; step++) {
      stepVehicleSubstepped(
        vehicle,
        1 / 60,
        defaultConfig.vehicle.vehicleSubstepDivider,
        { swayN: 6, yawNm: 0.002 },
        undefined,
        bounds
      );
      expect(Math.hypot(vehicle.position.x, vehicle.position.z)).toBeLessThanOrEqual(bounds.radiusM + 1e-6);
      expect(Number.isFinite(vehicle.position.length())).toBe(true);
    }
  });

  it('clamps the floor and the free surface while keeping the stored velocity consistent', () => {
    const vehicle = new VehicleBody(defaultConfig.vehicle);
    vehicle.reset([0, -0.24, 0]);
    let groundedSteps = 0;

    for (let step = 0; step < 120; step++) {
      const telemetry = stepVehicleRigidBody(
        vehicle,
        1 / 60,
        { heaveN: -6, surgeN: 0.4 },
        undefined,
        DEFAULT_TANK_BOUNDARIES
      );
      if (telemetry.isGrounded) groundedSteps++;
    }
    expect(groundedSteps).toBeGreaterThan(100);
    expect(vehicle.position.y).toBeGreaterThanOrEqual(DEFAULT_TANK_BOUNDARIES.floorElevationM - 1e-9);
    const restingWorld = vehicle.worldVelocity(new THREE.Vector3());
    expect(restingWorld.y).toBeGreaterThanOrEqual(-1e-12);

    vehicle.reset([0, 0.21, 0]);
    for (let step = 0; step < 120; step++) {
      stepVehicleRigidBody(vehicle, 1 / 60, [0, 0, 0], undefined, DEFAULT_TANK_BOUNDARIES);
    }
    expect(vehicle.position.y).toBeLessThanOrEqual(DEFAULT_TANK_BOUNDARIES.surfaceElevationM + 1e-9);
    expect(vehicle.worldVelocity(new THREE.Vector3()).y).toBeLessThanOrEqual(1e-12);
  });

  it('pulls the body back toward the tether anchor without frame desynchronization', () => {
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
    const world = vehicle.worldVelocity(new THREE.Vector3());
    const restored = vehicle.spatialVelocityVector();
    vehicle.setBodyVelocityFromWorld(world);
    expect(vehicle.spatialVelocityVector()[0]).toBeCloseTo(restored[0], 12);
    expect(vehicle.spatialVelocityVector()[1]).toBeCloseTo(restored[1], 12);
    expect(vehicle.spatialVelocityVector()[2]).toBeCloseTo(restored[2], 12);
  });
});
