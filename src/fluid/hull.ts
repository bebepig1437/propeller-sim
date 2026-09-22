import type { FluidGrid } from './grid';

export interface HullConfig {
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  cd: number;
  gridDxM: number;
  depthM: number;
  fluidDensity: number;
}

export interface HullTelemetry {
  dragForceX_N: number;
  dragForceY_N: number;
  totalDrag_N: number;
  meanWakeSpeedMs: number;
}

export class HullObstacle {
  public config: HullConfig;
  public lastTelemetry: HullTelemetry = {
    dragForceX_N: 0,
    dragForceY_N: 0,
    totalDrag_N: 0,
    meanWakeSpeedMs: 0
  };

  private cachedIndices: number[] = [];
  private cachedGridW = -1;
  private cachedGridH = -1;
  private cachedX = -1;
  private cachedY = -1;
  private cachedW = -1;
  private cachedH = -1;

  constructor(config?: Partial<HullConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      x: config?.x ?? 48,
      y: config?.y ?? 54,
      width: config?.width ?? 28,
      height: config?.height ?? 20,
      cd: config?.cd ?? 1.05,
      gridDxM: config?.gridDxM ?? 0.0015,
      depthM: config?.depthM ?? 0.042,
      fluidDensity: config?.fluidDensity ?? 1000.0
    };
  }

  public applyDrag(grid: FluidGrid, dt: number): HullTelemetry {
    if (!this.config.enabled) {
      this.lastTelemetry.dragForceX_N = 0;
      this.lastTelemetry.dragForceY_N = 0;
      this.lastTelemetry.totalDrag_N = 0;
      this.lastTelemetry.meanWakeSpeedMs = 0;
      return this.lastTelemetry;
    }

    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const v = grid.v;

    const { x, y, width, height, cd, gridDxM, depthM, fluidDensity } = this.config;

    if (
      this.cachedGridW !== W ||
      this.cachedGridH !== H ||
      this.cachedX !== x ||
      this.cachedY !== y ||
      this.cachedW !== width ||
      this.cachedH !== height ||
      this.cachedIndices.length === 0
    ) {
      this.cachedGridW = W;
      this.cachedGridH = H;
      this.cachedX = x;
      this.cachedY = y;
      this.cachedW = width;
      this.cachedH = height;
      this.cachedIndices = [];

      const xMin = Math.max(1, Math.floor(x));
      const xMax = Math.min(W - 2, Math.floor(x + width));
      const yMin = Math.max(1, Math.floor(y));
      const yMax = Math.min(H - 2, Math.floor(y + height));

      const cx = x + width * 0.5;
      const cy = y + height * 0.5;
      const rx = width * 0.5;
      const ry = height * 0.5;

      for (let py = yMin; py <= yMax; py++) {
        for (let px = xMin; px <= xMax; px++) {
          const normX = (px - cx) / rx;
          const normY = (py - cy) / ry;
          if (normX * normX + normY * normY <= 1.0) {
            this.cachedIndices.push(py * W + px);
          }
        }
      }
    }

    const indices = this.cachedIndices;
    const nCells = indices.length;
    if (nCells === 0) return this.lastTelemetry;

    const cellVolM3 = gridDxM * gridDxM * depthM;
    const cellMassKg = fluidDensity * cellVolM3;

    const frontalAreaM2 = height * gridDxM * depthM;
    const totalHullVolM3 = nCells * cellVolM3;
    const dragCoeff = (0.5 * cd * frontalAreaM2) / totalHullVolM3;

    let totalFx = 0;
    let totalFy = 0;
    let wakeSpeedSum = 0;

    for (let i = 0; i < nCells; i++) {
      const idx = indices[i];
      const curU = u[idx];
      const curV = v[idx];
      const speed = Math.sqrt(curU * curU + curV * curV);

      if (speed > 1e-4) {
        const denom = 1.0 + dragCoeff * speed * dt;
        const newU = curU / denom;
        const newV = curV / denom;

        const fxFluid = cellMassKg * (newU - curU) / dt;
        const fyFluid = cellMassKg * (newV - curV) / dt;

        totalFx -= fxFluid;
        totalFy -= fyFluid;

        u[idx] = newU;
        v[idx] = newV;
        wakeSpeedSum += Math.sqrt(newU * newU + newV * newV);
      }
    }

    this.lastTelemetry.dragForceX_N = totalFx;
    this.lastTelemetry.dragForceY_N = totalFy;
    this.lastTelemetry.totalDrag_N = Math.sqrt(totalFx * totalFx + totalFy * totalFy);
    this.lastTelemetry.meanWakeSpeedMs = wakeSpeedSum / nCells;

    return this.lastTelemetry;
  }
}
