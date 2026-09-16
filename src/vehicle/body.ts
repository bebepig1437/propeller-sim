import * as THREE from 'three';
import type { SimConfig } from '../core/config';
import { calculateBuoyancy, BuoyancyForces } from './buoyancy';
import { CANDIDATE_A_DRAG, CANDIDATE_A_ADDED_MASS, DragCoefficients6DOF, AddedMass6DOF } from './drag';

export interface VehicleState {
  position: [number, number, number];       // World position [x, y, z] (m)
  velocity: [number, number, number];       // World linear velocity [vx, vy, vz] (m/s)
  quaternion: [number, number, number, number]; // World orientation quaternion [x, y, z, w]
  angularVelocity: [number, number, number]; // Body angular velocity [wx, wy, wz] (rad/s)
}

export class VehicleBody {
  // 6-DOF Dynamical State
  public position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public quaternion: THREE.Quaternion = new THREE.Quaternion(0, 0, 0, 1);
  public angularVelocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0); // [wx (pitch), wy (yaw), wz (roll)]

  // Physical mass properties
  public dryMassKg: number;
  public displacedMassKg: number;
  public buoyancyForces: BuoyancyForces;
  public inertiaTensorBody: [number, number, number]; // [Ixx (Pitch), Iyy (Yaw), Izz (Roll)] in kg*m^2
  public addedMass: AddedMass6DOF;
  public dragCoefficients: DragCoefficients6DOF;

  // Effective inertial properties including hydrodynamic added mass
  public effectiveMassBody: [number, number, number]; // [m_eff_sway_X, m_eff_heave_Y, m_eff_surge_Z]
  public effectiveInertiaBody: [number, number, number]; // [I_eff_pitch_X, I_eff_yaw_Y, I_eff_roll_Z]

  constructor(config: SimConfig['vehicle'], propMassG = 1.80) {
    this.buoyancyForces = calculateBuoyancy(config, propMassG);
    this.dryMassKg = this.buoyancyForces.dryMassKg;
    this.displacedMassKg = this.buoyancyForces.displacedMassKg;

    // Approximate baseline rigid body inertia for SeaPerch rectangular frame (0.20m x 0.16m x 0.14m)
    // I = (1/12) * M * (a^2 + b^2)
    const m = this.dryMassKg;
    const l = 0.20; // Length along Surge (Z)
    const w = 0.16; // Width along Sway (X)
    const h = 0.14; // Height along Heave (Y)

    const Ixx = (1 / 12) * m * (h * h + l * l); // Pitch inertia around X
    const Iyy = (1 / 12) * m * (w * w + l * l); // Yaw inertia around Y
    const Izz = (1 / 12) * m * (w * w + h * h); // Roll inertia around Z
    this.inertiaTensorBody = [Ixx, Iyy, Izz];

    this.addedMass = { ...CANDIDATE_A_ADDED_MASS };
    this.dragCoefficients = { ...CANDIDATE_A_DRAG };

    // Body axes: X = Sway, Y = Heave, Z = Surge
    this.effectiveMassBody = [
      this.dryMassKg + this.addedMass.swayKg,
      this.dryMassKg + this.addedMass.heaveKg,
      this.dryMassKg + this.addedMass.surgeKg
    ];

    this.effectiveInertiaBody = [
      Ixx + this.addedMass.pitchKgM2,
      Iyy + this.addedMass.yawKgM2,
      Izz + this.addedMass.rollKgM2
    ];
  }

  /**
   * Resets vehicle dynamical state to initial conditions.
   */
  public reset(pos: [number, number, number] = [0, 0, 0]): void {
    this.position.set(...pos);
    this.velocity.set(0, 0, 0);
    this.quaternion.set(0, 0, 0, 1);
    this.angularVelocity.set(0, 0, 0);
  }

  /**
   * Computes linear velocity in body frame: v_body = q^-1 * v_world.
   * Body vector: [vx (Sway), vy (Heave), vz (Surge)].
   */
  public getBodyVelocity(): THREE.Vector3 {
    const invQ = this.quaternion.clone().invert();
    return this.velocity.clone().applyQuaternion(invQ);
  }

  /**
   * Transforms a vector from local body frame to world frame.
   */
  public localToWorldVector(v: THREE.Vector3): THREE.Vector3 {
    return v.clone().applyQuaternion(this.quaternion);
  }

  /**
   * Transforms a vector from world frame to local body frame.
   */
  public worldToLocalVector(v: THREE.Vector3): THREE.Vector3 {
    const invQ = this.quaternion.clone().invert();
    return v.clone().applyQuaternion(invQ);
  }

  /**
   * Transforms a point from local body frame to world coordinates.
   */
  public localToWorldPoint(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().applyQuaternion(this.quaternion).add(this.position);
  }

  /**
   * Extracts Euler angles in degrees (roll around Z, pitch around X, yaw around Y).
   */
  public getEulerDegrees(): { rollDeg: number; pitchDeg: number; yawDeg: number } {
    const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    const toDeg = 180.0 / Math.PI;
    return {
      pitchDeg: euler.x * toDeg,
      yawDeg: euler.y * toDeg,
      rollDeg: euler.z * toDeg
    };
  }

  /**
   * Exports a snapshot of the current 6-DOF state.
   */
  public getState(): VehicleState {
    return {
      position: [this.position.x, this.position.y, this.position.z],
      velocity: [this.velocity.x, this.velocity.y, this.velocity.z],
      quaternion: [this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w],
      angularVelocity: [this.angularVelocity.x, this.angularVelocity.y, this.angularVelocity.z]
    };
  }
}
