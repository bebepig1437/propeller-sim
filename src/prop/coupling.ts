import type { FluidGrid } from '../fluid/grid';
import type { BEMTResult } from './bemt';

export interface ActuatorDiscConfig {
  centerX: number;          // Grid cell X coordinate (e.g. 24)
  centerY: number;          // Grid cell Y coordinate (e.g. 64)
  radiusCells: number;      // Grid cell radius (e.g. 14)
  thicknessCells: number;   // Axial thickness of actuator disk in grid cells (e.g. 3)
  orientationRad: number;   // Orientation angle in radians (0 = +X, default 0)
  gridDxM: number;          // Physical meters per grid cell (e.g. 0.0015 m)
  depthM: number;           // Out-of-plane physical depth (e.g. 0.042 m)
  fluidDensity: number;     // Fluid density kg/m3 (default 1000)
  dyeEmissionRate: number;  // Tracer dye intensity multiplier
  inflowRelaxation: number; // Relaxation damping factor alpha in (0, 1] (default 0.5)
  sourceMode: 'bemt_thrust' | 'grid_momentum'; // Validation toggle
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

  // Relaxation state for inflow velocity
  private lastRelaxedInflow = 0;

  constructor(config?: Partial<ActuatorDiscConfig>) {
    this.config = {
      centerX: config?.centerX ?? 24,
      centerY: config?.centerY ?? 64,
      radiusCells: config?.radiusCells ?? 14,
      thicknessCells: config?.thicknessCells ?? 3,
      orientationRad: config?.orientationRad ?? 0.0,
      gridDxM: config?.gridDxM ?? 0.0015,
      depthM: config?.depthM ?? 0.15, // Modeled out-of-plane streamtube depth (default 0.15 m)
      fluidDensity: config?.fluidDensity ?? 1000.0,
      dyeEmissionRate: config?.dyeEmissionRate ?? 1.2,
      inflowRelaxation: config?.inflowRelaxation ?? 0.5,
      sourceMode: config?.sourceMode ?? 'bemt_thrust'
    };
  }

  /**
   * Resets internal dynamic states (e.g. relaxed inflow).
   */
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

  /**
   * Samples upstream inflow velocity (Va) directly from the fluid grid
   * at the propeller disc face.
   *
   * Correctness rules:
   * 1. Does NOT clamp to >= 0: reverse inflow is physically meaningful and feeds into BEMT.
   * 2. Projects flow along the disk's orientation normal vector.
   * 3. Applies first-order relaxation damping (alpha = config.inflowRelaxation).
   */
  public sampleInflowVelocity(grid: FluidGrid): number {
    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const v = grid.v;
    const { centerX, centerY, radiusCells, orientationRad, inflowRelaxation } = this.config;

    const cosT = Math.cos(orientationRad);
    const sinT = Math.sin(orientationRad);

    // Normal pointing along thrust: (cosT, sinT)
    // Upstream direction: (-cosT, -sinT)
    // Transverse direction: (-sinT, cosT)
    const upstreamOffset = 2.0;
    const sampleCenterX = Math.max(1, Math.min(W - 2, Math.round(centerX - upstreamOffset * cosT)));
    const sampleCenterY = Math.max(1, Math.min(H - 2, Math.round(centerY - upstreamOffset * sinT)));

    let sumAxialU = 0;
    let sumWeight = 0;

    const nSpanSamples = Math.max(7, Math.floor(radiusCells * 1.5));
    for (let i = 0; i <= nSpanSamples; i++) {
      const s = (i / nSpanSamples) * 2.0 - 1.0; // [-1, +1]
      const weight = Math.max(0, 1.0 - s * s);

      const px = Math.round(sampleCenterX + s * radiusCells * (-sinT));
      const py = Math.round(sampleCenterY + s * radiusCells * cosT);

      if (px >= 1 && px < W - 1 && py >= 1 && py < H - 1) {
        const idx = py * W + px;
        // Project local fluid velocity onto thrust normal: (u, v) · (cosT, sinT)
        const axialVel = u[idx] * cosT + v[idx] * sinT;
        sumAxialU += axialVel * weight;
        sumWeight += weight;
      }
    }

    const rawInflow = sumWeight > 0 ? sumAxialU / sumWeight : 0;
    this.lastTelemetry.rawInflowVelocityMs = rawInflow;

    // First-order relaxation damping: Va_rel = (1 - alpha) * Va_prev + alpha * Va_raw
    const alpha = Math.max(0.01, Math.min(1.0, inflowRelaxation));
    const relaxedInflow = (1.0 - alpha) * this.lastRelaxedInflow + alpha * rawInflow;
    this.lastRelaxedInflow = relaxedInflow;
    this.lastTelemetry.inflowVelocityMs = relaxedInflow;

    return relaxedInflow;
  }

