import type { PropellerMaterial } from './rigidbody';

/**
 * Sectional Hydrofoil Polar Representation & Viterna Post-Stall Extrapolation.
 *
 * Implements linear attached flow hydrofoil aerodynamics/hydrodynamics coupled
 * with Viterna-Corrigan post-stall extrapolation for deep stall and 360-degree
 * flow regimes (crucial for bollard pull J=0 and reverse thrust).
 *
 * Includes Reynolds number scaling and surface roughness adjustments for Candidate A
 * materials: Rigid 10K (smooth SLA), PA12-CF15 (SLS nylon), and PETG (FDM layer-lines).
 */

export interface PolarDataPoint {
  alphaDeg: number;
  cl: number;
  cd: number;
}

export interface SectionalHydrofoilProperties {
  zeroLiftAlphaDeg: number; // typically ~ -2.0 deg to -4.0 deg for cambered marine foil
  liftCurveSlope: number;    // dCl/drad ~ 2*pi / (1 + 2/AR)
  clMax: number;             // maximum attached Cl ~ 1.2 - 1.45
  clMin: number;             // minimum attached Cl ~ -0.85 - -0.9
  cd0: number;               // minimum parasite drag coefficient ~ 0.0075 - 0.014
  aspectRatio: number;       // blade effective aspect ratio ~ 3.2 - 3.5
  oswaldEfficiency: number;  // ~ 0.82 - 0.85
  referenceRe?: number;      // ~ 100,000
}

/**
 * Surface roughness increments on minimum drag coefficient delta Cd0.
 * Rigid 10K: optical SLA smooth finish
 * PA12-CF15: SLS powder micro-roughness
 * PETG: FDM layer lines and surface stepping
 */
export const MATERIAL_ROUGHNESS_CD_SHIFT: Record<PropellerMaterial, number> = {
  rigid10k: 0.0000,
  pa12cf15: 0.0035,
  petg: 0.0075
};

export const NACA_4412_PROPS: SectionalHydrofoilProperties = {
  zeroLiftAlphaDeg: -3.8,
  liftCurveSlope: 5.85,
  clMax: 1.42,
  clMin: -0.85,
  cd0: 0.0080,
  aspectRatio: 3.5,
  oswaldEfficiency: 0.85,
  referenceRe: 100000
};

export const NACA_63012_PROPS: SectionalHydrofoilProperties = {
  zeroLiftAlphaDeg: 0.0,
  liftCurveSlope: 5.90,
  clMax: 1.25,
  clMin: -1.25,
  cd0: 0.0055,
  aspectRatio: 3.5,
  oswaldEfficiency: 0.86,
  referenceRe: 100000
};

export const FLAT_PLATE_PROPS: SectionalHydrofoilProperties = {
  zeroLiftAlphaDeg: 0.0,
  liftCurveSlope: 5.40,
  clMax: 0.85,
  clMin: -0.85,
  cd0: 0.0120,
  aspectRatio: 3.0,
  oswaldEfficiency: 0.80,
  referenceRe: 50000
};

export const defaultHydrofoilProps: SectionalHydrofoilProperties = NACA_4412_PROPS;

/**
 * Returns hydrofoil properties given a section identifier.
 */
export function getHydrofoilProperties(sectionName = 'naca4412'): SectionalHydrofoilProperties {
  const s = sectionName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('63012')) return NACA_63012_PROPS;
  if (s.includes('flat')) return FLAT_PLATE_PROPS;
  return NACA_4412_PROPS;
}

/**
 * Evaluates Lift Coefficient (Cl) and Drag Coefficient (Cd) at any angle of attack
 * alpha (-180 deg to +180 deg) using Viterna-Corrigan post-stall model.
 */
export function evaluateSectionPolar(
  alphaRad: number,
  props: SectionalHydrofoilProperties = defaultHydrofoilProps
): { cl: number; cd: number } {
  // Normalize alpha to [-pi, pi]
  const alpha = Math.atan2(Math.sin(alphaRad), Math.cos(alphaRad));

  const alpha0Rad = (props.zeroLiftAlphaDeg * Math.PI) / 180.0;
  const stallAlphaPosRad = (15.0 * Math.PI) / 180.0;
  const stallAlphaNegRad = (-13.0 * Math.PI) / 180.0;
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
 * Evaluates sectional polar with Reynolds number scaling and material surface roughness.
 */
export function evaluateSectionPolarWithReAndRoughness(
  alphaRad: number,
  reynolds: number,
  material: PropellerMaterial = 'rigid10k',
  props: SectionalHydrofoilProperties = defaultHydrofoilProps
): { cl: number; cd: number } {
  // Base polar evaluation
  const base = evaluateSectionPolar(alphaRad, props);

  // 1. Reynolds number scaling on parasite drag:
  // Cd0 scales as (Re_ref / Re)^0.2 in turbulent boundary layers
  const refRe = props.referenceRe ?? 100000;
  const safeRe = Math.max(1000, reynolds);
  const reScaling = Math.pow(refRe / safeRe, 0.18);
  const reShift = props.cd0 * (Math.min(2.5, Math.max(0.7, reScaling)) - 1.0);

  // 2. Surface roughness delta
  const roughnessShift = MATERIAL_ROUGHNESS_CD_SHIFT[material] ?? 0.0;

  const totalCd = Math.max(0.005, base.cd + reShift + roughnessShift);
  return { cl: base.cl, cd: totalCd };
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
