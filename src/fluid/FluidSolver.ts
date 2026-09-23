import { FluidGrid, type GridOptions } from './grid';
import { BoundaryHandler, type BoundaryType } from './boundary';
import { advect, type AdvectionScheme } from './advect';
import { applyVorticityConfinement, computeCurl } from './vorticity';
import { projectVelocity, getMaxDivergence, type PressureSolveResult } from './pressure';
import { InflowJet, type InflowJetConfig } from './sources';

export interface FluidSolverParams {
  gridOptions?: GridOptions;
  dt?: number;
  advectionScheme?: AdvectionScheme;
  boundaryType?: BoundaryType;
  viscosity?: number;
  vorticityStrength?: number;
  pressureIterations?: number;
  pressureMethod?: "jacobi" | "multigrid";
  jetConfig?: Partial<InflowJetConfig>;
}

export interface FluidSolverMetrics {
  stepTimeMs: number;
  maxDivergence: number;
  pressureResidual: number;
  iterationsRun: number;
  totalDyeMass: number;
}

export class FluidSolver {
  public grid: FluidGrid;
  public boundary: BoundaryHandler;
  public jet: InflowJet;

  public dt: number;
  public advectionScheme: AdvectionScheme;
  public viscosity: number;
  public vorticityStrength: number;
  public pressureIterations: number;
  public pressureMethod: "jacobi" | "multigrid";

  public metrics: FluidSolverMetrics;
  public lastPressureResult: PressureSolveResult | null = null;
  public simTime = 0;

  constructor(params?: FluidSolverParams) {
    this.grid = new FluidGrid(params?.gridOptions);
    this.boundary = new BoundaryHandler(params?.boundaryType ?? 'FREE_SLIP');
    this.jet = new InflowJet(params?.jetConfig);

    this.dt = params?.dt ?? (1.0 / 60.0);
    this.advectionScheme = params?.advectionScheme ?? 'MACCORMACK';
    this.viscosity = params?.viscosity ?? 0.0001;
    this.vorticityStrength = params?.vorticityStrength ?? 4.0;
    this.pressureIterations = params?.pressureIterations ?? 40;
    this.pressureMethod = params?.pressureMethod ?? "jacobi";

    this.metrics = {
      stepTimeMs: 0,
      maxDivergence: 0,
      pressureResidual: 0,
      iterationsRun: this.pressureIterations,
      totalDyeMass: 0
    };
  }

  public step(customDt?: number): FluidSolverMetrics {
    const t0 = performance.now();
    const dt = customDt ?? this.dt;

    const cflLimit = 2.0;
    let maxVel = 0;
    for (let i = 0; i < this.grid.size; i++) {
      const spd = Math.max(Math.abs(this.grid.u[i]), Math.abs(this.grid.v[i]));
      if (spd > maxVel) maxVel = spd;
    }
    const cfl = (maxVel * dt) * this.grid.invDx;

    if (cfl > cflLimit) {
      const maxSubsteps = 8;
      const substeps = Math.min(maxSubsteps, Math.ceil(cfl / cflLimit));
      const subDt = dt / substeps;

      const maxAllowedVel = (cflLimit * this.grid.dx) / subDt;
      if (maxVel > maxAllowedVel) {
        const clampRatio = maxAllowedVel / maxVel;
        for (let i = 0; i < this.grid.size; i++) {
          this.grid.u[i] *= clampRatio;
          this.grid.v[i] *= clampRatio;
        }
      }

      for (let s = 0; s < substeps; s++) {
        this.stepSingle(subDt);
      }
    } else {
      this.stepSingle(dt);
    }

    this.metrics.stepTimeMs = performance.now() - t0;
    this.metrics.maxDivergence = getMaxDivergence(this.grid);
    if (this.lastPressureResult) {
      this.metrics.pressureResidual = this.lastPressureResult.finalResidual;
      this.metrics.iterationsRun = this.lastPressureResult.iterationsRun;
    }
    this.metrics.totalDyeMass = this.computeTotalDyeMass();

    return this.metrics;
  }

  private stepSingle(dt: number): void {
    this.simTime += dt;

    this.jet.inject(this.grid, this.simTime);

    if (this.vorticityStrength > 0) {
      applyVorticityConfinement(this.grid, dt, this.vorticityStrength);
      this.boundary.applyVelocityBoundary(this.grid);
    }

    if (this.viscosity > 0) {
      this.diffuseVelocity(dt);
    }

    this.grid.swapU();
    this.grid.swapV();
    advect(this.advectionScheme, this.grid, this.grid.uPrev, this.grid.u, dt, this.boundary, true);
    advect(this.advectionScheme, this.grid, this.grid.vPrev, this.grid.v, dt, this.boundary, true);
    this.boundary.applyVelocityBoundary(this.grid);

    this.grid.swapDye();
    advect(this.advectionScheme, this.grid, this.grid.dyePrev, this.grid.dye, dt, this.boundary, false);

    this.lastPressureResult = projectVelocity(this.grid, this.pressureIterations, this.boundary, this.pressureMethod);
    computeCurl(this.grid);
  }

  private diffuseVelocity(dt: number): void {
    const a = dt * this.viscosity * this.grid.invDx * this.grid.invDx;
    if (a <= 0) return;

    const { width: W, height: H, u, v, uPrev, vPrev } = this.grid;
    uPrev.set(u);
    vPrev.set(v);

    const denom = 1.0 / (1.0 + 4.0 * a);
    for (let iter = 0; iter < 4; iter++) {
      for (let y = 1; y < H - 1; y++) {
        const row = y * W;
        for (let x = 1; x < W - 1; x++) {
          const idx = row + x;
          u[idx] = (uPrev[idx] + a * (u[idx - 1] + u[idx + 1] + u[idx - W] + u[idx + W])) * denom;
          v[idx] = (vPrev[idx] + a * (v[idx - 1] + v[idx + 1] + v[idx - W] + v[idx + W])) * denom;
        }
      }
      this.boundary.applyVelocityBoundary(this.grid);
    }
  }

  public computeTotalDyeMass(): number {
    const { dye, size } = this.grid;
    let sum = 0;
    for (let i = 0; i < size; i++) {
      sum += dye[i];
    }
    return sum;
  }

  public primeTunnel(inflowVelocity: number): void {
    const { width: W, height: H, u, v } = this.grid;
    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        u[row + x] = inflowVelocity;
        v[row + x] = 0;
      }
    }
  }

  public reset(): void {
    this.grid.resetAll();
    this.simTime = 0;
    if (this.jet.config.enabled && this.jet.config.vx !== 0) {
      this.primeTunnel(this.jet.config.vx);
    }
  }
}
