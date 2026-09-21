import * as THREE from 'three';
import {
  VehicleBody,
  coriolisBodyForce,
  marineAngularToThree,
  threeToMarine,
  type Marine3,
  type Marine6
} from './body';
import { computeHydrodynamicDamping } from './drag';
import { metacentricRestoringTorqueBodyMarine } from './buoyancy';

export interface ThrusterInput6DOF {
  surgeN?: number;
  swayN?: number;
  heaveN?: number;
  rollNm?: number;
  pitchNm?: number;
  yawNm?: number;
  forceBodyMarine?: Marine3;
  momentBodyMarine?: Marine3;
}

export interface TankBoundaries {
  floorElevationM: number;
  surfaceElevationM: number;
  radiusM: number;
}

export const DEFAULT_TANK_BOUNDARIES: TankBoundaries = {
  floorElevationM: -0.25,
  surfaceElevationM: 0.22,
  radiusM: 1.1
};

export interface TetherParams {
  attached: boolean;
  anchorWorld: Marine3;
  stiffnessNm: number;
  dampingNPerMs: number;
}

export interface IntegratorTelemetry {
  bodyVelocityMs: Marine3;
  bodyAccelerationMs2: Marine3;
  dragForceBodyN: Marine3;
  coriolisForceBodyN: Marine6;
  restoringTorqueBodyNm: Marine3;
  tetherForceBodyN: Marine3;
  appliedForceBodyN: Marine3;
  appliedTorqueBodyNm: Marine3;
  contactNormalWorld: Marine3;
  isGrounded: boolean;
  isBroaching: boolean;
  isWallContact: boolean;
  angularRateClamped: boolean;
}

const ZERO_MARINE3: Marine3 = [0, 0, 0];

const DETACHED_TETHER: TetherParams = {
  attached: false,
  anchorWorld: [0, 0, 0],
  stiffnessNm: 0,
  dampingNPerMs: 0
};

const scratchWorldVelocity = new THREE.Vector3();
const scratchBodyVector = new THREE.Vector3();
const scratchInverseQuaternion = new THREE.Quaternion();
const scratchRotationDelta = new THREE.Quaternion();
const scratchAxis = new THREE.Vector3();

const nu: Marine6 = [0, 0, 0, 0, 0, 0];
const nuDot: Marine6 = [0, 0, 0, 0, 0, 0];
const coriolisForce: Marine6 = [0, 0, 0, 0, 0, 0];
const angularVelocityBody: Marine3 = [0, 0, 0];
const ambientFlowBody: Marine3 = [0, 0, 0];
const relativeFlowBody: Marine3 = [0, 0, 0];
const forceBody: Marine3 = [0, 0, 0];
const torqueBody: Marine3 = [0, 0, 0];
const buoyancyForceBody: Marine3 = [0, 0, 0];
const tetherForceBody: Marine3 = [0, 0, 0];
const contactNormalWorld: Marine3 = [0, 0, 0];
const restoringTorqueBody: Marine3 = [0, 0, 0];

const thrusterInputMarine: { forceMarine: Marine3; momentMarine: Marine3 } = {
  forceMarine: [0, 0, 0],
  momentMarine: [0, 0, 0]
};

const telemetry: IntegratorTelemetry = {
  bodyVelocityMs: [0, 0, 0],
  bodyAccelerationMs2: [0, 0, 0],
  dragForceBodyN: [0, 0, 0],
  coriolisForceBodyN: [0, 0, 0, 0, 0, 0],
  restoringTorqueBodyNm: [0, 0, 0],
  tetherForceBodyN: [0, 0, 0],
  appliedForceBodyN: [0, 0, 0],
  appliedTorqueBodyNm: [0, 0, 0],
  contactNormalWorld: [0, 0, 0],
  isGrounded: false,
  isBroaching: false,
  isWallContact: false,
  angularRateClamped: false
};

function worldToBodyMarine(world: THREE.Vector3, quaternion: THREE.Quaternion, out: Marine3): Marine3 {
  scratchInverseQuaternion.copy(quaternion).invert();
  scratchBodyVector.copy(world).applyQuaternion(scratchInverseQuaternion);
  return threeToMarine(scratchBodyVector, out);
}

