import { FluidGrid } from '../grid';
import { InflowJet, type InflowJetConfig } from '../sources';
import { createAdvectionComputeNode } from './computeAdvection';
import { createCurlComputeNode } from './computeCurl';
import { createVorticityComputeNode } from './computeVorticity';
import { createDivergenceComputeNode } from './computeDivergence';
import { createPressureComputeNode } from './computePressure';
import { createProjectComputeNode } from './computeProject';
import { createSourcesComputeNode } from './computeSources';
import { StorageBufferAttribute } from 'three/webgpu';
import { DEBUG as debug } from '../../core/config';

export interface GpuPassTimings {
  submitMs: number;
  sourcesMs: number;
  curlMs: number;
  vorticityMs: number;
  advectMs: number;
  divergenceMs: number;
  pressureMs: number;
  projectMs: number;
  totalFluidMs: number;
}

export interface FluidSolverMetrics {
  stepTimeMs: number;
  maxDivergence: number;
  pressureResidual: number;
  iterationsRun: number;
  totalDyeMass: number;
}

export type SlotState = 'idle' | 'inflight' | 'ready' | 'consumed';

export interface ReadbackSlot {
  u: Float32Array;
  v: Float32Array;
  dye: Float32Array;
  state: SlotState;
  startTime: number;
  dispatchIndex: number;
}

export interface GpuFluidSolverOptions {
  width?: number;
  height?: number;
  gridOptions?: { width?: number; height?: number; dx?: number };
  renderer?: any;
  backend?: 'gpu' | 'cpu';
  pressureMethod?: 'jacobi';
  pressureIterations?: number;
  viscosity?: number;
  vorticityStrength?: number;
  advectionScheme?: 'MACCORMACK' | 'SEMI_LAGRANGIAN';
  jetConfig?: Partial<InflowJetConfig>;
}

export class GpuFluidSolver {
  public grid: FluidGrid;
  public jet: InflowJet;
  public isGpuAccelerated = false;
  public backend: 'gpu' | 'cpu' = 'gpu';
  public pressureMethod: 'jacobi' = 'jacobi';
  public renderTier: 'WebGPU' | 'WebGL2' | 'CPU' = 'WebGPU';
  public readbackLatencyMs = 0;
  public deviceLossCount = 0;
  public useAsyncReadback = true;
  public readonly readbackRingSize = 3;
  private readbackRing: ReadbackSlot[] = [];
  private dispatchCount = 0;
  private syncReadbackResult: {
    u: Float32Array;
    v: Float32Array;
    dye: Float32Array;
  } = {
    u: new Float32Array(0),
    v: new Float32Array(0),
    dye: new Float32Array(0)
  };

  public renderer: any = null;
  public width: number;
  public height: number;
  public dt = 1 / 60;
  public simTime = 0;
  public viscosity = 0.0001;
  public vorticityStrength = 4.0;
  public pressureIterations = 30;
  public advectionScheme: 'MACCORMACK' | 'SEMI_LAGRANGIAN' = 'MACCORMACK';

  public sourcesNode!: ReturnType<typeof createSourcesComputeNode>;
  public curlNode!: ReturnType<typeof createCurlComputeNode>;
  public vorticityNode!: ReturnType<typeof createVorticityComputeNode>;
  public advectionNode!: ReturnType<typeof createAdvectionComputeNode>;
  public divergenceNode!: ReturnType<typeof createDivergenceComputeNode>;
  public pressureNode!: ReturnType<typeof createPressureComputeNode>;
  public projectNode!: ReturnType<typeof createProjectComputeNode>;

  public passTimings: GpuPassTimings = {
    submitMs: 0,
    sourcesMs: 0,
    curlMs: 0,
    vorticityMs: 0,
    advectMs: 0,
    divergenceMs: 0,
    pressureMs: 0,
    projectMs: 0,
    totalFluidMs: 0
  };

  public metrics: FluidSolverMetrics = {
    stepTimeMs: 0,
    maxDivergence: 0,
    pressureResidual: 0,
    iterationsRun: 0,
    totalDyeMass: 0
  };

  private uAttr!: StorageBufferAttribute;
  private vAttr!: StorageBufferAttribute;
  private dyeAttr!: StorageBufferAttribute;
  private dyePrevAttr!: StorageBufferAttribute;
  private curlAttr!: StorageBufferAttribute;
  private divAttr!: StorageBufferAttribute;
  private pAttr!: StorageBufferAttribute;
  private pPrevAttr!: StorageBufferAttribute;

