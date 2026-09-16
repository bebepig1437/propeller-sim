import type { FluidGrid } from '../fluid/grid';
import type { BEMTResult } from './bemt';

export interface ActuatorDiscConfig {
  centerX: number;       // Grid cell X coordinate (e.g. 24)
  centerY: number;       // Grid cell Y coordinate (e.g. 64)
  radiusCells: number;   // Grid cell radius (e.g. 14)
  thicknessCells: number;// Axial thickness of actuator disk in grid cells (e.g. 3)
  gridDxM: number;       // Physical meters per grid cell (e.g. 0.0015 m)
  fluidDensity: number;  // Fluid density kg/m3 (default 1000)
  dyeEmissionRate: number; // Tracer dye intensity multiplier
}

export interface CouplingTelemetry {
  inflowVelocityMs: number;
  wakeVelocityMs: number;
  slipstreamVelocityMs: number;
  thrustInjectedN: number;
  torqueInjectedNm: number;
  jetMomentumFluxN: number;
}

export interface PrecomputedDiscCell {
  idx: number;
  dy: number;
  radialFactor: number;
}

export class ActuatorDiscCoupler {
  public config: ActuatorDiscConfig;
  public lastTelemetry: CouplingTelemetry = {
    inflowVelocityMs: 0,
    wakeVelocityMs: 0,
    slipstreamVelocityMs: 0,
    thrustInjectedN: 0,
    torqueInjectedNm: 0,
    jetMomentumFluxN: 0
  };

  private cachedCells: PrecomputedDiscCell[] = [];
  private cachedTotalWeight = 0;
  private cachedGridW = -1;
  private cachedGridH = -1;
  private cachedCenterX = -1;
  private cachedCenterY = -1;
  private cachedRadiusCells = -1;
  private cachedThicknessCells = -1;

  constructor(config?: Partial<ActuatorDiscConfig>) {
    this.config = {
      centerX: config?.centerX ?? 24,
      centerY: config?.centerY ?? 64,
      radiusCells: config?.radiusCells ?? 14,
      thicknessCells: config?.thicknessCells ?? 3,
      gridDxM: config?.gridDxM ?? 0.0015,
      fluidDensity: config?.fluidDensity ?? 1000.0,
      dyeEmissionRate: config?.dyeEmissionRate ?? 1.2
    };
  }

  /**
   * Samples upstream inflow velocity (Va) directly from the fluid grid
   * at the propeller disc face. Supports bidirectional flow.
   */
  public sampleInflowVelocity(grid: FluidGrid): number {
    const W = grid.width;
    const u = grid.u;
    const { centerX, centerY, radiusCells } = this.config;

    // Sample 2 cells upstream of the disc face
    const sampleX = Math.max(1, Math.floor(centerX - 2));
    const yMin = Math.max(1, Math.floor(centerY - radiusCells));
    const yMax = Math.min(grid.height - 2, Math.floor(centerY + radiusCells));

    let sumU = 0;
    let count = 0;

    for (let y = yMin; y <= yMax; y++) {
      const dy = (y - centerY) / radiusCells;
      if (Math.abs(dy) <= 1.0) {
        const weight = Math.max(0, 1.0 - dy * dy);
        sumU += u[y * W + sampleX] * weight;
        count += weight;
      }
    }

    const meanU = count > 0 ? sumU / count : 0;
    this.lastTelemetry.inflowVelocityMs = meanU;
    return Math.max(0, meanU);
  }

  /**
   * Injects actuator disc momentum and swirl forces from BEMT solution into fluid grid.
   */
  public injectCouplingForces(
    grid: FluidGrid,
    bemt: BEMTResult,
    dt: number
  ): CouplingTelemetry {
    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const v = grid.v;
    const dye = grid.dye;

    const { centerX, centerY, radiusCells, thicknessCells, fluidDensity } = this.config;
    const R = radiusCells;
    const T = bemt.thrustN;
    const Q = bemt.torqueNm;

    const yMin = Math.max(1, Math.floor(centerY - R));
    const yMax = Math.min(H - 2, Math.floor(centerY + R));

    // Invalidate and rebuild disc cell cache if grid or disc dimensions change
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

      const xMin = Math.max(1, Math.floor(centerX - thicknessCells / 2));
      const xMax = Math.min(W - 2, Math.floor(centerX + thicknessCells / 2));

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          const dy = (y - centerY) / R;
          if (Math.abs(dy) <= 1.0) {
            const radialFactor = Math.sqrt(Math.max(0, 1.0 - dy * dy));
            const idx = y * W + x;
            this.cachedCells.push({ idx, dy, radialFactor });
            this.cachedTotalWeight += radialFactor;
          }
        }
      }
    }

    if (this.cachedTotalWeight <= 0) return this.lastTelemetry;

    // Physical acceleration scale normalized by effective 2D slice fluid mass
    const thrustScale = (T * dt) / (fluidDensity * 0.001 * this.cachedTotalWeight);
    const swirlScale = (Q * dt) / (fluidDensity * 0.001 * this.cachedTotalWeight * Math.max(1, R * 0.5));
    const dyeEmissionBase = Math.min(0.5, Math.abs(T) * 0.15 * this.config.dyeEmissionRate * dt);

    // Fast linear loop over precomputed disc cells
    const cells = this.cachedCells;
    const nCells = cells.length;
    for (let i = 0; i < nCells; i++) {
      const cell = cells[i];
      const rf = cell.radialFactor;
      const idx = cell.idx;

      // 1. Axial Thrust Force: accelerates fluid along +X (forward) or -X (reverse)
      u[idx] += thrustScale * rf;

      // 2. Swirl Torque: rotates fluid around disc center (clockwise / CCW)
      v[idx] += swirlScale * cell.dy * rf;

      // 3. Plume Dye Marker: injected in proportion to thrust activity
      const currentDye = dye[idx];
      dye[idx] = currentDye + dyeEmissionBase * rf > 1.0 ? 1.0 : currentDye + dyeEmissionBase * rf;
    }

    // Measure downstream slipstream wake velocity (at x = centerX + 15)
    const wakeX = Math.min(W - 2, Math.floor(centerX + 15));
    let wakeSum = 0;
    let wakeCount = 0;
    for (let y = yMin; y <= yMax; y++) {
      wakeSum += u[y * W + wakeX];
      wakeCount++;
    }
    const wakeVel = wakeCount > 0 ? wakeSum / wakeCount : 0;

    // Theoretical actuator disc slipstream velocity: V_wake = Va + 2*vi
    const meanInduced = bemt.elements.length > 0
      ? bemt.elements.reduce((acc, el) => acc + el.axialInducedMs, 0) / bemt.elements.length
      : 0;

    this.lastTelemetry = {
      inflowVelocityMs: this.lastTelemetry.inflowVelocityMs,
      wakeVelocityMs: wakeVel,
      slipstreamVelocityMs: this.lastTelemetry.inflowVelocityMs + 2.0 * meanInduced,
      thrustInjectedN: T,
      torqueInjectedNm: Q,
      jetMomentumFluxN: fluidDensity * Math.PI * Math.pow(R * this.config.gridDxM, 2) * wakeVel * wakeVel
    };

    return this.lastTelemetry;
  }
}
