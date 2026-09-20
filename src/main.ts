import './index.css';
import * as THREE from 'three';
import { defaultConfig } from './core/config';
import { SimClock } from './core/clock';
import { GpuFluidSolver } from './fluid/gpu/gpuFluidSolver';
import { FluidRenderer2D } from './fluid/FluidRenderer2D';
import { AppRenderer } from './render/renderer';
import { GpuTimer } from './telemetry/gpuTimer';
import { FluidSolver } from './fluid/FluidSolver';
import { buildSimLayout } from './ui/layout';
import { SimHeader, DEFAULT_PRESETS, type RunState } from './ui/header';
import { SimPalette } from './ui/palette';
import { StageOverlays } from './ui/stageOverlays';
import { SimInspector } from './ui/inspector';
import { SimHudStrip, type HudMetricsData } from './ui/hud';
import { PropellerShaft, type PropellerMaterial } from './prop/rigidbody';
import { solveBEMT } from './prop/bemt';
import { getPropDesign } from './prop/designs/index';
import { PowerBus } from './power/bus';
import { calculateTetherResistanceFromMeters } from './power/tether';
import { ActuatorDiscCoupler } from './prop/coupling';
import { HullObstacle } from './fluid/hull';
import { PropellerArray, type VehiclePropulsionSummary } from './prop/array';
import { OverlaySystem, DEFAULT_OVERLAY_STATE, type OverlayState, type OverlayUpdateContext, type ThrustCurvePoint } from './render/overlays';
import { ControlPanel } from './ui/panel';

export class App {
  private clock!: SimClock;
  private renderer!: AppRenderer;
  private fluidSolver!: GpuFluidSolver;
  private fluidRenderer!: FluidRenderer2D;
  private gpuTimer!: GpuTimer;

  // Phase 5b Propeller Array & Torque Ledger
  public propArray = new PropellerArray();

  // Phase 6 Overlay System & Tweakpane
  public overlaySystem!: OverlaySystem;
  public overlayState: OverlayState = { ...DEFAULT_OVERLAY_STATE };
  public controlPanel?: ControlPanel;
  private overlayCtx: OverlayUpdateContext = {
    dt: 0,
    physicsDt: 0,
    elapsed: 0,
    grid: null,
    gridCenter: new THREE.Vector3(),
    gridDxM: 0.0015,
    vehicle: null,
    summary: null as unknown as VehiclePropulsionSummary,
    motorTempsC: [],
    motorCurrentsA: []
  };

  // IBM Quantum Composer UI Components
  public header!: SimHeader;
  public palette!: SimPalette;
  public stageOverlays!: StageOverlays;
  public inspector!: SimInspector;
  public hudStrip!: SimHudStrip;
  public refBenchmarkMs = 0;

  public runState: RunState = 'idle';
  private frameCount = 0;
  private lastFpsUpdateTime = performance.now();
  private lastRenderTime = performance.now();

  // Active Operating State
  private activePresetKey = 'breakout';
  private activeThrottle = 1.0;
  private activeRpm = 4140;
  public activeCurrent_A = 1.41;
  private motorTemp_C = 20.0;
  private runDurationSec = 0.0;

  // Phase 4 Propeller Dynamic & Hydrodynamic State
  public shaft = new PropellerShaft(4140, 18.0);
  public activeDesignId: 'candidateA' | 'kaplan' | 'wageningen' = 'candidateA';
  public activeMaterial: PropellerMaterial = 'rigid10k';
  public activeHandedness: 'CW' | 'CCW' = 'CW';

  // Phase 4b Electrical Model
  public bus = new PowerBus(3, 12.0, 0.782);

  // Phase 5 Bidirectional Fluid-Propeller Coupling & Hull Obstacle
  public coupler = new ActuatorDiscCoupler({
    centerX: 28,
    centerY: 64,
    radiusCells: 14,
    thicknessCells: 3,
    gridDxM: 0.0015,
    depthM: 0.042,
    inflowRelaxation: 0.5
  });
  public hull = new HullObstacle({
    x: 48,
    y: 54,
    width: 28,
    height: 20,
    cd: 1.05
  });

  // Total sim time advanced by physics substeps THIS frame (Directive 5): on a
  // 240 Hz display one frame may contain 0 substeps (field unchanged, advection
  // dt = 0) or several (advection must advance by their SUM, not the last one).
  private physicsAdvancedDt = 0;
  // Last sampled inflow advance speed (m/s); live forward speed for the ledger (Directive 1)
  private lastAdvanceSpeedMs = 0;