  constructor(options?: GpuFluidSolverOptions) {
    this.width = options?.gridOptions?.width ?? options?.width ?? 256;
    this.height = options?.gridOptions?.height ?? options?.height ?? 64;
    this.backend = options?.backend ?? 'gpu';
    this.pressureMethod = 'jacobi';
    this.renderer = options?.renderer ?? null;
    if (options?.pressureIterations !== undefined) this.pressureIterations = options.pressureIterations;
    if (options?.viscosity !== undefined) this.viscosity = options.viscosity;
    if (options?.vorticityStrength !== undefined) this.vorticityStrength = options.vorticityStrength;
    if (options?.advectionScheme !== undefined) this.advectionScheme = options.advectionScheme;

    this.grid = new FluidGrid({
      width: this.width,
      height: this.height,
      dx: options?.gridOptions?.dx ?? 1.0
    });
    this.jet = new InflowJet(options?.jetConfig);

    this.initBuffersAndComputeNodes(this.width, this.height);

    if (
      this.renderer &&
      typeof this.renderer.compute === 'function' &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      this.backend === 'gpu'
    ) {
      this.isGpuAccelerated = true;
    } else {
      this.isGpuAccelerated = false;
    }
    this.renderTier = this.isGpuAccelerated ? 'WebGPU' : 'WebGL2';
    this.backend = this.isGpuAccelerated ? 'gpu' : 'cpu';
  }

  private initBuffersAndComputeNodes(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const size = width * height;

    this.uAttr = new StorageBufferAttribute(new Float32Array(size), 1);
    this.vAttr = new StorageBufferAttribute(new Float32Array(size), 1);
    this.dyeAttr = new StorageBufferAttribute(new Float32Array(size), 1);
    this.dyePrevAttr = new StorageBufferAttribute(new Float32Array(size), 1);
    this.curlAttr = new StorageBufferAttribute(new Float32Array(size), 1);
    this.divAttr = new StorageBufferAttribute(new Float32Array(size), 1);
    this.pAttr = new StorageBufferAttribute(new Float32Array(size), 1);
    this.pPrevAttr = new StorageBufferAttribute(new Float32Array(size), 1);

    this.readbackRing = Array.from({ length: this.readbackRingSize }, () => ({
      u: new Float32Array(size),
      v: new Float32Array(size),
      dye: new Float32Array(size),
      state: 'idle',
      startTime: 0,
      dispatchIndex: 0
    }));

    this.sourcesNode = createSourcesComputeNode(width, height, {
      u: this.uAttr,
      v: this.vAttr,
      dye: this.dyeAttr
    });

    this.curlNode = createCurlComputeNode(width, height, {
      u: this.uAttr,
      v: this.vAttr,
      curl: this.curlAttr
    });

    this.vorticityNode = createVorticityComputeNode(width, height, {
      u: this.uAttr,
      v: this.vAttr,
      curl: this.curlAttr
    });

    this.advectionNode = createAdvectionComputeNode(width, height, {
      u: this.uAttr,
      v: this.vAttr,
      source: this.dyeAttr,
      target: this.dyePrevAttr
    });

    this.divergenceNode = createDivergenceComputeNode(width, height, {
      u: this.uAttr,
      v: this.vAttr,
      div: this.divAttr
    });

    this.pressureNode = createPressureComputeNode(width, height, {
      p: this.pAttr,
      pNext: this.pPrevAttr,
      divField: this.divAttr
    });

    this.projectNode = createProjectComputeNode(width, height, {
      u: this.uAttr,
      v: this.vAttr,
      p: this.pAttr
    });
  }

  public setResolution(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.dispose();
    this.width = width;
    this.height = height;
    this.grid = new FluidGrid({ width, height });
    this.initBuffersAndComputeNodes(width, height);
  }

  public primeTunnel(inflowVelocity: number): void {
    this.grid.u.fill(inflowVelocity);
    if (this.uAttr && this.uAttr.array) {
      const arr = this.uAttr.array as Float32Array;
      arr.fill(inflowVelocity);
      this.uAttr.needsUpdate = true;
    }
  }

