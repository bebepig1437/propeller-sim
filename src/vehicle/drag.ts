import type { Marine3 } from '../math/vectors';

export interface DragCoefficients6DOF {
  quadraticTranslationalM2: Marine3;
  quadraticRotationalNmS2PerRad2: Marine3;
  linearTranslationalNPerMs: Marine3;
  linearRotationalNmPerRadS: Marine3;
  fluidDensityKgM3: number;
}

export interface AddedMass6DOF {
  translationalKg: Marine3;
  rotationalKgM2: Marine3;
}

export const CANDIDATE_A_DRAG: DragCoefficients6DOF = {
  quadraticTranslationalM2: [0.0079, 0.0129, 0.0227],
  quadraticRotationalNmS2PerRad2: [4.5e-4, 9.5e-4, 8.5e-4],
  linearTranslationalNPerMs: [0.15, 0.35, 0.45],
  linearRotationalNmPerRadS: [0.005, 0.008, 0.008],
  fluidDensityKgM3: 1000
};

export const CANDIDATE_A_ADDED_MASS: AddedMass6DOF = {
  translationalKg: [0.085, 0.1, 0.12],
  rotationalKgM2: [0.00075, 0.00125, 0.0011]
};

export interface HydrodynamicDamping {
  forceBodyN: Marine3;
  torqueBodyNm: Marine3;
}

const dampingResult: HydrodynamicDamping = { forceBodyN: [0, 0, 0], torqueBodyNm: [0, 0, 0] };

export function computeHydrodynamicDamping(
  velocityBodyMarine: Marine3,
  angularVelocityBodyMarine: Marine3,
  coefficients: DragCoefficients6DOF = CANDIDATE_A_DRAG
): HydrodynamicDamping {
  const rho = coefficients.fluidDensityKgM3;
  const d = coefficients;

  for (let axis = 0; axis < 3; axis++) {
    const v = velocityBodyMarine[axis];
    const w = angularVelocityBodyMarine[axis];
    const quadraticLinearV = 0.5 * rho * d.quadraticTranslationalM2[axis] * Math.abs(v) + d.linearTranslationalNPerMs[axis];
    const quadraticLinearW =
      d.quadraticRotationalNmS2PerRad2[axis] * Math.abs(w) + d.linearRotationalNmPerRadS[axis];
    dampingResult.forceBodyN[axis] = -quadraticLinearV * v;
    dampingResult.torqueBodyNm[axis] = -quadraticLinearW * w;
  }

  return dampingResult;
}
