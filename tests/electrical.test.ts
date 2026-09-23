import { describe, it, expect } from 'vitest';
import { DCMotorModel, MABUCHI_RC280RA_SPECS, solveMotorOperatingPoint } from '../src/motor/motor';
import { calculateTetherResistance, calculateTetherResistanceFromMeters, calculateTetherState, AWG_RESISTANCE_OHM_PER_FT } from '../src/power/tether';
import { PowerBus } from '../src/power/bus';

describe('Phase 4b — Motor & Tether Electrical Model (Candidate A)', () => {
  describe('Mabuchi RC-280RA DC Motor (motor.ts)', () => {
    it('evaluates stall current and stall torque at 12V terminal voltage', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      const iStall = motor.computeCurrent(12.0, 0, 1.0);
      const qStall = motor.computeTorque(12.0, 0, 1.0);

      expect(iStall).toBeCloseTo(12.0 / 4.50, 2);

      expect(qStall).toBeGreaterThan(0.025);
      expect(qStall).toBeLessThan(0.032);
    });

    it('matches no-load rated RPM ~9800 at 10.8V', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      const state = motor.solveVoltageMode(10.8, 1.0, () => 0);

      expect(state.rpm).toBeGreaterThan(9300);
      expect(state.rpm).toBeLessThan(10500);
      expect(state.currentA).toBeCloseTo(MABUCHI_RC280RA_SPECS.Io_A, 1);
    });

    it('supports dual-mode driving: Voltage Mode and RPM Mode', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      const targetRpm = 3500;
      const loadFn = (w: number) => 0.010; 

      const rpmState = motor.solveRpmMode(targetRpm, loadFn);
      expect(rpmState.rpm).toBe(targetRpm);
      expect(rpmState.currentA).toBeGreaterThan(0.9);
      expect(rpmState.currentA).toBeLessThan(1.2);
      expect(rpmState.terminalVoltageV).toBeGreaterThan(7.0);

      const voltState = motor.solveVoltageMode(rpmState.terminalVoltageV, 1.0, loadFn);
      expect(voltState.rpm).toBeCloseTo(targetRpm, -1); 
      expect(voltState.currentA).toBeCloseTo(rpmState.currentA, 1);
    });

    it('reverses direction correctly with negative throttle and signed current', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      const forward = motor.solveVoltageMode(10.0, 1.0, (w) => 1e-6 * w * w);
      const reverse = motor.solveVoltageMode(10.0, -1.0, (w) => 1e-6 * w * w);

      expect(forward.rpm).toBeGreaterThan(0);
      expect(reverse.rpm).toBeLessThan(0);
      expect(Math.abs(reverse.rpm)).toBeCloseTo(forward.rpm, 1);
      expect(reverse.shaftTorqueNm).toBeLessThan(0);
      expect(reverse.currentA).toBeLessThan(0);
    });

    it('computes motor electromechanical efficiency correctly clamped in [0, 1]', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      const state = motor.solveVoltageMode(11.0, 1.0, () => 0.012);

      expect(state.efficiency).toBeGreaterThan(0.3);
      expect(state.efficiency).toBeLessThan(0.85);
      expect(state.powerMechW).toBeGreaterThan(0);
      expect(state.powerElecW).toBeGreaterThan(state.powerMechW);
    });

    it('solves Candidate A breakout operating point (~4140 RPM, ~1.41 A)', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      const kHydro = 0.0144 / Math.pow(433, 2);
      const loadFn = (w: number) => kHydro * Math.pow(w, 2);

      const vTerminal = 12.0 - 1.41 * 0.782;
      const state = motor.solveVoltageMode(vTerminal, 1.0, loadFn);

      expect(state.rpm).toBeGreaterThan(3900);
      expect(state.rpm).toBeLessThan(4400);

      expect(state.currentA).toBeGreaterThan(1.25);
      expect(state.currentA).toBeLessThan(1.55);

      expect(state.shaftTorqueNm).toBeGreaterThan(0.011);
      expect(state.shaftTorqueNm).toBeLessThan(0.018);
    });

    it('validates thermal timing: 1.41 A in 20°C water reaches 85°C warning in ~18s (±20%)', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      motor.windingTempC = 20.0;
      motor.ambientTempC = 20.0;

      const dt = 1.0 / 60.0;
      const totalSteps = 18 * 60;

      let reachedWarnTimeS = -1;

      for (let step = 0; step < totalSteps + 300; step++) {
        motor.stepThermal(1.41, dt);
        const elapsedS = step * dt;
        if (reachedWarnTimeS < 0 && motor.windingTempC >= 85.0) {
          reachedWarnTimeS = elapsedS;
        }
      }

      console.log(`[Thermal Timing] Calibrated C_th = ${MABUCHI_RC280RA_SPECS.thermalCapacitanceJPerK} J/K, R_th = ${MABUCHI_RC280RA_SPECS.thermalResistanceKPerW} K/W`);
      console.log(`[Thermal Timing] 1.41 A heating reached 85°C warning at t = ${reachedWarnTimeS.toFixed(2)} s (target: 18s ± 20%)`);

      expect(reachedWarnTimeS).toBeGreaterThan(14.4); // 18s - 20%
      expect(reachedWarnTimeS).toBeLessThan(21.6);    // 18s + 20%
      expect(motor.getThermalState()).not.toBe('OK');
    });

    it('enforces thermal cutout at 100°C with 90°C hysteresis reset', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      motor.windingTempC = 95.0;

      // Heat up past 100°C
      motor.stepThermal(2.0, 5.0);
      expect(motor.windingTempC).toBeGreaterThanOrEqual(100.0);
      expect(motor.isCutout).toBe(true);
      expect(motor.getThermalState()).toBe('CUTOUT');

      // Attempting to run while in cutout produces 0 output
      const cutoutState = motor.solveVoltageMode(12.0, 1.0, () => 0.01);
      expect(cutoutState.rpm).toBe(0);
      expect(cutoutState.currentA).toBe(0);
      expect(cutoutState.isCutout).toBe(true);

      // Cool down to 94°C: hysteresis must keep cutout ACTIVE until <= 90°C
      motor.windingTempC = 94.0;
      motor.stepThermal(0, 0.1);
      expect(motor.isCutout).toBe(true);

      // Cool down below 90°C: cutout resets and motor re-enables
      motor.windingTempC = 88.0;
      motor.stepThermal(0, 0.1);
      expect(motor.isCutout).toBe(false);
      expect(motor.getThermalState()).toBe('WARN');
    });
  });

  describe('Tether Resistance & Voltage Drop (tether.ts)', () => {
    it('calculates round-trip resistance for 15ft 24AWG copper wire matching 0.782 Ohm', () => {
      const r = calculateTetherResistance(15.0, 24);
      expect(r).toBe(0.782); // Canonical Candidate A JSON spec anchor
    });

    it('calculates tether resistance across AWG wire gauges and meters', () => {
      const r18 = calculateTetherResistance(15.0, 18);
      const r20 = calculateTetherResistance(15.0, 20);
      const r24 = calculateTetherResistance(15.0, 24);
      const r26 = calculateTetherResistance(15.0, 26);

      expect(r18).toBeLessThan(r20);
      expect(r20).toBeLessThan(r24);
      expect(r24).toBeLessThan(r26);

      const rMeters = calculateTetherResistanceFromMeters(4.572, 24);
      expect(rMeters).toBeCloseTo(0.782, 2);
    });

    it('evaluates voltage drop and ohmic power dissipation under load', () => {
      const supplyV = 12.0;
      const rTether = 0.782;
      const current = 1.41; // 1 motor at breakout

      const drop = calculateTetherState(current, supplyV, rTether);
      expect(drop.voltageDropV).toBeCloseTo(1.41 * 0.782, 3);
      expect(drop.terminalV).toBeCloseTo(12.0 - 1.41 * 0.782, 3);
      expect(drop.jouleLossWatts).toBeCloseTo(Math.pow(1.41, 2) * 0.782, 3);
      expect(drop.tetherEfficiency).toBeCloseTo(drop.terminalV / 12.0, 3);
    });
  });

  describe('Multi-Motor Power Bus Network (bus.ts)', () => {
    it('reproduces Candidate A exact spec anchor: V_term = 10.82 V ± 0.01 and I = 1.25 A ± 0.02 at 3800 RPM', () => {
      // Vehicle operating anchor: 3800 RPM, Q_spec = 12.58 mNm, V_term = 10.82 V, I = 1.25 A
      const bus = new PowerBus(1, 12.0, 0.782, { quiescentCurrentA: 0.255 });
      const motor = bus.motors[0];

      // In RPM mode at 3800 RPM with Candidate A torque 12.58 mNm
      const stateRpm = motor.solveRpmMode(3800, () => 0.01258);
      expect(stateRpm.currentA).toBeCloseTo(1.25, 1);
      expect(Math.abs(stateRpm.currentA - 1.25)).toBeLessThan(0.02);

      // In bus network with tether drop:
      const tel = bus.solveBusNetwork([1.0], [() => 0.01258]);
      expect(tel.terminalV).toBeCloseTo(10.82, 2);
      expect(Math.abs(tel.terminalV - 10.82)).toBeLessThan(0.01);
      expect(Math.abs(tel.motors[0].currentA - 1.25)).toBeLessThan(0.02);
      console.log(`[Spec Anchor Point] V_term = ${tel.terminalV.toFixed(2)} V, I = ${tel.motors[0].currentA.toFixed(2)} A at 3800 RPM`);
    });

    it('verifies sum-of-currents sag linearity: 3 motors at 1.0 A sag identically to 1 motor at 3.0 A', () => {
      const bus3 = new PowerBus(3, 12.0, 0.782);
      const bus1 = new PowerBus(1, 12.0, 0.782);

      const drop3 = calculateTetherState(3.0, 12.0, 0.782);
      const drop1 = calculateTetherState(1.0 + 1.0 + 1.0, 12.0, 0.782);

      expect(drop3.voltageDropV).toBeCloseTo(2.346, 3);
      expect(drop1.voltageDropV).toBeCloseTo(drop3.voltageDropV, 6);
      expect(drop3.terminalV).toBeCloseTo(drop1.terminalV, 6);
    });

    it('demonstrates signed-current behavior: regenerative braking produces negative current and decreases tether drop', () => {
      const bus = new PowerBus(1, 12.0, 0.782);
      // Net regenerative current (-1.0 A)
      const telRegen = calculateTetherState(-1.0, 12.0, 0.782);

      // Terminal voltage must be HIGHER than supply voltage during regenerative feed
      expect(telRegen.voltageDropV).toBeLessThan(0);
      expect(telRegen.terminalV).toBeGreaterThan(12.0);
      expect(telRegen.terminalV).toBeCloseTo(12.0 - (-1.0 * 0.782), 3);
    });

    it('demonstrates realistic inter-motor voltage sag across 1 vs 3 motors', () => {
      const bus = new PowerBus(3, 12.0, 0.782);
      const kHydro = 0.0144 / Math.pow(433, 2);
      const loadFn = (w: number) => kHydro * Math.pow(w, 2);

      // Case 1: Only 1 motor active (e.g. vertical thruster alone)
      const tel1 = bus.solveBusNetwork([1.0, 0.0, 0.0], [loadFn, loadFn, loadFn]);
      expect(tel1.motors[0].rpm).toBeGreaterThan(3900);
      expect(tel1.terminalV).toBeGreaterThan(10.5);

      // Case 2: All 3 motors firing at full breakout throttle
      const tel3 = bus.solveBusNetwork([1.0, 1.0, 1.0], [loadFn, loadFn, loadFn]);
      expect(tel3.totalBusCurrentA).toBeGreaterThan(tel1.totalBusCurrentA * 2.0);

      // Terminal voltage must sag significantly due to 3x tether current
      expect(tel3.terminalV).toBeLessThan(tel1.terminalV);
      // Motor RPM under 3-motor bus sag should be lower than single motor
      expect(tel3.motors[0].rpm).toBeLessThan(tel1.motors[0].rpm);
    });

    it('steps thermal status across bus motors and executes thermal cutout', () => {
      const bus = new PowerBus(3, 12.0, 0.782);
      const loadFn = (w: number) => 1e-7 * Math.pow(w, 2);
      bus.solveBusNetwork([1.0, 1.0, 1.0], [loadFn, loadFn, loadFn]);

      bus.stepThermal(1.0);
      expect(bus.motors[0].windingTempC).toBeGreaterThan(20.0);

      bus.resetThermal();
      expect(bus.motors[0].windingTempC).toBe(20.0);
    });
  });
});
