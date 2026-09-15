import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { evaluateSectionPolar, generatePolarTable, defaultHydrofoilProps } from '../src/prop/polar';
import { solveBEMT, getBladeChordAt, getBladePitchAngleAt } from '../src/prop/bemt';
import { calculatePropellerInertia, calculateAngularAcceleration, MATERIAL_SPECS } from '../src/prop/rigidbody';
import { Propeller3D } from '../src/prop/geometry';

describe('Phase 4 — Propeller, BEMT & Inertia Variants', () => {
  describe('Hydrofoil Polar & Viterna Model (polar.ts)', () => {
    it('evaluates attached flow with positive camber lift at zero alpha', () => {
      const { cl, cd } = evaluateSectionPolar(0);
      // Zero-lift alpha is -2 deg, so at alpha = 0, Cl must be positive
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
      // At 90 degrees, Cl drops towards 0 and Cd reaches maximum (~1.1 - 1.2)
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

      // Per-propeller thrust at 4140 RPM in bollard pull
      expect(res.thrustN).toBeGreaterThan(1.2);
      expect(res.thrustN).toBeLessThan(3.5);

      // Torque should match ~0.010 to 0.020 Nm (well within Mabuchi motor peak envelope)
      expect(res.torqueNm).toBeGreaterThan(0.010);
      expect(res.torqueNm).toBeLessThan(0.020);

      // Non-dimensional coefficients:
      // KQ should closely match Candidate A specification (KQ ~ 0.024)
      expect(res.kq).toBeGreaterThan(0.018);
      expect(res.kq).toBeLessThan(0.030);

      // KT should be in standard marine prop bollard range (0.08 to 0.25)
      expect(res.kt).toBeGreaterThan(0.08);
      expect(res.kt).toBeLessThan(0.25);

      // Radial element discretization check
      expect(res.elements.length).toBe(20);
      expect(res.elements[0].radiusM).toBeCloseTo(0.004 + (0.021 - 0.004) / 40, 4);
    });

    it('shows thrust reduction and efficiency peak as advance ratio J increases', () => {
      const rpm = 4140;
      const bollard = solveBEMT(rpm, 0.0);
      const lowSpeed = solveBEMT(rpm, 0.5);
      const cruiseSpeed = solveBEMT(rpm, 1.2);

      // Thrust must decrease monotonically with forward vehicle speed
      expect(bollard.thrustN).toBeGreaterThan(lowSpeed.thrustN);
      expect(lowSpeed.thrustN).toBeGreaterThan(cruiseSpeed.thrustN);

      // Efficiency is 0 at bollard pull (no useful vehicle advance work), rises at cruise
      expect(bollard.efficiency).toBe(0);
      expect(cruiseSpeed.efficiency).toBeGreaterThan(0.40);
      expect(cruiseSpeed.efficiency).toBeLessThan(0.85);
    });

    it('evaluates reverse thrust under negative RPM', () => {
      const forward = solveBEMT(3500, 0);
      const reverse = solveBEMT(-3500, 0);

      expect(reverse.thrustN).toBeLessThan(0);
      // Reverse thrust should exhibit expected marine prop camber penalty (60-80% of forward)
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

      // Pitch angle must twist downwards from hub to tip (washout)
      expect(thetaHub).toBeGreaterThan(thetaTip);
    });
  });

  describe('Material Inertia Variants (rigidbody.ts)', () => {
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

      // Hydrodynamic added mass must be included
      expect(iPA12.iAddedMassWaterKgM2).toBeGreaterThan(0);
      expect(iPA12.iTotalEffectiveKgM2).toBe(iPA12.iDryKgM2 + iPA12.iAddedMassWaterKgM2);

      // Fast spin-up time constant for PA12-CF15 compared to Rigid 10K
      expect(iPA12.spinUpTimeConstantMs).toBeLessThan(iRigid.spinUpTimeConstantMs);
    });

    it('computes angular acceleration from net torque', () => {
      const alpha = calculateAngularAcceleration(0.020, 0.010, 1e-6);
      // (0.020 - 0.010) / 1e-6 = 10000 rad/s^2
      expect(alpha).toBeCloseTo(10000, 1);
    });
  });

  describe('3D Propeller Geometry (geometry.ts)', () => {
    it('generates 3D mesh with hub, nose cone, and 3 blades', () => {
      const prop = new Propeller3D({
        diameterMm: 42.0,
        hubOdMm: 8.0,
        blades: 3,
        materialType: 'rigid10k'
      });

      expect(prop.group).toBeInstanceOf(THREE.Group);
      expect(prop.rotorGroup).toBeInstanceOf(THREE.Group);

      // Rotor group contains 1 hub cylinder + 1 nose cone + 3 blades = 5 children
      expect(prop.rotorGroup.children.length).toBe(5);

      // Rotation update
      prop.setRotation(Math.PI / 4);
      expect(prop.rotorGroup.rotation.z).toBeCloseTo(Math.PI / 4, 3);

      // Material switching
      prop.setMaterial('pa12cf15');
      expect(prop.currentMaterial).toBe('pa12cf15');
      prop.setMaterial('petg');
      expect(prop.currentMaterial).toBe('petg');

      prop.dispose();
    });
  });
});
