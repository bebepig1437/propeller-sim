export interface DragCoefficients6DOF {
  // Linear quadratic drag areas: Cd * A (m^2)
  surgeCdA: number; // Forward X (streamlined ~ 0.007 m2)
  swayCdA: number;  // Lateral Y (broadside ~ 0.016 m2)
  heaveCdA: number; // Vertical Z (top/bottom ~ 0.022 m2)
  // Angular damping coefficients: (N*m / (rad/s)^2)
  rollDamping: number;
  pitchDamping: number;
  yawDamping: number;
  // Linear damping coefficients for creeping speeds: (N / (m/s))
  linearDamping: [number, number, number];
}

export interface AddedMass6DOF {
  surgeKg: number; // mAx
  swayKg: number;  // mAy
  heaveKg: number; // mAz
  rollKgM2: number; // IAx
  pitchKgM2: number;// IAy
  yawKgM2: number;  // IAz
}

export const CANDIDATE_A_DRAG: DragCoefficients6DOF = {
  surgeCdA: 0.0075,
  swayCdA: 0.0165,
  heaveCdA: 0.0210,
  rollDamping: 0.00045,
  pitchDamping: 0.00095,
  yawDamping: 0.00085,
  linearDamping: [0.15, 0.35, 0.45]
};

export const CANDIDATE_A_ADDED_MASS: AddedMass6DOF = {
  surgeKg: 0.085, // Displaced water entrained in forward motion
  swayKg: 0.145,
  heaveKg: 0.185,
  rollKgM2: 0.00075,
  pitchKgM2: 0.00125,
  yawKgM2: 0.00110
};

/**
 * Computes 6-DOF hydrodynamic damping forces and moments in body frame.
 */
export function computeHydrodynamicDamping(
  velocityBody: [number, number, number],
  angularVelBody: [number, number, number],
  dragCoeffs: DragCoefficients6DOF = CANDIDATE_A_DRAG,
  fluidDensity = 1000.0
): { forceBodyN: [number, number, number]; torqueBodyNm: [number, number, number] } {
  // Body velocity [vx, vy, vz]: vx = Sway (Starboard), vy = Heave (Up), vz = Surge (Bow)
  const [vx, vy, vz] = velocityBody;
  // Angular velocity [wx, wy, wz]: wx = Pitch, wy = Yaw, wz = Roll
  const [wx, wy, wz] = angularVelBody;

  // Dynamic pressure quadratic drag factors
  const qSway = 0.5 * fluidDensity * dragCoeffs.swayCdA;
  const qHeave = 0.5 * fluidDensity * dragCoeffs.heaveCdA;
  const qSurge = 0.5 * fluidDensity * dragCoeffs.surgeCdA;

  // Linear drag forces: F_drag = -(0.5 * rho * CdA * |v| + D_lin) * v
  const fx = -(qSway * Math.abs(vx) + dragCoeffs.linearDamping[0]) * vx || 0;
  const fy = -(qHeave * Math.abs(vy) + dragCoeffs.linearDamping[1]) * vy || 0;
  const fz = -(qSurge * Math.abs(vz) + dragCoeffs.linearDamping[2]) * vz || 0;

  // Angular damping torques: tau_drag = -(D_quad * |w| + D_linear) * w
  const tx = -(dragCoeffs.pitchDamping * Math.abs(wx) + 0.008) * wx || 0; // Pitch around X
  const ty = -(dragCoeffs.yawDamping * Math.abs(wy) + 0.008) * wy || 0;   // Yaw around Y
  const tz = -(dragCoeffs.rollDamping * Math.abs(wz) + 0.005) * wz || 0;  // Roll around Z

  return {
    forceBodyN: [fx, fy, fz],
    torqueBodyNm: [tx, ty, tz]
  };
}
