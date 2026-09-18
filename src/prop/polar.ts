/**
 * Sectional Hydrofoil Polar Representation & Viterna Post-Stall Extrapolation.
 *
 * Implements linear attached flow hydrofoil aerodynamics/hydrodynamics coupled
 * with Viterna-Corrigan post-stall extrapolation for deep stall and 360-degree
 * flow regimes (crucial for bollard pull J=0 and reverse thrust).
 */

export interface PolarDataPoint {
  alphaDeg: number;
  cl: number;
  cd: number;
}

export interface SectionalHydrofoilProperties {
  zeroLiftAlphaDeg: number; // typically ~ -2.0 deg for cambered marine foil
  liftCurveSlope: number;    // dCl/drad ~ 2*pi / (1 + 2/AR)
  clMax: number;             // maximum attached Cl ~ 1.25
  clMin: number;             // minimum attached Cl ~ -0.9
  cd0: number;               // minimum parasite drag coefficient ~ 0.012
  aspectRatio: number;       // blade effective aspect ratio ~ 3.5
  oswaldEfficiency: number;  // ~ 0.85
}

export const defaultHydrofoilProps: SectionalHydrofoilProperties = {
  zeroLiftAlphaDeg: -2.0,
  liftCurveSlope: 5.5,
  clMax: 1.20,
  clMin: -0.85,
  cd0: 0.014,
  aspectRatio: 3.2,
  oswaldEfficiency: 0.82
};

/**
 * Evaluates Lift Coefficient (Cl) and Drag Coefficient (Cd) at any angle of attack
 * alpha (-180 deg to +180 deg) using Viterna-Corrigan post-stall model.
 */
export function evaluateSectionPolar(
  alphaRad: number,
  props: SectionalHydrofoilProperties = defaultHydrofoilProps
): { cl: number; cd: number } {
  // Normalize alpha to [-pi, pi]
  let alpha = Math.atan2(Math.sin(alphaRad), Math.cos(alphaRad));

  const alpha0Rad = (props.zeroLiftAlphaDeg * Math.PI) / 180.0;
  const stallAlphaPosRad = (16.0 * Math.PI) / 180.0;
  const stallAlphaNegRad = (-12.0 * Math.PI) / 180.0;
  const deepStallPosRad = (28.0 * Math.PI) / 180.0;
  const deepStallNegRad = (-26.0 * Math.PI) / 180.0;

  // 1. Attached flow regime
  if (alpha >= stallAlphaNegRad && alpha <= stallAlphaPosRad) {
    const clAttached = props.liftCurveSlope * (alpha - alpha0Rad);
    const clClamped = Math.max(props.clMin, Math.min(props.clMax, clAttached));
    const inducedCd = Math.pow(clClamped, 2) / (Math.PI * props.aspectRatio * props.oswaldEfficiency);
    const cdAttached = props.cd0 + inducedCd;

    return { cl: clClamped, cd: cdAttached };
  }

  // 2. Viterna-Corrigan Post-Stall Extrapolation
  const cdMax = 1.11 + 0.018 * props.aspectRatio; // ~ 1.17
  const sinA = Math.sin(alpha);
  const cosA = Math.cos(alpha);

  // Deep stall formulation
  const clViterna = (cdMax / 2.0) * Math.sin(2.0 * alpha) * 1.1;
  const cdViterna = cdMax * Math.pow(sinA, 2) + props.cd0 * Math.abs(cosA);

  // Smooth blending across stall transition zone
  if (alpha > stallAlphaPosRad && alpha < deepStallPosRad) {
    const t = (alpha - stallAlphaPosRad) / (deepStallPosRad - stallAlphaPosRad);
    const blend = 0.5 * (1.0 + Math.cos(t * Math.PI)); // 1 at stall, 0 at deep stall
    const cdStall = props.cd0 + Math.pow(props.clMax, 2) / (Math.PI * props.aspectRatio * props.oswaldEfficiency);
    const cl = blend * props.clMax + (1.0 - blend) * clViterna;
    const cd = blend * cdStall + (1.0 - blend) * cdViterna;
    return { cl, cd };
  } else if (alpha < stallAlphaNegRad && alpha > deepStallNegRad) {
    const t = (alpha - stallAlphaNegRad) / (deepStallNegRad - stallAlphaNegRad);
    const blend = 0.5 * (1.0 + Math.cos(t * Math.PI));
    const cdStall = props.cd0 + Math.pow(props.clMin, 2) / (Math.PI * props.aspectRatio * props.oswaldEfficiency);
    const cl = blend * props.clMin + (1.0 - blend) * clViterna;
    const cd = blend * cdStall + (1.0 - blend) * cdViterna;
    return { cl, cd };
  }

  return { cl: clViterna, cd: Math.max(props.cd0, cdViterna) };
}

/**
 * Generates an array of polar data points across an angle of attack sweep.
 */
export function generatePolarTable(
  startDeg = -30,
  endDeg = 30,
  stepDeg = 1.0,
  props: SectionalHydrofoilProperties = defaultHydrofoilProps
): PolarDataPoint[] {
  const table: PolarDataPoint[] = [];
  for (let a = startDeg; a <= endDeg; a += stepDeg) {
    const alphaRad = (a * Math.PI) / 180.0;
    const { cl, cd } = evaluateSectionPolar(alphaRad, props);
    table.push({ alphaDeg: a, cl, cd });
  }
  return table;
}
