import { describe, it, expect } from 'vitest';
import { solveBemt } from '../src/prop/bemt';
import { DCMotorModel, MABUCHI_RC280RA_SPECS } from '../src/prop/motor';
import { calculateTetherState, calculateTetherResistanceFromMeters } from '../src/power/tether';

const CANDIDATE_A_BEMT = {
  diameterMm: 42.0,
  hubDiameterMm: 8.0,
  blades: 3,
  pitchMm: 32.0
};

function bollardThrustAtThrottle(throttle: number): number {
  const rpm = throttle * 4140;
  return solveBemt(rpm, 0, CANDIDATE_A_BEMT).thrustN;
}

describe('bemt_thrust_curve', () => {
  it('reproduces the Candidate A bollard anchor: 12.58 mNm at 3800 RPM within 2%', () => {
    const n = 3800 / 60;
    const d = 0.042;
    const referenceTorqueNm = 0.024 * 1000 * n * n * d * d * d * d * d;

    const result = solveBemt(3800, 0, { ...CANDIDATE_A_BEMT, pitchMm: 28.0 });
    const bemtTorqueNm = Math.abs(result.torqueNm);
    const errorPct = (Math.abs(bemtTorqueNm - referenceTorqueNm) / referenceTorqueNm) * 100;

    expect(errorPct).toBeLessThan(2);
  });

  it('follows the published quadratic thrust curve across the throttle range', () => {
    const fullThrottleThrustN = bollardThrustAtThrottle(1.0);
    expect(fullThrottleThrustN).toBeGreaterThan(1.2);
    expect(fullThrottleThrustN).toBeLessThan(3.5);

    const throttleRatios = [0.25, 0.5, 0.75];
    for (const ratio of throttleRatios) {
      const ratioThrustN = bollardThrustAtThrottle(ratio);
      const quadraticPredictionN = ratio * ratio * fullThrottleThrustN;
      const errorPct = (Math.abs(ratioThrustN - quadraticPredictionN) / quadraticPredictionN) * 100;
      expect(errorPct).toBeLessThan(4);
    }
  });

  it('keeps K_T in the small shrouded bollard band and K_Q anchored to the spec across the sweep', () => {
    for (const throttle of [0.3, 0.5, 0.75, 1.0]) {
      const result = solveBemt(throttle * 4140, 0, CANDIDATE_A_BEMT);
      expect(result.kt).toBeGreaterThan(0.08);
      expect(result.kt).toBeLessThan(0.25);
      expect(result.kq).toBeGreaterThan(0.018);
      expect(result.kq).toBeLessThan(0.030);
    }
  });

  it('degrades thrust monotonically toward the windmill branch as advance speed rises', () => {
    let previousThrustN = Infinity;
    for (const advanceSpeed of [0, 0.2, 0.4, 0.6, 0.9]) {
      const result = solveBemt(4140, advanceSpeed, CANDIDATE_A_BEMT);
      expect(result.thrustN).toBeLessThan(previousThrustN);
      expect(Number.isFinite(result.thrustN)).toBe(true);
      previousThrustN = result.thrustN;
    }
  });
});

describe('torque_balance', () => {
  it('preserves exact CW/CCW torque symmetry in the single-prop solver', () => {
    const cw = solveBemt(3800, 0, { ...CANDIDATE_A_BEMT, handedness: 'CW' });
    const ccw = solveBemt(3800, 0, { ...CANDIDATE_A_BEMT, handedness: 'CCW' });

    expect(cw.torqueNm).toBeGreaterThan(0);
    expect(ccw.torqueNm).toBeGreaterThan(0);
    expect(cw.reactionTorqueNm).toBeLessThan(0);
    expect(ccw.reactionTorqueNm).toBeGreaterThan(0);
    expect(cw.torqueNm).toBeCloseTo(ccw.torqueNm, 12);
    expect(cw.thrustN).toBeCloseTo(ccw.thrustN, 12);
  });
});

describe('tether_voltage_sag', () => {
  it('matches the Candidate A anchor: 15 ft of 24 AWG round-trip = 0.782 ohm', () => {
    expect(calculateTetherResistanceFromMeters(4.572, 24)).toBeCloseTo(0.782, 3);
  });

  it('matches the copper resistivity model: R = 2 rho L / A', () => {
    const copperResistivityOhmM = 1.724e-8;
    const lengthM = 4.572;
    const wireAreaM2 = 0.2051e-6;
    const expectedRoundTripOhm = (2 * copperResistivityOhmM * lengthM) / wireAreaM2;
    const modelOhm = calculateTetherResistanceFromMeters(lengthM, 24);

    expect(modelOhm).toBeGreaterThan(expectedRoundTripOhm * 0.85);
    expect(modelOhm).toBeLessThan(expectedRoundTripOhm * 1.35);
  });

  it('sags the bus voltage linearly with total thruster current draw', () => {
    for (const currentA of [0.5, 1.0, 2.0, 3.0]) {
      const state = calculateTetherState(currentA, 12, 0.782);
      expect(state.terminalV).toBeCloseTo(12 - currentA * 0.782, 12);
      expect(state.voltageDropV).toBeCloseTo(currentA * 0.782, 12);
    }
  });

  it('throttles available stall torque proportionally to the sagged bus voltage', () => {
    const supplyV = 12;
    const tetherOhm = 0.782;
    const busCurrentA = 2.0;
    const saggedV = calculateTetherState(busCurrentA, supplyV, tetherOhm).terminalV;

    const stalledAtSupply = new DCMotorModel(MABUCHI_RC280RA_SPECS);
    const stalledAtBus = new DCMotorModel(MABUCHI_RC280RA_SPECS);

    const stallCurrentSupplyA = stalledAtSupply.computeCurrent(supplyV, 0, 1.0);
    const stallCurrentBusA = stalledAtBus.computeCurrent(saggedV, 0, 1.0);
    expect(stallCurrentBusA / stallCurrentSupplyA).toBeCloseTo(saggedV / supplyV, 6);

    const stallTorqueSupplyNm = stalledAtSupply.computeTorque(supplyV, 0, 1.0);
    const stallTorqueBusNm = stalledAtBus.computeTorque(saggedV, 0, 1.0);
    const netTorqueBusNm = stallTorqueBusNm + stalledAtBus.specs.Io_A * stalledAtBus.specs.kt_Nm_per_A;
    const netTorqueSupplyNm = stallTorqueSupplyNm + stalledAtSupply.specs.Io_A * stalledAtSupply.specs.kt_Nm_per_A;
    expect(netTorqueBusNm / netTorqueSupplyNm).toBeCloseTo(saggedV / supplyV, 5);
  });
});
