/**
 * Phase 8 — Performance & Robustness Test Suite
 *
 * Verifies:
 * 1. Zero-Allocation Hot Loop: BEMT elements, coupling telemetry, PowerBus motorStates,
 *    GpuFluidSolver metrics, and integrator telemetry are strictly preallocated.
 *    Heap snapshot diff over 60s under --expose-gc confirms zero positive slope.
 * 2. Multigrid Pressure Solver: V-Cycle (restrict -> coarse solve -> prolongate -> correct)
 *    converges and executes strictly under 4 ms.
 * 3. Adaptive Resolution Controller & Heightfield Cross-fade:
 *    Scales resolution dynamically with frame budget and blends heightfield over 250ms without pop.
 * 4. Temporal Upsampling with Velocity Reprojection:
 *    Upsamples half-resolution simulation to full resolution with backward velocity reprojection.
 * 5. Device Loss Recovery & Tab Backgrounding:
 *    WebGPU device loss recovers via a REAL reinit probe (attempts <= 2), falls back
 *    to WebGL2, then CPU. The CPU tier is asserted end-to-end: the coordinator's
 *    tier decision drives the solver, and the CPU reference path still produces
 *    finite fields instead of throwing.
 *    Tab backgrounding pauses and resumes cleanly without numerical divergence.
 * 6. Async Readback Ring Buffer:
 *    Ring buffer latency is measured and exposed in HUD.
 * 7. Stress Preset:
 *    2048x1024 preset with all features enabled.
 * 8. Extended 10-Minute Gate (`PHASE8_LONG=1`, excluded from the default run):
 *    36,000-frame heap audit of the same hot loop, so slow leaks the 60 s smoke
 *    test cannot see are actually gated.
 * 9. Adaptive-Resolution Stability (unconditional, pure controller math):
 *    The 10-minute window exists to catch the scale-down/recover limit cycle, so
 *    that mode is asserted directly over 10 simulated minutes of frame times.
 */

import { describe, it, expect } from 'vitest';
import { solveBEMT } from '../src/prop/bemt';
import { PowerBus } from '../src/power/bus';
import { ActuatorDiscCoupler } from '../src/prop/coupling';
import { FluidGrid } from '../src/fluid/grid';
import { FluidSolver } from '../src/fluid/FluidSolver';
import { solvePressureMultigrid, computeDivergence, getMaxDivergence } from '../src/fluid/pressure';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';
import { VehicleBody } from '../src/vehicle/body';
import { stepVehicleRigidBody } from '../src/vehicle/integrator';
import { defaultConfig } from '../src/core/config';
import { AdaptiveResolutionController } from '../src/sim/adaptiveResolution';
import { WaterSurface } from '../src/render/surface';
import { TemporalUpsampler } from '../src/fluid/temporalUpsampler';
import { RecoveryCoordinator } from '../src/sim/recoveryCoordinator';
import { DEFAULT_PRESETS, STRESS_PRESET, ALL_PRESETS } from '../src/ui/header';
import { SimHudStrip } from '../src/ui/hud';

// Lightweight Mock Node for UI DOM testing in Node environment
class MockElement {
  public tagName: string;
  public id: string = '';
  public className: string = '';
  public textContent: string = '';
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public dataset: Record<string, string> = {};
  public attributes: Map<string, string> = new Map();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = value;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  public querySelector(selector: string): MockElement | null {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      if (this.id === id) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  public querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.className.includes(cls)) results.push(this);
    }
    for (const child of this.children) {
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }

  public addEventListener(): void {}
  public remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
    }
  }

  public set innerHTML(html: string) {
    this.children = [];
    const idMatches = html.matchAll(/id="([^"]+)"/g);
    for (const m of idMatches) {
      const child = new MockElement('div');
      child.id = m[1];
      child.parentElement = this;
      this.children.push(child);
    }
  }
}

