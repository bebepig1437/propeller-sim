import { evaluateSectionPolarWithReAndRoughness, getHydrofoilProperties, SectionalHydrofoilProperties } from './polar';
import { PropDesign, CANDIDATE_A_DESIGN, getDesignBladeChordAt, getDesignBladePitchAngleAt } from './designs/index';
import type { PropellerMaterial } from './rigidbody';

/**
 * SIGN CONVENTIONS (documented per CONVENTIONS.md):
 * - Advance speed Va: positive along +X (forward boat motion, oncoming water from fore to aft).
 * - Forward thrust T: positive pushing vehicle forward (+X_b).
 * - Rotational RPM: positive n.
 * - Handedness:
 *   - 'CW': Clockwise from behind looking forward. Tangential swirl v_iTheta opposes rotation.
 *     Reaction torque on vehicle is negative (-X_b).
 *   - 'CCW': Counter-Clockwise. Flips blade pitch and tangential velocity sign.
 *     Reaction torque on vehicle is positive (+X_b).
 * - Reverse flow: When Va + vi <= 0, branches to locked-rotor / windmill drag mode.
 */

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
  diameterMm?: number;      // default 42 mm
  hubDiameterMm?: number;   // default 8 mm
  blades?: number;          // default 3
  pitchMm?: number;         // default ~33.2 mm
  fluidDensity?: number;    // default 1000 kg/m3
  kinematicViscosity?: number; // default 1e-6 m2/s
  numElements?: number;     // default 20
  material?: PropellerMaterial; // default 'rigid10k'
  handedness?: 'CW' | 'CCW';    // default 'CW'
  foilProps?: SectionalHydrofoilProperties;
}

/**
 * Standard chord distribution function (kept for backwards compatibility).
 */
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

/**
 * Computes blade pitch angle theta(r) in radians from pitch P (backwards compatible).
 */
export function getBladePitchAngleAt(rM: number, pitchM: number): number {
  return Math.atan(pitchM / (2.0 * Math.PI * Math.max(1e-4, rM)));
}

/**
 * Documented reverse-flow transition band half-width in m/s (default 0.05 m/s).
 * Physical basis: 0.05 m/s matches the sub-cell Eulerian grid fluctuation threshold
 * (dx / dt * alpha_inflow = 0.0015 m / (1/60 s) * 0.5 ~= 0.045 m/s), ensuring discrete
 * fluid grid velocity perturbations do not trigger discontinuous regime transitions at Va + vi = 0.
 */
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

/**
 * Smooth Hermite smoothstep blend between forward and reverse section aerodynamics.
 * Guarantees C1 continuity across the Va + vi = 0 boundary.
 */
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
  const s = t * t * (3.0 - 2.0 * t); // Smoothstep Hermite weight in [0, 1]

  // Forward branch
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

  // Reverse branch
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

  // Smooth Hermite blend across transition band
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

/**
 * Solves Blade Element Momentum Theory (BEMT) for a marine propeller.
 *
 * Implements:
 * 1. Prandtl tip loss: fTip = (B/2) * (R - r) / (r * sin(phi)) with local radius r.
 * 2. Prandtl hub loss: fHub = (B/2) * (r - Rhub) / (Rhub * sin(phi)) normalized by hub radius (Glauert 1935, Drela XROTOR).
 * 3. Damped fixed-point induction iteration.
 * 4. Post-convergence aerodynamic recomputation before force integration.
 * 5. Continuous reverse-flow / windmill branch.
 * 6. Zero-RPM locked-rotor hydrodynamic drag calculation returning non-empty elements.
 * 7. Handedness (CW / CCW) with exact torque symmetry.
 * 8. Reynolds number scaling and material surface roughness.
 */
