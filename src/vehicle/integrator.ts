import * as THREE from 'three';
import { VehicleBody } from './body';
import { computeHydrodynamicDamping } from './drag';
import { computeMetacentricRightingMoment } from './buoyancy';

export interface ThrusterInput6DOF {
  surgeN?: number;
  swayN?: number;
  heaveN?: number;
  rollNm?: number;
  pitchNm?: number;
  yawNm?: number;
  forceBody?: [number, number, number];  // Direct [X (Sway), Y (Heave), Z (Surge)]
  momentBody?: [number, number, number]; // Direct [X (Pitch), Y (Yaw), Z (Roll)]
}

export interface TankBoundaries {
  floorElevationM: number;   // default -0.25m
  surfaceElevationM: number; // default +0.22m
  radiusM: number;           // default 1.1m
}

export const DEFAULT_TANK_BOUNDARIES: TankBoundaries = {
  floorElevationM: -0.25,
  surfaceElevationM: 0.22,
  radiusM: 1.1
};

export interface IntegratorTelemetry {
  bodyVelocity: [number, number, number];
  bodyAcceleration: [number, number, number];
  dragForceN: [number, number, number];
  restoringTorqueNm: [number, number, number];
  isGrounded: boolean;
  isBroaching: boolean;
}

// Static reusable scratch objects for zero-allocation 60Hz physics stepping
const _scratchVecA = new THREE.Vector3();
const _scratchVecB = new THREE.Vector3();
const _scratchQuatInv = new THREE.Quaternion();
const _scratchRotDelta = new THREE.Quaternion();

/**
 * 6-DOF Symplectic rigid body dynamics integrator (Phase 6b).
 * Computes hydrodynamic damping, metacentric restoring moment, net positive buoyancy,
 * thrust forces/torques, and applies tank wall and floor boundary constraints.
 */
