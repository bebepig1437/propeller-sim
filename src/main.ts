import './index.css';
import * as THREE from 'three';
import { defaultConfig, DEBUG as debug, MEDIUMS, type SimulationMedium } from './core/config';
import { SimClock } from './core/clock';
import { GpuFluidSolver } from './fluid/gpu/gpuFluidSolver';
import { AppRenderer } from './render/renderer';
import { GpuTimer } from './telemetry/gpuTimer';
import { buildSimLayout } from './ui/layout';
import { SimHeader } from './ui/header';
import { SimHudStrip } from './ui/hud';
import { CanvasRecorder } from './ui/recorder';
import { PropellerShaft } from './prop/rigidbody';
import { solveBemt } from './prop/bemt';
import { getPropDesign } from './prop/designs/index';
import { PowerBus } from './power/bus';
import { ActuatorDiscCoupler } from './prop/coupling';
import { RecoveryCoordinator } from './sim/recoveryCoordinator';
import type { HudMetricsData } from './types/telemetry';
import type { PropMaterialId } from './prop/materials';

export class App {
  private clock!: SimClock;
  private videoRecorder = new CanvasRecorder();
  public renderer!: AppRenderer;
  public fluidSolver!: GpuFluidSolver;
  public fluidSolverB!: GpuFluidSolver;
  public gpuTimer!: GpuTimer;
  public recovery!: RecoveryCoordinator;

  public shaft = new PropellerShaft(4140, 18.0);
  public bus = new PowerBus(1, 12.0, 0.782);
  public coupler = new ActuatorDiscCoupler({
    centerX: 64,
    centerY: 32,
    radiusCells: 14,
    thicknessCells: 3,
    gridDxM: 0.0015,
    depthM: 0.042,
    inflowRelaxation: 0.5
  });

  public shaftB = new PropellerShaft(4140, 18.0);
  public busB = new PowerBus(1, 12.0, 0.782);
  public couplerB = new ActuatorDiscCoupler({
    centerX: 64,
    centerY: 32,
    radiusCells: 14,
    thicknessCells: 3,
    gridDxM: 0.0015,
    depthM: 0.042,
    inflowRelaxation: 0.5
  });

  public header!: SimHeader;
  public hudStrip!: SimHudStrip;

  public runState: 'idle' | 'running' | 'paused' = 'running';
  private frameCount = 0;
  private lastFpsUpdateTime = performance.now();

  public activeMedium: SimulationMedium = 'water';
  public isCompareMode = false;

  public activeThrottle = 0.6;
  public activeMaterial: PropMaterialId = 'rigid10k';
  public activeMaterialB: PropMaterialId = 'rigid10k';
  public activeVoltage = 12.0;
  public activeInflowVelocity = defaultConfig.fluid.inflowVelocity;
  public activeDesignId = 'candidateA';
  public activeDesignIdB = 'kaplan';

  public metricsDataA: HudMetricsData = {
    thrustN: 0,
    torqueNm: 0,
    rpm: 0,
    inflowSpeedMs: 0,
    advanceRatioJ: 0,
    efficiency: null,
    medium: 'water',
    timeScale: 1.0,
    pShaftW: 0,
    pIdealW: 0
  };

  public metricsDataB: HudMetricsData = {
    thrustN: 0,
    torqueNm: 0,
    rpm: 0,
    inflowSpeedMs: 0,
    advanceRatioJ: 0,
    efficiency: null,
    medium: 'water',
    timeScale: 1.0,
    pShaftW: 0,
    pIdealW: 0
  };

