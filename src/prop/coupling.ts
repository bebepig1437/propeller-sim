import type { FluidGrid } from '../fluid/grid';
import type { BEMTResult } from './bemt';

export interface ActuatorDiscConfig {
  centerX: number;
  centerY: number;
  radiusCells: number;
  thicknessCells: number;
  gridDxM: number;
  depthM: number;
  fluidDensity: number;
  dyeEmissionRate: number;
  inflowRelaxation: number;
}

export interface CouplingTelemetry {
  inflowVelocityMs: number;
  rawInflowVelocityMs: number;
  wakeVelocityMs: number;
  thrustInjectedN: number;
  torqueInjectedNm: number;
  gridMomentumThrustN: number;
  bemtThrustN: number;
}

export interface PrecomputedDiscCell {
  idx: number;
  rNorm: number;
  radialFactor: number;
}

export class ActuatorDiscCoupler {
  public config: ActuatorDiscConfig;
  public lastTelemetry: CouplingTelemetry = {
    inflowVelocityMs: 0,
    rawInflowVelocityMs: 0,
    wakeVelocityMs: 0,
    thrustInjectedN: 0,
    torqueInjectedNm: 0,
    gridMomentumThrustN: 0,
    bemtThrustN: 0
  };

  public totalDiscMassKg = 0;
  public cellMassKg = 0;

  private cachedCells: PrecomputedDiscCell[] = [];
  private cachedTotalWeight = 0;
  private cachedGridW = -1;
  private cachedGridH = -1;
  private cachedCenterX = -1;
  private cachedCenterY = -1;
  private cachedRadiusCells = -1;
  private cachedThicknessCells = -1;
  private lastRelaxedInflow = 0;

  constructor(config?: Partial<ActuatorDiscConfig>) {
    this.config = {
      centerX: config?.centerX ?? 64,
      centerY: config?.centerY ?? 32,
      radiusCells: config?.radiusCells ?? 14,
      thicknessCells: config?.thicknessCells ?? 3,
      gridDxM: config?.gridDxM ?? 0.0015,
      depthM: config?.depthM ?? 0.042,
      fluidDensity: config?.fluidDensity ?? 1000.0,
      dyeEmissionRate: config?.dyeEmissionRate ?? 1.2,
      inflowRelaxation: config?.inflowRelaxation ?? 0.5
    };
  }

  public reset(): void {
    this.lastRelaxedInflow = 0;
    this.lastTelemetry.inflowVelocityMs = 0;
    this.lastTelemetry.rawInflowVelocityMs = 0;
    this.lastTelemetry.wakeVelocityMs = 0;
    this.lastTelemetry.thrustInjectedN = 0;
    this.lastTelemetry.torqueInjectedNm = 0;
    this.lastTelemetry.gridMomentumThrustN = 0;
    this.lastTelemetry.bemtThrustN = 0;
  }

  public sampleInflowVelocity(grid: FluidGrid): number {
    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const { centerX, centerY, radiusCells, inflowRelaxation } = this.config;

    const upstreamOffset = 2.0;
    const sampleCenterX = Math.max(1, Math.min(W - 2, Math.round(centerX - upstreamOffset)));
    const sampleCenterY = Math.max(1, Math.min(H - 2, Math.round(centerY)));

    let sumAxialU = 0;
    let sumWeight = 0;

    const nSpanSamples = Math.max(7, Math.floor(radiusCells * 1.5));
    for (let i = 0; i <= nSpanSamples; i++) {
      const s = (i / nSpanSamples) * 2.0 - 1.0;
      const weight = Math.max(0, 1.0 - s * s);
      const px = sampleCenterX;
      const py = Math.round(sampleCenterY + s * radiusCells);

      if (px >= 1 && px < W - 1 && py >= 1 && py < H - 1) {
        const idx = py * W + px;
        sumAxialU += u[idx] * weight;
        sumWeight += weight;
      }
    }

    const rawInflow = sumWeight > 0 ? sumAxialU / sumWeight : 0;
    this.lastTelemetry.rawInflowVelocityMs = rawInflow;

    const alpha = Math.max(0.01, Math.min(1.0, inflowRelaxation));
    const relaxedInflow = (1.0 - alpha) * this.lastRelaxedInflow + alpha * rawInflow;
    this.lastRelaxedInflow = relaxedInflow;
    this.lastTelemetry.inflowVelocityMs = relaxedInflow;

    return relaxedInflow;
  }

