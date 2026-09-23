// see CONVENTIONS.md: sign convention for stator reaction torque
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

  forwardGainN: number;

  reversePenaltyN: number;

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

  forwardGainN: 0.04, // EMPIRICAL: spec measurement, not derived

  reversePenaltyN: 0.09, // EMPIRICAL: spec measurement, not derived

  swirlRecoveryFraction: 0.85, // EMPIRICAL: spec measurement, not derived

  vaneType: 'slotted'
};

export class StatorVaneSystem {
  public config: StatorVaneConfig;

  public fluidDensityKgM3 = 1000.0;
  public propDiameterM = 0.042;

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
      res.residualRollDegPerM = 14.8;
      res.vSwirlRemovedMs = 0;
      res.qStatorNm = 0;
      return res;
    }

    const signThrust = Math.sign(propThrustN) || 1;
    const signTorque = Math.sign(propTorqueNm) || 1;

    const R = this.propDiameterM / 2.0;
    const aDisk = (Math.PI / 4.0) * Math.pow(this.propDiameterM, 2);
    const rMean = 0.7 * R;

    const ratedThrustPerProp = 1.577;
    const loadFactor = Math.min(1.5, Math.abs(propThrustN) / ratedThrustPerProp);

    let thrustDeltaN: number;
    let antiTorqueNm: number;
    let residualRollDegPerM: number;
    let swirlReductionRatio: number;
    let vSwirlRemovedMs: number = 0;
    let qStatorNm: number = 0;

    const absQ = Math.abs(propTorqueNm);
    const denom = this.fluidDensityKgM3 * aDisk * rMean;
    const vSwirlTotal = denom > 1e-6 ? absQ / denom : 0.0;

    if (signThrust >= 0) {
      thrustDeltaN = this.config.forwardGainN * loadFactor;

      const incidenceFactor = Math.max(0.5, Math.min(1.2, Math.abs(this.config.incidenceDeg) / 5.2));
      const solidity = (this.config.vanes * (this.config.chordMm * 1e-3)) / (2 * Math.PI * rMean);
      const baseFraction = this.config.swirlRecoveryFraction * incidenceFactor * Math.min(1.1, solidity / 0.39);

      if (this.config.vaneType === 'slotted') {
        swirlReductionRatio = Math.min(0.95, baseFraction * 1.033);
        residualRollDegPerM = 1.8;
      } else {
        swirlReductionRatio = Math.min(0.95, baseFraction * 1.065);
        residualRollDegPerM = 1.4;
      }

      vSwirlRemovedMs = swirlReductionRatio * vSwirlTotal;

      qStatorNm = this.fluidDensityKgM3 * aDisk * vSwirlRemovedMs * rMean;

      antiTorqueNm = -signTorque * qStatorNm;
    } else {
      if (this.config.vaneType === 'slotted') {
        thrustDeltaN = -0.02 * loadFactor;
        swirlReductionRatio = 0.40;
        residualRollDegPerM = 8.5;
      } else {
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
