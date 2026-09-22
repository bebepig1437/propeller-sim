import type { FluidGrid } from './grid';
import type { BoundaryHandler } from './boundary';

export type AdvectionScheme = 'SEMI_LAGRANGIAN' | 'MACCORMACK';

let phiStarBuffer: Float32Array | null = null;
let phiStarStarBuffer: Float32Array | null = null;

function ensureMacCormackBuffers(size: number): { phiStar: Float32Array; phiStarStar: Float32Array } {
  if (!phiStarBuffer || phiStarBuffer.length < size) {
    phiStarBuffer = new Float32Array(size);
    phiStarStarBuffer = new Float32Array(size);
  }
  return { phiStar: phiStarBuffer, phiStarStar: phiStarStarBuffer! };
}

export function advectSemiLagrangian(
  grid: FluidGrid,
  sourceField: Float32Array,
  targetField: Float32Array,
  dt: number,
  boundary?: BoundaryHandler,
  dtMultiplier = 1.0
): void {
  const W = grid.width;
  const H = grid.height;
  const u = grid.u;
  const v = grid.v;
  const invDx = grid.invDx;
  const effectiveDt = dt * dtMultiplier;

  for (let y = 1; y < H - 1; y++) {
    const rowOffset = y * W;
    for (let x = 1; x < W - 1; x++) {
      const idx = rowOffset + x;

      const traceX = x - effectiveDt * u[idx] * invDx;
      const traceY = y - effectiveDt * v[idx] * invDx;

      targetField[idx] = grid.sampleBilinear(sourceField, traceX, traceY);
    }
  }

  if (boundary) {
    boundary.applyScalarBoundary(grid, targetField);
  }
}

export function advectMacCormack(
  grid: FluidGrid,
  sourceField: Float32Array,
  targetField: Float32Array,
  dt: number,
  boundary?: BoundaryHandler,
  isVelocity = false
): void {
  const W = grid.width;
  const H = grid.height;
  const u = grid.u;
  const v = grid.v;
  const invDx = grid.invDx;
  const { phiStar, phiStarStar } = ensureMacCormackBuffers(grid.size);

  advectSemiLagrangian(grid, sourceField, phiStar, dt, boundary, 1.0);

  advectSemiLagrangian(grid, phiStar, phiStarStar, dt, boundary, -1.0);

  for (let y = 1; y < H - 1; y++) {
    const rowOffset = y * W;
    for (let x = 1; x < W - 1; x++) {
      const idx = rowOffset + x;

      const corrected = phiStar[idx] + 0.5 * (sourceField[idx] - phiStarStar[idx]);

      const traceX = Math.max(0.5, Math.min(W - 1.5, x - dt * u[idx] * invDx));
      const traceY = Math.max(0.5, Math.min(H - 1.5, y - dt * v[idx] * invDx));

      const x0 = Math.floor(traceX);
      const y0 = Math.floor(traceY);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      const i00 = y0 * W + x0;
      const i10 = y0 * W + x1;
      const i01 = y1 * W + x0;
      const i11 = y1 * W + x1;

      const v00 = sourceField[i00];
      const v10 = sourceField[i10];
      const v01 = sourceField[i01];
      const v11 = sourceField[i11];

      const minVal = Math.min(v00, v10, v01, v11);
      const maxVal = Math.max(v00, v10, v01, v11);

      targetField[idx] = Math.max(minVal, Math.min(maxVal, corrected));
    }
  }

  if (boundary) {
    if (isVelocity) {
      boundary.applyVelocityBoundary(grid);
    } else {
      boundary.applyScalarBoundary(grid, targetField);
    }
  }
}

export function advect(
  scheme: AdvectionScheme,
  grid: FluidGrid,
  sourceField: Float32Array,
  targetField: Float32Array,
  dt: number,
  boundary?: BoundaryHandler,
  isVelocity = false
): void {
  if (scheme === 'MACCORMACK') {
    advectMacCormack(grid, sourceField, targetField, dt, boundary, isVelocity);
  } else {
    advectSemiLagrangian(grid, sourceField, targetField, dt, boundary, 1.0);
  }
}