  public init(): void {
    const root = document.getElementById('app');
    if (!root) {
      if (debug) console.error('[App] Missing #app root element');
      return;
    }

    const layout = buildSimLayout(root);
    this.renderer = new AppRenderer(layout.viewportEl);

    this.fluidSolver = new GpuFluidSolver({
      renderer: this.renderer.renderer,
      gridOptions: { width: defaultConfig.fluid.nx, height: defaultConfig.fluid.ny },
      viscosity: defaultConfig.fluid.viscosity,
      vorticityStrength: defaultConfig.fluid.vorticityStrength,
      pressureIterations: defaultConfig.fluid.pressureIterations,
      jetConfig: {
        vx: this.activeInflowVelocity,
        enabled: defaultConfig.fluid.inflowActive
      }
    });
    this.fluidSolver.primeTunnel(this.activeInflowVelocity);

    this.fluidSolverB = new GpuFluidSolver({
      renderer: this.renderer.renderer,
      gridOptions: { width: defaultConfig.fluid.nx, height: defaultConfig.fluid.ny },
      viscosity: defaultConfig.fluid.viscosity,
      vorticityStrength: defaultConfig.fluid.vorticityStrength,
      pressureIterations: defaultConfig.fluid.pressureIterations,
      jetConfig: {
        vx: this.activeInflowVelocity,
        enabled: defaultConfig.fluid.inflowActive
      }
    });
    this.fluidSolverB.primeTunnel(this.activeInflowVelocity);

    this.recovery = new RecoveryCoordinator({
      onBackendChange: (backend) => {
        this.fluidSolver.setBackend(backend);
        this.fluidSolverB.setBackend(backend);
      },
      onPause: () => {
        this.clock.stop();
      },
      onResume: () => {
        if (this.runState === 'running') {
          this.clock.start();
        }
      },
      reinitProbe: () => this.fluidSolver.reinitGpuPipeline()
    });

    this.clock = new SimClock(defaultConfig.clock.fixedDeltaTime, defaultConfig.clock.maxSubsteps);
    this.clock.start();

    const rendererInstance = this.renderer.renderer;
    const glContext = 'getContext' in rendererInstance && typeof (rendererInstance as THREE.WebGLRenderer).getContext === 'function'
      ? (rendererInstance as THREE.WebGLRenderer).getContext()
      : undefined;
    this.gpuTimer = new GpuTimer({ gl: glContext instanceof WebGL2RenderingContext ? glContext : undefined });

    this.header = new SimHeader(layout.headerEl, {
      onRunToggle: (running) => {
        this.runState = running ? 'running' : 'paused';
        if (running) {
          this.clock.start();
        } else {
          this.clock.stop();
        }
      },
      onThrottleChange: (throttle) => {
        this.activeThrottle = Math.max(0.0, Math.min(1.0, throttle));
      },
      onMaterialChange: (materialId) => {
        this.setMaterialA(materialId);
      },
      onSpeedChange: (speed) => {
        this.clock.setTimeScale(speed);
        this.metricsDataA.timeScale = speed;
        this.metricsDataB.timeScale = speed;
      },
      onMediumChange: (medium) => {
        this.setMedium(medium);
      },
      onCompareToggle: (compareActive) => {
        this.setCompareMode(compareActive);
      },
      onDesignAChange: (designId) => {
        this.setDesignA(designId);
      },
      onMaterialAChange: (materialId) => {
        this.setMaterialA(materialId);
      },
      onDesignBChange: (designId) => {
        this.setDesignB(designId);
      },
      onMaterialBChange: (materialId) => {
        this.setMaterialB(materialId);
      },
      onRecordToggle: async () => {
        if (this.videoRecorder.recording) {
          this.header.setRecordingState(false);
          const blob = await this.videoRecorder.stop();
          if (blob) {
            this.videoRecorder.download(blob);
          }
        } else {
          const domEl = this.renderer.renderer.domElement as HTMLCanvasElement;
          const started = this.videoRecorder.start(domEl, 60);
          if (started) {
            this.header.setRecordingState(true);
          }
        }
      }
    });

    this.hudStrip = new SimHudStrip(layout.hudEl);

    this.start();
  }

  public setMedium(medium: SimulationMedium): void {
    this.activeMedium = medium;
    this.metricsDataA.medium = medium;
    this.metricsDataB.medium = medium;
    this.renderer.setMedium(medium);
  }

