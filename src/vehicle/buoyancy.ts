import * as THREE from 'three';
import type { SimConfig } from '../core/config';
import { type Marine3 } from '../math/vectors';

export type { Marine3 };

export interface BuoyancyForces {
  dryMassKg: number;
  displacedMassKg: number;
  netBuoyancyForceN: number;
  cobOffsetMarineM: Marine3;
  gravityForceWorldN: Marine3;
  buoyantForceWorldN: Marine3;
  fluidDensityKgM3: number;
}

export const STANDARD_GRAVITY_MS2 = 9.80665;

export function calculateBuoyancy(config: SimConfig['vehicle'], propMassG = 1.8): BuoyancyForces {
  const g = STANDARD_GRAVITY_MS2;
  const rotorCount = config.rotorMounts.length > 0 ? config.rotorMounts.length : config.motorCount;
  const dryMassKg =
    (config.frameMassG + config.hardwareMassG + (config.motorUnitMassG + propMassG) * rotorCount) * 1e-3;
  const displacedMassKg = config.displacedVolumeCm3 * 1e-6 * config.fluidDensityKgM3;
  const netBuoyancyForceN = (displacedMassKg - dryMassKg) * g;
  const cobOffsetMarineM: Marine3 = [0, 0, config.cobAboveCogMm * 1e-3];

  return {
    dryMassKg,
    displacedMassKg,
    netBuoyancyForceN,
    cobOffsetMarineM,
    gravityForceWorldN: [0, -dryMassKg * g, 0],
    buoyantForceWorldN: [0, displacedMassKg * g, 0],
    fluidDensityKgM3: config.fluidDensityKgM3
  };
}

const bodyBuoyantForceN = new THREE.Vector3();
const bodyCobOffsetM = new THREE.Vector3();
const bodyRestoringTorqueNm = new THREE.Vector3();
const inverseBodyQuaternion = new THREE.Quaternion();

export function metacentricRestoringTorqueBodyMarine(
  quaternion: THREE.Quaternion,
  buoyancy: BuoyancyForces,
  out: Marine3
): Marine3 {
  inverseBodyQuaternion.copy(quaternion).invert();
  bodyBuoyantForceN
    .set(buoyancy.buoyantForceWorldN[0], buoyancy.buoyantForceWorldN[1], buoyancy.buoyantForceWorldN[2])
    .applyQuaternion(inverseBodyQuaternion);
  const [surgeOffset, swayOffset, heaveOffset] = buoyancy.cobOffsetMarineM;
  bodyCobOffsetM.set(swayOffset, heaveOffset, surgeOffset);
  bodyRestoringTorqueNm.copy(bodyCobOffsetM).cross(bodyBuoyantForceN);
  out[0] = bodyRestoringTorqueNm.z;
  out[1] = bodyRestoringTorqueNm.x;
  out[2] = bodyRestoringTorqueNm.y;
  return out;
}