export function thrusterInputToMarine(
  thrusterInput: ThrusterInput6DOF | Marine3 = ZERO_MARINE3,
  thrusterMoments?: Marine3
): { forceMarine: Marine3; momentMarine: Marine3 } {
  const result = thrusterInputMarine;

  if (Array.isArray(thrusterInput)) {
    result.forceMarine[0] = thrusterInput[2];
    result.forceMarine[1] = thrusterInput[0];
    result.forceMarine[2] = thrusterInput[1];
    result.momentMarine[0] = thrusterMoments ? thrusterMoments[2] : 0;
    result.momentMarine[1] = thrusterMoments ? thrusterMoments[0] : 0;
    result.momentMarine[2] = thrusterMoments ? thrusterMoments[1] : 0;
    return result;
  }

  const input = thrusterInput as ThrusterInput6DOF;
  if (input.forceBodyMarine) {
    result.forceMarine[0] = input.forceBodyMarine[0];
    result.forceMarine[1] = input.forceBodyMarine[1];
    result.forceMarine[2] = input.forceBodyMarine[2];
  } else {
    result.forceMarine[0] = input.surgeN ?? 0;
    result.forceMarine[1] = input.swayN ?? 0;
    result.forceMarine[2] = input.heaveN ?? 0;
  }

  if (input.momentBodyMarine) {
    result.momentMarine[0] = input.momentBodyMarine[0];
    result.momentMarine[1] = input.momentBodyMarine[1];
    result.momentMarine[2] = input.momentBodyMarine[2];
  } else {
    result.momentMarine[0] = input.rollNm ?? 0;
    result.momentMarine[1] = input.pitchNm ?? 0;
    result.momentMarine[2] = input.yawNm ?? 0;
  }

  return result;
}

