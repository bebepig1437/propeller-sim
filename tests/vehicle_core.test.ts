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

