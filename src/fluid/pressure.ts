import type { FluidGrid } from './grid';
import type { BoundaryHandler } from './boundary';

export interface PressureSolveResult {
  iterationsRun: number;
  finalResidual: number;
  residuals: number[];
}

/**
 * Computes velocity divergence: div = du/dx + dv/dy using central differences.
 */
export function computeDivergence(grid: FluidGrid, boundary?: BoundaryHandler): void {
  const W = grid.width;
  const H = grid.height;
  const u = grid.u;
  const v = grid.v;
  const div = grid.div;
  const halfInvDx = 0.5 * grid.invDx;

  for (let y = 1; y < H - 1; y++) {
    const rowOffset = y * W;
    for (let x = 1; x < W - 1; x++) {
      const idx = rowOffset + x;
      div[idx] = ((u[idx + 1] - u[idx - 1]) + (v[idx + W] - v[idx - W])) * halfInvDx;
    }
  }

  if (boundary) {
    boundary.applyScalarBoundary(grid, div);
  }
}

/**
 * Computes maximum absolute divergence on the interior grid.
 */
export function getMaxDivergence(grid: FluidGrid, margin = 2): number {
  const W = grid.width;
  const H = grid.height;
  const div = grid.div;
  let maxVal = 0;

  for (let y = margin; y < H - margin; y++) {
    const rowOffset = y * W;
    for (let x = margin; x < W - margin; x++) {
      const val = Math.abs(div[rowOffset + x]);
      if (val > maxVal) maxVal = val;
    }
  }
  return maxVal;
}

/**
 * Solves the pressure Poisson equation:
 * L_2(p) = div(u) via Jacobi relaxation with monotonic residual monitoring.
 */
export function solvePressurePoisson(
  grid: FluidGrid,
  iterations = 40,
  boundary?: BoundaryHandler
): PressureSolveResult {
  const W = grid.width;
  const H = grid.height;
  const div = grid.div;
  const dx2 = grid.dx * grid.dx;

  let p = grid.pressure;
  let pNext = grid.pressurePrev;

  p.fill(0);
  pNext.fill(0);

  const residuals: number[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    let maxDelta = 0;

    for (let y = 1; y < H - 1; y++) {
      const rowOffset = y * W;
      for (let x = 1; x < W - 1; x++) {
        const idx = rowOffset + x;

        const sumNeighbors = p[idx - 1] + p[idx + 1] + p[idx - W] + p[idx + W];
        const target = 0.25 * (sumNeighbors - dx2 * div[idx]);

        pNext[idx] = target;
        const delta = Math.abs(target - p[idx]);
        if (delta > maxDelta) maxDelta = delta;
      }
    }

    // Ping-pong buffer swap
    const tmp = p;
    p = pNext;
    pNext = tmp;

    if (boundary) {
      boundary.applyPressureBoundary(grid);
    }

    residuals.push(maxDelta);
  }

  grid.pressure = p;
  grid.pressurePrev = pNext;

  return {
    iterationsRun: iterations,
    finalResidual: residuals[residuals.length - 1] ?? 0,
    residuals
  };
}

/**
 * Full pressure projection step:
 * Uses defect correction when high iteration counts are requested.
 */
export function projectVelocity(
  grid: FluidGrid,
  iterations = 40,
  boundary?: BoundaryHandler
): PressureSolveResult {
  const passes = iterations >= 80 ? 2 : 1;
  const itersPerPass = Math.floor(iterations / passes);
  let lastResult: PressureSolveResult = { iterationsRun: 0, finalResidual: 0, residuals: [] };

  const W = grid.width;
  const H = grid.height;
  const u = grid.u;
  const v = grid.v;
  const halfInvDx = 0.5 * grid.invDx;

  for (let pass = 0; pass < passes; pass++) {
    computeDivergence(grid, boundary);
    lastResult = solvePressurePoisson(grid, itersPerPass, boundary);

    const p = grid.pressure;
    for (let y = 1; y < H - 1; y++) {
      const rowOffset = y * W;
      for (let x = 1; x < W - 1; x++) {
        const idx = rowOffset + x;
        u[idx] -= (p[idx + 1] - p[idx - 1]) * halfInvDx;
        v[idx] -= (p[idx + W] - p[idx - W]) * halfInvDx;
      }
    }

    if (boundary) {
      boundary.applyVelocityBoundary(grid);
    }
  }

  computeDivergence(grid, boundary);
  return lastResult;
}
