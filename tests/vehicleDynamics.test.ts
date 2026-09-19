import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { calculateBuoyancy, computeMetacentricRightingMoment } from '../src/vehicle/buoyancy';
import { computeHydrodynamicDamping, CANDIDATE_A_DRAG, CANDIDATE_A_ADDED_MASS } from '../src/vehicle/drag';
import { VehicleBody } from '../src/vehicle/body';
import { stepVehicleRigidBody, DEFAULT_TANK_BOUNDARIES } from '../src/vehicle/integrator';
// Legacy renderer relocated out of the runtime module (review Directive 2):
// no contributor can accidentally import it from the live overlay module.
import { FlowOverlays } from '../src/render/legacy/flowOverlays';
import { PropellerArray } from '../src/prop/array';
import { defaultConfig } from '../src/core/config';

describe('Phase 6 & 6b — 6-DOF Vehicle Dynamics & Scientific Overlays', () => {
  describe('Hydrostatics & Buoyancy (buoyancy.ts)', () => {
    it('computes Candidate A mass and net positive buoyancy (+0.197 N)', () => {
      const buoyancy = calculateBuoyancy(defaultConfig.vehicle, 1.80);

      // Dry mass: 39.5 frame + 9.0 hardware + (42.0 * 3) motors + (1.80 * 3) props = 179.9 g = 0.1799 kg
      expect(buoyancy.dryMassKg).toBeCloseTo(0.1799, 4);

      // Displaced water: 200 cm3 at 1000 kg/m3 = 0.200 kg
      expect(buoyancy.displacedMassKg).toBeCloseTo(0.200, 4);

      // Net positive buoyancy: (0.200 - 0.1799) * 9.80665 = +0.1971 N
      expect(buoyancy.netBuoyancyForceN).toBeGreaterThan(0.19);
      expect(buoyancy.netBuoyancyForceN).toBeLessThan(0.21);

      // CoB offset is 12.5mm along body Y axis (+Yb is Dorsal/Up)
      expect(buoyancy.cobOffsetBodyM[0]).toBe(0.0);
      expect(buoyancy.cobOffsetBodyM[1]).toBeCloseTo(0.0125, 4);
      expect(buoyancy.cobOffsetBodyM[2]).toBe(0.0);
    });

    it('calculates zero metacentric righting moment when upright', () => {
      const buoyancy = calculateBuoyancy(defaultConfig.vehicle);
      const uprightQuat = new THREE.Quaternion(0, 0, 0, 1);
      const torque = computeMetacentricRightingMoment(uprightQuat, buoyancy);

      expect(torque[0]).toBeCloseTo(0.0, 5);
      expect(torque[1]).toBeCloseTo(0.0, 5);
      expect(torque[2]).toBeCloseTo(0.0, 5);
    });

    it('generates restoring righting moment when perturbed in roll (+30 deg)', () => {
      const buoyancy = calculateBuoyancy(defaultConfig.vehicle);
      // Roll 30 deg around body Z (longitudinal / surge axis)
      const rollQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (30.0 * Math.PI) / 180.0
      );

      const torque = computeMetacentricRightingMoment(rollQuat, buoyancy);

      // Roll torque should be non-zero and act in the restoring direction
      // tau = r_cob x F_buoy: since r_cob tilts into -X, cross product produces restoring moment
      expect(Math.abs(torque[2])).toBeGreaterThan(0.001);
    });

    it('generates restoring righting moment when perturbed in pitch (+20 deg)', () => {
      const buoyancy = calculateBuoyancy(defaultConfig.vehicle);
      // Pitch 20 deg around body X axis
      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        (20.0 * Math.PI) / 180.0
      );

      const torque = computeMetacentricRightingMoment(pitchQuat, buoyancy);
      expect(Math.abs(torque[0])).toBeGreaterThan(0.001);
    });
  });

  describe('Hydrodynamic Damping (drag.ts)', () => {
    it('returns zero damping forces at rest', () => {
      const damping = computeHydrodynamicDamping([0, 0, 0], [0, 0, 0]);
      expect(damping.forceBodyN[0]).toBe(0);
      expect(damping.forceBodyN[1]).toBe(0);
      expect(damping.forceBodyN[2]).toBe(0);
      expect(damping.torqueBodyNm[0]).toBe(0);
      expect(damping.torqueBodyNm[1]).toBe(0);
      expect(damping.torqueBodyNm[2]).toBe(0);
    });

    it('opposes forward surge motion with quadratic and linear drag', () => {
      // Forward surge at 0.5 m/s (along Z axis)
      const damping = computeHydrodynamicDamping([0, 0, 0.5], [0, 0, 0]);

      // Force along surge (Z) should oppose forward motion (negative)
      expect(damping.forceBodyN[2]).toBeLessThan(0);
      // Surge area 0.0075 m2, rho = 1000: 0.5 * 1000 * 0.0075 * 0.25 + 0.45 * 0.5 = 0.9375 + 0.225 = 1.1625 N
      expect(Math.abs(damping.forceBodyN[2])).toBeGreaterThan(0.8);
    });

    it('opposes angular rotation with rotational damping', () => {
      // Rolling at 2.0 rad/s (around Z axis)
      const damping = computeHydrodynamicDamping([0, 0, 0], [0, 0, 2.0]);
      expect(damping.torqueBodyNm[2]).toBeLessThan(0);
      expect(Math.abs(damping.torqueBodyNm[2])).toBeGreaterThan(0.01);
    });
  });

  describe('Vehicle 6-DOF Rigid Body State (body.ts)', () => {
    it('initializes vehicle with Candidate A mass properties and added mass', () => {
      const vehicle = new VehicleBody(defaultConfig.vehicle);

      expect(vehicle.dryMassKg).toBeCloseTo(0.1799, 3);
      expect(vehicle.effectiveMassBody[0]).toBeCloseTo(0.1799 + CANDIDATE_A_ADDED_MASS.swayKg, 3);
      expect(vehicle.effectiveMassBody[1]).toBeCloseTo(0.1799 + CANDIDATE_A_ADDED_MASS.heaveKg, 3);
      expect(vehicle.effectiveMassBody[2]).toBeCloseTo(0.1799 + CANDIDATE_A_ADDED_MASS.surgeKg, 3);
    });

    it('transforms vectors and points between local and world coordinates', () => {
      const vehicle = new VehicleBody(defaultConfig.vehicle);
      vehicle.position.set(0.5, -0.1, 0.2);

      // Rotate 90 deg around world Y (Yaw)
      vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

      // Local forward vector (Z) should transform to world vector (X)
      const localForward = new THREE.Vector3(0, 0, 1);
      const worldVec = vehicle.localToWorldVector(localForward);
      expect(worldVec.x).toBeCloseTo(1.0, 4);
      expect(worldVec.z).toBeCloseTo(0.0, 4);

      // Local origin transformed to world should equal vehicle position
      const worldPt = vehicle.localToWorldPoint(new THREE.Vector3(0, 0, 0));
      expect(worldPt.x).toBeCloseTo(0.5, 4);
      expect(worldPt.y).toBeCloseTo(-0.1, 4);
      expect(worldPt.z).toBeCloseTo(0.2, 4);
    });

    it('calculates Euler angles correctly', () => {
      const vehicle = new VehicleBody(defaultConfig.vehicle);
      const angles = vehicle.getEulerDegrees();
      expect(angles.rollDeg).toBeCloseTo(0, 1);
      expect(angles.pitchDeg).toBeCloseTo(0, 1);
      expect(angles.yawDeg).toBeCloseTo(0, 1);
    });
  });

  describe('6-DOF Symplectic Integrator (integrator.ts)', () => {
    it('causes unpowered positively-buoyant vehicle to rise towards the surface', () => {
      const vehicle = new VehicleBody(defaultConfig.vehicle);
      vehicle.reset([0, -0.15, 0]); // Start submerged at -0.15m

      const dt = 1.0 / 60.0;
      // Step 30 frames (0.5s) with no thruster inputs
      for (let i = 0; i < 30; i++) {
        stepVehicleRigidBody(vehicle, dt, [0, 0, 0]);
      }

      // Net positive buoyancy force (+0.197N) should have accelerated the vehicle upwards (+Y)
      expect(vehicle.velocity.y).toBeGreaterThan(0.05);
      expect(vehicle.position.y).toBeGreaterThan(-0.15);
    });

    it('accelerates forward under thruster surge input and reaches terminal velocity', () => {
      const vehicle = new VehicleBody(defaultConfig.vehicle);
      vehicle.reset([0, 0, -0.4]); // Start towards aft so it has runup distance

      const dt = 1.0 / 60.0;
      // Apply 3.0 N forward surge thrust for 50 steps (~0.83 seconds)
      for (let i = 0; i < 50; i++) {
        stepVehicleRigidBody(vehicle, dt, { surgeN: 3.0 });
      }

      // Forward velocity along world Z should be positive and bounded by hydrodynamic drag
      expect(vehicle.velocity.z).toBeGreaterThan(0.4);
      expect(vehicle.velocity.z).toBeLessThan(1.6); // Hydrodynamic drag prevents unbounded acceleration
    });

    it('self-rights a vehicle perturbed by 30 degrees of roll tilt', () => {
      const vehicle = new VehicleBody(defaultConfig.vehicle);
      vehicle.reset([0, 0, 0]);

      // Impose 30 deg initial roll perturbation
      vehicle.quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (30.0 * Math.PI) / 180.0
      );

      const dt = 1.0 / 60.0;
      // Step 60 frames (1 second) of free hydrostatic righting
      for (let i = 0; i < 60; i++) {
        stepVehicleRigidBody(vehicle, dt, [0, 0, 0]);
      }

      const angles = vehicle.getEulerDegrees();
      // Roll angle should be substantially reduced from 30 deg towards 0 deg
      expect(Math.abs(angles.rollDeg)).toBeLessThan(25.0);
    });

    it('enforces tank boundaries (floor clamping and surface limit)', () => {
      const vehicle = new VehicleBody(defaultConfig.vehicle);
      vehicle.reset([0, 0.20, 0]); // Near surface (+0.22m)

      const dt = 1.0 / 60.0;
      // Let vehicle float up to surface
      for (let i = 0; i < 120; i++) {
        stepVehicleRigidBody(vehicle, dt, [0, 0, 0]);
      }

      // Must not broach past surface (+0.22m)
      expect(vehicle.position.y).toBeLessThanOrEqual(DEFAULT_TANK_BOUNDARIES.surfaceElevationM + 1e-4);

      // Now drive full dive downwards (-5.0 N heave)
      for (let i = 0; i < 300; i++) {
        stepVehicleRigidBody(vehicle, dt, { heaveN: -5.0 });
      }

      // Must not penetrate floor (-0.25m)
      expect(vehicle.position.y).toBeGreaterThanOrEqual(DEFAULT_TANK_BOUNDARIES.floorElevationM - 1e-4);
    });
  });

  describe('3D Flow & Telemetry Overlays (overlays.ts)', () => {
    it('creates overlay groups and updates without errors', () => {
      const overlays = new FlowOverlays();
      expect(overlays.group.children.length).toBe(4);

      const vehicle = new VehicleBody(defaultConfig.vehicle);
      const propArray = new PropellerArray();
      const summary = propArray.evaluate([1.0, 1.0, 0.0]);

      expect(() => {
        overlays.update(vehicle, summary, 0.0);
      }).not.toThrow();

      expect(() => {
        overlays.dispose();
      }).not.toThrow();
    });
  });
});
