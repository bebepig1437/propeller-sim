// Jacobi / Multigrid Poisson solver for divergence-free projection (Stam / Fedkiw)
import type { FluidGrid } from "./grid";
import type { BoundaryHandler } from "./boundary";

export interface PressureSolveResult {
  iterationsRun: number;
  finalResidual: number;
  residuals: number[];
}

const staticPressureResult: PressureSolveResult = {
  iterationsRun: 0,
  finalResidual: 0,
  residuals: []
};

let cachedCoarseW = 0;
let cachedCoarseH = 0;
let coarseR = new Float32Array(0);
let coarseE = new Float32Array(0);
let coarseENext = new Float32Array(0);
let fineResidual = new Float32Array(0);

function ensureCoarseBuffers(fineW: number, fineH: number): { cW: number; cH: number } {
  const cW = Math.floor(fineW / 2);
  const cH = Math.floor(fineH / 2);
  const fineSize = fineW * fineH;
  const coarseSize = cW * cH;

  if (fineResidual.length !== fineSize) {
    fineResidual = new Float32Array(fineSize);
  }
  if (cachedCoarseW !== cW || cachedCoarseH !== cH) {
    cachedCoarseW = cW;
    cachedCoarseH = cH;
    coarseR = new Float32Array(coarseSize);
    coarseE = new Float32Array(coarseSize);
    coarseENext = new Float32Array(coarseSize);
  }
  return { cW, cH };
}

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

  staticPressureResult.residuals.length = 0;
  const residuals = staticPressureResult.residuals;

  for (let iter = 0; iter < iterations; iter++) {
    let maxDelta = 0;

    const solid = (grid as any).solid;
    for (let y = 1; y < H - 1; y++) {
      const rowOffset = y * W;
      for (let x = 1; x < W - 1; x++) {
        const idx = rowOffset + x;
        if (solid && solid[idx]) {
          pNext[idx] = 0;
          continue;
        }

        let denom = 0;
        let sumNeighbors = 0;
        if (!solid || !solid[idx - 1]) { sumNeighbors += p[idx - 1]; denom++; }
        if (!solid || !solid[idx + 1]) { sumNeighbors += p[idx + 1]; denom++; }
        if (!solid || !solid[idx - W]) { sumNeighbors += p[idx - W]; denom++; }
        if (!solid || !solid[idx + W]) { sumNeighbors += p[idx + W]; denom++; }

        if (denom === 0) continue;
        const target = (sumNeighbors - dx2 * div[idx]) / denom;

        pNext[idx] = target;
        const delta = Math.abs(target - p[idx]);
        if (delta > maxDelta) maxDelta = delta;
      }
    }

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

  staticPressureResult.iterationsRun = iterations;
  staticPressureResult.finalResidual = residuals.length > 0 ? residuals[residuals.length - 1] : 0;
  return staticPressureResult;
}