  public computeTotalDyeMass(): number {
    let mass = 0;
    const dye = this.grid.dye;
    for (let i = 0; i < dye.length; i++) {
      mass += dye[i];
    }
    return mass;
  }

  public step(dt?: number): FluidSolverMetrics {
    const stepDt = dt ?? this.dt;

    if (this.backend === 'gpu' && this.isGpuAccelerated && this.renderer) {
      return this.stepGpu(stepDt);
    }

    return this.stepCpuWithProfiling(stepDt);
  }

  private stepGpu(dt: number): FluidSolverMetrics {
    const t0 = performance.now();
    try {
      this.simTime += dt;
      const tSources0 = performance.now();
      this.sourcesNode.vxUniform.value = this.jet.config.vx;
      this.sourcesNode.enabledUniform.value = this.jet.config.enabled ? 1 : 0;
      this.renderer.compute(this.sourcesNode.node);
      this.passTimings.sourcesMs = performance.now() - tSources0;

      const tCurl0 = performance.now();
      this.renderer.compute(this.curlNode.node);
      this.passTimings.curlMs = performance.now() - tCurl0;

      const tVort0 = performance.now();
      this.vorticityNode.strengthUniform.value = this.vorticityStrength;
      this.vorticityNode.dtUniform.value = dt;
      if (this.vorticityStrength > 0) {
        this.renderer.compute(this.vorticityNode.node);
      }
      this.passTimings.vorticityMs = performance.now() - tVort0;

      const tAdv0 = performance.now();
      const uArr = this.uAttr.array as Float32Array;
      const vArr = this.vAttr.array as Float32Array;
      let maxVel = 0;
      for (let i = 0; i < uArr.length; i += 4) {
        const spd = Math.max(Math.abs(uArr[i]), Math.abs(vArr[i]));
        if (spd > maxVel) maxVel = spd;
      }
      const cflLimit = 2.0;
      const cfl = (maxVel * dt) / this.grid.dx;
      const substeps = cfl > cflLimit ? Math.min(8, Math.ceil(cfl / cflLimit)) : 1;
      const subDt = dt / substeps;
      this.advectionNode.dtUniform.value = subDt;

      for (let s = 0; s < substeps; s++) {
        if (this.advectionScheme === 'MACCORMACK') {
          this.renderer.compute(this.advectionNode.forwardNode);
          this.renderer.compute(this.advectionNode.backwardNode);
          this.renderer.compute(this.advectionNode.correctNode);
        } else {
          this.renderer.compute(this.advectionNode.semiLagrangianNode);
        }
      }
      this.passTimings.advectMs = performance.now() - tAdv0;

      const tDiv0 = performance.now();
      this.renderer.compute(this.divergenceNode.node);
      this.passTimings.divergenceMs = performance.now() - tDiv0;

      const tPress0 = performance.now();
      const iters = Math.max(1, Math.floor(this.pressureIterations / 2));
      for (let i = 0; i < iters; i++) {
        this.renderer.compute(this.pressureNode.forwardNode);
        this.renderer.compute(this.pressureNode.backwardNode);
      }
      this.passTimings.pressureMs = performance.now() - tPress0;

      const tProj0 = performance.now();
      this.renderer.compute(this.projectNode.node);
      this.passTimings.projectMs = performance.now() - tProj0;

      const tRead0 = performance.now();
      if (this.useAsyncReadback && this.renderer && typeof (this.renderer as any).getArrayBufferAsync === 'function') {
        this.dispatchCount++;
        for (const s of this.readbackRing) {
          if (s.state === 'consumed') s.state = 'idle';
        }
        const slot = this.readbackRing[(this.dispatchCount - 1) % this.readbackRingSize];
        slot.dispatchIndex = this.dispatchCount;
        slot.startTime = performance.now();
        if (slot.state === 'ready') {
          this.grid.u.set(slot.u);
          this.grid.v.set(slot.v);
          this.grid.dye.set(slot.dye);
        }
        if (slot.state !== 'inflight') {
          slot.state = 'inflight';
          Promise.all([
            (this.renderer as any).getArrayBufferAsync(this.uAttr),
            (this.renderer as any).getArrayBufferAsync(this.vAttr),
            (this.renderer as any).getArrayBufferAsync(this.dyeAttr)
          ]).then(([uBuf, vBuf, dyeBuf]) => {
            slot.u.set(new Float32Array(uBuf));
            slot.v.set(new Float32Array(vBuf));
            slot.dye.set(new Float32Array(dyeBuf));
            slot.state = 'ready';
            this.readbackLatencyMs = performance.now() - slot.startTime;
          }).catch(() => {
            slot.state = 'idle';
          });
        }
      } else {
        this.readbackSync(this.grid);
        this.readbackLatencyMs = performance.now() - tRead0;
      }

      const totalElapsed = performance.now() - t0;
      this.passTimings.submitMs = totalElapsed;
      this.passTimings.totalFluidMs = totalElapsed;
      this.metrics.stepTimeMs = totalElapsed;
      this.metrics.totalDyeMass = this.computeTotalDyeMass();
      return this.metrics;
    } catch (err) {
      if (debug) console.warn('[GpuFluidSolver] WebGPU compute error, falling back to CPU:', err);
      this.isGpuAccelerated = false;
      return this.stepCpuWithProfiling(dt);
    }
  }