  public setCompareMode(enabled: boolean): void {
    this.isCompareMode = enabled;
    const designB = getPropDesign(this.activeDesignIdB);
    this.renderer.setCompareMode(enabled, designB, this.activeMaterialB);
    this.updateHudLabels();
  }

  public setDesignA(designId: string): void {
    this.activeDesignId = designId;
    const design = getPropDesign(designId);
    this.renderer.prop3D.setDesign(design);
    this.updateHudLabels();
  }

  public setMaterialA(materialId: PropMaterialId): void {
    this.activeMaterial = materialId;
    this.renderer.prop3D.setMaterial(materialId);
  }

  public setDesignB(designId: string): void {
    this.activeDesignIdB = designId;
    const design = getPropDesign(designId);
    this.renderer.prop3D_B.setDesign(design);
    this.updateHudLabels();
  }

  public setMaterialB(materialId: PropMaterialId): void {
    this.activeMaterialB = materialId;
    this.renderer.prop3D_B.setMaterial(materialId);
  }

  private updateHudLabels(): void {
    const nameA = getPropDesign(this.activeDesignId).name || this.activeDesignId;
    const nameB = getPropDesign(this.activeDesignIdB).name || this.activeDesignIdB;
    this.renderer.updateColumnLabels(nameA, nameB);
    this.hudStrip.setCompareMode(this.isCompareMode, nameA, nameB);
  }