export function solvePressureMultigrid(
  grid: FluidGrid,
  vCycles = 1,
  boundary?: BoundaryHandler
): PressureSolveResult {
  const W = grid.width;
  const H = grid.height;
  const div = grid.div;
  const dx2 = grid.dx * grid.dx;
  const coarseDx2 = 4.0 * dx2;
  const invDx2 = 1.0 / dx2;

  const { cW, cH } = ensureCoarseBuffers(W, H);

  let p = grid.pressure;
  let pNext = grid.pressurePrev;

  staticPressureResult.residuals.length = 0;
  let finalResidual = 0;
  let totalItersRun = 0;

  for (let cycle = 0; cycle < vCycles; cycle++) {
    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        const idx = row + x;
        pNext[idx] = 0.25 * (p[idx - 1] + p[idx + 1] + p[idx - W] + p[idx + W] - dx2 * div[idx]);
      }
    }
    let tmp = p; p = pNext; pNext = tmp;
    grid.pressure = p;
    grid.pressurePrev = pNext;
    if (boundary) boundary.applyPressureBoundary(grid);
    totalItersRun++;

    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        const idx = row + x;
        fineResidual[idx] = div[idx] - (p[idx - 1] + p[idx + 1] + p[idx - W] + p[idx + W] - 4.0 * p[idx]) * invDx2;
      }
    }

    for (let cy = 0; cy < cH; cy++) {
      const fRow0 = (cy * 2) * W;
      const fRow1 = Math.min(H - 1, cy * 2 + 1) * W;
      const cRow = cy * cW;
      for (let cx = 0; cx < cW; cx++) {
        const fx0 = cx * 2;
        const fx1 = Math.min(W - 1, fx0 + 1);
        coarseR[cRow + cx] = 0.25 * (fineResidual[fRow0 + fx0] + fineResidual[fRow0 + fx1] + fineResidual[fRow1 + fx0] + fineResidual[fRow1 + fx1]);
        coarseE[cRow + cx] = 0.0;
      }
    }

    let cE: Float32Array = coarseE;
    let cENext: Float32Array = coarseENext;
    let tmpSwap: Float32Array;
    for (let iter = 0; iter < 2; iter++) {
      for (let cy = 1; cy < cH - 1; cy++) {
        const cRow = cy * cW;
        for (let cx = 1; cx < cW - 1; cx++) {
          const cIdx = cRow + cx;
          cENext[cIdx] = 0.25 * (cE[cIdx - 1] + cE[cIdx + 1] + cE[cIdx - cW] + cE[cIdx + cW] - coarseDx2 * coarseR[cIdx]);
        }
      }
      tmpSwap = cE; cE = cENext; cENext = tmpSwap;
      totalItersRun++;
    }

    for (let fy = 1; fy < H - 1; fy++) {
      const cy = fy >> 1;
      const cRow = cy * cW;
      const fRow = fy * W;
      for (let fx = 1; fx < W - 1; fx++) {
        p[fRow + fx] += cE[cRow + (fx >> 1)];
      }
    }

    let maxDelta = 0;
    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        const idx = row + x;
        const sumN = p[idx - 1] + p[idx + 1] + p[idx - W] + p[idx + W];
        const target = 0.25 * (sumN - dx2 * div[idx]);
        pNext[idx] = target;
        const delta = Math.abs(target - p[idx]);
        if (delta > maxDelta) maxDelta = delta;
      }
    }
    tmp = p; p = pNext; pNext = tmp;
    grid.pressure = p;
    grid.pressurePrev = pNext;
    if (boundary) boundary.applyPressureBoundary(grid);
    finalResidual = maxDelta;
    totalItersRun++;

    staticPressureResult.residuals.push(finalResidual);
  }

  grid.pressure = p;
  grid.pressurePrev = pNext;

  staticPressureResult.iterationsRun = totalItersRun;
  staticPressureResult.finalResidual = finalResidual;
  return staticPressureResult;
}

export function projectVelocity(
  grid: FluidGrid,
  iterations = 40,
  boundary?: BoundaryHandler,
  method: "jacobi" | "multigrid" = "jacobi"
): PressureSolveResult {
  const passes = iterations >= 80 ? 2 : 1;
  const itersPerPass = Math.floor(iterations / passes);
  let lastResult: PressureSolveResult = staticPressureResult;

  const W = grid.width;
  const H = grid.height;
  const u = grid.u;
  const v = grid.v;
  const halfInvDx = 0.5 * grid.invDx;

  for (let pass = 0; pass < passes; pass++) {
    computeDivergence(grid, boundary);
    if (method === "multigrid") {
      const cycles = Math.max(1, Math.floor(itersPerPass / 20));
      lastResult = solvePressureMultigrid(grid, cycles, boundary);
    } else {
      lastResult = solvePressurePoisson(grid, itersPerPass, boundary);
    }

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

export function solvePressure(
  grid: FluidGrid,
  iterations = 40,
  boundary?: BoundaryHandler
): PressureSolveResult {
  return solvePressurePoisson(grid, iterations, boundary);
}