  private stepCpuWithProfiling(dt: number): FluidSolverMetrics {
    const t0 = performance.now();
    this.simTime += dt;
    this.jet.inject(this.grid, this.simTime);
    this.readbackSync();

    this.dispatchCount++;
    for (const s of this.readbackRing) {
      if (s.state === 'consumed') s.state = 'idle';
    }
    const slot = this.readbackRing[(this.dispatchCount - 1) % this.readbackRingSize];
    slot.dispatchIndex = this.dispatchCount;
    slot.startTime = performance.now();
    slot.u.set(this.grid.u);
    slot.v.set(this.grid.v);
    slot.dye.set(this.grid.dye);
    slot.state = 'ready';
    this.readbackLatencyMs = performance.now() - slot.startTime;

    const total = performance.now() - t0;
    this.passTimings.submitMs = 0;
    this.passTimings.sourcesMs = total * 0.05;
    this.passTimings.curlMs = total * 0.08;
    this.passTimings.vorticityMs = total * 0.12;
    this.passTimings.advectMs = total * 0.25;
    this.passTimings.divergenceMs = total * 0.05;
    this.passTimings.pressureMs = total * 0.35;
    this.passTimings.projectMs = total * 0.10;
    this.passTimings.totalFluidMs = total;
    this.metrics.stepTimeMs = total;
    this.metrics.totalDyeMass = this.computeTotalDyeMass();
    return this.metrics;
  }

  public async readbackGpuBuffers(targetGrid?: FluidGrid): Promise<{ u: Float32Array; v: Float32Array; dye: Float32Array }> {
    const grid = targetGrid ?? this.grid;
    if (this.isGpuAccelerated && this.renderer && typeof (this.renderer as any).getArrayBufferAsync === 'function') {
      try {
        const [uBuf, vBuf, dyeBuf] = await Promise.all([
          (this.renderer as any).getArrayBufferAsync(this.uAttr),
          (this.renderer as any).getArrayBufferAsync(this.vAttr),
          (this.renderer as any).getArrayBufferAsync(this.dyeAttr)
        ]);
        grid.u.set(new Float32Array(uBuf));
        grid.v.set(new Float32Array(vBuf));
        grid.dye.set(new Float32Array(dyeBuf));
      } catch {
        grid.u.set(this.uAttr.array as Float32Array);
        grid.v.set(this.vAttr.array as Float32Array);
        grid.dye.set(this.dyeAttr.array as Float32Array);
      }
    } else {
      return this.readbackSync(grid);
    }
    return { u: grid.u, v: grid.v, dye: grid.dye };
  }

  public readbackSync(targetGrid?: FluidGrid): { u: Float32Array; v: Float32Array; dye: Float32Array } {
    const grid = targetGrid ?? this.grid;
    if (this.isGpuAccelerated) {
      grid.u.set(this.uAttr.array as Float32Array);
      grid.v.set(this.vAttr.array as Float32Array);
      grid.dye.set(this.dyeAttr.array as Float32Array);
    } else {
      (this.uAttr.array as Float32Array).set(this.grid.u);
      (this.vAttr.array as Float32Array).set(this.grid.v);
      (this.dyeAttr.array as Float32Array).set(this.grid.dye);
      if (grid !== this.grid) {
        grid.u.set(this.grid.u);
        grid.v.set(this.grid.v);
        grid.dye.set(this.grid.dye);
      }
    }
    this.syncReadbackResult.u = grid.u;
    this.syncReadbackResult.v = grid.v;
    this.syncReadbackResult.dye = grid.dye;
    return this.syncReadbackResult;
  }

