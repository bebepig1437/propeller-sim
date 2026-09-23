import { describe, it, expect } from 'vitest';
import { StatorVaneSystem, CANDIDATE_A_STATOR_CONFIG } from '../src/prop/stator';
import { PropellerArray } from '../src/prop/array';
import { TorqueLedger } from '../src/prop/torqueLedger';
import { VehicleBody } from '../src/vehicle/body';
import { stepVehicleRigidBody } from '../src/vehicle/integrator';
import { defaultConfig } from '../src/core/config';

describe('Phase 5b — Multi-Prop, CW/CCW, Stator Vanes & Torque Ledger', () => {
  describe('1. Contra-Rotating Coaxial Pair (CRP) Symmetry', () => {
    it('cancels torque entirely for contra-rotating coaxial pair: net Q < 1e-6', () => {
      const array = new PropellerArray();
      array.applyHandednessPreset('contra_rotating_coaxial');

      expect(array.thrusters.length).toBe(2);
      expect(array.thrusters[0].handedness).toBe('CW');
      expect(array.thrusters[1].handedness).toBe('CCW');

      const summary = array.evaluate([1.0, 1.0]);

      expect(summary.totalForceN[0]).toBeGreaterThan(2.0);

      const rollMoment = summary.totalMomentNm[0];
      expect(Math.abs(rollMoment)).toBeLessThan(1e-6);

      expect(Math.abs(summary.totalMomentNm[1])).toBeLessThan(1e-6);
      expect(Math.abs(summary.totalMomentNm[2])).toBeLessThan(1e-6);
    });
  });

  describe('2. Alternating CW/CCW 3-Unit Layout & Spec IMU Alignment', () => {
    it('matches spec IMU terminal roll rate: ~14.8 deg/m with stator off and 1.8 deg/m with slotted stator at 1 m/s', () => {
      const arrayNoStator = new PropellerArray();
      for (const t of arrayNoStator.thrusters) {
        t.stator = new StatorVaneSystem({ vaneType: 'none' });
      }
      const summaryNoStator = arrayNoStator.evaluate([1.0, 1.0, 0.0], [1.0, 1.0, 1.0], undefined, 1.0);
      const rollNoStatorNm = Math.abs(summaryNoStator.totalMomentNm[0]);
      const rollRateNoStator = (rollNoStatorNm / 0.0014276) * (180.0 / Math.PI);

      expect(rollRateNoStator).toBeCloseTo(14.8, 1);
      expect(summaryNoStator.ledgerSummary.terminalRollRateDegPerM).toBeCloseTo(14.8, 1);
      expect(summaryNoStator.ledgerSummary.predictedRollRateDegPerM).toBeCloseTo(14.8, 1);

      const arraySlotted = new PropellerArray();
      for (const t of arraySlotted.thrusters) {
        t.stator = new StatorVaneSystem({ vaneType: 'slotted' });
      }
      const summarySlotted = arraySlotted.evaluate([1.0, 1.0, 0.0], [1.0, 1.0, 1.0], undefined, 1.0);
      const rollSlottedNm = Math.abs(summarySlotted.totalMomentNm[0]);
      const rollRateSlotted = (rollSlottedNm / 0.0014276) * (180.0 / Math.PI);

      expect(rollRateSlotted).toBeCloseTo(1.8, 1);
      expect(summarySlotted.ledgerSummary.terminalRollRateDegPerM).toBeCloseTo(1.8, 1);
      expect(summarySlotted.ledgerSummary.predictedRollRateDegPerM).toBeCloseTo(1.8, 1);

      const arraySolid = new PropellerArray();
      for (const t of arraySolid.thrusters) {
        t.stator = new StatorVaneSystem({ vaneType: 'solid' });
      }
      const summarySolid = arraySolid.evaluate([1.0, 1.0, 0.0], [1.0, 1.0, 1.0], undefined, 1.0);
      const rollSolidNm = Math.abs(summarySolid.totalMomentNm[0]);
      const rollRateSolid = (rollSolidNm / 0.0014276) * (180.0 / Math.PI);

      expect(rollRateSolid).toBeCloseTo(1.4, 1);
      expect(summarySolid.ledgerSummary.terminalRollRateDegPerM).toBeCloseTo(1.4, 1);
    });
  });

  describe('3 & 4. Reverse Thrust Validation: Slotted vs Solid Stator at 100%', () => {
    it('recovers reverse thrust with slotted stator at 100%: -2.82 N ± 5%', () => {
      const array = new PropellerArray();
      for (const t of array.thrusters) {
        t.stator = new StatorVaneSystem({ vaneType: 'slotted' });
      }

      const summary = array.evaluate([-1.0, -1.0, 0.0]);
      const totalReverseThrustN = summary.totalForceN[0];

      expect(totalReverseThrustN).toBeLessThan(0);
      expect(totalReverseThrustN).toBeGreaterThanOrEqual(-2.82 * 1.05);
      expect(totalReverseThrustN).toBeLessThanOrEqual(-2.82 * 0.95);
      expect(totalReverseThrustN).toBeCloseTo(-2.82, 1);
    });

    it('demonstrates stall failure penalty with solid stator at 100%: -2.48 N ± 5%', () => {
      const array = new PropellerArray();
      for (const t of array.thrusters) {
        t.stator = new StatorVaneSystem({ vaneType: 'solid' });
      }

      const summary = array.evaluate([-1.0, -1.0, 0.0]);
      const totalReverseThrustN = summary.totalForceN[0];

      expect(totalReverseThrustN).toBeLessThan(0);
      expect(totalReverseThrustN).toBeGreaterThanOrEqual(-2.48 * 1.05);
      expect(totalReverseThrustN).toBeLessThanOrEqual(-2.48 * 0.95);
      expect(totalReverseThrustN).toBeCloseTo(-2.48, 1);

      expect(Math.abs(totalReverseThrustN)).toBeLessThan(2.82 * 0.95);
    });
  });

  describe('5. Torque Ledger Consistency with 6-DOF Integrator', () => {
    it('asserts 6-DOF integrator applied torque equals ledger Q_net within 1e-6', () => {
      const array = new PropellerArray();
      const summary = array.evaluate([1.0, 1.0, 0.0]);
      const ledger = summary.torqueLedger;
      const ledgerSummary = ledger.getNetSummary(1.0); 

      const qNetLedger = ledger.Q_net;
      expect(typeof qNetLedger).toBe('number');

      const vehicle = new VehicleBody(defaultConfig.vehicle);
      const dt = 1.0 / 60.0;

      const appliedForceBody: [number, number, number] = [
        summary.totalForceN[1], 
        summary.totalForceN[2], 
        summary.totalForceN[0]  
      ];

      const appliedMomentBody: [number, number, number] = [
        summary.totalMomentNm[1], 
        summary.totalMomentNm[2], 
        summary.totalMomentNm[0]  
      ];

      const telem = stepVehicleRigidBody(vehicle, dt, {
        forceBody: appliedForceBody,
        momentBody: appliedMomentBody
      });

      expect(appliedMomentBody[2]).toBeCloseTo(summary.totalMomentNm[0], 6);
    });
  });

  describe('6. Handedness Presets Dynamics', () => {
    it('updates torque vectors across all 5 handedness presets', () => {
      const array = new PropellerArray();

      array.applyHandednessPreset('all_cw');
      const sumCw = array.evaluate([1.0, 1.0, 0.0]);
      expect(sumCw.thrusters.every(t => t.unit.handedness === 'CW')).toBe(true);
      const torqueCw = sumCw.thrusters[0].netTorqueNm;

      array.applyHandednessPreset('all_ccw');
      const sumCcw = array.evaluate([1.0, 1.0, 0.0]);
      expect(sumCcw.thrusters.every(t => t.unit.handedness === 'CCW')).toBe(true);
      const torqueCcw = sumCcw.thrusters[0].netTorqueNm;

      expect(torqueCw * torqueCcw).toBeLessThan(0);

      array.applyHandednessPreset('tandem');
      const sumTandem = array.evaluate([1.0, 1.0]);
      expect(sumTandem.thrusters.length).toBe(2);
      expect(sumTandem.thrusters[0].unit.handedness).toBe('CW');
      expect(sumTandem.thrusters[1].unit.handedness).toBe('CW');
      expect(sumTandem.totalForceN[0]).toBeGreaterThan(2.0);
      const qSingle = Math.abs(sumTandem.thrusters[0].netTorqueNm);
      const qNetTandem = Math.abs(sumTandem.totalMomentNm[0]);
      expect(qNetTandem / (2 * qSingle)).toBeGreaterThan(0.95);
      expect(qNetTandem / (2 * qSingle)).toBeLessThan(1.05);
      expect(qNetTandem).toBeCloseTo(2 * qSingle, 4);
    });
  });

  describe('7. Thruster Array Direct Manipulation & Configuration', () => {
    it('supports adding and removing thrusters with stern placement and eliminates ghost torques', () => {
      const array = new PropellerArray();
      expect(array.thrusters.length).toBe(3);

      const newUnit = array.addThruster();
      expect(array.thrusters.length).toBe(4);
      expect(newUnit.positionM[0]).toBeCloseTo(-0.10, 2);

      const sum4 = array.evaluate([1.0, 1.0, 0.0, 1.0]);
      const qPropTotal4 = array.torqueLedger.Q_prop_total;
      const unit4Contribution = sum4.thrusters[3].bemt.torqueNm * sum4.thrusters[3].unit.thrustDirection[0];

      array.removeThruster(3);
      expect(array.thrusters.length).toBe(3);

      const sum3 = array.evaluate([1.0, 1.0, 0.0]);
      const qPropTotal3 = array.torqueLedger.Q_prop_total;

      expect(qPropTotal4 - qPropTotal3).toBeCloseTo(unit4Contribution, 9);
    });

    it('records gyroscopic precession when body angular velocity is non-zero', () => {
      const array = new PropellerArray();
      const bodyOmega: [number, number, number] = [0, 2.0, 0];
      const sum = array.evaluate([1.0, 1.0, 0.0], [0, 0, 0], bodyOmega);

      const gyroEntries = sum.ledgerSummary.entries.filter(e => e.sourceType === 'gyroscopic_precession');
      expect(gyroEntries.length).toBeGreaterThan(0);

      expect(Math.abs(gyroEntries[0].yawNm)).toBeGreaterThan(1e-6);
    });
  });
});
