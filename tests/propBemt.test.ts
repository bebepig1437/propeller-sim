import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { evaluateSectionPolar, generatePolarTable, defaultHydrofoilProps } from '../src/prop/polar';
import { solveBEMT, getBladeChordAt, getBladePitchAngleAt } from '../src/prop/bemt';
import { calculatePropellerInertia, calculateAngularAcceleration, MATERIAL_SPECS, PropellerShaft } from '../src/prop/rigidbody';
import { Propeller3D } from '../src/prop/geometry';

describe('Phase 4 — Propeller, BEMT & Inertia Variants', () => {
  describe('Hydrofoil Polar & Viterna Model (polar.ts)', () => {
    it('evaluates attached flow with positive camber lift at zero alpha', () => {
      const { cl, cd } = evaluateSectionPolar(0);
      expect(cl).toBeGreaterThan(0.1);
      expect(cl).toBeLessThan(0.4);
      expect(cd).toBeGreaterThan(0.01);
      expect(cd).toBeLessThan(0.03);
    });

    it('predicts linear lift slope in attached regime', () => {
      const alpha1 = (2.0 * Math.PI) / 180.0;
      const alpha2 = (6.0 * Math.PI) / 180.0;
      const p1 = evaluateSectionPolar(alpha1);
      const p2 = evaluateSectionPolar(alpha2);

      const dCl = p2.cl - p1.cl;
      const dAlpha = alpha2 - alpha1;
      const slope = dCl / dAlpha;
      expect(slope).toBeCloseTo(defaultHydrofoilProps.liftCurveSlope, 1);
    });

    it('models post-stall flat-plate drag peak around 90 degrees', () => {
      const p90 = evaluateSectionPolar((90.0 * Math.PI) / 180.0);
      expect(Math.abs(p90.cl)).toBeLessThan(0.15);
      expect(p90.cd).toBeGreaterThan(1.0);
      expect(p90.cd).toBeLessThan(1.3);
    });

    it('generates polar table with correct resolution and count', () => {
      const table = generatePolarTable(-20, 20, 2);
      expect(table.length).toBe(21);
      expect(table[0].alphaDeg).toBe(-20);
      expect(table[table.length - 1].alphaDeg).toBe(20);
    });
  });

  describe('Blade Element Momentum Theory Solver (bemt.ts)', () => {
    it('evaluates zero forces at zero RPM', () => {
      const res = solveBEMT(0, 0);
      expect(res.thrustN).toBe(0);
      expect(res.torqueNm).toBe(0);
      expect(res.efficiency).toBe(0);
    });

    it('solves Candidate A breakout bollard pull condition (4140 RPM, Va = 0)', () => {
      const res = solveBEMT(4140, 0, {
        diameterMm: 42.0,
        hubDiameterMm: 8.0,
        blades: 3,
        pitchMm: 32.0
      });

      expect(res.thrustN).toBeGreaterThan(1.2);
      expect(res.thrustN).toBeLessThan(3.5);

      expect(Math.abs(res.torqueNm)).toBeGreaterThan(0.010);
      expect(Math.abs(res.torqueNm)).toBeLessThan(0.020);
      expect(res.torqueNm).toBeLessThan(0); 

      expect(res.kq).toBeGreaterThan(0.018);
      expect(res.kq).toBeLessThan(0.030);

      expect(res.kt).toBeGreaterThan(0.08);
      expect(res.kt).toBeLessThan(0.25);

      expect(res.elements.length).toBe(20);
      expect(res.elements[0].radiusM).toBeCloseTo(0.004 + (0.021 - 0.004) / 40, 4);
    });

    it('validates Candidate A KQ anchor point at 3800 RPM produces Q = 12.58 mNm within 2%', () => {
      const n = 63.3333; 
      const rpm = n * 60; 
      const D = 0.042;
      const rho = 1000.0;
      const KQ_spec = 0.024;
      const Q_spec = KQ_spec * rho * Math.pow(n, 2) * Math.pow(D, 5); 

      const res = solveBEMT(rpm, 0, {
        diameterMm: 42.0,
        hubDiameterMm: 8.0,
        blades: 3,
        pitchMm: 28.0
      });

      const Q_bemt = Math.abs(res.torqueNm);
      const percentError = (Math.abs(Q_bemt - Q_spec) / Q_spec) * 100;
      console.log(`[BEMT Anchor] Q_spec = ${(Q_spec * 1e3).toFixed(2)} mNm, Q_bemt = ${(Q_bemt * 1e3).toFixed(2)} mNm, error = ${percentError.toFixed(2)}%`);
      expect(percentError).toBeLessThan(2.0);
    });

    it('validates against 3 UIUC propeller database points and reports % error', () => {
      const uiucPoints = [
        { J: 0.20, Kt_ref: 0.180, Kq_ref: 0.0260, eta_ref: 0.220 },
        { J: 0.45, Kt_ref: 0.150, Kq_ref: 0.0240, eta_ref: 0.450 },
        { J: 0.65, Kt_ref: 0.108, Kq_ref: 0.0190, eta_ref: 0.585 }
      ];

      const rpm = 5000;
      const n = rpm / 60;
      const D = 0.1067; 

      console.log('\n--- UIUC Propeller Database Validation ---');
      for (const pt of uiucPoints) {
        const Va = pt.J * n * D;
        const res = solveBEMT(rpm, Va, {
          diameterMm: 106.7,
          hubDiameterMm: 16.0,
          blades: 2,
          pitchMm: 101.6,
          fluidDensity: 1.225, // air for UIUC wind tunnel test
          kinematicViscosity: 1.5e-5
        });

        const ktErr = (Math.abs(res.kt - pt.Kt_ref) / pt.Kt_ref) * 100;
        const kqErr = (Math.abs(res.kq - pt.Kq_ref) / pt.Kq_ref) * 100;
        const etaErr = pt.eta_ref > 0 ? (Math.abs(res.efficiency - pt.eta_ref) / pt.eta_ref) * 100 : 0;

        console.log(`[UIUC J=${pt.J.toFixed(2)}] Kt: sim=${res.kt.toFixed(4)} ref=${pt.Kt_ref.toFixed(4)} (err=${ktErr.toFixed(1)}%) | Kq: sim=${res.kq.toFixed(4)} ref=${pt.Kq_ref.toFixed(4)} (err=${kqErr.toFixed(1)}%) | eta: sim=${res.efficiency.toFixed(3)} ref=${pt.eta_ref.toFixed(3)} (err=${etaErr.toFixed(1)}%)`);

        expect(ktErr).toBeLessThan(15.0);
        expect(kqErr).toBeLessThan(15.0);
        expect(etaErr).toBeLessThan(15.0);
      }
    });

    it('performs J-sweep validation from J=0 to 1.2 with no NaNs and within tolerances', () => {
      const rpm = 4140;
      const n = rpm / 60;
      const D = 0.042;

      const jPoints = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
      const refTable: Record<number, { kt: number; kq: number; eta: number }> = {
        0.0: { kt: 0.238, kq: 0.0302, eta: 0.0 },
        0.2: { kt: 0.212, kq: 0.0283, eta: 0.238 },
        0.4: { kt: 0.168, kq: 0.0237, eta: 0.451 },
        0.6: { kt: 0.115, kq: 0.0174, eta: 0.633 },
        0.8: { kt: 0.054, kq: 0.0091, eta: 0.749 },
        1.0: { kt: -0.029, kq: -0.0032, eta: 0.0 },
        1.2: { kt: -0.167, kq: -0.0264, eta: 0.0 }
      };

      console.log('\n--- J-Sweep Validation vs XROTOR Reference Table ---');
      for (const J of jPoints) {
        const Va = J * n * D;
        const res = solveBEMT(rpm, Va, {
          diameterMm: 42.0,
          hubDiameterMm: 8.0,
          blades: 3,
          pitchMm: 33.2
        });

        expect(Number.isNaN(res.thrustN)).toBe(false);
        expect(Number.isNaN(res.torqueNm)).toBe(false);
        expect(Number.isNaN(res.kt)).toBe(false);
        expect(Number.isNaN(res.kq)).toBe(false);
        expect(Number.isNaN(res.efficiency)).toBe(false);

        for (const elem of res.elements) {
          expect(Number.isNaN(elem.dT)).toBe(false);
          expect(Number.isNaN(elem.dQ)).toBe(false);
          expect(Number.isNaN(elem.cl)).toBe(false);
          expect(Number.isNaN(elem.cd)).toBe(false);
          expect(Number.isNaN(elem.axialInducedMs)).toBe(false);
          expect(Number.isNaN(elem.tangentialInducedMs)).toBe(false);
        }

        const ref = refTable[J];
        const ktDiff = Math.abs(res.kt - ref.kt);
        const kqDiff = Math.abs(res.kq - ref.kq);
        const ktErr = (ktDiff / Math.max(0.05, Math.abs(ref.kt))) * 100;
        const kqErr = (kqDiff / Math.max(0.005, Math.abs(ref.kq))) * 100;
        console.log(`[J=${J.toFixed(2)}] Kt: ${res.kt.toFixed(4)} (ref ${ref.kt.toFixed(4)}, err=${ktErr.toFixed(1)}%) | Kq: ${res.kq.toFixed(4)} (ref ${ref.kq.toFixed(4)}, err=${kqErr.toFixed(1)}%) | eta: ${res.efficiency.toFixed(3)} (ref ${ref.eta.toFixed(3)})`);

        expect(ktDiff).toBeLessThan(0.025);
        expect(kqDiff).toBeLessThan(0.005);
      }
    });

    it('validates handedness symmetry: flipping CW to CCW produces equal magnitude within 1e-6 and opposite torque sign', () => {
      const rpm = 3500;
      const resCW = solveBEMT(rpm, 0.4, { handedness: 'CW' });
      const resCCW = solveBEMT(rpm, 0.4, { handedness: 'CCW' });

      expect(resCW.thrustN).toBeGreaterThan(0);
      expect(resCCW.thrustN).toBeGreaterThan(0);
      expect(Math.abs(resCW.thrustN - resCCW.thrustN)).toBeLessThan(1e-6);

      expect(Math.abs(Math.abs(resCW.torqueNm) - Math.abs(resCCW.torqueNm))).toBeLessThan(1e-6);
      expect(resCW.torqueNm).toBeLessThan(0);
      expect(resCCW.torqueNm).toBeGreaterThan(0);
      expect(resCW.torqueNm + resCCW.torqueNm).toBeCloseTo(0, 6);
    });

    it('computes locked-rotor drag forces with non-empty elements when |RPM| < 1', () => {
      const resLocked = solveBEMT(0, 1.5); 
      expect(resLocked.elements.length).toBe(20);
      expect(resLocked.thrustN).toBeLessThan(0);
      expect(resLocked.torqueNm).toBe(0);
      expect(resLocked.efficiency).toBe(0);

      for (const elem of resLocked.elements) {
        expect(elem.axialInducedMs).toBe(0);
        expect(elem.tangentialInducedMs).toBe(0);
        expect(elem.cd).toBeGreaterThan(0);
        expect(elem.dT).toBeLessThan(0);
      }
    });

    it('shows thrust reduction and efficiency peak as advance ratio J increases', () => {
      const rpm = 4140;
      const bollard = solveBEMT(rpm, 0.0);
      const lowSpeed = solveBEMT(rpm, 0.5);
      const cruiseSpeed = solveBEMT(rpm, 1.2);

      expect(bollard.thrustN).toBeGreaterThan(lowSpeed.thrustN);
      expect(lowSpeed.thrustN).toBeGreaterThan(cruiseSpeed.thrustN);

      expect(bollard.efficiency).toBe(0);
      expect(cruiseSpeed.efficiency).toBeGreaterThan(0.40);
      expect(cruiseSpeed.efficiency).toBeLessThan(0.85);
    });

    it('evaluates reverse thrust under negative RPM', () => {
      const forward = solveBEMT(3500, 0);
      const reverse = solveBEMT(-3500, 0);

      expect(reverse.thrustN).toBeLessThan(0);
      expect(Math.abs(reverse.thrustN)).toBeLessThan(forward.thrustN);
      expect(Math.abs(reverse.thrustN)).toBeGreaterThan(forward.thrustN * 0.5);
    });

    it('computes blade chord and pitch angle functions', () => {
      const rHub = 0.004;
      const rTip = 0.021;
      const chordMid = getBladeChordAt(0.015, rHub, rTip);
      const chordTip = getBladeChordAt(rTip, rHub, rTip);

      expect(chordMid).toBeGreaterThan(chordTip);

      const pitch = 0.044;
      const thetaHub = getBladePitchAngleAt(rHub, pitch);
      const thetaTip = getBladePitchAngleAt(rTip, pitch);

      expect(thetaHub).toBeGreaterThan(thetaTip);
    });
  });

  describe('Shaft Dynamics & Material Inertia Variants (rigidbody.ts)', () => {
    it('models first-order RPM lag and pitch servo lag in PropellerShaft', () => {
      const shaft = new PropellerShaft(0, 15.0);
      shaft.commandedRpm = 3000;
      shaft.commandedPitchDeg = 25.0;

      shaft.update(0.05);
      expect(shaft.currentRpm).toBeGreaterThan(500);
      expect(shaft.currentRpm).toBeLessThan(3000);
      expect(shaft.currentPitchDeg).toBeCloseTo(25.0, 1);

      for (let t = 0; t < 35; t++) {
        shaft.update(0.05);
      }
      expect(shaft.currentRpm).toBeCloseTo(3000, 0);
      expect(shaft.currentPitchDeg).toBeCloseTo(25.0, 1);
      expect(shaft.bladePhaseRad).toBeGreaterThan(0);
      expect(shaft.getBlurAlpha()).toBeGreaterThan(0.9);
    });

    it('verifies Candidate A material masses match specifications', () => {
      expect(MATERIAL_SPECS.rigid10k.massGrams).toBeCloseTo(1.80, 2);
      expect(MATERIAL_SPECS.pa12cf15.massGrams).toBeCloseTo(1.25, 2);
      expect(MATERIAL_SPECS.petg.massGrams).toBeCloseTo(1.38, 2);
    });

    it('calculates polar moment of inertia ordering: PA12-CF15 < PETG < Rigid 10K', () => {
      const iRigid = calculatePropellerInertia('rigid10k');
      const iPA12 = calculatePropellerInertia('pa12cf15');
      const iPETG = calculatePropellerInertia('petg');

      expect(iPA12.iDryKgM2).toBeLessThan(iPETG.iDryKgM2);
      expect(iPETG.iDryKgM2).toBeLessThan(iRigid.iDryKgM2);

      expect(iPA12.iAddedMassWaterKgM2).toBeGreaterThan(0);
      expect(iPA12.iTotalEffectiveKgM2).toBe(iPA12.iDryKgM2 + iPA12.iAddedMassWaterKgM2);

      expect(iPA12.spinUpTimeConstantMs).toBeLessThan(iRigid.spinUpTimeConstantMs);
    });

    it('computes angular acceleration from net torque', () => {
      const alpha = calculateAngularAcceleration(0.020, 0.010, 1e-6);
      expect(alpha).toBeCloseTo(10000, 1);
    });
  });

  describe('3D Propeller Geometry & Direct Manipulation (geometry.ts)', () => {
    it('generates 3D mesh with hub, nose cone, 3 blades, and anti-strobe blur disc', () => {
      const prop = new Propeller3D({
        diameterMm: 42.0,
        hubOdMm: 8.0,
        blades: 3,
        materialType: 'rigid10k'
      });

      expect(prop.group).toBeInstanceOf(THREE.Group);
      expect(prop.rotorGroup).toBeInstanceOf(THREE.Group);

      expect(prop.rotorGroup.children.length).toBe(6);

      expect(prop.handlesGroup).toBeInstanceOf(THREE.Group);
      expect(prop.translateHandle).toBeInstanceOf(THREE.Group);
      expect(prop.pitchHandle).toBeInstanceOf(THREE.Group);
      expect(prop.handednessBadge).toBeInstanceOf(THREE.Mesh);

      prop.setRotation(Math.PI / 4);
      expect(prop.rotorGroup.rotation.z).toBeCloseTo(Math.PI / 4, 3);

      prop.setMaterial('pa12cf15');
      expect(prop.currentMaterial).toBe('pa12cf15');
      prop.setMaterial('petg');
      expect(prop.currentMaterial).toBe('petg');

      prop.setDesign('kaplan');
      expect(prop.currentDesignId).toBe('kaplan');
      prop.setDesign('wageningen');
      expect(prop.currentDesignId).toBe('wageningen');
      prop.setDesign('candidateA');
      expect(prop.currentDesignId).toBe('candidateA');

      prop.setHandedness('CCW');
      expect(prop.currentHandedness).toBe('CCW');
      prop.setHandedness('CW');
      expect(prop.currentHandedness).toBe('CW');

      prop.dispose();
    });
  });
});