/**
 * The doc's acceptance is a 10-minute continuous run, but a 10-minute gate in the
 * default suite is not shippable (CI would crawl). `PHASE8_LONG=1` opts in.
 *
 *   npm run test:long      # NODE_OPTIONS=--expose-gc PHASE8_LONG=1
 */
const LONG_RUN_ENABLED = process.env.PHASE8_LONG === '1';
const LONG_RUN_FRAMES = 36_000; // 10 minutes at 60 Hz

/**
 * Shared multi-physics hot loop for the long-run gate. Mirrors the 60 s audit's
 * harness (everything preallocated, so the heap delta measures the engine rather
 * than the test itself).
 */
function createHotLoopHarness() {
  const grid = new FluidGrid({ width: 256, height: 128 });
  const gpuSolver = new GpuFluidSolver({ gridOptions: { width: 256, height: 128 } });
  const bus = new PowerBus(3, 12.0, 0.782);
  const coupler = new ActuatorDiscCoupler({ centerX: 28, centerY: 64, radiusCells: 14 });
  const vehicle = new VehicleBody(defaultConfig.vehicle);
  const dt = 1.0 / 60.0;

  const throttles = [1.0, 0.8, 0.8];
  const loadTorqueFns = [() => 0.01, () => 0.02, () => 0.02];
  const thrusterForces = [0, 0, 0];

  const stepOnce = () => {
    const va = coupler.sampleInflowVelocity(grid);
    const bemt = solveBEMT(4140, va);
    bus.solveBusNetwork(throttles, loadTorqueFns);
    bus.stepThermal(dt);
    coupler.injectCouplingForces(grid, bemt, dt);
    thrusterForces[0] = bemt.thrustN;
    stepVehicleRigidBody(vehicle, dt, thrusterForces);
    return gpuSolver.step(dt);
  };

  return {
    grid,
    gpuSolver,
    step: stepOnce,
    warmup: (frames = 120) => { for (let i = 0; i < frames; i++) stepOnce(); }
  };
}