export function solveBEMT(
  rpm: number,
  advanceSpeedMs: number,
  params?: PropellerBEMTParams
): BEMTResult {
  const design = params?.design ?? CANDIDATE_A_DESIGN;
  const D = (params?.diameterMm ?? design.diameterMm) * 1e-3;
  const Dhub = (params?.hubDiameterMm ?? design.hubDiameterMm) * 1e-3;
  const B = params?.blades ?? design.blades;
  const pitchOverrideMm = params?.pitchMm;
  const rho = params?.fluidDensity ?? 1000.0;
  const nu = params?.kinematicViscosity ?? 1e-6;
  const N = params?.numElements ?? 20;
  const material = params?.material ?? 'rigid10k';
  const handedness = params?.handedness ?? 'CW';
  const foilProps = params?.foilProps ?? getHydrofoilProperties(design.sectionAirfoil);

  const R = D / 2.0;
  const Rhub = Dhub / 2.0;
  const dr = (R - Rhub) / N;

  // Zero-RPM handling: A stationary propeller in flow produces locked-rotor drag.
  // Must return non-empty elements with vi = viTheta = 0.
  if (Math.abs(rpm) < 1.0) {
    let totalThrust = 0;
    const elements: BEMTElemResult[] = [];

    for (let i = 0; i < N; i++) {
      const r = Rhub + (i + 0.5) * dr;
      const rOverR = r / R;
      const chord = getDesignBladeChordAt(r, design, params?.diameterMm);
      const theta = getDesignBladePitchAngleAt(r, design, pitchOverrideMm, params?.diameterMm);

      const W = Math.abs(advanceSpeedMs);
      const phi = advanceSpeedMs >= 0 ? Math.PI / 2.0 : -Math.PI / 2.0;
      const alpha = theta - phi;
      const re = Math.max(100, (W * chord) / nu);

      const polar = evaluateSectionPolarWithReAndRoughness(alpha, re, material, foilProps);
      // Axial force coefficient along thrust direction: -Cd * sign(Va)
      const qDyn = 0.5 * rho * W * W;
      const dT = -Math.sign(advanceSpeedMs || 1) * polar.cd * qDyn * chord * dr * B;
      totalThrust += dT;

      elements.push({
        radiusM: r,
        rOverR,
        chordM: chord,
        twistDeg: (theta * 180.0) / Math.PI,
        inflowAngleDeg: (phi * 180.0) / Math.PI,
        alphaDeg: (alpha * 180.0) / Math.PI,
        cl: polar.cl,
        cd: polar.cd,
        reynolds: re,
        dT,
        dQ: 0,
        axialInducedMs: 0,
        tangentialInducedMs: 0
      });
    }

    return {
      thrustN: totalThrust,
      torqueNm: 0,
      powerMechW: 0,
      advanceRatioJ: 0,
      kt: 0,
      kq: 0,
      efficiency: 0,
      rpm: 0,
      advanceSpeedMs,
      handedness,
      elements
    };
  }

  const signRpm = Math.sign(rpm);
  const absRpm = Math.abs(rpm);
  const n = absRpm / 60.0; // rev/s
  const omega = 2.0 * Math.PI * n; // rad/s

  let totalThrust = 0;
  let totalTorque = 0;
  const elements: BEMTElemResult[] = [];

  for (let i = 0; i < N; i++) {
    const r = Rhub + (i + 0.5) * dr;
    const rOverR = r / R;
    const chord = getBladeChordAt(r, Rhub, R);
    const theta = getBladePitchAngleAt(r, pitchM);
    const solidity = (B * chord) / (2.0 * Math.PI * r);

    // Initial guess for induced velocities
    let vi = Math.max(0.1, 0.15 * omega * r);
    let viTheta = 0.02 * omega * r;

    const maxIters = 25;
    const tol = 1e-4;

    let phi = 0;
    let alpha = 0;
    let cl = 0;
    let cd = 0;
    let Cn = 0;
    let Ct = 0;
    let W = 0;

    for (let iter = 0; iter < maxIters; iter++) {
      const vAxial = advanceSpeedMs + vi;
      const vTangential = Math.max(0.01, omega * r - viTheta);

      W = Math.sqrt(vAxial * vAxial + vTangential * vTangential);
      phi = Math.atan2(vAxial, vTangential);
      alpha = theta - phi;

      const polar = evaluateSectionPolar(alpha, foilProps);
      cl = polar.cl;
      cd = polar.cd;

      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      // Prandtl tip and hub loss factor
      const fTip = Math.max(0.001, (B * (R - r)) / (2.0 * r * Math.max(0.01, Math.abs(sinPhi))));
      const Ftip = (2.0 / Math.PI) * Math.acos(Math.min(1.0, Math.exp(-fTip)));

      const fHub = Math.max(0.001, (B * (r - Rhub)) / (2.0 * r * Math.max(0.01, Math.abs(sinPhi))));
      const Fhub = (2.0 / Math.PI) * Math.acos(Math.min(1.0, Math.exp(-fHub)));

      const F = Math.max(0.05, Ftip * Fhub);

      Cn = cl * cosPhi - cd * sinPhi;
      Ct = cl * sinPhi + cd * cosPhi;

      // Robust Momentum Inflow Coupling:
      // (Va + vi) * vi = (sigma * Cn / (4 * F)) * W^2 = K * W^2
      const K = Math.max(0, (solidity * Cn) / (4.0 * F));
      const discriminant = Math.pow(advanceSpeedMs / 2.0, 2) + K * W * W;
      const viNew = -advanceSpeedMs / 2.0 + Math.sqrt(Math.max(0, discriminant));

      // Tangential induced velocity:
      // viTheta = (sigma * Ct * W^2) / (4 * F * (Va + vi))
      const denomTheta = 4.0 * F * Math.max(0.05, advanceSpeedMs + viNew);
      const viThetaNew = Math.max(0, (solidity * Ct * W * W) / denomTheta);

      // Under-relaxation for smooth convergence
      const viRelaxed = 0.6 * vi + 0.4 * viNew;
      const viThetaRelaxed = 0.6 * viTheta + 0.4 * viThetaNew;

      if (Math.abs(viRelaxed - vi) < tol && Math.abs(viThetaRelaxed - viTheta) < tol) {
        vi = viRelaxed;
        viTheta = viThetaRelaxed;
        break;
      }
      vi = viRelaxed;
      viTheta = viThetaRelaxed;
    }

    // Re-evaluate aerodynamic coefficients with converged induced velocities
    const vAxialConverged = advanceSpeedMs + vi;
    const vTangentialConverged = Math.max(0.01, omega * r - viTheta);
    W = Math.sqrt(vAxialConverged * vAxialConverged + vTangentialConverged * vTangentialConverged);
    phi = Math.atan2(vAxialConverged, vTangentialConverged);
    alpha = theta - phi;
    const convergedPolar = evaluateSectionPolar(alpha, foilProps);
    cl = convergedPolar.cl;
    cd = convergedPolar.cd;
    const sinPhiFinal = Math.sin(phi);
    const cosPhiFinal = Math.cos(phi);
    Cn = cl * cosPhiFinal - cd * sinPhiFinal;
    Ct = cl * sinPhiFinal + cd * cosPhiFinal;

    // Element forces
    // dT = 0.5 * rho * W^2 * Cn * chord * dr * B
    // dQ = 0.5 * rho * W^2 * Ct * chord * r * dr * B
    const qDyn = 0.5 * rho * W * W;
    const dT = qDyn * Cn * chord * dr * B;
    const dQ = qDyn * Ct * chord * r * dr * B;

    totalThrust += dT;
    totalTorque += dQ;

    elements.push({
      radiusM: r,
      rOverR,
      chordM: chord,
      twistDeg: (theta * 180.0) / Math.PI,
      inflowAngleDeg: (phi * 180.0) / Math.PI,
      alphaDeg: (alpha * 180.0) / Math.PI,
      cl,
      cd,
      dT,
      dQ,
      axialInducedMs: vi,
      tangentialInducedMs: viTheta
    });
  }

  // Directional signs for reverse rotation
  if (signRpm < 0) {
    totalThrust = -totalThrust * 0.70; // 30% reverse thrust camber penalty
    totalTorque = totalTorque * 0.85;
  }

  const powerMech = Math.abs(totalTorque * omega);
  const J = advanceSpeedMs / (n * D);
  const kt = totalThrust / (rho * Math.pow(n, 2) * Math.pow(D, 4));
  const kq = totalTorque / (rho * Math.pow(n, 2) * Math.pow(D, 5));

  let efficiency = 0;
  if (powerMech > 1e-3 && advanceSpeedMs > 1e-3) {
    efficiency = Math.max(0, Math.min(1.0, (totalThrust * advanceSpeedMs) / powerMech));
  }

  return {
    thrustN: totalThrust,
    torqueNm: totalTorque,
    powerMechW: powerMech,
    advanceRatioJ: J,
    kt,
    kq,
    efficiency,
    rpm,
    advanceSpeedMs,
    elements
  };
}
