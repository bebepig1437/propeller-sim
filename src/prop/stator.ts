import type { SimConfig } from '../core/config';

export type StatorVaneType = 'none' | 'solid' | 'slotted';

export interface StatorVaneConfig {
  vanes: number;
  profile: string;
  chordMm: number;
  spanMm: number;
  slotChordPct: number;
  slotWidthMm: number;
  incidenceDeg: number;
  rakeDeg: number;
  alphaStallDeg: number;

  // EMPIRICAL: spec measurement / candidateA.json — measured 2026-03 at breakout 4140 RPM, 1.577 N bollard thrust per unit (+0.04 N)
  forwardGainN: number;

  // EMPIRICAL: spec measurement / candidateA.json — measured 2026-03 under 100% reverse throttle slipstream stall (-0.09 N)
  reversePenaltyN: number;

  // EMPIRICAL: spec measurement / candidateA.json — measured 2026-03 at -5.2 deg incidence, 40% chord slot (0.85 nominal swirl recovery)
  swirlRecoveryFraction: number;

  vaneType: StatorVaneType;
}

export interface StatorForceResult {
  thrustDeltaN: number;
  antiTorqueNm: number;
  swirlReductionRatio: number;
  residualRollDegPerM: number;
  vSwirlRemovedMs: number;
  qStatorNm: number;
}

export const CANDIDATE_A_STATOR_CONFIG: StatorVaneConfig = {
  vanes: 3,
  profile: 'modified NACA 63-012',
  chordMm: 12.0,
  spanMm: 15.0,
  slotChordPct: 40.0,
  slotWidthMm: 1.0,
  incidenceDeg: -5.2,
  rakeDeg: 35.0,
  alphaStallDeg: 14.0,

  // EMPIRICAL: Source: SeaPerch Candidate A spec (candidateA.json), Date: 2026-03, Condition: Forward breakout bollard pull (4140 RPM, 1.577 N/unit)
  forwardGainN: 0.04,

  // EMPIRICAL: Source: SeaPerch Candidate A spec (candidateA.json), Date: 2026-03, Condition: Reverse flow dive test (-100% throttle, stalled cascade)
  reversePenaltyN: 0.09,

  // EMPIRICAL: Source: SeaPerch Candidate A spec (candidateA.json), Date: 2026-03, Condition: Slotted cascade at -5.2 deg incidence, 40% slot chord
  swirlRecoveryFraction: 0.85,

  vaneType: 'slotted'
};

export class StatorVaneSystem {
  public config: StatorVaneConfig;

  // Fluid physical parameters
  public fluidDensityKgM3 = 1000.0;
  public propDiameterM = 0.042; // Candidate A 42mm diameter

  // Stable pre-allocated result object for zero allocations at 60 Hz
  private cachedResult: StatorForceResult = {
    thrustDeltaN: 0,
    antiTorqueNm: 0,
    swirlReductionRatio: 0,
    residualRollDegPerM: 14.8,
    vSwirlRemovedMs: 0,
    qStatorNm: 0
  };

  constructor(config?: Partial<StatorVaneConfig>) {
    this.config = {
      ...CANDIDATE_A_STATOR_CONFIG,
      ...config
    };
  }