export function stepVehicleRigidBody(
  vehicle: VehicleBody,
  dt: number,
  thrusterInput: ThrusterInput6DOF | Marine3 = ZERO_MARINE3,
  thrusterMoments?: Marine3,
  bounds: TankBoundaries = DEFAULT_TANK_BOUNDARIES,
  tether: TetherParams = DETACHED_TETHER,
  ambientFlowWorld?: Marine3
): IntegratorTelemetry {
  const thrust = thrusterInputToMarine(thrusterInput, thrusterMoments);
  const spatial = vehicle.spatialMass;

  for (let axis = 0; axis < 3; axis++) {
    nu[axis] = vehicle.velocityBodyMs[axis];
    nu[axis + 3] = vehicle.angularVelocityBodyRadS[axis];
    angularVelocityBody[axis] = nu[axis + 3];
    relativeFlowBody[axis] = nu[axis];
  }

  if (ambientFlowWorld) {
    scratchWorldVelocity.set(ambientFlowWorld[0], ambientFlowWorld[1], ambientFlowWorld[2]);
    worldToBodyMarine(scratchWorldVelocity, vehicle.quaternion, ambientFlowBody);
    for (let axis = 0; axis < 3; axis++) relativeFlowBody[axis] -= ambientFlowBody[axis];
  }

  const damping = computeHydrodynamicDamping(relativeFlowBody, angularVelocityBody, vehicle.dragCoefficients);
  metacentricRestoringTorqueBodyMarine(vehicle.quaternion, vehicle.buoyancyForces, restoringTorqueBody);

  scratchWorldVelocity.set(0, vehicle.buoyancyForces.netBuoyancyForceN, 0);
  worldToBodyMarine(scratchWorldVelocity, vehicle.quaternion, buoyancyForceBody);

  tetherForceBody[0] = 0;
  tetherForceBody[1] = 0;
  tetherForceBody[2] = 0;
  if (tether.attached) {
    vehicle.worldVelocity(scratchWorldVelocity);
    scratchBodyVector.set(
      -tether.stiffnessNm * (vehicle.position.x - tether.anchorWorld[0]) - tether.dampingNPerMs * scratchWorldVelocity.x,
      -tether.stiffnessNm * (vehicle.position.y - tether.anchorWorld[1]) - tether.dampingNPerMs * scratchWorldVelocity.y,
      -tether.stiffnessNm * (vehicle.position.z - tether.anchorWorld[2]) - tether.dampingNPerMs * scratchWorldVelocity.z
    );
    worldToBodyMarine(scratchBodyVector, vehicle.quaternion, tetherForceBody);
  }

  coriolisBodyForce(spatial, nu, coriolisForce);

  for (let axis = 0; axis < 3; axis++) {
    forceBody[axis] = thrust.forceMarine[axis] + damping.forceBodyN[axis] + buoyancyForceBody[axis] + tetherForceBody[axis];
    torqueBody[axis] = thrust.momentMarine[axis] + damping.torqueBodyNm[axis] + restoringTorqueBody[axis];
  }

  for (let axis = 0; axis < 3; axis++) {
    nuDot[axis] = (forceBody[axis] - coriolisForce[axis]) / spatial.translationalKg[axis];
    nuDot[axis + 3] = (torqueBody[axis] - coriolisForce[axis + 3]) / spatial.rotationalKgM2[axis];
  }

  for (let index = 0; index < 6; index++) nu[index] += nuDot[index] * dt;

  for (let axis = 0; axis < 3; axis++) {
    vehicle.velocityBodyMs[axis] = nu[axis];
    vehicle.angularVelocityBodyRadS[axis] = nu[axis + 3];
  }

  const angularRateClamped = vehicle.clampAngularRate();

  marineAngularToThree(
    vehicle.angularVelocityBodyRadS[0],
    vehicle.angularVelocityBodyRadS[1],
    vehicle.angularVelocityBodyRadS[2],
    scratchBodyVector
  );
  const angularSpeed = scratchBodyVector.length();
  if (angularSpeed > 1e-12) {
    scratchAxis.copy(scratchBodyVector).divideScalar(angularSpeed);
    scratchRotationDelta.setFromAxisAngle(scratchAxis, angularSpeed * dt);
    vehicle.quaternion.multiply(scratchRotationDelta).normalize();
  }

  vehicle.worldVelocity(scratchWorldVelocity);
  vehicle.position.addScaledVector(scratchWorldVelocity, dt);

  contactNormalWorld[0] = 0;
  contactNormalWorld[1] = 0;
  contactNormalWorld[2] = 0;
  let isGrounded = false;
  let isBroaching = false;
  let isWallContact = false;

  const hasContact =
    vehicle.position.y <= bounds.floorElevationM ||
    vehicle.position.y >= bounds.surfaceElevationM ||
    Math.hypot(vehicle.position.x, vehicle.position.z) > bounds.radiusM;

  if (hasContact) {
    vehicle.worldVelocity(scratchWorldVelocity);

    if (vehicle.position.y <= bounds.floorElevationM) {
      vehicle.position.y = bounds.floorElevationM;
      isGrounded = true;
      if (scratchWorldVelocity.y < 0) scratchWorldVelocity.y = 0;
      scratchWorldVelocity.x *= Math.max(0, 1 - 8 * dt);
      scratchWorldVelocity.z *= Math.max(0, 1 - 8 * dt);
      contactNormalWorld[1] = 1;
      const spinRetention = Math.max(0, 1 - 10 * dt);
      for (let axis = 0; axis < 3; axis++) vehicle.angularVelocityBodyRadS[axis] *= spinRetention;
    }

    if (vehicle.position.y >= bounds.surfaceElevationM) {
      vehicle.position.y = bounds.surfaceElevationM;
      isBroaching = true;
      if (scratchWorldVelocity.y > 0) scratchWorldVelocity.y = 0;
      scratchWorldVelocity.x *= Math.max(0, 1 - 2 * dt);
      scratchWorldVelocity.z *= Math.max(0, 1 - 2 * dt);
      contactNormalWorld[1] = -1;
    }

    const radius = Math.hypot(vehicle.position.x, vehicle.position.z);
    if (radius > bounds.radiusM) {
      const scale = bounds.radiusM / radius;
      vehicle.position.x *= scale;
      vehicle.position.z *= scale;
      const normalX = vehicle.position.x / bounds.radiusM;
      const normalZ = vehicle.position.z / bounds.radiusM;
      const outward = scratchWorldVelocity.x * normalX + scratchWorldVelocity.z * normalZ;
      if (outward > 0) {
        scratchWorldVelocity.x -= outward * normalX;
        scratchWorldVelocity.z -= outward * normalZ;
      }
      contactNormalWorld[0] = -normalX;
      contactNormalWorld[2] = -normalZ;
      isWallContact = true;
    }

    vehicle.setBodyVelocityFromWorld(scratchWorldVelocity);
  }

  for (let axis = 0; axis < 3; axis++) {
    telemetry.bodyVelocityMs[axis] = vehicle.velocityBodyMs[axis];
    telemetry.bodyAccelerationMs2[axis] = nuDot[axis];
    telemetry.dragForceBodyN[axis] = damping.forceBodyN[axis];
    telemetry.restoringTorqueBodyNm[axis] = restoringTorqueBody[axis];
    telemetry.tetherForceBodyN[axis] = tetherForceBody[axis];
    telemetry.appliedForceBodyN[axis] = forceBody[axis];
    telemetry.appliedTorqueBodyNm[axis] = torqueBody[axis];
    telemetry.contactNormalWorld[axis] = contactNormalWorld[axis];
  }
  for (let index = 0; index < 6; index++) telemetry.coriolisForceBodyN[index] = coriolisForce[index];

  telemetry.isGrounded = isGrounded;
  telemetry.isBroaching = isBroaching;
  telemetry.isWallContact = isWallContact;
  telemetry.angularRateClamped = angularRateClamped;

  return telemetry;
}

