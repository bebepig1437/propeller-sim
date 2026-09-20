import * as THREE from 'three';

/**
 * Centralized frame mappings for every overlay (Phase 6 principal review,
 * Directive 4). All grid→world and body→world transforms MUST go through
 * these functions so a future rotated/tilted fluid plane can be introduced
 * in exactly one place.
 *
 * Grid frame (2D Eulerian, from CONVENTIONS.md §1.3):
 *   +gx downstream, +gy vertical, cell (0,0) at the bottom-left of the plane.
 *   The plane is the world X–Y plane at gridCenter.z (mid-tank).
 *
 * Body frame (marine SNAME, from CONVENTIONS.md §1.2):
 *   x = surge (forward), y = sway (starboard), z = heave (up).
 *   Mapped to three.js as (sway, heave, surge) = (x_three, y_three, z_three),
 *   i.e. stage forward is +Z. A 90° yaw of the BODY about its heave axis
 *   rotates surge onto sway in the marine frame before the three.js remap.
 */

/**
 * Maps grid cell coordinates (float, cell-center convention) to world space.
 * Cell (0,0) maps to the plane's lower-left corner; (W-1, H-1) to the
 * upper-right. Extent is ALWAYS derived as dims × gridDxM — never carried
 * as a separate redundant parameter (drift prevention, review non-blocking 4).
 */
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

/** Inverse of gridToWorld: world point (on the grid plane) → grid cell coords. */
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

/**
 * Marine body-frame POINT → three.js world. Applies the (surge, sway, heave)
 * → (x=sway, y=heave, z=surge) axis remap, then the vehicle quaternion and
 * position. `vehicle` may be null (unmounted overlays map around the origin).
 */
export function bodyPointToWorld(
  vehicle: { quaternion: THREE.Quaternion; position: THREE.Vector3 } | null,
  surge: number,
  sway: number,
  heave: number,
  out: THREE.Vector3
): THREE.Vector3 {
  out.set(sway, heave, surge);
  if (vehicle) {
    out.applyQuaternion(vehicle.quaternion).add(vehicle.position);
  }
  return out;
}

/** Marine body-frame DIRECTION → three.js world (rotation only, no translation). */
export function bodyDirToWorld(
  vehicle: { quaternion: THREE.Quaternion; position: THREE.Vector3 } | null,
  surge: number,
  sway: number,
  heave: number,
  out: THREE.Vector3
): THREE.Vector3 {
  out.set(sway, heave, surge);
  if (vehicle) {
    out.applyQuaternion(vehicle.quaternion);
  }
  return out;
}
