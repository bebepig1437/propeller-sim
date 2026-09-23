import type { FluidGrid } from '../fluid/grid';
import type { BEMTResult } from './bemt';

export interface ActuatorDiscConfig {
  centerX: number;
  centerY: number;
  radiusCells: number;
  thicknessCells: number;
  orientationRad: number;
  gridDxM: number;
  depthM: number;
  fluidDensity: number;
  dyeEmissionRate: number;
  inflowRelaxation: number;
  sourceMode: 'bemt_thrust' | 'grid_momentum';
}

export interface CouplingTelemetry {
  inflowVelocityMs: number;
  rawInflowVelocityMs: number;
  wakeVelocityMs: number;
  slipstreamVelocityMs: number;
  thrustInjectedN: number;
  torqueInjectedNm: number;
  jetMomentumFluxN: number;
  gridMomentumThrustN: number;
  bemtThrustN: number;
  thrustAgreementPct: number;
  steadyStateConverged: boolean;
}

export interface PrecomputedDiscCell {
  idx: number;
  xRot: number;
  yRot: number;
  rNorm: number;
  radialFactor: number;
  cosTheta: number;
  sinTheta: number;
}

export class ActuatorDiscCoupler {
  public config: ActuatorDiscConfig;
  public lastTelemetry: CouplingTelemetry = {
    inflowVelocityMs: 0,
    rawInflowVelocityMs: 0,
    wakeVelocityMs: 0,
    slipstreamVelocityMs: 0,
    thrustInjectedN: 0,
    torqueInjectedNm: 0,
    jetMomentumFluxN: 0,
    gridMomentumThrustN: 0,
    bemtThrustN: 0,
    thrustAgreementPct: 100,
    steadyStateConverged: true
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
  private cachedOrientationRad = -999;

  private lastRelaxedInflow = 0;

  constructor(config?: Partial<ActuatorDiscConfig>) {
    this.config = {
      centerX: config?.centerX ?? 24,
      centerY: config?.centerY ?? 64,
      radiusCells: config?.radiusCells ?? 14,
      thicknessCells: config?.thicknessCells ?? 3,
      orientationRad: config?.orientationRad ?? 0.0,
      gridDxM: config?.gridDxM ?? 0.0015,
      depthM: config?.depthM ?? 0.15,
      fluidDensity: config?.fluidDensity ?? 1000.0,
      dyeEmissionRate: config?.dyeEmissionRate ?? 1.2,
      inflowRelaxation: config?.inflowRelaxation ?? 0.5,
      sourceMode: config?.sourceMode ?? 'bemt_thrust'
    };
  }

  public reset(): void {
    this.lastRelaxedInflow = 0;
    this.lastTelemetry.inflowVelocityMs = 0;
    this.lastTelemetry.rawInflowVelocityMs = 0;
    this.lastTelemetry.wakeVelocityMs = 0;
    this.lastTelemetry.slipstreamVelocityMs = 0;
    this.lastTelemetry.thrustInjectedN = 0;
    this.lastTelemetry.torqueInjectedNm = 0;
    this.lastTelemetry.jetMomentumFluxN = 0;
    this.lastTelemetry.gridMomentumThrustN = 0;
    this.lastTelemetry.bemtThrustN = 0;
    this.lastTelemetry.thrustAgreementPct = 100;
    this.lastTelemetry.steadyStateConverged = true;
  }

  public sampleInflowVelocity(grid: FluidGrid): number {
    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const v = grid.v;
    const { centerX, centerY, radiusCells, orientationRad, inflowRelaxation } = this.config;

    const cosT = Math.cos(orientationRad);
    const sinT = Math.sin(orientationRad);

    const upstreamOffset = 2.0;
    const sampleCenterX = Math.max(1, Math.min(W - 2, Math.round(centerX - upstreamOffset * cosT)));
    const sampleCenterY = Math.max(1, Math.min(H - 2, Math.round(centerY - upstreamOffset * sinT)));

    let sumAxialU = 0;
    let sumWeight = 0;

    const nSpanSamples = Math.max(7, Math.floor(radiusCells * 1.5));
    for (let i = 0; i <= nSpanSamples; i++) {
      const s = (i / nSpanSamples) * 2.0 - 1.0;
      const weight = Math.max(0, 1.0 - s * s);

      const px = Math.round(sampleCenterX + s * radiusCells * (-sinT));
      const py = Math.round(sampleCenterY + s * radiusCells * cosT);

      if (px >= 1 && px < W - 1 && py >= 1 && py < H - 1) {
        const idx = py * W + px;
        const axialVel = u[idx] * cosT + v[idx] * sinT;
        sumAxialU += axialVel * weight;
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
    dt: number,
    swirlSign?: number
  ): CouplingTelemetry {
    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const v = grid.v;
    const dye = grid.dye;

    const {
      centerX,
      centerY,
      radiusCells,
      thicknessCells,
      orientationRad,
      gridDxM,
      depthM,
      fluidDensity,
      dyeEmissionRate,
      sourceMode
    } = this.config;

    const R = radiusCells;
    const T = bemt.thrustN;
    const Q = bemt.torqueNm;

    const effectiveSwirlSign = swirlSign !== undefined
      ? (swirlSign < 0 ? -1 : 1)
      : (bemt.handedness === 'CW' ? -1 : 1);

    if (
      this.cachedGridW !== W ||
      this.cachedGridH !== H ||
      this.cachedCenterX !== centerX ||
      this.cachedCenterY !== centerY ||
      this.cachedRadiusCells !== radiusCells ||
      this.cachedThicknessCells !== thicknessCells ||
      Math.abs(this.cachedOrientationRad - orientationRad) > 1e-4 ||
      this.cachedCells.length === 0
    ) {
      this.cachedGridW = W;
      this.cachedGridH = H;
      this.cachedCenterX = centerX;
      this.cachedCenterY = centerY;
      this.cachedRadiusCells = radiusCells;
      this.cachedThicknessCells = thicknessCells;
      this.cachedOrientationRad = orientationRad;
      this.cachedCells = [];
      this.cachedTotalWeight = 0;

      const cosT = Math.cos(orientationRad);
      const sinT = Math.sin(orientationRad);

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

          const xRot = dx * cosT + dy * sinT;
          const yRot = -dx * sinT + dy * cosT;

          if (Math.abs(xRot) <= halfThick && Math.abs(yRot) <= radiusCells) {
            const rNorm = yRot / radiusCells;
            const radialFactor = Math.sqrt(Math.max(0.01, 1.0 - rNorm * rNorm));
            const idx = y * W + x;

            this.cachedCells.push({
              idx,
              xRot,
              yRot,
              rNorm,
              radialFactor,
              cosTheta: cosT,
              sinTheta: sinT
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

    const thrustToApply = sourceMode === 'grid_momentum' && this.lastTelemetry.gridMomentumThrustN !== 0
      ? this.lastTelemetry.gridMomentumThrustN
      : T;

    const axialDeltaVScale = (thrustToApply * dt) / (totalDiscMassKg * (this.cachedTotalWeight / this.cachedCells.length));

    const absQ = Math.abs(Q);
    const swirlScale = (effectiveSwirlSign * absQ * dt) / (totalDiscMassKg * Math.max(0.01, R * gridDxM));
    const dyeEmissionBase = Math.min(0.8, Math.abs(T) * 0.2 * dyeEmissionRate * dt);

    const cells = this.cachedCells;
    const nCells = cells.length;
    let sumInduced = 0;
    const numEl = bemt.elements ? bemt.elements.length : 0;
    if (numEl > 0) {
      for (let i = 0; i < numEl; i++) {
        sumInduced += bemt.elements[i].axialInducedMs;
      }
    }
    const meanInduced = numEl > 0 ? sumInduced / numEl : 0;

    let sumInjectedForceN = 0;

    for (let i = 0; i < nCells; i++) {
      const cell = cells[i];
      const idx = cell.idx;
      const rf = cell.radialFactor;
      const cosT = cell.cosTheta;
      const sinT = cell.sinTheta;

      const dAxial = axialDeltaVScale * rf;
      sumInjectedForceN += this.cellMassKg * (dAxial / dt);

      const edgeFactor = Math.abs(cell.rNorm) > 0.6
        ? Math.sign(cell.rNorm) * (Math.abs(cell.rNorm) - 0.6) / 0.4
        : 0;
      const swirlFactor = cell.rNorm * Math.sqrt(Math.max(0.01, 1.0 - cell.rNorm * cell.rNorm));
      const dTransverse = swirlScale * (0.5 * swirlFactor + 0.5 * edgeFactor);

      const du = dAxial * cosT - dTransverse * sinT;
      const dv = dAxial * sinT + dTransverse * cosT;

      u[idx] += du;
      v[idx] += dv;

      const curDye = dye[idx];
      const newDye = curDye + dyeEmissionBase * rf;
      dye[idx] = newDye > 1.0 ? 1.0 : newDye;
    }

    const cosT = Math.cos(orientationRad);
    const sinT = Math.sin(orientationRad);
    const downstreamDist = Math.max(2.0, Math.min(8.0, thicknessCells / 2 + 2.0));
    const wakeCenterX = Math.max(1, Math.min(W - 2, Math.round(centerX + downstreamDist * cosT)));
    const wakeCenterY = Math.max(1, Math.min(H - 2, Math.round(centerY + downstreamDist * sinT)));

    let wakeSum = 0;
    let wakeCount = 0;

    const nWakeSamples = Math.max(7, Math.floor(R * 1.5));
    for (let i = 0; i <= nWakeSamples; i++) {
      const s = (i / nWakeSamples) * 2.0 - 1.0;
      const weight = Math.max(0.05, 1.0 - s * s);

      const wx = Math.round(wakeCenterX + s * R * (-sinT));
      const wy = Math.round(wakeCenterY + s * R * cosT);

      if (wx >= 1 && wx < W - 1 && wy >= 1 && wy < H - 1) {
        const wIdx = wy * W + wx;
        const wakeAxial = u[wIdx] * cosT + v[wIdx] * sinT;
        wakeSum += wakeAxial * weight;
        wakeCount += weight;
      }
    }

    const meanWakeVel = wakeCount > 0 ? wakeSum / wakeCount : 0;
    const gridMomentumFluxN = sumInjectedForceN;

    const absT = Math.abs(T);
    const absGridThrust = Math.abs(gridMomentumFluxN);
    const errThrust = Math.abs(absT - absGridThrust);
    const denom = Math.max(0.1, Math.max(absT, absGridThrust));
    const agreementPct = Math.max(0, Math.min(100, (1.0 - errThrust / denom) * 100));
    const steadyStateConverged = absT < 1e-3 || errThrust / denom <= 0.15;

    this.lastTelemetry.inflowVelocityMs = this.lastRelaxedInflow;
    this.lastTelemetry.rawInflowVelocityMs = this.lastTelemetry.rawInflowVelocityMs;
    this.lastTelemetry.wakeVelocityMs = meanWakeVel;
    this.lastTelemetry.slipstreamVelocityMs = this.lastRelaxedInflow + 2.0 * meanInduced;
    this.lastTelemetry.thrustInjectedN = T;
    this.lastTelemetry.torqueInjectedNm = Q;
    this.lastTelemetry.jetMomentumFluxN = fluidDensity * Math.PI * Math.pow(R * gridDxM, 2) * meanWakeVel * meanWakeVel;
    this.lastTelemetry.gridMomentumThrustN = gridMomentumFluxN;
    this.lastTelemetry.bemtThrustN = T;
    this.lastTelemetry.thrustAgreementPct = agreementPct;
    this.lastTelemetry.steadyStateConverged = steadyStateConverged;

    return this.lastTelemetry;
  }
}