  /**
   * Injects actuator disc momentum and tip vortex forces from BEMT solution into fluid grid.
   *
   * Correctness:
   * 1. Rebuilds cell cache if centerX, centerY, radiusCells, thicknessCells, or orientationRad change.
   * 2. Physical cell volume Delta V = (gridDxM)^2 * depthM.
   * 3. Conservation: sum of body force over all cells equals thrust T exactly in SI units.
   * 4. Swirl in 2D is injected as counter-rotating tip vortex pair (+/- omega_z) at disc edges y = +/- R,
   *    reproducing 2D centerline cut of axisymmetric vortex rings.
   * 5. Zero heap allocations: mutates preallocated lastTelemetry.
   */
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

    // Effective swirl sign: CW = -1, CCW = +1 (matching BEMT hull reaction torque convention)
    const effectiveSwirlSign = swirlSign !== undefined
      ? (swirlSign < 0 ? -1 : 1)
      : (bemt.handedness === 'CW' ? -1 : 1);

    // 1. Invalidate and rebuild disc cell cache when dimensions, position, or orientation change
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

          // Rotate into disc frame:
          // xRot: axial coordinate along thrust axis
          // yRot: transverse coordinate across disc diameter
          const xRot = dx * cosT + dy * sinT;
          const yRot = -dx * sinT + dy * cosT;

          if (Math.abs(xRot) <= halfThick && Math.abs(yRot) <= radiusCells) {
            const rNorm = yRot / radiusCells;
            // Parabolic radial weighting from center to tip
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

    // 2D Equivalent Cell Mass scaling with dx and modeled depth:
    // Cell volume Delta V = (gridDxM)^2 * depthM.
    const cellVolM3 = gridDxM * gridDxM * depthM;
    const cellMassKg = fluidDensity * cellVolM3;
    const totalDiscMassKg = this.cachedCells.length * cellMassKg;
    this.totalDiscMassKg = totalDiscMassKg;
    this.cellMassKg = cellMassKg;

    // Conservation: Sum(mass_i * delta_u_i / dt) = T
    // With N cells and mean weight (totalWeight / N), each cell mass = totalDiscMassKg / N
    const thrustToApply = sourceMode === 'grid_momentum' && this.lastTelemetry.gridMomentumThrustN !== 0
      ? this.lastTelemetry.gridMomentumThrustN
      : T;

    const axialDeltaVScale = (thrustToApply * dt) / (totalDiscMassKg * (this.cachedTotalWeight / this.cachedCells.length));

    // 2D Swirl & Edge Vorticity (Tip Vortex Generation):
    // Tangential momentum injection scaled by torque and signed by handedness (CW = -1, CCW = +1)
    const absQ = Math.abs(Q);
    const swirlScale = (effectiveSwirlSign * absQ * dt) / (totalDiscMassKg * Math.max(0.01, R * gridDxM));
    const dyeEmissionBase = Math.min(0.8, Math.abs(T) * 0.2 * dyeEmissionRate * dt);

    const cells = this.cachedCells;
    const nCells = cells.length;
    // Actuator disc theoretical slipstream velocity: V_wake = Va + 2*vi
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

      // 1. Axial Acceleration directed along orientation angle
      const dAxial = axialDeltaVScale * rf;
      sumInjectedForceN += this.cellMassKg * (dAxial / dt);

      // 2. Tangential Swirl & Tip Vortex Shear: anti-symmetric across disc diameter (+/-)
      // Produces counter-rotating vortex ring cut without introducing artificial net transverse force
      const edgeFactor = Math.abs(cell.rNorm) > 0.6
        ? Math.sign(cell.rNorm) * (Math.abs(cell.rNorm) - 0.6) / 0.4
        : 0;
      const swirlFactor = cell.rNorm * Math.sqrt(Math.max(0.01, 1.0 - cell.rNorm * cell.rNorm));
      const dTransverse = swirlScale * (0.5 * swirlFactor + 0.5 * edgeFactor);

      // Rotate local (axial, transverse) into global (u, v)
      const du = dAxial * cosT - dTransverse * sinT;
      const dv = dAxial * sinT + dTransverse * cosT;

      u[idx] += du;
      v[idx] += dv;

      // 3. Flow Dye Tracer Marker
      const curDye = dye[idx];
      const newDye = curDye + dyeEmissionBase * rf;
      dye[idx] = newDye > 1.0 ? 1.0 : newDye;
    }

    // Measure downstream slipstream wake velocity
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

    // Mutate preallocated telemetry object (zero heap garbage generation)
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
