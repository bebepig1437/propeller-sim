import { describe, it, expect } from 'vitest';
import { DCMotorModel, MABUCHI_RC280RA_SPECS, solveMotorOperatingPoint } from '../src/prop/motor';
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

  });

  describe('Tether Resistance & Voltage Drop (tether.ts)', () => {
    it('calculates round-trip resistance for 15ft 24AWG copper wire matching 0.782 Ohm', () => {
      const r = calculateTetherResistance(15.0, 24);
      expect(r).toBe(0.782); 
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
      const current = 1.41; 

      const drop = calculateTetherState(current, supplyV, rTether);
      expect(drop.voltageDropV).toBeCloseTo(1.41 * 0.782, 3);
      expect(drop.terminalV).toBeCloseTo(12.0 - 1.41 * 0.782, 3);
      expect(drop.jouleLossWatts).toBeCloseTo(Math.pow(1.41, 2) * 0.782, 3);
      expect(drop.tetherEfficiency).toBeCloseTo(drop.terminalV / 12.0, 3);
    });
  });

  describe('Multi-Motor Power Bus Network (bus.ts)', () => {
    it('reproduces Candidate A exact spec anchor: V_term = 10.82 V ± 0.01 and I = 1.25 A ± 0.02 at 3800 RPM', () => {
      const bus = new PowerBus(1, 12.0, 0.782, { quiescentCurrentA: 0.255 });
      const motor = bus.motors[0];

      const stateRpm = motor.solveRpmMode(3800, () => 0.01258);
      expect(stateRpm.currentA).toBeCloseTo(1.25, 1);
      expect(Math.abs(stateRpm.currentA - 1.25)).toBeLessThan(0.02);

      const tel = bus.solveBusNetwork([1.0], [() => 0.01258]);
      expect(tel.terminalV).toBeCloseTo(10.82, 2);
      expect(Math.abs(tel.terminalV - 10.82)).toBeLessThan(0.01);
      expect(Math.abs(tel.motors[0].currentA - 1.25)).toBeLessThan(0.02);
      console.log(`[Spec Anchor Point] V_term = ${tel.terminalV.toFixed(2)} V, I = ${tel.motors[0].currentA.toFixed(2)} A at 3800 RPM`);
    });
  });
});
