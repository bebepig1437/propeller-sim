import type { SimConfig } from '../core/config';

export type StatorVaneType = 'none' | 'solid' | 'slotted';

export interface StatorVaneConfig {
  vanes: number;
  profile: string;
  slotChordPct: number;
  incidenceDeg: number;
  rakeDeg: number;
  forwardGainN: number;
  reversePenaltyN: number;
  vaneType: StatorVaneType;
}

export interface StatorForceResult {
  thrustDeltaN: number;
  antiTorqueNm: number;
  swirlReductionRatio: number;
  residualRollDegPerM: number;
}

export const CANDIDATE_A_STATOR_CONFIG: StatorVaneConfig = {
  vanes: 3,
  profile: 'modified NACA 63-012',
  slotChordPct: 40.0,
  incidenceDeg: -5.2,
  rakeDeg: 35.0,
  forwardGainN: 0.04,
  reversePenaltyN: 0.09,
  vaneType: 'slotted'
};

export class StatorVaneSystem {
  public config: StatorVaneConfig;

  constructor(config?: Partial<StatorVaneConfig>) {
    this.config = {
      ...CANDIDATE_A_STATOR_CONFIG,
      ...config
    };
  }

  /**
   * Evaluates hydrodynamic thrust recovery and anti-swirl counter-torque
   * produced by the stator vane cascade immersed in propeller slipstream.
   */
  public evaluate(
    propThrustN: number,
    propTorqueNm: number,
    rpm: number
  ): StatorForceResult {
    if (this.config.vaneType === 'none' || Math.abs(rpm) < 10) {
      return {
        thrustDeltaN: 0,
        antiTorqueNm: 0,
        swirlReductionRatio: 0,
        residualRollDegPerM: 14.8 // Candidate A baseline uncompensated roll
      };
    }

    const signThrust = Math.sign(propThrustN) || 1;
    const signTorque = Math.sign(propTorqueNm) || 1;

    // Relative load scale based on breakout operating point (4140 RPM, ~1.58 N per prop)
    const loadFactor = Math.min(1.5, Math.abs(propThrustN) / 1.58);

    let thrustDeltaN: number;
    let antiTorqueNm: number;
    let residualRollDegPerM: number;
    let swirlReductionRatio: number;

    if (signThrust >= 0) {
      // Forward thrust: Stator recovers tangential slipstream swirl into axial thrust (+0.04 N rated)
      thrustDeltaN = this.config.forwardGainN * loadFactor;

      if (this.config.vaneType === 'slotted') {
        // Slotted stator (40% slot chord) prevents flow separation on vane suction side
        swirlReductionRatio = 0.88; // 88% swirl neutralization
        residualRollDegPerM = 1.8;   // candidateA.json: slotted = 1.8 deg/m
      } else {
        // Solid stator
        swirlReductionRatio = 0.905;
        residualRollDegPerM = 1.4;   // candidateA.json: solid = 1.4 deg/m
      }

      // Counter-torque opposes propeller reaction torque
      antiTorqueNm = -signTorque * Math.abs(propTorqueNm) * swirlReductionRatio;
    } else {
      // Reverse thrust: Stator vanes act as an obstruction / drag penalty (-0.09 N rated)
      thrustDeltaN = -this.config.reversePenaltyN * loadFactor;
      swirlReductionRatio = 0.40;
      residualRollDegPerM = 8.5;
      antiTorqueNm = -signTorque * Math.abs(propTorqueNm) * swirlReductionRatio;
    }

    return {
      thrustDeltaN,
      antiTorqueNm,
      swirlReductionRatio,
      residualRollDegPerM
    };
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

  const res = stator.evaluate(1.58, 0.014, 4140);
  return {
    thrustGainN: res.thrustDeltaN,
    torqueRecoveryNm: Math.abs(res.antiTorqueNm)
  };
}