  private start(): void {
    const loop = (currentTimeMs: number) => {
      this.update(currentTimeMs);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private update(currentTimeMs: number): void {
    const frameStart = performance.now();

    if (this.runState === 'running') {
      this.clock.tick(currentTimeMs, (dt) => {
        const rho = MEDIUMS[this.activeMedium].density;
        const nu = MEDIUMS[this.activeMedium].dynamicViscosity / rho;

        const lastMotorRpmA = this.bus.lastTelemetry?.motors[0]?.rpm ?? (4140 * this.activeThrottle);
        this.shaft.commandedRpm = this.activeThrottle > 0.001 ? lastMotorRpmA : 0;
        this.shaft.update(dt);

        const advanceSpeedA = this.activeMedium === 'water'
          ? this.coupler.sampleInflowVelocity(this.fluidSolver.grid)
          : 0.0;
        const designA = getPropDesign(this.activeDesignId);
        const bemtA = solveBemt(this.shaft.currentRpm, advanceSpeedA, {
          design: designA,
          pitchMm: designA.pitchMm,
          material: this.activeMaterial,
          fluidDensity: rho,
          kinematicViscosity: nu
        });

        this.bus.supplyV = this.activeVoltage;
        this.bus.solveBusNetwork(
          [this.activeThrottle],
          [() => Math.abs(bemtA.torqueNm)]
        );

        if (this.activeMedium === 'water') {
          this.coupler.injectCouplingForces(this.fluidSolver.grid, bemtA, dt);
          this.fluidSolver.step(dt);
          this.renderer.waterViz.stepParticles(dt, this.fluidSolver.grid, this.shaft);
        }

        const nA = this.shaft.currentRpm / 60;
        const DA = designA.diameterMm / 1000;
        const jA = (nA > 1e-4 && DA > 1e-4) ? advanceSpeedA / (nA * DA) : 0;
        const pShaftA = 2 * Math.PI * nA * bemtA.torqueNm;
        const discAreaA = Math.PI * Math.pow(DA / 2, 2);
        const pIdealA = (bemtA.thrustN * bemtA.thrustN) / (2 * rho * discAreaA);
        const etaA = (advanceSpeedA > 1e-4 && pShaftA > 1e-4) ? (bemtA.thrustN * advanceSpeedA) / pShaftA : null;

        this.metricsDataA = {
          thrustN: bemtA.thrustN,
          torqueNm: bemtA.torqueNm,
          rpm: this.shaft.currentRpm,
          inflowSpeedMs: advanceSpeedA,
          advanceRatioJ: jA,
          efficiency: etaA,
          medium: this.activeMedium,
          timeScale: this.clock.timeScale,
          pShaftW: pShaftA,
          pIdealW: pIdealA
        };

        if (this.isCompareMode) {
          const lastMotorRpmB = this.busB.lastTelemetry?.motors[0]?.rpm ?? (4140 * this.activeThrottle);
          this.shaftB.commandedRpm = this.activeThrottle > 0.001 ? lastMotorRpmB : 0;
          this.shaftB.update(dt);

          const advanceSpeedB = this.activeMedium === 'water'
            ? this.couplerB.sampleInflowVelocity(this.fluidSolverB.grid)
            : 0.0;
          const designB = getPropDesign(this.activeDesignIdB);
          const bemtB = solveBemt(this.shaftB.currentRpm, advanceSpeedB, {
            design: designB,
            pitchMm: designB.pitchMm,
            material: this.activeMaterialB,
            fluidDensity: rho,
            kinematicViscosity: nu
          });

          this.busB.supplyV = this.activeVoltage;
          this.busB.solveBusNetwork(
            [this.activeThrottle],
            [() => Math.abs(bemtB.torqueNm)]
          );

          if (this.activeMedium === 'water') {
            this.couplerB.injectCouplingForces(this.fluidSolverB.grid, bemtB, dt);
            this.fluidSolverB.step(dt);
            this.renderer.waterVizB.stepParticles(dt, this.fluidSolverB.grid, this.shaftB);
          }

          const nB = this.shaftB.currentRpm / 60;
          const DB = designB.diameterMm / 1000;
          const jB = (nB > 1e-4 && DB > 1e-4) ? advanceSpeedB / (nB * DB) : 0;
          const pShaftB = 2 * Math.PI * nB * bemtB.torqueNm;
          const discAreaB = Math.PI * Math.pow(DB / 2, 2);
          const pIdealB = (bemtB.thrustN * bemtB.thrustN) / (2 * rho * discAreaB);
          const etaB = (advanceSpeedB > 1e-4 && pShaftB > 1e-4) ? (bemtB.thrustN * advanceSpeedB) / pShaftB : null;

          this.metricsDataB = {
            thrustN: bemtB.thrustN,
            torqueNm: bemtB.torqueNm,
            rpm: this.shaftB.currentRpm,
            inflowSpeedMs: advanceSpeedB,
            advanceRatioJ: jB,
            efficiency: etaB,
            medium: this.activeMedium,
            timeScale: this.clock.timeScale,
            pShaftW: pShaftB,
            pIdealW: pIdealB
          };
        }
      });
    }

    this.gpuTimer.begin();
    this.renderer.render(
      this.shaft.bladePhaseRad,
      this.shaft.currentRpm,
      this.clock.getFixedDeltaTime(),
      this.fluidSolver.grid,
      this.shaft,
      this.isCompareMode ? this.shaftB.bladePhaseRad : undefined,
      this.isCompareMode ? this.shaftB.currentRpm : 0,
      this.isCompareMode ? this.fluidSolverB.grid : undefined,
      this.isCompareMode ? this.shaftB : undefined
    );
    this.gpuTimer.end();
    this.gpuTimer.resolve();

    const frameElapsed = performance.now() - frameStart;

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdateTime >= 500) {
      const fps = (this.frameCount * 1000) / (now - this.lastFpsUpdateTime);
      this.frameCount = 0;
      this.lastFpsUpdateTime = now;
      this.header.setFpsTooltip(fps, frameElapsed);
    }

    const nameA = getPropDesign(this.activeDesignId).name || this.activeDesignId;
    const nameB = getPropDesign(this.activeDesignIdB).name || this.activeDesignIdB;
    this.hudStrip.update(
      this.metricsDataA,
      this.isCompareMode ? this.metricsDataB : undefined,
      this.isCompareMode,
      nameA,
      nameB
    );
  }
}

interface GlobalAppWindow extends Window {
  __app?: App;
  __solveBemt?: typeof solveBemt;
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
    const win = window as unknown as GlobalAppWindow;
    win.__app = app;
    win.__solveBemt = solveBemt;
  });
}
