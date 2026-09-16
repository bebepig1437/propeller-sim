/**
 * Vorticity & Confinement Module (CPU Reference)
 *
 * Citation:
 * Fedkiw, R., Stam, J., & Jensen, H. W. (2001). "Visual Simulation of Smoke".
 * Proceedings of the 28th Annual Conference on Computer Graphics and Interactive Techniques (SIGGRAPH '01),
 * ACM, pp. 15–22. https://doi.org/10.1145/383259.383260
 *
 * Vorticity Confinement Formulation:
 * 1. omega = curl(u) = (dv/dx - du/dy)
 * 2. N = grad(|omega|) / |grad(|omega|)|
 * 3. Force = eps * h * (N x omega)
 * where:
 *   eps   = dimensionless vorticity confinement strength parameter
 *   h     = cell spacing (dx)
 *   N     = unit normal vector pointing toward local vorticity concentration peaks
 *   omega = vorticity scalar/vector
 */

import type { FluidGrid } from './grid';

let curlMagBuffer: Float32Array | null = null;

function ensureMagBuffer(size: number): Float32Array {
  if (!curlMagBuffer || curlMagBuffer.length < size) {
    curlMagBuffer = new Float32Array(size);
  }
  return curlMagBuffer;
}

/**
 * Computes curl (vorticity omega = dv/dx - du/dy) on the grid.
 */
export function computeCurl(grid: FluidGrid): void {
  const W = grid.width;
  const H = grid.height;
  const u = grid.u;
  const v = grid.v;
  const curl = grid.curl;
  const halfInvDx = 0.5 * grid.invDx;

  for (let y = 1; y < H - 1; y++) {
    const rowOffset = y * W;
    for (let x = 1; x < W - 1; x++) {
      const idx = rowOffset + x;
      const dv_dx = (v[idx + 1] - v[idx - 1]) * halfInvDx;
      const du_dy = (u[idx + W] - u[idx - W]) * halfInvDx;
      curl[idx] = dv_dx - du_dy;
    }
  }
}

/**
 * Documented numerical threshold below which vorticity gradient is considered
 * zero to prevent division by zero in irrotational flow regions.
 */
export const VORTICITY_GRADIENT_EPSILON = 1e-7;

/**
 * Fedkiw et al. (2001) Vorticity Confinement:
 * Re-injects energy lost to numerical dissipation at small eddy scales.
 */
export function applyVorticityConfinement(
  grid: FluidGrid,
  dt: number,
  strength = 4.0
): void {
  if (strength <= 0) return;

  computeCurl(grid);

  const W = grid.width;
  const H = grid.height;
  const curl = grid.curl;
  const mag = ensureMagBuffer(grid.size);
  const halfInvDx = 0.5 * grid.invDx;

  // 1. Compute curl magnitude |omega|
  for (let i = 0; i < grid.size; i++) {
    mag[i] = Math.abs(curl[i]);
  }

  // 2. Compute gradient of magnitude N = grad(|omega|) / |grad(|omega|)|
  // and apply force F_vort = strength * dx * (N x omega)
  const u = grid.u;
  const v = grid.v;
  const factor = strength * grid.dx * dt;

  for (let y = 1; y < H - 1; y++) {
    const rowOffset = y * W;
    for (let x = 1; x < W - 1; x++) {
      const idx = rowOffset + x;
      const omega = curl[idx];

      const gradX = (mag[idx + 1] - mag[idx - 1]) * halfInvDx;
      const gradY = (mag[idx + W] - mag[idx - W]) * halfInvDx;

      const gradMag = Math.hypot(gradX, gradY);
      if (gradMag < VORTICITY_GRADIENT_EPSILON || Math.abs(omega) < 1e-7) {
        continue; // Exact zero confinement force in irrotational field
      }

      const nx = gradX / gradMag;
      const ny = gradY / gradMag;

      // 2D Cross product: N x (0, 0, omega) = (ny * omega, -nx * omega)
      u[idx] += factor * (ny * omega);
      v[idx] -= factor * (nx * omega);
    }
  }
}