  public injectCouplingForces(
    grid: FluidGrid,
    bemt: BEMTResult,
    dt: number
  ): CouplingTelemetry {
    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const dye = grid.dye;

    const {
      centerX,
      centerY,
      radiusCells,
      thicknessCells,
      gridDxM,
      depthM,
      fluidDensity,
      dyeEmissionRate
    } = this.config;

    const T = bemt.thrustN;
    const Q = bemt.torqueNm;

    if (
      this.cachedGridW !== W ||
      this.cachedGridH !== H ||
      this.cachedCenterX !== centerX ||
      this.cachedCenterY !== centerY ||
      this.cachedRadiusCells !== radiusCells ||
      this.cachedThicknessCells !== thicknessCells ||
      this.cachedCells.length === 0
    ) {
      this.cachedGridW = W;
      this.cachedGridH = H;
      this.cachedCenterX = centerX;
      this.cachedCenterY = centerY;
      this.cachedRadiusCells = radiusCells;
      this.cachedThicknessCells = thicknessCells;
      this.cachedCells = [];
      this.cachedTotalWeight = 0;

      const maxDim = Math.ceil(Math.max(radiusCells, thicknessCells) * 1.5);
      const xMin = Math.max(1, Math.floor(centerX - maxDim));
      const xMax = Math.min(W - 2, Math.ceil(centerX + maxDim));
      const yMin = Math.max(1, Math.floor(centerY - maxDim));
      const yMax = Math.min(H - 2, Math.ceil(centerY + maxDim));

      const halfThick = Math.max(0.5, thicknessCells * 0.5);

      for (let y = yMin; y <= yMax; y++) {
        for (let x = xMin; x <= xMax; x++) {
          const dx = x - centerX;
          const dy = y - centerY;

          if (Math.abs(dx) <= halfThick && Math.abs(dy) <= radiusCells) {
            const rNorm = dy / radiusCells;
            const radialFactor = Math.sqrt(Math.max(0.01, 1.0 - rNorm * rNorm));
            const idx = y * W + x;

            this.cachedCells.push({
              idx,
              rNorm,
              radialFactor
            });
            this.cachedTotalWeight += radialFactor;
          }
        }
      }
    }

    if (this.cachedTotalWeight <= 0) return this.lastTelemetry;

    const cellVolM3 = gridDxM * gridDxM * depthM;
    const cellMassKg = fluidDensity * cellVolM3;
    const totalDiscMassKg = this.cachedCells.length * cellMassKg;
    this.totalDiscMassKg = totalDiscMassKg;
    this.cellMassKg = cellMassKg;

    const axialDeltaVScale = (T * dt) / (totalDiscMassKg * (this.cachedTotalWeight / this.cachedCells.length));
    const dyeEmissionBase = Math.min(0.8, Math.abs(T) * 0.2 * dyeEmissionRate * dt);

    const cells = this.cachedCells;
    const nCells = cells.length;
    let sumInjectedForceN = 0;

    for (let i = 0; i < nCells; i++) {
      const cell = cells[i];
      const idx = cell.idx;
      const rf = cell.radialFactor;
      const dAxial = axialDeltaVScale * rf;
      sumInjectedForceN += this.cellMassKg * (dAxial / dt);

      u[idx] += dAxial;

      const curDye = dye[idx];
      const newDye = curDye + dyeEmissionBase * rf;
      dye[idx] = newDye > 1.0 ? 1.0 : newDye;
    }

    const downstreamDist = Math.max(2.0, Math.min(8.0, thicknessCells / 2 + 2.0));
    const wakeCenterX = Math.max(1, Math.min(W - 2, Math.round(centerX + downstreamDist)));
    const wakeCenterY = Math.max(1, Math.min(H - 2, Math.round(centerY)));

    let wakeSum = 0;
    let wakeCount = 0;
    const nWakeSamples = Math.max(7, Math.floor(radiusCells * 1.5));
    for (let i = 0; i <= nWakeSamples; i++) {
      const s = (i / nWakeSamples) * 2.0 - 1.0;
      const weight = Math.max(0.05, 1.0 - s * s);
      const wx = wakeCenterX;
      const wy = Math.round(wakeCenterY + s * radiusCells);

      if (wx >= 1 && wx < W - 1 && wy >= 1 && wy < H - 1) {
        const wIdx = wy * W + wx;
        wakeSum += u[wIdx] * weight;
        wakeCount += weight;
      }
    }

    const meanWakeVel = wakeCount > 0 ? wakeSum / wakeCount : 0;
    this.lastTelemetry.inflowVelocityMs = this.lastRelaxedInflow;
    this.lastTelemetry.wakeVelocityMs = meanWakeVel;
    this.lastTelemetry.thrustInjectedN = T;
    this.lastTelemetry.torqueInjectedNm = Q;
    this.lastTelemetry.gridMomentumThrustN = sumInjectedForceN;
    this.lastTelemetry.bemtThrustN = T;

    return this.lastTelemetry;
  }
}
