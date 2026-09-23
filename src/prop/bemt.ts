// Blade Element Momentum Theory (BEMT) solver with Prandtl tip/hub loss and XROTOR/OpenProp corrections
import { evaluateSectionPolarWithReAndRoughness, getHydrofoilProperties, SectionalHydrofoilProperties } from './polar';
import { PropDesign, CANDIDATE_A_DESIGN, getDesignBladeChordAt, getDesignBladePitchAngleAt } from './designs/index';
import type { PropellerMaterial } from './rigidbody';

export interface BEMTElemResult {
  radiusM: number;
  rOverR: number;
  chordM: number;
  twistDeg: number;
  inflowAngleDeg: number;
  alphaDeg: number;
  cl: number;
  cd: number;
  reynolds: number;
  dT: number;
  dQ: number;
  axialInducedMs: number;
  tangentialInducedMs: number;
}

export interface BEMTResult {
  thrustN: number;
  torqueNm: number;
  powerMechW: number;
  advanceRatioJ: number;
  kt: number;
  kq: number;
  efficiency: number;
  rpm: number;
  advanceSpeedMs: number;
  handedness: 'CW' | 'CCW';
  elements: BEMTElemResult[];
}

export interface PropellerBEMTParams {
  design?: PropDesign;
  diameterMm?: number;
  hubDiameterMm?: number;
  blades?: number;
  pitchMm?: number;
  fluidDensity?: number;
  kinematicViscosity?: number;
  numElements?: number;
  material?: PropellerMaterial;
  handedness?: 'CW' | 'CCW';
  foilProps?: SectionalHydrofoilProperties;
}

export function getBladeChordAt(rM: number, rHubM: number, rTipM: number): number {
  const span = rTipM - rHubM;
  const xi = Math.max(0, Math.min(1.0, (rM - rHubM) / span));

  const chordBase = 0.0038;
  const chordPeak = 0.0055;
  const chordTip = 0.0022;

  if (xi < 0.6) {
    const s = xi / 0.6;
    return chordBase + (chordPeak - chordBase) * Math.sin((s * Math.PI) / 2.0);
  } else {
    const s = (xi - 0.6) / 0.4;
    return chordPeak - (chordPeak - chordTip) * Math.pow(s, 1.3);
  }
}

export function getBladePitchAngleAt(rM: number, pitchM: number): number {
  return Math.atan(pitchM / (2.0 * Math.PI * Math.max(1e-4, rM)));
}

export const REVERSE_FLOW_BLEND_BAND_M_PER_S = 0.05;
export const REVERSE_FLOW_BLEND_BAND_MS = REVERSE_FLOW_BLEND_BAND_M_PER_S;

export interface InflowAeroResult {
  W: number;
  phi: number;
  alpha: number;
  cl: number;
  cd: number;
  Cn: number;
  Ct: number;
  reynolds: number;
}

export function evaluateBlendedSectionAero(
  vRaw: number,
  vTangential: number,
  theta: number,
  chord: number,
  nu: number,
  material: PropellerMaterial,
  foilProps: SectionalHydrofoilProperties,
  blendBand: number = REVERSE_FLOW_BLEND_BAND_M_PER_S
): InflowAeroResult {
  const t = Math.max(0, Math.min(1, (vRaw + blendBand) / (2.0 * blendBand)));
  const s = t * t * (3.0 - 2.0 * t);

  const vAxialFwd = Math.max(0.001, vRaw);
  const wFwd = Math.sqrt(vAxialFwd * vAxialFwd + vTangential * vTangential);
  const phiFwd = Math.atan2(vAxialFwd, vTangential);
  const alphaFwd = theta - phiFwd;
  const reFwd = Math.max(100, (wFwd * chord) / nu);
  const polFwd = evaluateSectionPolarWithReAndRoughness(alphaFwd, reFwd, material, foilProps);
  const sinPhiFwd = Math.sin(phiFwd);
  const cosPhiFwd = Math.cos(phiFwd);
  const cnFwd = polFwd.cl * cosPhiFwd - polFwd.cd * sinPhiFwd;
  const ctFwd = polFwd.cl * sinPhiFwd + polFwd.cd * cosPhiFwd;

  if (s >= 0.9999) {
    return {
      W: wFwd,
      phi: phiFwd,
      alpha: alphaFwd,
      cl: polFwd.cl,
      cd: polFwd.cd,
      Cn: cnFwd,
      Ct: ctFwd,
      reynolds: reFwd
    };
  }

  const vAxialRev = Math.min(-0.001, vRaw);
  const wRev = Math.sqrt(vAxialRev * vAxialRev + vTangential * vTangential);
  const phiRev = Math.atan2(vAxialRev, vTangential);
  const alphaRev = theta - phiRev;
  const reRev = Math.max(100, (wRev * chord) / nu);
  const polRev = evaluateSectionPolarWithReAndRoughness(alphaRev, reRev, material, foilProps);
  const sinPhiRev = Math.sin(phiRev);
  const cosPhiRev = Math.cos(phiRev);
  const cnRev = polRev.cl * cosPhiRev - polRev.cd * sinPhiRev;
  const ctRev = polRev.cl * sinPhiRev + polRev.cd * cosPhiRev;

  if (s <= 0.0001) {
    return {
      W: wRev,
      phi: phiRev,
      alpha: alphaRev,
      cl: polRev.cl,
      cd: polRev.cd,
      Cn: cnRev,
      Ct: ctRev,
      reynolds: reRev
    };
  }

  return {
    W: (1.0 - s) * wRev + s * wFwd,
    phi: (1.0 - s) * phiRev + s * phiFwd,
    alpha: (1.0 - s) * alphaRev + s * alphaFwd,
    cl: (1.0 - s) * polRev.cl + s * polFwd.cl,
    cd: (1.0 - s) * polRev.cd + s * polFwd.cd,
    Cn: (1.0 - s) * cnRev + s * cnFwd,
    Ct: (1.0 - s) * ctRev + s * ctFwd,
    reynolds: (1.0 - s) * reRev + s * reFwd
  };
}

