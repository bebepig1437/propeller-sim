import './index.css';
import { defaultConfig, DEBUG as debug } from './core/config';
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

export class App {
  private clock!: SimClock;
  private videoRecorder = new CanvasRecorder();
  public renderer!: AppRenderer;
  public fluidSolver!: GpuFluidSolver;
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

  public header!: SimHeader;
  public hudStrip!: SimHudStrip;

  public runState: 'idle' | 'running' | 'paused' = 'running';
  private frameCount = 0;
  private lastFpsUpdateTime = performance.now();
  private lastRenderTime = performance.now();

  public activeThrottle = 1.0;
  public activeVoltage = 12.0;
  public activeInflowVelocity = defaultConfig.fluid.inflowVelocity;
  public activeDesignId = defaultConfig.propulsion.designId;

  public metricsData: HudMetricsData = {
    thrust_N: 0,
    torque_Nm: 0,
    rpm: 0,
    inflow_velocity_ms: 0,
    advance_ratio_J: 0,
    tip_mach: 0,
    timeScale: 1.0,
    fps: 60.0,
    frameMs: 16.6
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

    this.recovery = new RecoveryCoordinator({
      onBackendChange: (backend) => {
        this.fluidSolver.setBackend(backend);
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

    const glContext = (this.renderer.renderer as any).getContext
      ? (this.renderer.renderer as any).getContext()
      : undefined;
    this.gpuTimer = new GpuTimer({ gl: glContext });

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
      },
      onSpeedChange: (scale) => {
        this.clock.setTimeScale(scale);
        this.metricsData.timeScale = scale;
      },
      onInflowChange: (inflowMs) => {
        this.activeInflowVelocity = inflowMs;
        this.fluidSolver.jet.config.vx = inflowMs;
        if (this.fluidSolver.sourcesNode) {
          this.fluidSolver.sourcesNode.vxUniform.value = inflowMs;
        }
      },
      onVoltageChange: (voltageV) => {
        this.activeVoltage = voltageV;
        this.bus.supplyV = voltageV;
      },
      onDesignChange: (designId) => {
        this.activeDesignId = designId;
        const design = getPropDesign(designId);
        this.renderer.prop3D.setDesign(design);
      },
      onVisualizationModeChange: (mode) => {
        this.renderer.setVisualizationMode(mode);
      },
      onWakeEnvelopeToggle: (enabled) => {
        this.renderer.flowViz.setWakeEnvelopeVisible(enabled);
      },
      onVelocityVectorsToggle: (enabled) => {
        this.renderer.flowViz.setVelocityVectorsVisible(enabled);
      },
      onTipVorticesToggle: (enabled) => {
        this.renderer.flowViz.setTipVorticesVisible(enabled);
      },
      onParticleTracersToggle: (enabled) => {
        this.renderer.flowViz.setParticleTracersVisible(enabled);
      }
    });

    this.hudStrip = new SimHudStrip(layout.hudEl);

    this.start();
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
        const lastMotorRpm = this.bus.lastTelemetry?.motors[0]?.rpm ?? (4140 * this.activeThrottle);
        this.shaft.commandedRpm = this.activeThrottle > 0.001 ? lastMotorRpm : 0;
        this.shaft.update(dt);

        const advanceSpeed = this.coupler.sampleInflowVelocity(this.fluidSolver.grid);
        const design = getPropDesign(this.activeDesignId);
        const bemt = solveBemt(this.shaft.currentRpm, advanceSpeed, { design, pitchMm: design.pitchMm });

        this.bus.supplyV = this.activeVoltage;
        this.bus.solveBusNetwork(
          [this.activeThrottle],
          [() => Math.abs(bemt.torqueNm)]
        );

        this.coupler.injectCouplingForces(this.fluidSolver.grid, bemt, dt);
        this.fluidSolver.step(dt);

        const diameterM = design.diameterMm * 0.001;
        const nRps = this.shaft.currentRpm / 60.0;
        /* Glauert (1935): J = V / (n * D) */
        const advanceRatioJ = (nRps > 1e-3 && diameterM > 1e-4) ? (advanceSpeed / (nRps * diameterM)) : 0;
        const tipSpeedMs = Math.PI * nRps * diameterM;
        const tipMach = tipSpeedMs / 1480.0;

        this.metricsData.thrust_N = bemt.thrustN;
        this.metricsData.torque_Nm = bemt.torqueNm;
        this.metricsData.rpm = this.shaft.currentRpm;
        this.metricsData.inflow_velocity_ms = advanceSpeed;
        this.metricsData.advance_ratio_J = advanceRatioJ;
        this.metricsData.tip_mach = tipMach;
        this.metricsData.timeScale = this.clock.timeScale;
      });
    }

    const renderDt = Math.min(0.05, Math.max(0.001, (currentTimeMs - this.lastRenderTime) * 0.001));
    this.lastRenderTime = currentTimeMs;

    this.gpuTimer.begin();
    this.renderer.render(
      this.shaft.bladePhaseRad,
      this.shaft.currentRpm,
      this.metricsData.thrust_N,
      renderDt,
      this.fluidSolver.grid
    );
    this.gpuTimer.end();
    this.gpuTimer.resolve();

    const frameElapsed = performance.now() - frameStart;
    this.metricsData.frameMs = frameElapsed;

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdateTime >= 500) {
      this.metricsData.fps = (this.frameCount * 1000) / (now - this.lastFpsUpdateTime);
      this.frameCount = 0;
      this.lastFpsUpdateTime = now;
      this.header.setFpsTooltip(this.metricsData.fps, this.metricsData.frameMs);
    }

    this.hudStrip.update(this.metricsData, currentTimeMs);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
    (window as any).__app = app;
  });
}

