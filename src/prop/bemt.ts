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
    const chord = getDesignBladeChordAt(r, design, params?.diameterMm);
    const theta = getDesignBladePitchAngleAt(r, design, pitchOverrideMm, params?.diameterMm);
    const solidity = (B * chord) / (2.0 * Math.PI * r);

    // Initial induced velocity guesses
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

      // MANDATORY CORRECTNESS FIX: Prandtl tip loss denominator uses local radius r
      const sinPhiPos = Math.max(0.01, Math.abs(sinPhi));
      const fTip = Math.max(0.001, (B * (R - r)) / (2.0 * r * sinPhiPos));
      const Ftip = (2.0 / Math.PI) * Math.acos(Math.min(1.0, Math.exp(-fTip)));

      // Hub loss factor: Prandtl root loss normalized by hub radius Rhub
      // References:
      // - Glauert, H. (1935), "Airplane Propellers", Division L in Aerodynamic Theory (W.F. Durand, ed.)
      // - Drela, M., XROTOR Theory and User Guide (BEMT root circulation formulation)
      const fHub = Math.max(0.001, (B * (r - Rhub)) / (2.0 * Rhub * sinPhiPos));
      const Fhub = (2.0 / Math.PI) * Math.acos(Math.min(1.0, Math.exp(-fHub)));

      const F = Math.max(0.05, Ftip * Fhub);

      // Momentum inflow solve with Glauert / high-thrust extension
      const K = Math.max(0, (solidity * Cn) / (4.0 * F));
      const discriminant = Math.pow(advanceSpeedMs / 2.0, 2) + K * W * W;
      const viNew = -advanceSpeedMs / 2.0 + Math.sqrt(Math.max(0, discriminant));

      // Tangential induced velocity
      const denomTheta = 4.0 * F * Math.max(0.05, advanceSpeedMs + viNew);
      const viThetaNew = Math.max(0, (solidity * Ct * W * W) / denomTheta);

      // Under-relaxation
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

    // MANDATORY CORRECTNESS FIX: Recompute aerodynamic quantities from converged induced velocities
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

    const qDyn = 0.5 * rho * WConv * WConv;
    const dT = qDyn * CnConv * chord * dr * B;
    const dQ = qDyn * CtConv * chord * r * dr * B;

    totalThrust += dT;
    totalTorque += dQ;

    elements.push({
      radiusM: r,
      rOverR,
      chordM: chord,
      twistDeg: (theta * 180.0) / Math.PI,
      inflowAngleDeg: (phiConv * 180.0) / Math.PI,
      alphaDeg: (alphaConv * 180.0) / Math.PI,
      cl: clConv,
      cd: cdConv,
      reynolds: reConv,
      dT,
      dQ,
      axialInducedMs: vi,
      tangentialInducedMs: viTheta
    });
  }

  // Directional signs for reverse rotation
  if (signRpm < 0) {
    totalThrust = -totalThrust * 0.72; // Reverse thrust camber penalty (~28%)
    totalTorque = totalTorque * 0.88;
  }

  // Handedness torque sign convention:
  // CW propeller rotation exerts negative reaction torque on vehicle hull.
  // CCW propeller rotation exerts positive reaction torque on vehicle hull.
  const directedTorque = handedness === 'CW' ? -totalTorque : totalTorque;

  const powerMech = Math.max(0, totalTorque * omega);
  const J = advanceSpeedMs / (n * D);
  const kt = totalThrust / (rho * Math.pow(n, 2) * Math.pow(D, 4));
  const kq = totalTorque / (rho * Math.pow(n, 2) * Math.pow(D, 5));

  // MANDATORY CORRECTNESS FIX: Clamp efficiency to [0, 1]
  let efficiency = 0;
  if (powerMech > 1e-4 && advanceSpeedMs > 1e-4 && totalThrust > 0) {
    efficiency = Math.min(1.0, Math.max(0.0, (totalThrust * advanceSpeedMs) / powerMech));
  }

  return {
    thrustN: totalThrust,
    torqueNm: directedTorque,
    powerMechW: powerMech,
    advanceRatioJ: J,
    kt,
    kq,
    efficiency,
    rpm,
    advanceSpeedMs,
    handedness,
    elements
  };
}