const MAX_PREALLOC_ELEMENTS = 64;
const BEMT_RING_SIZE = 8;
let bemtRingIndex = 0;

function createBemtElement(): BEMTElemResult {
  return {
    radiusM: 0,
    rOverR: 0,
    chordM: 0,
    twistDeg: 0,
    inflowAngleDeg: 0,
    alphaDeg: 0,
    cl: 0,
    cd: 0,
    reynolds: 0,
    dT: 0,
    dQ: 0,
    axialInducedMs: 0,
    tangentialInducedMs: 0
  };
}

const bemtResultRing: BEMTResult[] = Array.from({ length: BEMT_RING_SIZE }, () => ({
  thrustN: 0,
  torqueNm: 0,
  powerMechW: 0,
  advanceRatioJ: 0,
  kt: 0,
  kq: 0,
  efficiency: 0,
  rpm: 0,
  advanceSpeedMs: 0,
  handedness: "CW",
  elements: Array.from({ length: MAX_PREALLOC_ELEMENTS }, createBemtElement)
}));

export function cloneBEMTResult(res: BEMTResult): BEMTResult {
  return {
    ...res,
    elements: res.elements.map(e => ({ ...e }))
  };
}

export function solveBemt(
  rpm: number,
  advanceSpeedMs: number,
  localParams?: PropellerBEMTParams,
  out?: BEMTResult
): BEMTResult {
  const design = localParams?.design ?? CANDIDATE_A_DESIGN;
  const D = (localParams?.diameterMm ?? design.diameterMm) * 1e-3;
  const Dhub = (localParams?.hubDiameterMm ?? design.hubDiameterMm) * 1e-3;
  const B = localParams?.blades ?? design.blades;
  const pitchOverrideMm = localParams?.pitchMm;
  const rho = localParams?.fluidDensity ?? 1000.0;
  const nu = localParams?.kinematicViscosity ?? 1e-6;
  const N = localParams?.numElements ?? 20;
  const material = localParams?.material ?? 'rigid10k';
  const handedness = localParams?.handedness ?? 'CW';
  const foilProps = localParams?.foilProps ?? getHydrofoilProperties(design.sectionAirfoil);

  const R = D / 2.0;
  const Rhub = Dhub / 2.0;
  const dr = (R - Rhub) / N;

  const targetResult = out ?? bemtResultRing[bemtRingIndex++ % BEMT_RING_SIZE];
  const targetElements = targetResult.elements;
  while (targetElements.length < N) {
    targetElements.push(createBemtElement());
  }
  targetElements.length = N;

  if (Math.abs(rpm) < 1.0) {
    let totalThrust = 0;

    for (let i = 0; i < N; i++) {
      const r = Rhub + (i + 0.5) * dr;
      const rOverR = r / R;
      const chord = getDesignBladeChordAt(r, design, localParams?.diameterMm);
      const theta = getDesignBladePitchAngleAt(r, design, pitchOverrideMm, localParams?.diameterMm);

      const W = Math.abs(advanceSpeedMs);
      const phi = advanceSpeedMs >= 0 ? Math.PI / 2.0 : -Math.PI / 2.0;
      const alpha = theta - phi;
      const re = Math.max(100, (W * chord) / nu);

      const polar = evaluateSectionPolarWithReAndRoughness(alpha, re, material, foilProps);
      const qDyn = 0.5 * rho * W * W;
      const cdFinite = Number.isFinite(polar.cd) ? Math.max(0.01, polar.cd) : 0.1;
      const dT = -Math.sign(advanceSpeedMs || 1) * cdFinite * qDyn * chord * dr * B;
      totalThrust += dT;

      const el = targetElements[i];
      el.radiusM = r;
      el.rOverR = rOverR;
      el.chordM = chord;
      el.twistDeg = (theta * 180.0) / Math.PI;
      el.inflowAngleDeg = (phi * 180.0) / Math.PI;
      el.alphaDeg = (alpha * 180.0) / Math.PI;
      el.cl = Number.isFinite(polar.cl) ? polar.cl : 0;
      el.cd = cdFinite;
      el.reynolds = Number.isFinite(re) ? re : 0;
      el.dT = Number.isFinite(dT) ? dT : 0;
      el.dQ = 0;
      el.axialInducedMs = 0;
      el.tangentialInducedMs = 0;
    }

    targetResult.thrustN = totalThrust;
    targetResult.torqueNm = 0;
    targetResult.powerMechW = 0;
    targetResult.advanceRatioJ = 0;
    targetResult.kt = 0;
    targetResult.kq = 0;
    targetResult.efficiency = 0;
    targetResult.rpm = 0;
    targetResult.advanceSpeedMs = advanceSpeedMs;
    targetResult.handedness = handedness;
    return targetResult;
  }

  const signRpm = Math.sign(rpm);
  const absRpm = Math.abs(rpm);
  const n = absRpm / 60.0;
  const omega = 2.0 * Math.PI * n;

  let totalThrust = 0;
  let totalTorque = 0;

  for (let i = 0; i < N; i++) {
    const r = Rhub + (i + 0.5) * dr;
    const rOverR = r / R;
    const chord = getDesignBladeChordAt(r, design, localParams?.diameterMm);
    const theta = getDesignBladePitchAngleAt(r, design, pitchOverrideMm, localParams?.diameterMm);
    const solidity = (B * chord) / (2.0 * Math.PI * r);

    let vi = Math.max(0.05, 0.12 * omega * r);
    let viTheta = 0.015 * omega * r;

    const maxIters = 35;
    const tol = 1e-4;

    for (let iter = 0; iter < maxIters; iter++) {
      const vTangential = Math.max(0.01, omega * r - viTheta);
      const aero = evaluateBlendedSectionAero(
        advanceSpeedMs + vi,
        vTangential,
        theta,
        chord,
        nu,
        material,
        foilProps
      );

      const W = aero.W;
      const phi = aero.phi;
      const Cn = aero.Cn;
      const Ct = aero.Ct;
      const sinPhi = Math.sin(phi);

      const sinPhiPos = Math.max(0.01, Math.abs(sinPhi));
      const fTip = Math.max(0.001, (B * (R - r)) / (2.0 * r * sinPhiPos));
      const expTip = Math.exp(-fTip);
      const Ftip = (expTip >= 1.0 || expTip <= 0.0 || !Number.isFinite(expTip))
        ? 0.0
        : (2.0 / Math.PI) * Math.acos(Math.min(1.0, Math.max(0.0, expTip)));

      const fHub = Math.max(0.001, (B * (r - Rhub)) / (2.0 * Rhub * sinPhiPos));
      const expHub = Math.exp(-fHub);
      const Fhub = (expHub >= 1.0 || expHub <= 0.0 || !Number.isFinite(expHub))
        ? 0.0
        : (2.0 / Math.PI) * Math.acos(Math.min(1.0, Math.max(0.0, expHub)));

      const F = Math.max(0.05, Math.min(1.0, Ftip * Fhub));

      const K = Math.max(0, (solidity * Cn) / (4.0 * F));
      const discriminant = Math.pow(advanceSpeedMs / 2.0, 2) + K * W * W;
      const viNew = -advanceSpeedMs / 2.0 + Math.sqrt(Math.max(0, discriminant));

      const denomTheta = 4.0 * F * Math.max(0.05, advanceSpeedMs + viNew);
      const viThetaNew = Math.max(0, (solidity * Ct * W * W) / denomTheta);

      const viRelaxed = 0.65 * vi + 0.35 * viNew;
      const viThetaRelaxed = 0.65 * viTheta + 0.35 * viThetaNew;

      if (Math.abs(viRelaxed - vi) < tol && Math.abs(viThetaRelaxed - viTheta) < tol) {
        vi = viRelaxed;
        viTheta = viThetaRelaxed;
        break;
      }
      vi = viRelaxed;
      viTheta = viThetaRelaxed;
    }

    const vTangentialConv = Math.max(0.01, omega * r - viTheta);
    const aeroConv = evaluateBlendedSectionAero(
      advanceSpeedMs + vi,
      vTangentialConv,
      theta,
      chord,
      nu,
      material,
      foilProps
    );

    const WConv = aeroConv.W;
    const phiConv = aeroConv.phi;
    const alphaConv = aeroConv.alpha;
    const clConv = aeroConv.cl;
    const cdConv = aeroConv.cd;
    const CnConv = aeroConv.Cn;
    const CtConv = aeroConv.Ct;
    const reConv = aeroConv.reynolds;

    if (!Number.isFinite(phiConv) || !Number.isFinite(WConv) || WConv <= 1e-6) {
      const qDyn = 0.5 * rho * Math.max(1e-6, (advanceSpeedMs * advanceSpeedMs));
      const cdFallback = 0.1;
      const dT = -qDyn * cdFallback * chord * dr * B;
      const dQ = qDyn * cdFallback * chord * r * dr * B;
      totalThrust += Number.isFinite(dT) ? dT : 0;
      totalTorque += Number.isFinite(dQ) ? dQ : 0;
      const el = targetElements[i];
      el.radiusM = r;
      el.rOverR = rOverR;
      el.chordM = chord;
      el.twistDeg = (theta * 180.0) / Math.PI;
      el.inflowAngleDeg = (theta * 180.0) / Math.PI;
      el.alphaDeg = 0;
      el.cl = 0;
      el.cd = cdFallback;
      el.reynolds = 0;
      el.dT = Number.isFinite(dT) ? dT : 0;
      el.dQ = Number.isFinite(dQ) ? dQ : 0;
      el.axialInducedMs = vi;
      el.tangentialInducedMs = viTheta;
      continue;
    }

    const qDyn = 0.5 * rho * WConv * WConv;
    const dT = qDyn * CnConv * chord * dr * B;
    const dQ = qDyn * CtConv * chord * r * dr * B;

    totalThrust += dT;
    totalTorque += dQ;

    const el = targetElements[i];
    el.radiusM = r;
    el.rOverR = rOverR;
    el.chordM = chord;
    el.twistDeg = (theta * 180.0) / Math.PI;
    el.inflowAngleDeg = Number.isFinite(phiConv) ? (phiConv * 180.0) / Math.PI : 0;
    el.alphaDeg = Number.isFinite(alphaConv) ? (alphaConv * 180.0) / Math.PI : 0;
    el.cl = Number.isFinite(clConv) ? clConv : 0;
    el.cd = Number.isFinite(cdConv) ? cdConv : 0.1;
    el.reynolds = Number.isFinite(reConv) ? reConv : 0;
    el.dT = Number.isFinite(dT) ? dT : 0;
    el.dQ = Number.isFinite(dQ) ? dQ : 0;
    el.axialInducedMs = Number.isFinite(vi) ? vi : 0;
    el.tangentialInducedMs = Number.isFinite(viTheta) ? viTheta : 0;
  }

  if (signRpm < 0) {
    totalThrust = -totalThrust * 0.72;
    totalTorque = totalTorque * 0.88;
  }

  const directedTorque = handedness === 'CW' ? -totalTorque : totalTorque;

  const powerMech = Math.max(0, totalTorque * omega);
  const J = n > 1e-5 ? advanceSpeedMs / (n * D) : 0;
  const kt = n > 1e-5 ? totalThrust / (rho * Math.pow(n, 2) * Math.pow(D, 4)) : 0;
  const kq = n > 1e-5 ? totalTorque / (rho * Math.pow(n, 2) * Math.pow(D, 5)) : 0;

  let efficiency = 0;
  if (powerMech > 1e-4 && advanceSpeedMs > 1e-4 && totalThrust > 0) {
    efficiency = Math.min(1.0, Math.max(0.0, (totalThrust * advanceSpeedMs) / powerMech));
  }

  targetResult.thrustN = Number.isFinite(totalThrust) ? totalThrust : 0;
  targetResult.torqueNm = Number.isFinite(directedTorque) ? directedTorque : 0;
  targetResult.powerMechW = Number.isFinite(powerMech) ? powerMech : 0;
  targetResult.advanceRatioJ = Number.isFinite(J) ? J : 0;
  targetResult.kt = Number.isFinite(kt) ? kt : 0;
  targetResult.kq = Number.isFinite(kq) ? kq : 0;
  targetResult.efficiency = Number.isFinite(efficiency) ? efficiency : 0;
  targetResult.rpm = rpm;
  targetResult.advanceSpeedMs = advanceSpeedMs;
  targetResult.handedness = handedness;
  return targetResult;
}

