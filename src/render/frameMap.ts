import * as THREE from 'three';
import { marineToThree } from '../math/vectors';

export function gridToWorld(
  gx: number,
  gy: number,
  gridWidth: number,
  gridHeight: number,
  gridDxM: number,
  gridCenter: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 {
  const W = Math.max(1, gridWidth);
  const H = Math.max(1, gridHeight);
  out.set(
    gridCenter.x + (gx / Math.max(1, W - 1) - 0.5) * W * gridDxM,
    gridCenter.y + (gy / Math.max(1, H - 1) - 0.5) * H * gridDxM,
    gridCenter.z
  );
  return out;
}

export function worldToGrid(
  wx: number,
  wy: number,
  gridWidth: number,
  gridHeight: number,
  gridDxM: number,
  gridCenter: THREE.Vector3,
  out: { x: number; y: number }
): { x: number; y: number } {
  const W = Math.max(1, gridWidth);
  const H = Math.max(1, gridHeight);
  out.x = ((wx - gridCenter.x) / (W * gridDxM) + 0.5) * Math.max(1, W - 1);
  out.y = ((wy - gridCenter.y) / (H * gridDxM) + 0.5) * Math.max(1, H - 1);
  return out;
}

export function bodyPointToWorld(
  vehicle: { quaternion: THREE.Quaternion; position: THREE.Vector3 } | null,
  surge: number,
  sway: number,
  heave: number,
  out: THREE.Vector3
): THREE.Vector3 {
  marineToThree(surge, sway, heave, out);
  if (vehicle) {
    out.applyQuaternion(vehicle.quaternion).add(vehicle.position);
  }
  return out;
}

export function bodyDirToWorld(
  vehicle: { quaternion: THREE.Quaternion; position: THREE.Vector3 } | null,
  surge: number,
  sway: number,
  heave: number,
  out: THREE.Vector3
): THREE.Vector3 {
  marineToThree(surge, sway, heave, out);
  if (vehicle) {
    out.applyQuaternion(vehicle.quaternion);
  }
  return out;
}