export function stepVehicleRigidBody(
  vehicle: VehicleBody,
  dt: number,
  thrusterInput: ThrusterInput6DOF | [number, number, number] = [0, 0, 0],
  thrusterMoments?: [number, number, number],
  tankBounds: TankBoundaries = DEFAULT_TANK_BOUNDARIES
): IntegratorTelemetry {
  // 1. Resolve thruster forces and moments in body frame [X (Sway), Y (Heave), Z (Surge)]
  let fThrustBodyX = 0;
  let fThrustBodyY = 0;
  let fThrustBodyZ = 0;
  let mThrustBodyX = 0;
  let mThrustBodyY = 0;
  let mThrustBodyZ = 0;

  if (Array.isArray(thrusterInput)) {
    // Array format [Surge, Sway, Heave] mapped to body axes [Sway (X), Heave (Y), Surge (Z)]
    fThrustBodyX = thrusterInput[1];
    fThrustBodyY = thrusterInput[2];
    fThrustBodyZ = thrusterInput[0];

    if (thrusterMoments) {
      mThrustBodyX = thrusterMoments[1];
      mThrustBodyY = thrusterMoments[2];
      mThrustBodyZ = thrusterMoments[0];
    }
  } else {
    if (thrusterInput.forceBody) {
      fThrustBodyX = thrusterInput.forceBody[0];
      fThrustBodyY = thrusterInput.forceBody[1];
      fThrustBodyZ = thrusterInput.forceBody[2];
    } else {
      fThrustBodyX = thrusterInput.swayN ?? 0;
      fThrustBodyY = thrusterInput.heaveN ?? 0;
      fThrustBodyZ = thrusterInput.surgeN ?? 0;
    }

    if (thrusterInput.momentBody) {
      mThrustBodyX = thrusterInput.momentBody[0];
      mThrustBodyY = thrusterInput.momentBody[1];
      mThrustBodyZ = thrusterInput.momentBody[2];
    } else {
      mThrustBodyX = thrusterInput.pitchNm ?? 0;
      mThrustBodyY = thrusterInput.yawNm ?? 0;
      mThrustBodyZ = thrusterInput.rollNm ?? 0;
    }
  }

  // 2. Body frame linear velocity: vBody = q^-1 * vWorld (using scratch objects)
  _scratchQuatInv.copy(vehicle.quaternion).invert();
  _scratchVecA.copy(vehicle.velocity).applyQuaternion(_scratchQuatInv);
  const vx = _scratchVecA.x;
  const vy = _scratchVecA.y;
  const vz = _scratchVecA.z;
  const wBody = vehicle.angularVelocity;

  // 3. Hydrodynamic damping forces and moments in body frame
  const damping = computeHydrodynamicDamping(
    [vx, vy, vz],
    [wBody.x, wBody.y, wBody.z],
    vehicle.dragCoefficients,
    vehicle.buoyancyForces.displacedMassKg / (vehicle.buoyancyForces.displacedMassKg / 1000.0)
  );

  // 4. Net buoyancy force in world frame (+Y is Up): transformed to body frame
  _scratchVecB.set(0, vehicle.buoyancyForces.netBuoyancyForceN, 0).applyQuaternion(_scratchQuatInv);
  const fNetBuoyBodyX = _scratchVecB.x;
  const fNetBuoyBodyY = _scratchVecB.y;
  const fNetBuoyBodyZ = _scratchVecB.z;

  // 5. Metacentric righting moment restoring upright orientation (tau = r_cob x F_buoy)
  const tauRightingWorldArr = computeMetacentricRightingMoment(
    vehicle.quaternion,
    vehicle.buoyancyForces
  );
  _scratchVecB.set(tauRightingWorldArr[0], tauRightingWorldArr[1], tauRightingWorldArr[2]).applyQuaternion(_scratchQuatInv);
  const tauRightingBodyX = _scratchVecB.x;
  const tauRightingBodyY = _scratchVecB.y;
  const tauRightingBodyZ = _scratchVecB.z;

  // 6. Net linear forces in body frame
  const fTotalBodyX = fThrustBodyX + damping.forceBodyN[0] + fNetBuoyBodyX;
  const fTotalBodyY = fThrustBodyY + damping.forceBodyN[1] + fNetBuoyBodyY;
  const fTotalBodyZ = fThrustBodyZ + damping.forceBodyN[2] + fNetBuoyBodyZ;

  // 7. Linear acceleration in body frame (using anisotropic effective mass = dry + added mass)
  const aBodyX = fTotalBodyX / vehicle.effectiveMassBody[0];
  const aBodyY = fTotalBodyY / vehicle.effectiveMassBody[1];
  const aBodyZ = fTotalBodyZ / vehicle.effectiveMassBody[2];

  // 8. Net angular torques in body frame
  const tauTotalBodyX = mThrustBodyX + damping.torqueBodyNm[0] + tauRightingBodyX;
  const tauTotalBodyY = mThrustBodyY + damping.torqueBodyNm[1] + tauRightingBodyY;
  const tauTotalBodyZ = mThrustBodyZ + damping.torqueBodyNm[2] + tauRightingBodyZ;

  // 9. Angular acceleration in body frame (using effective inertia = rigid + added inertia)
  const alphaBodyX = tauTotalBodyX / vehicle.effectiveInertiaBody[0];
  const alphaBodyY = tauTotalBodyY / vehicle.effectiveInertiaBody[1];
  const alphaBodyZ = tauTotalBodyZ / vehicle.effectiveInertiaBody[2];

  // 10. Symplectic Euler Integration: Update Angular Velocity & Orientation
  vehicle.angularVelocity.x += alphaBodyX * dt;
  vehicle.angularVelocity.y += alphaBodyY * dt;
  vehicle.angularVelocity.z += alphaBodyZ * dt;

  const wMag = vehicle.angularVelocity.length();
  if (wMag > 1e-6) {
    _scratchVecB.copy(vehicle.angularVelocity).divideScalar(wMag);
    _scratchRotDelta.setFromAxisAngle(_scratchVecB, wMag * dt);
    vehicle.quaternion.multiply(_scratchRotDelta);
    vehicle.quaternion.normalize();
  }

  // 11. Symplectic Euler Integration: Update Linear Velocity & Position in World Frame
  _scratchVecB.set(aBodyX, aBodyY, aBodyZ).applyQuaternion(vehicle.quaternion);
  vehicle.velocity.x += _scratchVecB.x * dt;
  vehicle.velocity.y += _scratchVecB.y * dt;
  vehicle.velocity.z += _scratchVecB.z * dt;

  vehicle.position.x += vehicle.velocity.x * dt;
  vehicle.position.y += vehicle.velocity.y * dt;
  vehicle.position.z += vehicle.velocity.z * dt;

  // 12. Tank Environmental Boundaries (Clamping & Contact Damping)
  let isGrounded = false;
  let isBroaching = false;

  // Floor collision (depth y = -0.25m)
  if (vehicle.position.y <= tankBounds.floorElevationM) {
    vehicle.position.y = tankBounds.floorElevationM;
    isGrounded = true;
    if (vehicle.velocity.y < 0) {
      vehicle.velocity.y = 0;
    }
    // Ground friction contact damping
    vehicle.velocity.x *= Math.max(0, 1 - 8.0 * dt);
    vehicle.velocity.z *= Math.max(0, 1 - 8.0 * dt);
    vehicle.angularVelocity.multiplyScalar(Math.max(0, 1 - 10.0 * dt));
  }

  // Water free surface (elevation y = +0.22m)
  if (vehicle.position.y >= tankBounds.surfaceElevationM) {
    vehicle.position.y = tankBounds.surfaceElevationM;
    isBroaching = true;
    if (vehicle.velocity.y > 0) {
      vehicle.velocity.y = 0;
    }
    vehicle.velocity.x *= Math.max(0, 1 - 2.0 * dt);
    vehicle.velocity.z *= Math.max(0, 1 - 2.0 * dt);
  }

  // Horizontal radial tank walls
  const rHoriz = Math.hypot(vehicle.position.x, vehicle.position.z);
  if (rHoriz > tankBounds.radiusM) {
    const scale = tankBounds.radiusM / rHoriz;
    vehicle.position.x *= scale;
    vehicle.position.z *= scale;
    // Damp radial component of velocity
    const normalX = vehicle.position.x / tankBounds.radiusM;
    const normalZ = vehicle.position.z / tankBounds.radiusM;
    const vDotN = vehicle.velocity.x * normalX + vehicle.velocity.z * normalZ;
    if (vDotN > 0) {
      vehicle.velocity.x -= vDotN * normalX;
      vehicle.velocity.z -= vDotN * normalZ;
    }
  }

  return {
    bodyVelocity: [vx, vy, vz],
    bodyAcceleration: [aBodyX, aBodyY, aBodyZ],
    dragForceN: damping.forceBodyN,
    restoringTorqueNm: [tauRightingBodyX, tauRightingBodyY, tauRightingBodyZ],
    isGrounded,
    isBroaching
  };
}