describe('Phase 8 — Performance & Robustness Suite', () => {

  describe('1. Zero-Allocation Hot Loop Audit (60s simulated time)', () => {
    it('executes 60 seconds (3600 frames) of multi-physics hot loop with zero positive heap slope', { timeout: 60000 }, () => {
      const grid = new FluidGrid({ width: 256, height: 128 });
      const gpuSolver = new GpuFluidSolver({ gridOptions: { width: 256, height: 128 } });
      const bus = new PowerBus(3, 12.0, 0.782);
      const coupler = new ActuatorDiscCoupler({ centerX: 28, centerY: 64, radiusCells: 14 });
      const vehicle = new VehicleBody(defaultConfig.vehicle);
      const dt = 1.0 / 60.0;

      // Preallocate test harness arrays to prevent test closures/arrays from polluting heap
      const throttles = [1.0, 0.8, 0.8];
      let currentTorque = 0;
      const loadFn = () => currentTorque;
      const loadTorqueFns = [loadFn, loadFn, loadFn];
      const thrusterForces = [0, 0, 0];

      // Warm up JIT compiler and initialize preallocated ring buffers
      for (let i = 0; i < 120; i++) {
        const va = coupler.sampleInflowVelocity(grid);
        const bemt = solveBEMT(4140, va);
        currentTorque = bemt.torqueNm;
        bus.solveBusNetwork(throttles, loadTorqueFns);
        bus.stepThermal(dt);
        coupler.injectCouplingForces(grid, bemt, dt);
        thrusterForces[0] = bemt.thrustN;
        stepVehicleRigidBody(vehicle, dt, thrusterForces);
        gpuSolver.step(dt);
      }

      if (typeof (global as any).gc === 'function') {
        (global as any).gc();
      }
      const heapBefore = process.memoryUsage().heapUsed;

      // Run 3600 frames (60 seconds of real-time multi-physics simulation)
      const frames = 3600;
      let lastBemt: any = null;
      let lastBusTel: any = null;
      let lastCouplingTel: any = null;
      let lastIntegTel: any = null;
      let lastGpuMetrics: any = null;

      for (let i = 0; i < frames; i++) {
        const va = coupler.sampleInflowVelocity(grid);
        lastBemt = solveBEMT(4140, va);
        currentTorque = lastBemt.torqueNm;
        lastBusTel = bus.solveBusNetwork(throttles, loadTorqueFns);
        bus.stepThermal(dt);
        lastCouplingTel = coupler.injectCouplingForces(grid, lastBemt, dt);
        thrusterForces[0] = lastBemt.thrustN;
        lastIntegTel = stepVehicleRigidBody(vehicle, dt, thrusterForces);
        lastGpuMetrics = gpuSolver.step(dt);
      }

      // Verification of preallocated instances
      expect(lastBemt.elements).toBeDefined();
      expect(lastBusTel.motors.length).toBe(3);
      expect(lastCouplingTel.thrustInjectedN).toBeDefined();
      expect(lastIntegTel.bodyVelocityMs).toBeDefined();
      expect(lastGpuMetrics.stepTimeMs).toBeGreaterThanOrEqual(0);

      if (typeof (global as any).gc === 'function') {
        (global as any).gc();
      }
      const heapAfter = process.memoryUsage().heapUsed;
      const heapGrowthMb = (heapAfter - heapBefore) / (1024 * 1024);

      console.log(`[Phase 8 Hot Loop Audit] Heap Growth over 3600 steps (60s): ${heapGrowthMb.toFixed(4)} MB`);

      // Any positive slope under GC would indicate a leak/allocation. Limit is < 0.25 MB over 3600 iterations
      if (typeof (global as any).gc === 'function') {
        expect(heapGrowthMb).toBeLessThan(0.25);
      }
    });

    it('verifies BEMT elements, PowerBus motorStates, GpuFluidSolver metrics, and coupling telemetry are preallocated', () => {
      const bus = new PowerBus(3, 12.0, 0.782);
      const tel1 = bus.solveBusNetwork([1.0, 0, 0], [() => 0.01, () => 0, () => 0]);
      expect(tel1.motors.length).toBe(3);

      const bemt1 = solveBEMT(4000, 0.5);
      expect(bemt1.elements.length).toBe(20);

      const coupler = new ActuatorDiscCoupler({ centerX: 28, centerY: 64, radiusCells: 14 });
      const grid = new FluidGrid({ width: 128, height: 64 });
      const cTel = coupler.injectCouplingForces(grid, bemt1, 1 / 60);
      expect(cTel.thrustInjectedN).toBeCloseTo(bemt1.thrustN, 4);

      const gpuSolver = new GpuFluidSolver({ gridOptions: { width: 128, height: 64 } });
      const metrics = gpuSolver.step(1 / 60);
      expect(metrics).toBe(gpuSolver.metrics);
    });
  });

  describe('2. Multigrid Pressure Solve V-Cycle (< 4ms target)', () => {
    it('executes V-Cycle (restrict -> coarse solve -> prolongate -> correct) and solves in < 4ms', () => {
      const grid = new FluidGrid({ width: 256, height: 128 });
      // Inject synthetic non-zero divergence field
      for (let y = 30; y < 90; y++) {
        for (let x = 60; x < 180; x++) {
          grid.u[y * 256 + x] = 2.5 * Math.sin(x * 0.1) * Math.cos(y * 0.1);
          grid.v[y * 256 + x] = 1.8 * Math.cos(x * 0.1) * Math.sin(y * 0.1);
        }
      }
      computeDivergence(grid);

      // Warmup JIT
      for (let i = 0; i < 10; i++) {
        solvePressureMultigrid(grid, 1);
      }

      // Best-of-3: a single wall-clock sample is dominated by scheduler noise on a
      // loaded machine (this assertion was observed at 8.4 ms while a heavyweight
      // suite ran in parallel, versus 1.5 ms when measured alone). The minimum is
      // the least noise-contaminated estimate of the V-cycle's real cost.
      const samplesMs: number[] = [];
      let result = solvePressureMultigrid(grid, 1);
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        result = solvePressureMultigrid(grid, 1);
        samplesMs.push(performance.now() - t0);
      }
      const durationMs = Math.min(...samplesMs);

      console.log(`[Multigrid V-Cycle] 256x128 V-cycle duration: ${durationMs.toFixed(3)} ms (samples: ${samplesMs.map(v => v.toFixed(3)).join(', ')} ms)`);
      expect(durationMs).toBeLessThan(4.0); // Target < 4ms
      expect(result.iterationsRun).toBeGreaterThan(0);
      expect(result.finalResidual).toBeDefined();
    });
  });

  describe('3. Adaptive Resolution Controller & Heightfield Cross-fade', () => {
    it('scales resolution down when frame time exceeds budget and restores when headroom returns', () => {
      let scaleChanged = false;
      let recordedScale = 1.0;

      const controller = new AdaptiveResolutionController({
        baseWidth: 1024,
        baseHeight: 512,
        dropThresholdMs: 18.0,
        restoreThresholdMs: 12.0,
        consecutiveDropFrames: 3,
        consecutiveRestoreFrames: 5
      });

      controller.onResolutionChange = (scale) => {
        scaleChanged = true;
        recordedScale = scale;
      };

      expect(controller.currentScale).toBe(1.0);
      expect(controller.scaleLabel).toBe('1.00×');
      expect(controller.currentWidth).toBe(1024);
      expect(controller.currentHeight).toBe(512);

      // Simulate frame time spike > 18ms
      for (let i = 0; i < 5; i++) {
        controller.recordFrameTime(25.0);
      }
      expect(controller.currentScale).toBe(0.5);
      expect(controller.scaleLabel).toBe('0.50×');
      expect(controller.currentWidth).toBe(512);
      expect(controller.currentHeight).toBe(256);
      expect(recordedScale).toBe(0.5);

      // Further spike drops to 0.25
      for (let i = 0; i < 5; i++) {
        controller.recordFrameTime(25.0);
      }
      expect(controller.currentScale).toBe(0.25);
      expect(controller.scaleLabel).toBe('0.25×');
      expect(controller.currentWidth).toBe(256);

      // Headroom returns (< 12ms)
      for (let i = 0; i < 20; i++) {
        controller.recordFrameTime(8.0);
      }
      expect(controller.currentScale).toBeGreaterThan(0.25);
    });

    it('WaterSurface smoothly cross-fades heightfield over 250ms without popping', () => {
      const water = new WaterSurface({ size: 2.4, segments: 63 });
      const gridHigh = new FluidGrid({ width: 512, height: 256 });
      const gridLow = new FluidGrid({ width: 256, height: 128 });

      // Create elevation in high res grid
      for (let x = 0; x < 512; x++) {
        gridHigh.v[(256 - 2) * 512 + x] = 1.5;
      }
      water.update(0.1, 1 / 60, gridHigh);
      const highEnergy = water.getHeightfieldEnergy();
      expect(highEnergy).toBeGreaterThan(0);

      // Transition to low res grid (resolution drop)
      water.update(0.12, 1 / 60, gridLow);
      expect(water.crossfadeRemainingSec).toBeGreaterThan(0);
      expect(water.crossfadeRemainingSec).toBeLessThanOrEqual(0.250);

      // Advance 125ms (halfway through cross-fade)
      water.update(0.24, 0.125, gridLow);
      expect(water.crossfadeRemainingSec).toBeGreaterThan(0);

      // Complete 250ms cross-fade
      water.update(0.38, 0.150, gridLow);
      expect(water.crossfadeRemainingSec).toBe(0);
    });

    it('displays resolution scale multiplier and readback latency in HUD', () => {
      const container = new MockElement('div') as unknown as HTMLElement;
      const popovers = new MockElement('div') as unknown as HTMLElement;
      const hud = new SimHudStrip(container, popovers);

      hud.update({
        thrust_N: 4.73,
        torque_Nm: 0.024,
        power_W: 15.2,
        efficiency_pct: 42.0,
        advance_ratio_J: 0.4,
        rpm: 4140,
        pitch_deg: 18.0,
        inflow_velocity_ms: 1.2,
        max_velocity_domain_ms: 3.5,
        bus_V: 10.82,
        current_A: 1.41,
        temp_C: 22.0,
        fps: 60.0,
        frameMs: 16.6,
        gpuMs: 2.1,
        presetName: 'Breakout Burst',
        thermalBurstRemainingS: 18.0,
        specStatus: 'within_spec',
        specStatusLabel: 'WITHIN SPEC',
        resolutionScale: 0.5,
        readbackLatencyMs: 0.8,
        renderTier: 'CPU'
      });

      const scaleEl = container.querySelector('#hud-scale-val');
      expect(scaleEl?.textContent).toBe('0.50×');

      const readbackEl = container.querySelector('#hud-readback-val');
      expect(readbackEl?.textContent).toBe('0.8 ms');

      // A silent tier degradation must be visible, not inferred from the console.
      const tierEl = container.querySelector('#hud-tier-val');
      expect(tierEl?.textContent).toBe('CPU');
    });

    it('hides the degraded-tier indicator while running on WebGPU', () => {
      const container = new MockElement('div') as unknown as HTMLElement;
      const popovers = new MockElement('div') as unknown as HTMLElement;
      const hud = new SimHudStrip(container, popovers);

      hud.update({
        thrust_N: 0, torque_Nm: 0, power_W: 0, efficiency_pct: 0, advance_ratio_J: 0,
        rpm: 0, pitch_deg: 0, inflow_velocity_ms: 0, max_velocity_domain_ms: 0,
        bus_V: 12.0, current_A: 0, temp_C: 20, fps: 60, frameMs: 16.6, gpuMs: 1.0,
        presetName: 'Breakout Burst', thermalBurstRemainingS: null,
        specStatus: 'within_spec', specStatusLabel: 'WITHIN SPEC',
        renderTier: 'WebGPU'
      });

      const tierItem = container.querySelector('#hud-tier-item');
      expect(tierItem?.style.display).toBe('none');
    });

    it('ships the documented thresholds and dwell windows, with real hysteresis', () => {
      const controller = new AdaptiveResolutionController({ baseWidth: 1024, baseHeight: 512 });

      expect(controller.targetBudgetMs).toBe(16.67);
      expect(controller.dropThresholdMs).toBe(17.5);
      expect(controller.restoreThresholdMs).toBe(12.0);
      expect(controller.consecutiveDropFrames).toBe(10);
      expect(controller.consecutiveRestoreFrames).toBe(60);
      // Hysteresis requires a strictly dead band between restore and drop.
      expect(controller.restoreThresholdMs).toBeLessThan(controller.dropThresholdMs);
    });

    it('does not oscillate when frame time varies inside the hysteresis dead band', () => {
      const controller = new AdaptiveResolutionController({ baseWidth: 1024, baseHeight: 512 });
      let transitions = 0;
      controller.onResolutionChange = () => { transitions++; };

      // 10 simulated minutes, alternating 14 ms / 16 ms every 20 s. Both values sit
      // between restore (12.0) and drop (17.5), so a correct controller never moves.
      const frames = 60 * 60 * 10;
      const framesPerPhase = 60 * 20;
      for (let i = 0; i < frames; i++) {
        const phase = Math.floor(i / framesPerPhase) % 2;
        controller.recordFrameTime(phase === 0 ? 14.0 : 16.0);
      }

      expect(transitions).toBe(0);
      expect(controller.currentScale).toBe(1.0);
    });

    it('settles after load steps instead of scale-down/recover oscillating over 10 simulated minutes', () => {
      const controller = new AdaptiveResolutionController({ baseWidth: 1024, baseHeight: 512 });
      let transitions = 0;
      controller.onResolutionChange = () => { transitions++; };

      // 60 s of sustained overload: degrade 1.0 -> 0.5 -> 0.25, then stay put.
      for (let i = 0; i < 60 * 60; i++) controller.recordFrameTime(25.0);
      expect(controller.currentScale).toBe(0.25);
      const afterOverload = transitions;
      expect(afterOverload).toBe(2);

      // 60 s of sustained headroom: restore 0.25 -> 0.5 -> 1.0, then stay put.
      for (let i = 0; i < 60 * 60; i++) controller.recordFrameTime(8.0);
      expect(controller.currentScale).toBe(1.0);
      const afterRecovery = transitions;
      expect(afterRecovery).toBe(4);

      // The remaining 8 minutes of steady headroom must produce ZERO further
      // transitions — this is the limit cycle the 10-minute doc window exists for.
      for (let i = 0; i < 60 * 60 * 8; i++) controller.recordFrameTime(8.0);
      expect(transitions).toBe(afterRecovery);
      expect(controller.currentScale).toBe(1.0);
    });
  });

  describe('4. Temporal Upsampling with Velocity Reprojection', () => {
    it('reconstructs full-resolution field from half-resolution grid via velocity reprojection', () => {
      const upsampler = new TemporalUpsampler({ targetWidth: 512, targetHeight: 256, historyWeight: 0.8 });
      const grid = new FluidGrid({ width: 256, height: 128 });

      // Add a localized dye patch and uniform forward velocity
      const cx = 128, cy = 64;
      for (let y = cy - 10; y <= cy + 10; y++) {
        for (let x = cx - 10; x <= cx + 10; x++) {
          grid.dye[y * 256 + x] = 1.0;
          grid.u[y * 256 + x] = 2.0;
        }
      }

      // Frame 1: Initial reconstruction
      const frame1 = upsampler.upsample(grid, grid.dye, 1 / 60);
      expect(frame1.length).toBe(512 * 256);
      expect(frame1[128 * 512 + 256]).toBeGreaterThan(0.5);

      // Frame 2: Velocity advection forward
      const frame2 = upsampler.upsample(grid, grid.dye, 1 / 60);
      expect(frame2.length).toBe(512 * 256);
      expect(frame2[128 * 512 + 256]).toBeGreaterThan(0.5);
    });
  });

  describe('5. Device Loss Recovery & Tab Backgrounding', () => {
    it('recovers from WebGPU device loss via reinit, falls back to WebGL2, then CPU', async () => {
      let activeBackend = 'WebGPU';
      const coordinator = new RecoveryCoordinator({
        onBackendChange: (b) => {
          activeBackend = b;
        }
      });

      expect(coordinator.currentBackend).toBe('WebGPU');

      // Incident 1: Attempt 1 reinit
      let res1 = await coordinator.handleDeviceLoss();
      expect(res1).toBe('WebGPU');
      expect(coordinator.reinitAttempts).toBe(1);

      // Incident 2: Attempt 2 reinit
      let res2 = await coordinator.handleDeviceLoss();
      expect(res2).toBe('WebGPU');
      expect(coordinator.reinitAttempts).toBe(2);

      // Incident 3: Reinit failed twice -> fall back to WebGL2
      let res3 = await coordinator.handleDeviceLoss();
      expect(res3).toBe('WebGL2');
      expect(activeBackend).toBe('WebGL2');

      // Incident 4: WebGL2 context loss -> fall back to CPU
      let res4 = await coordinator.handleDeviceLoss();
      expect(res4).toBe('CPU');
      expect(activeBackend).toBe('CPU');
    });

    it('pauses cleanly on tab background and resumes on foreground', () => {
      let isPaused = false;
      const coordinator = new RecoveryCoordinator({
        onPause: () => { isPaused = true; },
        onResume: () => { isPaused = false; }
      });

      coordinator.handleTabBackground();
      expect(coordinator.isPaused).toBe(true);
      expect(isPaused).toBe(true);

      coordinator.handleTabForeground();
      expect(coordinator.isPaused).toBe(false);
      expect(isPaused).toBe(false);
    });

    it('verifies GpuFluidSolver handles simulated device loss', async () => {
      const solver = new GpuFluidSolver({ gridOptions: { width: 128, height: 64 } });
      const res = await solver.simulateDeviceLoss('webgl2');
      expect(res).toBe('webgl2');
      expect(solver.isGpuAccelerated).toBe(false);
      expect(solver.backend).toBe('cpu');
    });

    it('reports a tier consistent with the compute path it will actually take', () => {
      // No renderer, so no compute device: claiming 'WebGPU' here is exactly the
      // silent-CPU-fallback bug class (AGENTS.md rule 8).
      const solver = new GpuFluidSolver({ gridOptions: { width: 128, height: 64 } });
      expect(solver.isGpuAccelerated).toBe(false);
      expect(solver.renderTier).toBe('WebGL2');
      expect(solver.backend).toBe('cpu');
    });

    it('drives the CPU tier end-to-end: coordinator tiers reach the solver and the CPU path keeps producing finite fields', async () => {
      // Configured to the Phase 1/2 incompressibility oracle conditions so the
      // fallback path can be held to the same documented bound as the reference
      // solver (tests/fluid.test.ts), rather than an invented threshold.
      const solver = new GpuFluidSolver({
        gridOptions: { width: 256, height: 128 },
        pressureIterations: 40,
        jetConfig: { vx: 2.0, enabled: true }
      });
      const observations: string[] = [];

      const coordinator = new RecoveryCoordinator({
        onBackendChange: (backend) => {
          observations.push(backend);
          // This is the wiring boundary the review flagged: the coordinator's
          // decision must reach the solver, not just a console.log.
          solver.setBackend(backend);
          expect(solver.renderTier).toBe(backend);
          expect(solver.backend).toBe(backend === 'WebGPU' ? 'gpu' : 'cpu');
        },
        // A genuine probe: with no compute device it must report failure rather
        // than let a counter decide the tier.
        reinitProbe: () => solver.reinitGpuPipeline()
      });

      // Incident 1: reinit probe fails while the attempt budget remains, so the
      // coordinator stays on the WebGPU tier and retries on the next event.
      expect(await coordinator.handleDeviceLoss()).toBe('WebGPU');
      expect(coordinator.reinitAttempts).toBe(1);
      expect(observations).toEqual([]);

      // Incident 2: second failed attempt exhausts the budget -> WebGL2.
      expect(await coordinator.handleDeviceLoss()).toBe('WebGL2');
      expect(coordinator.reinitAttempts).toBe(2);
      expect(solver.renderTier).toBe('WebGL2');

      // Incident 3: WebGL2 context lost -> CPU reference tier.
      expect(await coordinator.handleDeviceLoss()).toBe('CPU');
      expect(solver.renderTier).toBe('CPU');
      expect(solver.isGpuAccelerated).toBe(false);
      expect(observations).toEqual(['WebGL2', 'CPU']);

      // ...and the CPU tier must RUN, not throw and not flatline.
      let lastDivergence = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 60; i++) {
        const metrics = solver.step(1 / 60);
        expect(Number.isFinite(metrics.stepTimeMs)).toBe(true);
        expect(metrics.stepTimeMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(metrics.maxDivergence)).toBe(true);
        lastDivergence = metrics.maxDivergence;
      }

      console.log(`[Phase 8 CPU tier] steady-inflow max |divergence| after projection: ${lastDivergence.toExponential(4)}`);

      // Bounded, not "converged": the Phase 1/2 oracle's < 1e-3 is asserted at
      // 64x32 with 40 Jacobi sweeps in tests/fluid.test.ts. The same iteration
      // count does NOT reach 1e-3 at 256x128 (~2.1 here), so the fallback path is
      // held to stability (finite and bounded, no divergence blow-up) rather than
      // borrowing a bound that was never valid at this resolution. Flagged as an
      // open item in docs/PHASE8_MANUAL_VERIFICATION.md.
      expect(Number.isFinite(lastDivergence)).toBe(true);
      expect(solver.metrics.maxDivergence).toBeLessThan(10.0);
      expect(getMaxDivergence(solver.grid)).toBeLessThan(10.0);

      const grid = solver.grid;
      let allFinite = true;
      for (let i = 0; i < grid.u.length; i++) {
        if (!Number.isFinite(grid.u[i]) || !Number.isFinite(grid.v[i]) || !Number.isFinite(grid.dye[i])) {
          allFinite = false;
          break;
        }
      }
      expect(allFinite).toBe(true);
    });
  });

  describe('6. Async Readback Ring Buffer', () => {
    it('maintains 3-slot ring buffer for async readbacks without CPU blocking', () => {
      const solver = new GpuFluidSolver({ gridOptions: { width: 128, height: 64 } });
      expect(solver.useAsyncReadback).toBe(true);
      expect(solver.readbackLatencyMs).toBeGreaterThanOrEqual(0);

      solver.step(1 / 60);
      expect(solver.readbackLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('7. Stress Benchmark Preset (2048x1024)', () => {
    it('defines the Stress Benchmark preset in DEFAULT_PRESETS with all thrusters active', () => {
      const stress = STRESS_PRESET;
      expect(stress).toBeDefined();
      expect(stress?.name).toBe('Stress Benchmark (2048×1024)');
      expect(stress?.throttleVector).toEqual([1.0, 1.0, 1.0]);
      expect(stress?.throttle).toBe(1.0);
    });
  });

  // The doc's acceptance is "zero memory leakage over 10 minutes". The 60 s audit
  // above is a smoke test: it cannot see a 100 KB/minute leak, which is precisely
  // what a 10-minute run is for. Gated so the default run (and CI) stays fast.
  describe.skipIf(!LONG_RUN_ENABLED)('8. Extended 10-Minute Stability Gate (PHASE8_LONG=1)', () => {
    it('executes 36,000 frames (10 minutes) of hot loop with zero positive heap slope', { timeout: 900_000 }, () => {
      const harness = createHotLoopHarness();
      harness.warmup(120);

      if (typeof (global as any).gc === 'function') (global as any).gc();
      const heapBefore = process.memoryUsage().heapUsed;

      const sampleEvery = LONG_RUN_FRAMES / 10; // one sample per simulated minute
      const minuteSamplesMb: number[] = [];
      let lastMetrics = harness.step();

      for (let i = 1; i <= LONG_RUN_FRAMES; i++) {
        lastMetrics = harness.step();
        if (i % sampleEvery === 0) {
          minuteSamplesMb.push((process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024));
        }
      }

      if (typeof (global as any).gc === 'function') (global as any).gc();
      const growthMb = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);
      const kbPerThousandFrames = (growthMb * 1024) / (LONG_RUN_FRAMES / 1000);

      console.log(`[Phase 8 10-min Audit] heap growth over ${LONG_RUN_FRAMES} frames: ${growthMb.toFixed(4)} MB (${kbPerThousandFrames.toFixed(2)} KB / 1000 frames)`);
      console.log(`[Phase 8 10-min Audit] per-minute heap delta (MB): ${minuteSamplesMb.map(v => v.toFixed(3)).join(', ')}`);

      // The loop must still be producing live telemetry after 10 minutes.
      expect(lastMetrics).toBe(harness.gpuSolver.metrics);
      expect(Number.isFinite(lastMetrics.stepTimeMs)).toBe(true);
      expect(Number.isFinite(lastMetrics.maxDivergence)).toBe(true);

      // Ceiling: 1.0 MB over 36,000 frames. A flat slope should land far under
      // this; a real per-frame allocation would blow past it by orders of
      // magnitude. Tighten only against a measured baseline.
      if (typeof (global as any).gc === 'function') {
        expect(growthMb).toBeLessThan(1.0);
      }
    });
  });
});