  private metricsData: HudMetricsData = {
    thrust_N: 0,
    torque_Nm: 0,
    rpm: 0,
    bus_V: 12.0,
    current_A: 0,
    temp_C: 20.0,
    rollRatePrediction_deg_m: 1.8,
    fps: 60.0,
    frameMs: 16.6,
    gpuMs: 0.0,
    overlayMs: 0.0,
    presetName: 'Breakout'
  };

  public init(): void {
    const root = document.getElementById('app');
    if (!root) {
      console.error('[App] Missing #app root element');
      return;
    }

    // 1. Build IBM Quantum 3-Region Layout Shell
    const layout = buildSimLayout(root);

    // 2. Initialize 3D AppRenderer with automatic WebGL2 fallback
    this.renderer = new AppRenderer(layout.viewportEl);

    // 2b. Initialize Phase 6 OverlaySystem (3D overlay group + hover/diff DOM)
    this.overlaySystem = new OverlaySystem({
      hoverEl: layout.stagePopoversEl,
      diffEl: layout.stagePopoversEl
    });
    this.overlaySystem.setCamera(this.renderer.camera, layout.viewportEl);
    this.renderer.scene.add(this.overlaySystem.group);
    layout.viewportEl.addEventListener('pointermove', (e: PointerEvent) => {
      const rect = layout.viewportEl.getBoundingClientRect();
      this.overlaySystem.setPointerNDC(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
    });
    layout.viewportEl.addEventListener('pointerleave', () => {
      this.overlaySystem.clearPointer();
    });

    // 3. Initialize Phase 2 GPU Fluid Solver (TSL with CPU fallback) & 2D Debug Overlay
    this.fluidSolver = new GpuFluidSolver({
      renderer: this.renderer.renderer,
      gridOptions: { width: defaultConfig.fluid.nx, height: defaultConfig.fluid.ny },
      advectionScheme: defaultConfig.fluid.advectionScheme === 'maccormack' ? 'MACCORMACK' : 'SEMI_LAGRANGIAN',
      viscosity: defaultConfig.fluid.viscosity,
      vorticityStrength: defaultConfig.fluid.vorticityStrength,
      pressureIterations: defaultConfig.fluid.pressureIterations,
      jetConfig: {
        vx: defaultConfig.fluid.inflowVelocity,
        enabled: defaultConfig.fluid.inflowActive
      }
    });

    this.fluidRenderer = new FluidRenderer2D(layout.fluidCanvasEl, defaultConfig.fluid.nx, defaultConfig.fluid.ny);

    // 4. Measure reference benchmark ms at 256x128 CPU
    this.measureCpuReferenceBenchmark();

    // 5. Initialize Fixed-Timestep Simulation Clock (60 Hz, max 5 substeps)
    this.clock = new SimClock(defaultConfig.clock.fixedDeltaTime, defaultConfig.clock.maxSubsteps);

    // 6. Initialize GPU Timer
    const glContext = (this.renderer.renderer as any).getContext ? (this.renderer.renderer as any).getContext() : undefined;
    this.gpuTimer = new GpuTimer({ gl: glContext });

    // 7. Mount Header
    this.header = new SimHeader(layout.headerEl, {
      onRunToggle: (nextState) => {
        this.runState = nextState;
        if (nextState === 'running') {
          this.clock.start();
          // Inject immediate initial plume burst so within 2 seconds water visibly rises & flows
          this.fluidSolver.jet.triggerBurst(this.fluidSolver.grid, 3.2);
        } else if (nextState === 'paused') {
          this.clock.stop();
        } else if (nextState === 'idle') {
          this.clock.stop();
          this.runDurationSec = 0;
          this.motorTemp_C = 20.0;
        }
      },
      onPresetSelect: (presetKey) => {
        this.applyPreset(presetKey);
      },
      onShare: () => {
        const stateUrl = new URL(window.location.href);
        stateUrl.searchParams.set('preset', this.activePresetKey);
        stateUrl.searchParams.set('supply_v', this.inspector.supplyV.toFixed(1));
        stateUrl.searchParams.set('tether_ft', this.inspector.tetherFt.toString());
        navigator.clipboard?.writeText(stateUrl.toString());
        alert(`Configuration URL copied to clipboard:\n${stateUrl.toString()}`);
      },
      onExportCsv: () => {
        this.exportTelemetryCsv();
      },
      onValidationClick: () => {
        alert('Navigating to ITTC & NACA Open-Water Validation Report');
      }
    });

    // Wire Stage Direct Manipulation Callbacks
    this.renderer.onPropellerSelected = () => {
      this.inspector.setSelection({ type: 'thruster', index: 0 });
    };
    this.renderer.onPropellerPositionChanged = (zM) => {
      console.log(`[Stage] Propeller translated along Z-axis: ${zM.toFixed(3)} m`);
      const baseCenterX = 28;
      const shiftCells = Math.round(zM / this.coupler.config.gridDxM);
      this.coupler.config.centerX = Math.max(8, Math.min(this.fluidSolver.grid.width - 40, baseCenterX + shiftCells));
    };
    this.renderer.onPitchChanged = (pitchDeg) => {
      this.shaft.commandedPitchDeg = pitchDeg;
      this.inspector.thrusterPitch = pitchDeg;
      const pitchSlider = document.querySelector('#slider-pitch') as HTMLInputElement;
      if (pitchSlider) pitchSlider.value = pitchDeg.toFixed(1);
      const valEl = document.querySelector('#val-thruster-pitch');
      if (valEl) valEl.textContent = `${pitchDeg.toFixed(1)}°`;
    };
    this.renderer.onHandednessChanged = (h) => {
      this.activeHandedness = h;
      this.inspector.thrusterHandedness = h;
      const selIdx = this.palette.selectedThruster;
      if (this.propArray.thrusters[selIdx]) {
        this.propArray.thrusters[selIdx].handedness = h;
      }
    };
    this.renderer.onIncidenceChanged = (incDeg) => {
      const selIdx = this.palette.selectedThruster;
      if (this.propArray.thrusters[selIdx]) {
        this.propArray.thrusters[selIdx].stator.config.incidenceDeg = incDeg;
      }
      this.inspector.statorIncidenceDeg = incDeg;
      const incSlider = document.querySelector('#slider-th-stator-inc') as HTMLInputElement;
      if (incSlider) incSlider.value = incDeg.toFixed(1);
      const valEl = document.querySelector('#val-th-stator-inc');
      if (valEl) valEl.textContent = `${incDeg.toFixed(1)}°`;
    };
    this.renderer.onRemoveThruster = () => {
      const selIdx = this.palette.selectedThruster;
      if (this.propArray.thrusters.length > 1) {
        this.propArray.removeThruster(selIdx);
        this.palette.setThrusterCount(this.propArray.thrusters.length);
        this.inspector.propulsorCount = this.propArray.thrusters.length;
        const newIdx = Math.max(0, this.propArray.thrusters.length - 1);
        this.inspector.setSelection({ type: 'thruster', index: newIdx });
      }
    };

    // 8. Mount Left Palette (Physical Primitives)
    this.palette = new SimPalette(layout.paletteEl, {
      onLoadVehicle: (vehicleId) => {
        console.log(`[Palette] Loaded vehicle: ${vehicleId}`);
        this.propArray.setupCandidateADefaults();
        this.palette.setThrusterCount(3, 0);
        this.inspector.propulsorCount = 3;
        this.renderer.resetOrbitView();
      },
      onResetPose: () => {
        this.renderer.resetOrbitView();
      },
      onSelectThruster: (idx) => {
        this.inspector.setSelection({ type: 'thruster', index: idx });
        const unit = this.propArray.thrusters[idx];
        if (unit) {
          this.inspector.thrusterHandedness = unit.handedness;
          this.inspector.thrusterThrottle = unit.throttle;
          this.inspector.statorAttached = unit.stator.config.vaneType !== 'none';
          this.inspector.statorSlotted = unit.stator.config.vaneType === 'slotted';
          this.inspector.statorIncidenceDeg = unit.stator.config.incidenceDeg;
          this.renderer.prop3D?.setHandedness(unit.handedness);
          this.renderer.prop3D?.setStatorAttached(unit.stator.config.vaneType !== 'none');
          this.renderer.prop3D?.setStatorSlotted(unit.stator.config.vaneType === 'slotted');
          this.renderer.prop3D?.setStatorIncidence(unit.stator.config.incidenceDeg);
        }
        this.renderer.prop3D?.setSelected(true);
      },
      onAddThruster: () => {
        this.propArray.addThruster();
        const newIdx = this.propArray.thrusters.length - 1;
        this.palette.setThrusterCount(this.propArray.thrusters.length, newIdx);
        this.inspector.propulsorCount = this.propArray.thrusters.length;
        this.inspector.setSelection({ type: 'thruster', index: newIdx });
        this.renderer.prop3D?.setSelected(true);
      },
      onRemoveThruster: (idx) => {
        this.propArray.removeThruster(idx);
        this.palette.setThrusterCount(this.propArray.thrusters.length);
        this.inspector.propulsorCount = this.propArray.thrusters.length;
        const newIdx = Math.max(0, this.propArray.thrusters.length - 1);
        this.inspector.setSelection({ type: 'thruster', index: newIdx });
      },
      onHandednessPresetChange: (preset) => {
        this.propArray.applyHandednessPreset(preset);
        this.palette.handednessPreset = preset;
        this.inspector.handednessPreset = preset;
        this.palette.setThrusterCount(this.propArray.thrusters.length);
        this.inspector.propulsorCount = this.propArray.thrusters.length;
      },
      onToggleStator: (attached) => {
        const selIdx = this.palette.selectedThruster;
        if (this.propArray.thrusters[selIdx]) {
          this.propArray.thrusters[selIdx].stator.config.vaneType = attached
            ? (this.palette.slottedVane ? 'slotted' : 'solid')
            : 'none';
        }
        this.renderer.prop3D?.setStatorAttached(attached);
        this.inspector.statorAttached = attached;
      },
      onToggleSlottedVane: (slotted) => {
        const selIdx = this.palette.selectedThruster;
        if (this.propArray.thrusters[selIdx]) {
          this.propArray.thrusters[selIdx].stator.config.vaneType = slotted ? 'slotted' : 'solid';
        }
        this.renderer.prop3D?.setStatorSlotted(slotted);
        this.inspector.statorSlotted = slotted;
      },
      onSelectPropDesign: (design) => {
        const oldCurve = this.computeThrustCurve(this.activeDesignId);
        this.activeDesignId = design;
        const d = getPropDesign(design);
        this.renderer.prop3D?.setDesign(d);
        // Phase 6 variant diff overlay: old vs new open-water thrust curve, 5 s fade
        const newCurve = this.computeThrustCurve(design);
        this.overlaySystem.showVariantDiff(oldCurve, newCurve);
      },
      onSelectMaterial: (material) => {
        this.activeMaterial = material;
        this.renderer.prop3D?.setMaterial(material);
      },
      onSelectOperatingPoint: (key) => {
        this.applyPreset(key);
      }
    });

    // 9. Mount Stage Overlays
    this.stageOverlays = new StageOverlays(
      layout.stageCornerToolsEl,
      layout.stageOverlayStripEl,
      layout.fluidCutawayEl,
      {
        onToggleCutaway: (active) => {
          if (active) {
            this.renderer.setSideCutawayView();
          } else {
            this.renderer.resetOrbitView();
          }
        },
        onToggleOverlay: (key, active) => {
          console.log(`[Overlay] ${key} = ${active}`);
        }
      }
    );

    // 10. Mount Right Inspector (Run settings by default)
    this.inspector = new SimInspector(layout.inspectorEl, {
      onSupplyVoltageChange: (v) => {
        defaultConfig.electrical.supplyVoltage = v;
      },
      onTetherLengthChange: (ft) => {
        defaultConfig.electrical.tetherLengthFt = ft;
        defaultConfig.electrical.tetherResistance = (ft / 15.0) * 0.782;
      },
      onThermalToggle: (_enabled) => {},
      onThrottleChange: (_idx, throttle) => {
        this.activeThrottle = throttle;
      },
      onResolutionChange: (preset) => {
        let w = 1024, h = 512;
        if (preset === '512x256') { w = 512; h = 256; }
        else if (preset === '256x128') { w = 256; h = 128; }
        this.fluidSolver.setResolution(w, h);
        this.fluidRenderer.resize(w, h);
      }
    });

    // 11. Mount Bottom HUD Strip
    this.hudStrip = new SimHudStrip(layout.hudEl, layout.stagePopoversEl);

    // Apply default preset (Breakout)
    this.applyPreset('breakout');

    console.log('[App] IBM Quantum-inspired instrument UI ready.');
    this.start();
  }

  private applyPreset(presetKey: string): void {
    const p = DEFAULT_PRESETS.find(x => x.key === presetKey);
    if (!p) return;

    this.activePresetKey = p.key;
    this.activeThrottle = p.throttle;
    this.activeRpm = p.rpm;
    this.activeThrust_N = p.thrust_N;
    this.activeCurrent_A = p.current_A;

    this.metricsData.presetName = p.label.split(' ')[0];
    this.header.setPreset(p.key);
    this.inspector.thrusterThrottle = p.throttle;
    this.inspector.thrusterRpm = p.rpm;

    if (this.runState === 'running') {
      this.fluidSolver.jet.config.enabled = Math.abs(p.throttle) > 0.1;
      this.fluidSolver.jet.config.vx = p.throttle * 3.5;
      this.fluidSolver.jet.triggerBurst(this.fluidSolver.grid, Math.abs(p.throttle) * 2.5);
    }
  }

  private measureCpuReferenceBenchmark(): void {
    try {
      const refSolver = new FluidSolver({
        gridOptions: { width: 256, height: 128 },
        pressureIterations: 20,
        advectionScheme: 'MACCORMACK'
      });
      refSolver.step(1.0 / 60.0);
      const start = performance.now();
      const iters = 5;
      for (let i = 0; i < iters; i++) {
        refSolver.step(1.0 / 60.0);
      }
      this.refBenchmarkMs = (performance.now() - start) / iters;
    } catch {
      this.refBenchmarkMs = 6.5;
    }
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

    // 1. Advance Physics when RUNNING at Fixed 60 Hz Timestep
    if (this.runState === 'running') {
      this.clock.tick(currentTimeMs, (dt) => {
        this.runDurationSec += dt;

        // Synchronize fluid inflow from throttle
        this.fluidSolver.jet.config.enabled = Math.abs(this.activeThrottle) > 0.05;
        this.fluidSolver.jet.config.vx = this.activeThrottle * 3.2;

        // Step Fluid Solver
        this.fluidSolver.step(dt);

        // Electrical sag and thermal accumulation
        const rTether = (this.inspector.tetherFt / 15.0) * 0.782;
        const vSupply = this.inspector.supplyV;
        const current = this.activeCurrent_A * Math.abs(this.activeThrottle);
        const vBus = Math.max(0, vSupply - current * rTether);

        // Thermal dissipation model
        if (this.inspector.thermalActive) {
          const powerLoss = current * current * 4.5; // I^2 * Ra
          const heatingRate = powerLoss * 0.04; // °C / s
          const coolingRate = (this.motorTemp_C - 20.0) * 0.05;
          this.motorTemp_C += (heatingRate - coolingRate) * dt;
        }

        // Update Live Physical Metrics
        this.metricsData.thrust_N = this.activeThrust_N * this.activeThrottle;
        this.metricsData.torque_Nm = 0.024 * this.activeThrottle;
        this.metricsData.rpm = this.activeRpm * this.activeThrottle;
        this.metricsData.bus_V = vBus;
        this.metricsData.current_A = current;
        this.metricsData.temp_C = this.motorTemp_C;
      });
    }

    // 2. Render 2D Eulerian Cutaway Canvas
    this.fluidRenderer.render(this.fluidSolver.grid);

    // 3. Render 3D Water Surface & Propeller Scene
    const renderDt = Math.min(0.05, Math.max(0.001, (currentTimeMs - this.lastRenderTime) * 0.001));
    this.lastRenderTime = currentTimeMs;

    this.gpuTimer.begin();
    this.renderer.render(
      currentTimeMs * 0.001,
      defaultConfig.water.causticIntensity,
      this.fluidSolver.grid,
      renderDt
    );
    this.gpuTimer.end();

    const gpuResult = this.gpuTimer.resolve();
    this.metricsData.gpuMs = gpuResult.durationMs;

    // 4. Performance & Frame Timings
    const frameElapsed = performance.now() - frameStart;
    this.metricsData.frameMs = frameElapsed;

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdateTime >= 500) {
      this.metricsData.fps = (this.frameCount * 1000) / (now - this.lastFpsUpdateTime);
      this.frameCount = 0;
      this.lastFpsUpdateTime = now;
    }

    // 5. Update HUD Strip
    this.hudStrip.update(this.metricsData, currentTimeMs);
  }

  private exportTelemetryCsv(): void {
    const csvContent = 'data:text/csv;charset=utf-8,' +
      'Time_s,Thrust_N,Torque_Nm,RPM,Bus_V,Current_A,Temp_C\n' +
      `${this.runDurationSec.toFixed(2)},${this.metricsData.thrust_N.toFixed(2)},${this.metricsData.torque_Nm.toFixed(3)},${this.metricsData.rpm.toFixed(0)},${this.metricsData.bus_V.toFixed(2)},${this.metricsData.current_A.toFixed(2)},${this.metricsData.temp_C.toFixed(1)}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `seaperch_telemetry_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Bootstrap application on DOM ready
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
  });
}
