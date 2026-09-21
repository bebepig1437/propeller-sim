import * as THREE from 'three';
import type { SimConfig } from '../core/config';
import { calculateBuoyancy, type BuoyancyForces, type Marine3 } from './buoyancy';
import {
  CANDIDATE_A_ADDED_MASS,
  CANDIDATE_A_DRAG,
  type AddedMass6DOF,
  type DragCoefficients6DOF
} from './drag';

export type { Marine3 } from './buoyancy';
export type Marine6 = [number, number, number, number, number, number];
export type MarineAxis = 0 | 1 | 2;

export interface PointMass {
  surge: number;
  sway: number;
  heave: number;
  massKg: number;
}

export interface RotorMass extends PointMass {
  spinAxis: MarineAxis;
  spinInertiaKgM2: number;
}

export interface RigidBodyGeometry {
  pointMasses: PointMass[];
  rotors: RotorMass[];
}

export interface SpatialMassBody {
  translationalKg: Marine3;
  rotationalKgM2: Marine3;
  rigidRotationalKgM2: Marine3;
  addedTranslationalKg: Marine3;
  addedRotationalKgM2: Marine3;
}

export interface VehiclePoseSnapshot {
  position: Marine3;
  quaternion: [number, number, number, number];
  spatialVelocityBody: Marine6;
}

export function marineToThree(surge: number, sway: number, heave: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(sway, heave, surge);
  return out;
}

export function threeToMarine(v: THREE.Vector3, out: Marine3): Marine3 {
  out[0] = v.z;
  out[1] = v.x;
  out[2] = v.y;
  return out;
}

export function marineToThreeVector(v: Marine3, out: THREE.Vector3): THREE.Vector3 {
  return marineToThree(v[0], v[1], v[2], out);
}

export function marineAngularToThree(p: number, q: number, r: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(q, r, p);
  return out;
}

export function threeAngularToMarine(w: THREE.Vector3, out: Marine3): Marine3 {
  out[0] = w.z;
  out[1] = w.x;
  out[2] = w.y;
  return out;
}

const SPIN_AXIS_INDEX: Record<string, MarineAxis> = { surge: 0, sway: 1, heave: 2 };

export function buildRigidBodyGeometry(config: SimConfig['vehicle'], propMassG: number): RigidBodyGeometry {
  const c = config.frameTrussCornerHalfGapM;
  const trussMassKg = (config.frameMassG + config.hardwareMassG) * 1e-3;
  const nodeMassKg = (trussMassKg * config.frameTrussNodeMassFraction) / config.frameTrussNodeCount;
  const railMassKg = (trussMassKg * config.frameTrussRailMassFraction) / 12;
  const pointMasses: PointMass[] = [];

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pointMasses.push({ surge: sx * c, sway: sy * c, heave: sz * c, massKg: nodeMassKg });
      }
    }
  }

  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      pointMasses.push({ surge: 0, sway: s1 * c, heave: s2 * c, massKg: railMassKg });
      pointMasses.push({ surge: s1 * c, sway: 0, heave: s2 * c, massKg: railMassKg });
      pointMasses.push({ surge: s1 * c, sway: s2 * c, heave: 0, massKg: railMassKg });
    }
  }

  for (const mount of config.rotorMounts) {
    pointMasses.push({
      surge: mount.surgeM,
      sway: mount.swayM,
      heave: mount.heaveM,
      massKg: config.motorUnitMassG * 1e-3
    });
  }

  const spinInertiaKgM2 = config.propInertiaZzKgM2 * (propMassG / 1.8);
  const rotors: RotorMass[] = config.rotorMounts.map((mount) => ({
    surge: mount.surgeM,
    sway: mount.swayM,
    heave: mount.heaveM,
    massKg: propMassG * 1e-3,
    spinAxis: SPIN_AXIS_INDEX[mount.spinAxis],
    spinInertiaKgM2
  }));

  return { pointMasses, rotors };
}

export function compileRigidBodyInertia(geometry: RigidBodyGeometry): Marine3 {
  const inertiaKgM2: Marine3 = [0, 0, 0];

  for (const mass of geometry.pointMasses) {
    inertiaKgM2[0] += mass.massKg * (mass.sway * mass.sway + mass.heave * mass.heave);
    inertiaKgM2[1] += mass.massKg * (mass.surge * mass.surge + mass.heave * mass.heave);
    inertiaKgM2[2] += mass.massKg * (mass.surge * mass.surge + mass.sway * mass.sway);
  }

  for (const rotor of geometry.rotors) {
    const armSquared: Marine3 = [
      rotor.sway * rotor.sway + rotor.heave * rotor.heave,
      rotor.surge * rotor.surge + rotor.heave * rotor.heave,
      rotor.surge * rotor.surge + rotor.sway * rotor.sway
    ];
    for (let axis: MarineAxis = 0; axis < 3; axis = (axis + 1) as MarineAxis) {
      const transverseOrSpin = axis === rotor.spinAxis ? rotor.spinInertiaKgM2 : 0.5 * rotor.spinInertiaKgM2;
      inertiaKgM2[axis] += rotor.massKg * armSquared[axis] + transverseOrSpin;
    }
  }

  return inertiaKgM2;
}

export function compileAddedMass(config: SimConfig['vehicle']): AddedMass6DOF {
  const baseKg =
    0.5 * config.fluidDensityKgM3 * (config.displacedVolumeCm3 * 1e-6) * config.addedMassTranslationalScale;
  return {
    translationalKg: [
      baseKg * config.addedMassSurgeFactor,
      baseKg * config.addedMassSwayFactor,
      baseKg * config.addedMassHeaveFactor
    ],
    rotationalKgM2: [config.addedMassRollFactor, config.addedMassPitchFactor, config.addedMassYawFactor]
  };
}

export function compileDragCoefficients(config: SimConfig['vehicle']): DragCoefficients6DOF {
  return {
    quadraticTranslationalM2: [config.dragCdASurge, config.dragCdASway, config.dragCdAHeave],
    quadraticRotationalNmS2PerRad2: [config.rotDragQuadRoll, config.rotDragQuadPitch, config.rotDragQuadYaw],
    linearTranslationalNPerMs: [config.dragLinSurge, config.dragLinSway, config.dragLinHeave],
    linearRotationalNmPerRadS: [config.rotDragLinRoll, config.rotDragLinPitch, config.rotDragLinYaw],
    fluidDensityKgM3: config.fluidDensityKgM3
  };
}

export function compileSpatialMassBody(
  dryMassKg: number,
  rigidRotationalKgM2: Marine3,
  addedMass: AddedMass6DOF
): SpatialMassBody {
  return {
    translationalKg: [
      dryMassKg + addedMass.translationalKg[0],
      dryMassKg + addedMass.translationalKg[1],
      dryMassKg + addedMass.translationalKg[2]
    ],
    rotationalKgM2: [
      rigidRotationalKgM2[0] + addedMass.rotationalKgM2[0],
      rigidRotationalKgM2[1] + addedMass.rotationalKgM2[1],
      rigidRotationalKgM2[2] + addedMass.rotationalKgM2[2]
    ],
    rigidRotationalKgM2: [rigidRotationalKgM2[0], rigidRotationalKgM2[1], rigidRotationalKgM2[2]],
    addedTranslationalKg: [
      addedMass.translationalKg[0],
      addedMass.translationalKg[1],
      addedMass.translationalKg[2]
    ],
    addedRotationalKgM2: [
      addedMass.rotationalKgM2[0],
      addedMass.rotationalKgM2[1],
      addedMass.rotationalKgM2[2]
    ]
  };
}

