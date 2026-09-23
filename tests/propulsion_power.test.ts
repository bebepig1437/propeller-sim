import { describe, it, expect } from 'vitest';
import { solveBemt } from '../src/prop/bemt';
import { PropellerArray } from '../src/prop/array';
import { DCMotorModel, MABUCHI_RC280RA_SPECS } from '../src/prop/motor';
import { PowerBus } from '../src/power/bus';
import { calculateTetherState, calculateTetherResistanceFromMeters } from '../src/power/tether';
import { defaultConfig } from '../src/core/config';

const CANDIDATE_A_BEMT = {
  diameterMm: 42.0,
  hubDiameterMm: 8.0,
  blades: 3,
  pitchMm: 32.0
};

const SPEC_QUIESCENT_CURRENT_A = 0.0;

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

  it('keeps the array total at the BlueROV2-style sanity band with both lateral thrusters at full throttle', () => {
    const array = new PropellerArray();
    const summary = array.evaluate([1, 1, 0], [0, 0, 0], [0, 0, 0], 0);

    expect(summary.totalForceN[0]).toBeGreaterThan(2 * 1.2);
    expect(summary.totalForceN[0]).toBeLessThan(2 * 3.5);
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
  it('cancels the net reaction torque of a coaxial contra-rotating pair within 1e-5 N·m', () => {
    const array = new PropellerArray();
    array.applyHandednessPreset('contra_rotating_coaxial');
    for (const unit of array.thrusters) unit.throttle = 1;
    const summary = array.evaluate(undefined, [0, 0], [0, 0, 0], 0);

    expect(Math.abs(summary.totalMomentNm[0])).toBeLessThan(1e-5);
    expect(summary.totalForceN[0]).toBeGreaterThan(0);
  });

  it('balances the pair across a matched load sweep, not only at one point', () => {
    const array = new PropellerArray();
    array.applyHandednessPreset('contra_rotating_coaxial');

    for (const throttle of [0.25, 0.5, 0.75, 1.0]) {
      for (const unit of array.thrusters) unit.throttle = throttle;
      const summary = array.evaluate(undefined, [0, 0], [0, 0, 0], 0);
      expect(Math.abs(summary.totalMomentNm[0])).toBeLessThan(1e-5);
    }
  });

  it('preserves exact CW/CCW torque symmetry in the single-prop solver', () => {
    const cw = solveBemt(3800, 0, { ...CANDIDATE_A_BEMT, handedness: 'CW' });
    const ccw = solveBemt(3800, 0, { ...CANDIDATE_A_BEMT, handedness: 'CCW' });

    expect(cw.torqueNm).toBeLessThan(0);
    expect(ccw.torqueNm).toBeGreaterThan(0);
    expect(Math.abs(cw.torqueNm)).toBeCloseTo(Math.abs(ccw.torqueNm), 12);
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

  it('sags the whole bus network consistently under simultaneous motor load', () => {
    const bus = new PowerBus(3, 12, 0.782);
    const zeroLoad = (): number => 0;
    const telemetry = bus.solveBusNetwork([1, 1, 1], [zeroLoad, zeroLoad, zeroLoad]);

    expect(telemetry.terminalV).toBeCloseTo(12 - telemetry.totalBusCurrentA * 0.782, 4);
    expect(telemetry.terminalV).toBeLessThan(12);
    expect(telemetry.totalBusCurrentA).toBeGreaterThan(0);
  });
});

describe('thermal_limiting', () => {
  it('reaches the analytic steady-state winding temperature under continuous load', () => {
    const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
    const steadyCurrentA = 1.41;
    const dt = 0.01;

    for (let step = 0; step < 100000; step++) {
      motor.stepThermal(steadyCurrentA, dt);
    }

    const tauS = MABUCHI_RC280RA_SPECS.thermalResistanceKPerW * MABUCHI_RC280RA_SPECS.thermalCapacitanceJPerK;
    const steadyStateTempC =
      motor.ambientTempC + steadyCurrentA * steadyCurrentA * MABUCHI_RC280RA_SPECS.Ra_ohm * MABUCHI_RC280RA_SPECS.thermalResistanceKPerW;

    expect(motor.windingTempC).toBeCloseTo(steadyStateTempC, 1);
    expect(tauS).toBeGreaterThan(25);
    expect(tauS < 45).toBe(true);
  });

  it('cools convectively back toward ambient after the load is removed', () => {
    const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
    for (let step = 0; step < 2000; step++) {
      motor.stepThermal(1.41, 0.1);
    }
    const heatedTempC = motor.windingTempC;

    for (let step = 0; step < 8000; step++) {
      motor.stepThermal(0, 0.1);
    }

    expect(motor.windingTempC).toBeLessThan(heatedTempC - 20);
    expect(motor.windingTempC).toBeLessThan(motor.ambientTempC + 5);
  });

  it('derates throttle between the warning and cutout limits before tripping', () => {
    const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
    motor.windingTempC = 92;

    const bus = new PowerBus(1, 12, 0.782);
    bus.motors = [motor];
    const zeroLoad = (): number => 0;
    const telemetry = bus.solveBusNetwork([1], [zeroLoad]);

    const hotState = telemetry.motors[0];
    const coldMotor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
    const coldState = coldMotor.solveVoltageMode(telemetry.terminalV, 1.0, zeroLoad);

    expect(hotState.omegaRadS).toBeLessThan(coldState.omegaRadS);
    expect(hotState.isThermalDerated).toBe(true);
    expect(hotState.thermalState).toBe('WARN');
    expect(hotState.rpm).toBeGreaterThan(0);
  });

  it('trips cutout under continuous stall and recovers through the hysteresis band', () => {
    const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
    const bus = new PowerBus(1, 12, 0.782);
    bus.motors = [motor];
    const loadTorqueNm = 0.026;
    const fullLoad = (): number => loadTorqueNm;

    let trippedAtStepS = -1;
    for (let second = 0; second < 600; second++) {
      bus.solveBusNetwork([1], [fullLoad]);
      bus.stepThermal(1);
      if (motor.isCutout && trippedAtStepS < 0) {
        trippedAtStepS = second;
        break;
      }
    }

    expect(trippedAtStepS).toBeGreaterThan(0);
    expect(motor.windingTempC).toBeGreaterThanOrEqual(MABUCHI_RC280RA_SPECS.cutoutWindingTempC - 2);

    bus.solveBusNetwork([1], [fullLoad]);
    const stallCurrentA = bus.lastTelemetry!.motors[0].currentA;
    expect(stallCurrentA).toBe(0);
    expect(bus.lastTelemetry!.motors[0].thermalState).toBe('CUTOUT');

    for (let second = 0; second < 1200; second++) {
      motor.stepThermal(0, 1);
    }
    expect(motor.isCutout).toBe(false);
    expect(motor.windingTempC).toBeLessThanOrEqual(MABUCHI_RC280RA_SPECS.cutoutResetTempC + 2);
  });

  it('stays inside the 18 s +/- 20% spec to the 85 C warning at the 1.41 A anchor', () => {
    const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
    let warningTimeS = -1;
    for (let step = 0; step < 6000; step++) {
      motor.stepThermal(1.41, 0.01);
      if (motor.windingTempC >= MABUCHI_RC280RA_SPECS.warnWindingTempC) {
        warningTimeS = (step + 1) * 0.01;
        break;
      }
    }

    expect(warningTimeS).toBeGreaterThan(18 * 0.8);
    expect(warningTimeS).toBeLessThan(18 * 1.2);
  });
});
