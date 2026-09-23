// Fedkiw et al.: Vorticity confinement to counteract numerical dissipation
import type { FluidGrid } from './grid';

let curlMagBuffer: Float32Array | null = null;

function ensureMagBuffer(size: number): Float32Array {
  if (!curlMagBuffer || curlMagBuffer.length < size) {
    curlMagBuffer = new Float32Array(size);
  }
  return curlMagBuffer;
}

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

export const VORTICITY_GRADIENT_EPSILON = 1e-7;

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

  for (let i = 0; i < grid.size; i++) {
    mag[i] = Math.abs(curl[i]);
  }

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
        continue;
      }

      const nx = gradX / gradMag;
      const ny = gradY / gradMag;

      u[idx] += factor * (ny * omega);
      v[idx] -= factor * (nx * omega);
    }
  }
}