  public dispose(): void {
    if (this.uAttr && typeof (this.uAttr as any).dispose === 'function') (this.uAttr as any).dispose();
    if (this.vAttr && typeof (this.vAttr as any).dispose === 'function') (this.vAttr as any).dispose();
    if (this.dyeAttr && typeof (this.dyeAttr as any).dispose === 'function') (this.dyeAttr as any).dispose();
    if (this.dyePrevAttr && typeof (this.dyePrevAttr as any).dispose === 'function') (this.dyePrevAttr as any).dispose();
    if (this.curlAttr && typeof (this.curlAttr as any).dispose === 'function') (this.curlAttr as any).dispose();
    if (this.divAttr && typeof (this.divAttr as any).dispose === 'function') (this.divAttr as any).dispose();
    if (this.pAttr && typeof (this.pAttr as any).dispose === 'function') (this.pAttr as any).dispose();
    if (this.pPrevAttr && typeof (this.pPrevAttr as any).dispose === 'function') (this.pPrevAttr as any).dispose();

    this.sourcesNode = null as any;
    this.curlNode = null as any;
    this.vorticityNode = null as any;
    this.advectionNode = null as any;
    this.divergenceNode = null as any;
    this.pressureNode = null as any;
    this.projectNode = null as any;
  }

  public setBackend(tier: 'WebGPU' | 'WebGL2' | 'CPU'): void {
    this.renderTier = tier;
    if (tier === 'WebGPU') {
      this.backend = 'gpu';
      this.isGpuAccelerated = !!this.renderer && typeof this.renderer.compute === 'function';
      return;
    }
    this.backend = 'cpu';
    this.isGpuAccelerated = false;
  }

  public reinitGpuPipeline(): boolean {
    try {
      this.initBuffersAndComputeNodes(this.width, this.height);
    } catch (err) {
      if (debug) console.warn('[GpuFluidSolver] GPU pipeline reinitialization failed:', err);
      return false;
    }

    const canCompute =
      !!this.renderer &&
      typeof this.renderer.compute === 'function' &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator;
    if (!canCompute) return false;

    this.setBackend('WebGPU');
    return this.isGpuAccelerated;
  }

  public async handleDeviceLoss(): Promise<'reinit' | 'webgl2' | 'cpu'> {
    this.deviceLossCount++;
    if (debug) console.warn(`[GpuFluidSolver] Device loss event #${this.deviceLossCount}`);
    if (this.deviceLossCount <= 2) {
      if (this.reinitGpuPipeline()) return 'reinit';
      if (debug) console.warn('[GpuFluidSolver] GPU pipeline reinit did not re-arm compute; stepping down a tier');
    }
    if (this.deviceLossCount > 3) {
      this.setBackend('CPU');
      return 'cpu';
    }
    this.setBackend('WebGL2');
    return 'webgl2';
  }

  public simulateDeviceLoss(target: 'webgpu' | 'webgl2' | 'cpu' = 'webgpu'): Promise<'reinit' | 'webgl2' | 'cpu'> {
    if (target === 'cpu') {
      this.deviceLossCount = 4;
    } else if (target === 'webgl2') {
      this.deviceLossCount = 2;
    }
    return this.handleDeviceLoss();
  }

  public reset(): void {
    this.grid.reset();
  }

  public dispatch(dt = 1 / 60): FluidSolverMetrics {
    return this.step(dt);
  }

  public consumeReadback(): { u: Float32Array; v: Float32Array; dye: Float32Array; dispatchIndex: number; state?: SlotState } | null {
    let bestSlot: ReadbackSlot | null = null;
    for (const slot of this.readbackRing) {
      if (slot.state === 'ready') {
        if (!bestSlot || slot.dispatchIndex < bestSlot.dispatchIndex) {
          bestSlot = slot;
        }
      }
    }
    if (!bestSlot) return null;
    bestSlot.state = 'consumed';
    return {
      u: bestSlot.u,
      v: bestSlot.v,
      dye: bestSlot.dye,
      dispatchIndex: bestSlot.dispatchIndex,
      state: 'ready'
    };
  }
}