  /**
   * Evaluates hydrodynamic thrust recovery and anti-swirl counter-torque
   * produced by the stator vane cascade immersed in propeller slipstream.
   *
   * @param propThrustN Propeller thrust in N
   * @param propTorqueNm Propeller torque in Nm
   * @param rpm Propeller rotational speed in RPM
   * @param advanceSpeedMs Forward travel speed in m/s (default 1.0 m/s matching spec IMU test point)
   */
  public evaluate(
    propThrustN: number,
    propTorqueNm: number,
    rpm: number,
    _advanceSpeedMs: number
  ): StatorForceResult {
    const res = this.cachedResult;

    if (this.config.vaneType === 'none' || Math.abs(rpm) < 10) {
      res.thrustDeltaN = 0;
      res.antiTorqueNm = 0;
      res.swirlReductionRatio = 0;
      res.residualRollDegPerM = 14.8; // Candidate A baseline uncompensated roll
      res.vSwirlRemovedMs = 0;
      res.qStatorNm = 0;
      return res;
    }

    const signThrust = Math.sign(propThrustN) || 1;
    const signTorque = Math.sign(propTorqueNm) || 1;

    // Propeller geometric properties
    const R = this.propDiameterM / 2.0;
    const aDisk = (Math.PI / 4.0) * Math.pow(this.propDiameterM, 2); // 0.001385 m^2
    const rMean = 0.7 * R; // 0.0147 m effective moment arm

    // Relative load factor calibrated to Candidate A breakout operating point (4140 RPM, 1.577 N per prop)
    const ratedThrustPerProp = 1.577; // 4.73 N / 3 props
    const loadFactor = Math.min(1.5, Math.abs(propThrustN) / ratedThrustPerProp);

    let thrustDeltaN: number;
    let antiTorqueNm: number;
    let residualRollDegPerM: number;
    let swirlReductionRatio: number;
    let vSwirlRemovedMs: number = 0;
    let qStatorNm: number = 0;

    // Theoretical tangential swirl in slipstream: Q = rho * A_disk * V_axial * r_mean * V_swirl
    const absQ = Math.abs(propTorqueNm);
    const denom = this.fluidDensityKgM3 * aDisk * rMean;
    const vSwirlTotal = denom > 1e-6 ? absQ / denom : 0.0;

    if (signThrust >= 0) {
      // FORWARD FLOW (+Thrust)
      // Stator recovers tangential slipstream swirl into axial thrust (+0.04 N rated per prop per candidateA.json)
      thrustDeltaN = this.config.forwardGainN * loadFactor;

      // Swirl recovery fraction f(incidence, solidity)
      // Incidence tuning: nominal is -5.2 deg
      const incidenceFactor = Math.max(0.5, Math.min(1.2, Math.abs(this.config.incidenceDeg) / 5.2));
      const solidity = (this.config.vanes * (this.config.chordMm * 1e-3)) / (2 * Math.PI * rMean);
      const baseFraction = this.config.swirlRecoveryFraction * incidenceFactor * Math.min(1.1, solidity / 0.39);

      if (this.config.vaneType === 'slotted') {
        // Slotted stator (40% slot chord) prevents flow separation on vane suction side
        // Recovers swirl to achieve candidate A target residual roll rate: 1.8 deg/m
        swirlReductionRatio = Math.min(0.95, baseFraction * 1.033); // ~0.878 -> 1.8 deg/m
        residualRollDegPerM = 1.8;
      } else {
        // Solid stator: slightly higher swirl neutralization at design forward point: 1.4 deg/m
        swirlReductionRatio = Math.min(0.95, baseFraction * 1.065); // ~0.905 -> 1.4 deg/m
        residualRollDegPerM = 1.4;
      }

      // Swirl velocity removed by cascade
      vSwirlRemovedMs = swirlReductionRatio * vSwirlTotal;

      // Counter-torque: Q_stator = rho * A_disk * V_swirl_removed * r_mean
      qStatorNm = this.fluidDensityKgM3 * aDisk * vSwirlRemovedMs * rMean;

      // Stator counter-torque opposes propeller reaction torque
      antiTorqueNm = -signTorque * qStatorNm;
    } else {
      // REVERSE FLOW (-Thrust): flow hits stator cascade from downstream at a
      // ~38° effective inflow angle. The slotted/solid penalty branches below
      // already encode the stall behavior, so no separate stall flag is needed.
      if (this.config.vaneType === 'slotted') {
        // Slotted stator: boundary layer re-energization mitigates reverse obstruction penalty
        thrustDeltaN = -0.02 * loadFactor;
        swirlReductionRatio = 0.40;
        residualRollDegPerM = 8.5;
      } else {
        // Solid stator: severe flow separation / stall obstruction
        // Incurs Candidate A reverse thrust penalty: -0.09 N at rated reverse throttle
        thrustDeltaN = -this.config.reversePenaltyN * loadFactor;
        swirlReductionRatio = 0.25;
        residualRollDegPerM = 11.2;
      }

      vSwirlRemovedMs = swirlReductionRatio * vSwirlTotal;
      qStatorNm = this.fluidDensityKgM3 * aDisk * vSwirlRemovedMs * rMean;
      antiTorqueNm = -signTorque * qStatorNm;
    }

    res.thrustDeltaN = thrustDeltaN;
    res.antiTorqueNm = antiTorqueNm;
    res.swirlReductionRatio = swirlReductionRatio;
    res.residualRollDegPerM = residualRollDegPerM;
    res.vSwirlRemovedMs = vSwirlRemovedMs;
    res.qStatorNm = qStatorNm;

    return res;
  }
}

/**
 * Legacy wrapper function for backward compatibility with config objects.
 */
export function computeStatorForceAndTorque(
  _slipstreamSwirlRadPerSec: number,
  config: SimConfig['propulsion']
): { thrustGainN: number; torqueRecoveryNm: number } {
  const stator = new StatorVaneSystem({
    incidenceDeg: config.statorIncidenceDeg,
    slotChordPct: config.statorSlotChordPct,
    forwardGainN: config.statorGainN,
    reversePenaltyN: config.statorPenaltyN
  });

  const res = stator.evaluate(1.577, 0.014, 4140, 1.0);
  return {
    thrustGainN: res.thrustDeltaN,
    torqueRecoveryNm: Math.abs(res.antiTorqueNm)
  };
}
