import { describe, it, expect } from 'vitest';
import { DCMotorModel, MABUCHI_RC280RA_SPECS, solveMotorOperatingPoint } from '../src/prop/motor';
import { calculateTetherResistance, calculateTetherState, AWG_RESISTANCE_OHM_PER_FT } from '../src/power/tether';
import { PowerBus } from '../src/power/bus';

describe('Phase 4b — Motor & Tether Electrical Model (Candidate A)', () => {
  describe('Mabuchi RC-280RA DC Motor (motor.ts)', () => {
    it('evaluates stall current and stall torque at 12V terminal voltage', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      const iStall = motor.computeCurrent(12.0, 0, 1.0);
      const qStall = motor.computeTorque(12.0, 0, 1.0);

      // I_stall = 12V / 4.50 Ohm = 2.67 A
      expect(iStall).toBeCloseTo(12.0 / 4.50, 2);

      // Q_stall = Kt * (I_stall - Io) = 0.01171 * (2.67 - 0.18) ~ 0.029 Nm
      expect(qStall).toBeGreaterThan(0.025);
      expect(qStall).toBeLessThan(0.032);
    });

    it('matches no-load rated RPM ~9800 at 10.8V', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      // No-load condition: load torque = 0
      const state = motor.solveEquilibrium(10.8, 1.0, () => 0);

      // No-load RPM at 10.8V should match Candidate A specification (9800 RPM +/- 5%)
      expect(state.rpm).toBeGreaterThan(9300);
      expect(state.rpm).toBeLessThan(10500);
      expect(state.currentA).toBeCloseTo(MABUCHI_RC280RA_SPECS.Io_A, 2);
    });

    it('reverses direction correctly with negative throttle', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      const forward = motor.solveEquilibrium(10.0, 1.0, (w) => 1e-6 * w * w);
      const reverse = motor.solveEquilibrium(10.0, -1.0, (w) => 1e-6 * w * w);

      expect(forward.rpm).toBeGreaterThan(0);
      expect(reverse.rpm).toBeLessThan(0);
      expect(Math.abs(reverse.rpm)).toBeCloseTo(forward.rpm, 1);
      expect(reverse.shaftTorqueNm).toBeLessThan(0);
    });

    it('solves Candidate A breakout operating point (~4140 RPM, ~1.41 A)', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      // Load torque representing the 42mm propeller at breakout: Q_load ~ 0.014 Nm at ~4140 RPM (w ~ 433 rad/s)
      const kHydro = 0.0144 / Math.pow(433, 2);
      const loadFn = (w: number) => kHydro * Math.pow(w, 2);

      // At 1.41A through 0.782 Ohm tether, terminal voltage is ~10.9V
      const vTerminal = 12.0 - 1.41 * 0.782;
      const state = motor.solveEquilibrium(vTerminal, 1.0, loadFn);

      // Expected RPM ~ 4140 (+/- 5%)
      expect(state.rpm).toBeGreaterThan(3900);
      expect(state.rpm).toBeLessThan(4400);

      // Expected current ~ 1.41 A (+/- 0.15 A)
      expect(state.currentA).toBeGreaterThan(1.25);
      expect(state.currentA).toBeLessThan(1.55);

      // Operating torque ~ 0.012 to 0.017 Nm
      expect(state.shaftTorqueNm).toBeGreaterThan(0.011);
      expect(state.shaftTorqueNm).toBeLessThan(0.018);
    });

    it('simulates thermal accumulation and predicts burst duration', () => {
      const motor = new DCMotorModel(MABUCHI_RC280RA_SPECS);
      expect(motor.windingTempC).toBe(20.0);

      // Heavy current load 2.0 A for 10 seconds
      motor.stepThermal(2.0, 10.0);
      expect(motor.windingTempC).toBeGreaterThan(20.0);

      // Check thermal burst duration prediction at high current
      const highLoadState = motor.solveEquilibrium(12.0, 1.0, (w) => 0.020);
      expect(Number.isFinite(highLoadState.burstDurationRemainingS)).toBe(true);
      expect(highLoadState.burstDurationRemainingS).toBeGreaterThan(5);
      expect(highLoadState.burstDurationRemainingS).toBeLessThan(350);

      motor.resetThermal();
      expect(motor.windingTempC).toBe(20.0);
    });
  });

  describe('Tether Resistance & Voltage Drop (tether.ts)', () => {
    it('calculates round-trip resistance for 15ft 24AWG copper wire', () => {
      const r = calculateTetherResistance(15.0, 24);
      // 30 ft * 0.02567 Ohm/ft = 0.770 Ohm
      expect(r).toBeGreaterThan(0.70);
      expect(r).toBeLessThan(0.85);
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

    it('steps thermal status across bus motors', () => {
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
