import type { PropellerMaterial } from './rigidbody';
import { PROP_MATERIALS, PropMaterialId } from './materials';

export interface PolarDataPoint {
  alphaDeg: number;
  cl: number;
  cd: number;
}

export interface SectionalHydrofoilProperties {
  zeroLiftAlphaDeg: number;
  liftCurveSlope: number;
  clMax: number;
  clMin: number;
  cd0: number;
  aspectRatio: number;
  oswaldEfficiency: number;
  referenceRe?: number;
}

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

export function getHydrofoilProperties(sectionName = 'naca4412'): SectionalHydrofoilProperties {
  const s = sectionName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('63012')) return NACA_63012_PROPS;
  if (s.includes('flat')) return FLAT_PLATE_PROPS;
  return NACA_4412_PROPS;
}

export function evaluateSectionPolar(
  alphaRad: number,
  props: SectionalHydrofoilProperties = defaultHydrofoilProps
): { cl: number; cd: number } {
  const alpha = Math.atan2(Math.sin(alphaRad), Math.cos(alphaRad));

  const alpha0Rad = (props.zeroLiftAlphaDeg * Math.PI) / 180.0;
  const stallAlphaPosRad = (15.0 * Math.PI) / 180.0;
  const stallAlphaNegRad = (-13.0 * Math.PI) / 180.0;
  const deepStallPosRad = (28.0 * Math.PI) / 180.0;
  const deepStallNegRad = (-26.0 * Math.PI) / 180.0;

  if (alpha >= stallAlphaNegRad && alpha <= stallAlphaPosRad) {
    const clAttached = props.liftCurveSlope * (alpha - alpha0Rad);
    const clClamped = Math.max(props.clMin, Math.min(props.clMax, clAttached));
    const inducedCd = Math.pow(clClamped, 2) / (Math.PI * props.aspectRatio * props.oswaldEfficiency);
    const cdAttached = props.cd0 + inducedCd;

    return { cl: clClamped, cd: cdAttached };
  }

  const cdMax = 1.11 + 0.018 * props.aspectRatio;
  const sinA = Math.sin(alpha);
  const cosA = Math.cos(alpha);

  const clViterna = (cdMax / 2.0) * Math.sin(2.0 * alpha) * 1.1;
  const cdViterna = cdMax * Math.pow(sinA, 2) + props.cd0 * Math.abs(cosA);

  if (alpha > stallAlphaPosRad && alpha < deepStallPosRad) {
    const t = (alpha - stallAlphaPosRad) / (deepStallPosRad - stallAlphaPosRad);
    const blend = 0.5 * (1.0 + Math.cos(t * Math.PI));
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

export function evaluateSectionPolarWithReAndRoughness(
  alphaRad: number,
  reynolds: number,
  material: PropellerMaterial = 'rigid10k',
  props: SectionalHydrofoilProperties = defaultHydrofoilProps
): { cl: number; cd: number } {
  /* Skin friction roughness scaling on minimum profile drag paper: Schlichting (1979) */
  const roughnessMult = PROP_MATERIALS[material as PropMaterialId]?.roughnessMultiplier ?? 1.0;
  const cd0Effective = props.cd0 * roughnessMult;
  const effectiveProps: SectionalHydrofoilProperties = { ...props, cd0: cd0Effective };

  const base = evaluateSectionPolar(alphaRad, effectiveProps);

  const refRe = props.referenceRe ?? 100000;
  const safeRe = Math.max(1000, reynolds);
  const reScaling = Math.pow(refRe / safeRe, 0.18);
  const reShift = cd0Effective * (Math.min(2.5, Math.max(0.7, reScaling)) - 1.0);

  const totalCd = Math.max(0.005, base.cd + reShift);
  return { cl: base.cl, cd: totalCd };
}

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
