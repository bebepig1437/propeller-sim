import * as THREE from 'three';
import type { SimConfig } from '../core/config';

export interface BuoyancyForces {
  dryMassKg: number;
  displacedMassKg: number;
  netBuoyancyForceN: number;
  cobOffsetBodyM: [number, number, number];
  gravityForceN: [number, number, number];
  buoyantForceWorldN: [number, number, number];
}

/**
 * Evaluates hydrostatic equilibrium, positive net buoyancy, and CoB-above-CoG restoring moment
 * according to Candidate A physical parameters.
 */
export function calculateBuoyancy(
  config: SimConfig['vehicle'],
  propMassG = 1.80
): BuoyancyForces {
  const g = 9.80665;

  // Candidate A total dry mass in kg (frame + hardware + 3 motors + 3 props)
  const dryKg = (config.frameMassG + config.hardwareMassG + (config.motorUnitMassG * config.motorCount) + 3 * propMassG) * 1e-3;

  // Displaced water mass (200 cm3 at 1000 kg/m3 = 0.200 kg)
  const displacedKg = (config.displacedVolumeCm3 * 1e-6) * config.fluidDensityKgM3;

  // Net buoyant force along vertical axis (+Z or +Y depending on world frame, we provide explicit vector)
  const netKg = displacedKg - dryKg;
  const netBuoyancyForceN = netKg * g; // ~ +0.197 N

  // Center of Buoyancy is 12.5mm directly above Center of Gravity along body Y axis (+Yb is Dorsal/Up)
  const cobOffsetBodyM: [number, number, number] = [0.0, config.cobAboveCogMm * 1e-3, 0.0];

  return {
    dryMassKg: dryKg,
    displacedMassKg: displacedKg,
    netBuoyancyForceN,
    cobOffsetBodyM,
    gravityForceN: [0.0, -dryKg * g, 0.0],
    buoyantForceWorldN: [0.0, displacedKg * g, 0.0]
  };
}

/**
 * Computes 3D metacentric righting moment restoring the vehicle upright in pitch and roll:
 * tau_righting = r_cob_world x F_buoyant_world
 */
export function computeMetacentricRightingMoment(
  quaternion: THREE.Quaternion,
  buoyancy: BuoyancyForces
): [number, number, number] {
  const d = buoyancy.cobOffsetBodyM[1]; // Distance above CoG along body Y
  const fb = buoyancy.buoyantForceWorldN[1]; // Vertical buoyant force along world Y

  // Closed-form quaternion rotation of (0, d, 0) crossed with (0, fb, 0):
  // r_cob_world = d * [ 2*(x*y - w*z), 1 - 2*(x*x + z*z), 2*(y*z + w*x) ]
  // tau = r_cob_world x [0, fb, 0] = [ -2*(y*z + w*x)*d*fb, 0, 2*(x*y - w*z)*d*fb ]
  const x = quaternion.x;
  const y = quaternion.y;
  const z = quaternion.z;
  const w = quaternion.w;

  const tauX = -2.0 * (y * z + w * x) * d * fb;
  const tauZ = 2.0 * (x * y - w * z) * d * fb;

  return [tauX, 0.0, tauZ];
}
