import * as THREE from 'three';

export type Marine3 = [number, number, number];
export type Marine6 = [number, number, number, number, number, number];
export type MarineAxis = 0 | 1 | 2;

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SpatialInertia {
  translationalKg: readonly [number, number, number];
  rigidRotationalKgM2: readonly [number, number, number];
  addedTranslationalKg: readonly [number, number, number];
  addedRotationalKgM2: readonly [number, number, number];
}

const scratchQuat = new THREE.Quaternion();
const scratchVec = new THREE.Vector3();

export function vec3Dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: readonly number[], b: readonly number[], out: number[]): void {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
}

export function vec3NormSq(v: readonly number[]): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

export function vec3Norm(v: readonly number[]): number {
  return Math.sqrt(vec3NormSq(v));
}

export function vec3Normalize(v: readonly number[], out: number[]): void {
  const length = vec3Norm(v);
  if (length > 1e-12) {
    const inv = 1.0 / length;
    out[0] = v[0] * inv;
    out[1] = v[1] * inv;
    out[2] = v[2] * inv;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
}

export function vec3Add(a: readonly number[], b: readonly number[], out: number[]): void {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
}

export function vec3Sub(a: readonly number[], b: readonly number[], out: number[]): void {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
}

export function vec3Scale(v: readonly number[], scale: number, out: number[]): void {
  out[0] = v[0] * scale;
  out[1] = v[1] * scale;
  out[2] = v[2] * scale;
}

export function vec3Set(out: number[], x: number, y: number, z: number): void {
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

export function vec3Copy(out: number[], src: readonly number[]): void {
  out[0] = src[0];
  out[1] = src[1];
  out[2] = src[2];
}

export function marineToThree(surge: number, sway: number, heave: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(sway, heave, surge);
  return out;
}

export function threeToMarine(v: Vector3Like, out: Marine3): Marine3 {
  out[0] = v.z;
  out[1] = v.x;
  out[2] = v.y;
  return out;
}

export function marineToThreeVector(v: Marine3, out: THREE.Vector3): THREE.Vector3 {
  return marineToThree(v[0], v[1], v[2], out);
}

export function marineAngularToThree(p: number, q: number, r: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(q, r, p);
  return out;
}

export function threeAngularToMarine(w: Vector3Like, out: Marine3): Marine3 {
  out[0] = w.z;
  out[1] = w.x;
  out[2] = w.y;
  return out;
}

export function worldToBodyMarine(world: THREE.Vector3, quaternion: THREE.Quaternion, out: Marine3): Marine3 {
  scratchQuat.copy(quaternion).invert();
  scratchVec.copy(world).applyQuaternion(scratchQuat);
  return threeToMarine(scratchVec, out);
}

export function bodyToWorldMarine(marine: Marine3, quaternion: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  marineToThree(marine[0], marine[1], marine[2], out);
  return out.applyQuaternion(quaternion);
}

export function coriolisBodyForce(spatial: SpatialInertia, nu: Marine6, out: Marine6): Marine6 {
  const [u, v, w, p, q, r] = nu;
  const [m1, m2, m3] = spatial.translationalKg;
  const [i1, i2, i3] = spatial.rigidRotationalKgM2;
  const [a1, a2, a3] = spatial.addedTranslationalKg;
  const [ap, aq, ar] = spatial.addedRotationalKgM2;

  out[0] = q * (m3 * w) - r * (m2 * v);
  out[1] = r * (m1 * u) - p * (m3 * w);
  out[2] = p * (m2 * v) - q * (m1 * u);

  out[3] = q * (i3 * r) - r * (i2 * q) + (v * (a3 * w) - w * (a2 * v)) + (q * (ar * r) - r * (aq * q));
  out[4] = r * (i1 * p) - p * (i3 * r) + (w * (a1 * u) - u * (a3 * w)) + (r * (ap * p) - p * (ar * r));
  out[5] = p * (i2 * q) - q * (i1 * p) + (u * (a2 * v) - v * (a1 * u)) + (p * (aq * q) - q * (ap * p));

  return out;
}

export function coriolisPower(spatial: SpatialInertia, nu: Marine6): number {
  const force: Marine6 = [0, 0, 0, 0, 0, 0];
  coriolisBodyForce(spatial, nu, force);
  let power = 0;
  for (let i = 0; i < 6; i++) {
    power += force[i] * nu[i];
  }
  return power;
}
