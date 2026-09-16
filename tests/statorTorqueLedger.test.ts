import { describe, it, expect } from 'vitest';
import { StatorVaneSystem, CANDIDATE_A_STATOR_CONFIG } from '../src/prop/stator';
import { PropellerArray } from '../src/prop/array';
import { TorqueLedger } from '../src/prop/torqueLedger';

describe('Phase 5b — Multi-Prop, Stator Swirl Recovery & Torque Ledger', () => {
  describe('Stator Vane Swirl Recovery (stator.ts)', () => {
    it('provides +0.04 N forward thrust gain at rated breakout condition', () => {
      const stator = new StatorVaneSystem();
      // Breakout condition: thrust ~1.58 N, torque ~0.014 Nm, 4140 RPM
      const res = stator.evaluate(1.58, 0.014, 4140);

      expect(res.thrustDeltaN).toBeCloseTo(0.04, 2);
      expect(res.antiTorqueNm).toBeLessThan(0); // Opposes propeller torque
      expect(res.residualRollDegPerM).toBeCloseTo(1.8, 1); // Candidate A: 1.8 deg/m for slotted
    });

    it('exhibits -0.09 N reverse thrust penalty under reverse flow', () => {
      const stator = new StatorVaneSystem();
      const res = stator.evaluate(-1.58, 0.014, -4140);

      expect(res.thrustDeltaN).toBeCloseTo(-0.09, 2);
      expect(res.residualRollDegPerM).toBeGreaterThan(5.0);
    });

    it('verifies roll reduction across vane types (none vs solid vs slotted)', () => {
      const noneStator = new StatorVaneSystem({ vaneType: 'none' });
      const solidStator = new StatorVaneSystem({ vaneType: 'solid' });
      const slottedStator = new StatorVaneSystem({ vaneType: 'slotted' });

      const resNone = noneStator.evaluate(1.58, 0.014, 4140);
      const resSolid = solidStator.evaluate(1.58, 0.014, 4140);
      const resSlotted = slottedStator.evaluate(1.58, 0.014, 4140);

      // Baseline uncompensated roll: 14.8 deg/m
      expect(resNone.residualRollDegPerM).toBeCloseTo(14.8, 1);
      // Solid stator: 1.4 deg/m
      expect(resSolid.residualRollDegPerM).toBeCloseTo(1.4, 1);
      // Slotted stator: 1.8 deg/m
      expect(resSlotted.residualRollDegPerM).toBeCloseTo(1.8, 1);

      // Slotted has lower roll than uncompensated
      expect(resSlotted.residualRollDegPerM).toBeLessThan(resNone.residualRollDegPerM * 0.15);
    });
  });

  describe('Multi-Propeller Array (array.ts)', () => {
    it('cancels roll torque using counter-rotating Port (CW) and Starboard (CCW) pair', () => {
      const array = new PropellerArray();

      // Equal forward throttle on Port and Starboard, vertical off
      const summary = array.evaluate([1.0, 1.0, 0.0]);

      // Total forward force (surge) should be sum of both thrusters
      expect(summary.totalForceN[0]).toBeGreaterThan(2.5); // ~3.0 N total forward surge

      // Net roll moment should cancel almost completely (>90% cancellation)
      const rollMoment = summary.totalMomentNm[0];
      const singleThrusterTorque = summary.thrusters[0].netTorqueNm;

      expect(Math.abs(rollMoment)).toBeLessThan(Math.abs(singleThrusterTorque) * 0.1);
      expect(summary.rollCancelledFraction).toBeGreaterThan(0.90);
    });

    it('generates differential yaw moment for vehicle steering', () => {
      const array = new PropellerArray();

      // Differential thrust: Port 1.0 forward, Starboard 0.2
      const summary = array.evaluate([1.0, 0.2, 0.0]);

      // Yaw moment about Z axis: Mz = Fx_port * (-y_port) + Fx_stbd * (-y_stbd)
      // Port at y = -0.075 pushing forward (+Fx) creates positive (clockwise) yaw moment Mz
      expect(summary.totalMomentNm[2]).toBeGreaterThan(0.05);
    });

    it('produces vertical heave without affecting horizontal surge', () => {
      const array = new PropellerArray();

      // Only vertical thruster firing
      const summary = array.evaluate([0.0, 0.0, 1.0]);

      expect(summary.totalForceN[0]).toBeCloseTo(0, 3); // Surge = 0
      expect(summary.totalForceN[1]).toBeCloseTo(0, 3); // Sway = 0
      expect(summary.totalForceN[2]).toBeGreaterThan(1.0); // Heave > 1.0 N
    });
  });

  describe('Torque Ledger & Precession (torqueLedger.ts)', () => {
    it('records entries and computes net torque summary', () => {
      const ledger = new TorqueLedger();

      ledger.record({
        sourceId: 'port_prop',
        sourceType: 'prop_reaction',
        description: 'Port prop reaction',
        rollNm: -0.014,
        pitchNm: 0,
        yawNm: 0
      });

      ledger.record({
        sourceId: 'port_stator',
        sourceType: 'stator_recovery',
        description: 'Port stator anti-swirl',
        rollNm: 0.012,
        pitchNm: 0,
        yawNm: 0
      });

      const summary = ledger.getNetSummary();
      // Net roll should be -0.014 + 0.012 = -0.002 Nm
      expect(summary.rollNm).toBeCloseTo(-0.002, 4);
      expect(summary.rollCancellationEfficiencyPct).toBeGreaterThan(80.0);
    });

    it('computes gyroscopic precession cross-product torque', () => {
      const ledger = new TorqueLedger();

      // Vehicle pitching up at 1.0 rad/s (wy = 1.0) with rotor spinning along X at 433 rad/s
      ledger.recordGyroscopicPrecession(
        'port_rotor',
        [0.0, 1.0, 0.0], // Body pitch rate wy
        [1.0, 0.0, 0.0], // Spin axis along +X
        433.0,            // Spin rate
        1e-6              // Propeller inertia Ixx
      );

      const summary = ledger.getNetSummary();
      // Gyroscopic precession: wy x Hx produces yaw torque (Mz)
      expect(summary.yawNm).not.toBe(0);
      expect(Math.abs(summary.yawNm)).toBeCloseTo(1.0 * 1e-6 * 433.0, 5);
    });
  });
});
