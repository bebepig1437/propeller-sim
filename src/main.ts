import { AdaptiveResolutionController } from "./sim/adaptiveResolution";
import { RecoveryCoordinator } from "./sim/recoveryCoordinator";
import { SimulationWorkerBridge } from "./workers/workerBridge";
import { CanvasRecorder } from "./ui/recorder";
import { parseSimStateFromUrl, serializeSimStateToUrl } from "./core/urlState";
import './index.css';
import * as THREE from 'three';
import { defaultConfig } from './core/config';
import { SimClock } from './sim/clock';
import { GpuFluidSolver } from './fluid/gpu/gpuFluidSolver';
import { FluidRenderer2D } from './fluid/FluidRenderer2D';
import { AppRenderer } from './render/renderer';
import { GpuTimer } from './telemetry/gpuTimer';
import { FluidSolver } from './fluid/FluidSolver';
import { buildSimLayout } from './ui/layout';
import { SimHeader, ALL_PRESETS, type RunState } from './ui/header';
import { SimPalette } from './ui/palette';
import { StageOverlays } from './ui/stageOverlays';
import { SimInspector, type VehicleTelemetryView } from './ui/inspector';
import { SimHudStrip, type HudMetricsData } from './ui/hud';
import { TelemetryRecorder } from './telemetry/recorder';
import { type SpecStatus } from './types/telemetry';
import { applyPresetToState, createDefaultPresetState, tickThermalBurst, type PresetRuntimeState } from './core/presetState';
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
import { VehicleBody } from './vehicle/body';
import {
  stepVehicleSubstepped,
  DEFAULT_TANK_BOUNDARIES,
  type IntegratorTelemetry,
  type TetherParams
} from './vehicle/integrator';
import { computeInterpolatedPose, type InterpolatedPose } from './sim/interpolation';
import { VehicleFluidCoupler } from './vehicle/coupling';

export class App {
  private clock!: SimClock;
  private videoRecorder: CanvasRecorder = new CanvasRecorder();
  private renderer!: AppRenderer;
  private fluidSolver!: GpuFluidSolver;
  private fluidRenderer!: FluidRenderer2D;
  private gpuTimer!: GpuTimer;


  public adaptiveRes = new AdaptiveResolutionController({
    baseWidth: defaultConfig.fluid.nx,
    baseHeight: defaultConfig.fluid.ny
  });
  public recovery!: RecoveryCoordinator;
  public workerBridge?: SimulationWorkerBridge;
  private scratchDtDr: Array<{ rOverR: number; dT: number }> = [];
  private scratchPerUnitTel: Array<{
    id: string;
    thrust_N: number;
    torque_Nm: number;
    rpm: number;
    current_A: number;
    temp_C: number;
  }> = [];


  public propArray = new PropellerArray();


  public vehicle = new VehicleBody(defaultConfig.vehicle);
  public vehicleCoupler = new VehicleFluidCoupler({
    gridCenter: new THREE.Vector3(0, 0, 0),
    gridDxM: 0.0015,
    depthM: 0.042,
    fluidDensity: defaultConfig.vehicle.fluidDensityKgM3,
    inflowRelaxation: 0.5,
    injectionRadiusCells: 14,


    injectionOffsetCells: 14,
    enabled: true
  });
  public vehicleTelemetry: IntegratorTelemetry | null = null;
  public vehicleRenderPose: InterpolatedPose | null = null;
  public vehicleTether: TetherParams = {
    attached: defaultConfig.vehicle.tetherAttached,
    anchorWorld: [...defaultConfig.vehicle.tetherAnchorWorld] as [number, number, number],
    stiffnessNm: defaultConfig.vehicle.tetherStiffnessNm,
    dampingNPerMs: defaultConfig.vehicle.tetherDamping
  };
  
  private vehicleAmbientFlowWorld = new THREE.Vector3();
  private scratchVehicleWorldVelocity = new THREE.Vector3();
  
  public vehicleForceMarineN: [number, number, number] = [0, 0, 0];
  public vehicleMomentMarineNm: [number, number, number] = [0, 0, 0];
  
  public vehicleInit = {
    surgeM: 0.0,
    swayM: 0.0,
    heaveM: -0.1,
    yawDeg: 0.0,
    tetherAnchorSurgeM: defaultConfig.vehicle.tetherAnchorWorld[0],
    tetherAnchorSwayM: defaultConfig.vehicle.tetherAnchorWorld[1],
    tetherAnchorHeaveM: defaultConfig.vehicle.tetherAnchorWorld[2]
  };


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


  public header!: SimHeader;
  public palette!: SimPalette;
  public stageOverlays!: StageOverlays;
  public inspector!: SimInspector;
  public hudStrip!: SimHudStrip;
  public recorder = new TelemetryRecorder();
  private presetState: PresetRuntimeState = createDefaultPresetState();
  public refBenchmarkMs = 0;

  public runState: RunState = 'idle';
  private frameCount = 0;
  private lastFpsUpdateTime = performance.now();
  private lastRenderTime = performance.now();
  private vehiclePosePrevious: InterpolatedPose = { position: [0, 0, 0], yawRad: 0, scale: 1 };
  private vehiclePoseCurrent: InterpolatedPose = { position: [0, 0, 0], yawRad: 0, scale: 1 };
  private vehicleInterpolatedPose: InterpolatedPose = { position: [0, 0, 0], yawRad: 0, scale: 1 };


  private activePresetKey = 'breakout';
  private activeThrottle = 1.0;
  private activeRpm = 4140;
  public activeCurrent_A = 1.41;
  private motorTemp_C = 20.0;
  private runDurationSec = 0.0;


  public shaft = new PropellerShaft(4140, 18.0);
  public activeDesignId: 'candidateA' | 'kaplan' | 'wageningen' = 'candidateA';
  public activeMaterial: PropellerMaterial = 'rigid10k';
  public activeHandedness: 'CW' | 'CCW' = 'CW';


  public bus = new PowerBus(3, 12.0, 0.782);


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




  private physicsAdvancedDt = 0;

  private lastAdvanceSpeedMs = 0;

  private metricsData: HudMetricsData = {
    thrust_N: 4.73,
    torque_Nm: 0.024,
    power_W: 15.2,
    efficiency_pct: 0.0,
    advance_ratio_J: 0.0,
    rpm: 4140,
    pitch_deg: 18.0,
    inflow_velocity_ms: 0.0,
    max_velocity_domain_ms: 0.0,
    bus_V: 10.90,
    current_A: 1.41,
    temp_C: 20.0,
    rollRatePrediction_deg_m: 1.8,
    fps: 60.0,
    frameMs: 16.6,
    gpuMs: 0.0,
    overlayMs: 0.0,
    resolutionScale: 1.0,
    readbackLatencyMs: 0.0,
    renderTier: 'WebGPU',
    presetName: 'Breakout Burst',
    thermalBurstRemainingS: 18.0,
    specStatus: 'within_spec',
    specStatusLabel: 'WITHIN SPEC'
  };

  public init(): void {
    const root = document.getElementById('app');
    if (!root) {
      console.error('[App] Missing #app root element');
      return;
    }


    const layout = buildSimLayout(root);


    this.renderer = new AppRenderer(layout.viewportEl);


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

    this.adaptiveRes.onResolutionChange = (scale, w, h) => {
      this.fluidSolver.setResolution(w, h);
      this.fluidRenderer.resize(w, h);
      this.coupler.config.centerY = Math.floor(h / 2);
      this.hull.config.y = Math.floor(h / 2 - 10);
      this.metricsData.resolutionScale = scale;
    };

    this.recovery = new RecoveryCoordinator({
      onBackendChange: (backend) => {
        console.log(`[App] Render backend transitioned to ${backend}`);


        this.fluidSolver.setBackend(backend);
        this.metricsData.renderTier = backend;
      },
      onPause: () => {
        this.clock.stop();
      },
      onResume: () => {
        if (this.runState === "running") {
          this.clock.start();
        }
      },


      reinitProbe: () => this.fluidSolver.reinitGpuPipeline()
    });

    this.attachDeviceLossListeners();
    this.metricsData.renderTier = this.renderer.backend;



    this.measureCpuReferenceBenchmark();


    this.clock = new SimClock(defaultConfig.clock.fixedDeltaTime, defaultConfig.clock.maxSubsteps);


    const glContext = (this.renderer.renderer as any).getContext ? (this.renderer.renderer as any).getContext() : undefined;
    this.gpuTimer = new GpuTimer({ gl: glContext });


    this.header = new SimHeader(layout.headerEl, {
      onRunToggle: (nextState) => {
        this.runState = nextState;
        if (nextState === 'running') {
          this.clock.start();

          this.recorder.start();
          this.fluidSolver.jet.config.enabled = true;
          this.fluidSolver.jet.config.vx = Math.max(1.8, Math.abs(this.activeThrottle) * 3.5);
          this.fluidSolver.jet.triggerBurst(this.fluidSolver.grid, Math.max(2.5, Math.abs(this.activeThrottle) * 3.2));
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
        const shareUrl = serializeSimStateToUrl({
          preset: this.activePresetKey,
          vehicle: "candidateA",
          pitch: this.shaft.commandedPitchDeg,
          handedness: this.activeHandedness,
          stator: this.inspector.statorSlotted ? "slotted" : "solid",
          supplyV: this.inspector.supplyV,
          tetherFt: this.inspector.tetherFt,
          tetherAwg: this.inspector.tetherAwg
        });
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(shareUrl).catch(() => {});
        }
        this.showNotification("Configuration URL copied to clipboard");
      },
      onRecordToggle: async () => {
        if (this.videoRecorder.recording) {
          this.header.setRecordingState(false);
          const blob = await this.videoRecorder.stop();
          if (blob) {
            this.videoRecorder.download(blob);
            this.showNotification("Simulation recording downloaded (.webm)");
          }
        } else {
          const domEl = this.renderer.renderer.domElement as HTMLCanvasElement;
          const started = this.videoRecorder.start(domEl, 60);
          if (started) {
            this.header.setRecordingState(true);
            this.showNotification("Recording started (60 FPS WebM)");
          } else {
            this.showNotification("Video recording not supported in this browser");
          }
        }
      },
      onExportCsv: () => {
        this.exportTelemetryCsv();
      },
      onValidationClick: () => {
        window.location.href = '/validation';
      }
    });


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

    const vehicle3D = this.renderer.attachVehicle3D(defaultConfig.vehicle);
    this.renderer.onVehicleSelected = () => {
      this.inspector.setSelection({ type: 'vehicle' });
      this.renderer.prop3D?.setSelected(false);
    };
    this.renderer.onVehiclePoseChanged = (position, yawRad) => {


      this.vehicle.reset([position.x, position.y, position.z], yawRad);
      this.vehicleTelemetry = null;
    };
    this.renderer.onVehiclePoseCommit = () => {
      this.syncVehicleInitFromBody();
      this.controlPanel?.refreshVehicleGroup();
    };
    this.applyVehicleInitPose();
    vehicle3D.setSelected(true);

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


    this.palette = new SimPalette(layout.paletteEl, {
      onLoadVehicle: (vehicleId) => {
        console.log(`[Palette] Loaded vehicle: ${vehicleId}`);
        this.propArray.setupCandidateADefaults();
        this.palette.setThrusterCount(3, 0);
        this.inspector.propulsorCount = 3;
        this.renderer.resetOrbitView();
      },
      onResetPose: () => {


        this.applyVehicleInitPose();
        this.renderer.vehicle3D?.commitPose();
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
          this.overlayState[key] = active;
          this.overlaySystem.setVisible(key, active);

          if (key === 'pressureHeatmap') {
            this.fluidRenderer.mode = active ? 'PRESSURE' : 'DYE';
          }
          this.controlPanel?.syncOverlayState(this.overlayState);
        }
      },
      { sharedState: this.overlayState }
    );


    this.inspector = new SimInspector(layout.inspectorEl, {
      onSupplyVoltageChange: (v) => {
        defaultConfig.electrical.supplyVoltage = v;
        this.bus.supplyV = v;
      },
      onTetherLengthChange: (ft) => {
        defaultConfig.electrical.tetherLengthFt = ft;
        this.bus.tetherResistance = calculateTetherResistanceFromMeters(ft / 3.28084, this.inspector.tetherAwg);
        this.inspector.tetherResistance = this.bus.tetherResistance;
      },
      onTetherLengthMChange: (m) => {
        this.bus.tetherResistance = calculateTetherResistanceFromMeters(m, this.inspector.tetherAwg);
        this.inspector.tetherResistance = this.bus.tetherResistance;
      },
      onTetherAwgChange: (awg) => {
        this.bus.tetherResistance = calculateTetherResistanceFromMeters(this.inspector.tetherM, awg);
        this.inspector.tetherResistance = this.bus.tetherResistance;
      },
      onAmbientTempChange: (tempC) => {
        this.bus.setAmbientTemperature(tempC);
      },
      onThermalToggle: (enabled) => {
        this.bus.thermalEnabled = enabled;
      },
      onThrottleChange: (idx, throttle) => {
        if (idx === 0) this.activeThrottle = throttle;
        if (this.propArray.thrusters[idx]) {
          this.propArray.thrusters[idx].throttle = throttle;
        }
      },
      onPitchChange: (_idx, pitchDeg) => {
        this.shaft.commandedPitchDeg = pitchDeg;
        if (this.renderer.prop3D) this.renderer.prop3D.currentPitchDeg = pitchDeg;
      },
      onHandednessToggle: (idx) => {
        this.activeHandedness = this.activeHandedness === 'CW' ? 'CCW' : 'CW';
        if (this.propArray.thrusters[idx]) {
          this.propArray.thrusters[idx].handedness = this.activeHandedness;
        }
        this.renderer.prop3D?.setHandedness(this.activeHandedness);
      },
      onStatorToggle: (idx, attached) => {
        if (this.propArray.thrusters[idx]) {
          this.propArray.thrusters[idx].stator.config.vaneType = attached
            ? (this.inspector.statorSlotted ? 'slotted' : 'solid')
            : 'none';
        }
        this.palette.statorAttached = attached;
        this.palette.render();
        this.renderer.prop3D?.setStatorAttached(attached);
      },
      onStatorIncidenceChange: (idx, incidenceDeg) => {
        if (this.propArray.thrusters[idx]) {
          this.propArray.thrusters[idx].stator.config.incidenceDeg = incidenceDeg;
        }
        this.renderer.prop3D?.setStatorIncidence(incidenceDeg);
      },
      onStatorSlotToggle: (idx, slotted) => {
        if (this.propArray.thrusters[idx]) {
          this.propArray.thrusters[idx].stator.config.vaneType = slotted ? 'slotted' : 'solid';
        }
        this.palette.slottedVane = slotted;
        this.palette.render();
        this.renderer.prop3D?.setStatorSlotted(slotted);
      },
      onStatorSlotPctChange: (idx, pct) => {
        if (this.propArray.thrusters[idx]) {
          this.propArray.thrusters[idx].stator.config.slotChordPct = pct;
        }
      },
      onPropulsorCountChange: (count) => {
        while (this.propArray.thrusters.length < count) {
          this.propArray.addThruster();
        }
        while (this.propArray.thrusters.length > count) {
          this.propArray.removeThruster(this.propArray.thrusters.length - 1);
        }
        this.palette.setThrusterCount(count);
      },
      onHandednessPresetChange: (preset) => {
        this.propArray.applyHandednessPreset(preset as any);
        this.palette.handednessPreset = preset as any;
        this.palette.setThrusterCount(this.propArray.thrusters.length);
      },
      onInflowDampingChange: (alpha) => {
        this.coupler.config.inflowRelaxation = alpha;
      },
      onResolutionChange: (preset) => {
        let w = 1024, h = 512;
        if (preset === '512x256') { w = 512; h = 256; }
        else if (preset === '256x128') { w = 256; h = 128; }
        this.fluidSolver.setResolution(w, h);
        this.fluidRenderer.resize(w, h);
        this.coupler.config.centerY = Math.floor(h / 2);
        this.hull.config.y = Math.floor(h / 2 - 10);
      }
    });


    this.hudStrip = new SimHudStrip(layout.hudEl, layout.stagePopoversEl);


    this.controlPanel = new ControlPanel(
      defaultConfig,
      this.metricsData as any,
      {
        onInjectBurst: () => this.fluidSolver.jet.triggerBurst(this.fluidSolver.grid, 3.2),
        onResetFluid: () => this.fluidSolver.grid.resetAll(),
        onVehicleInitPoseChange: () => {
          this.applyVehicleInitPose();
          this.renderer.vehicle3D?.commitPose();
        },
        onVehicleResetPose: () => {
          this.applyVehicleInitPose();
          this.renderer.vehicle3D?.commitPose();
          this.renderer.resetOrbitView();
        },
        onVehicleTetherChange: () => {
          this.vehicleTether.attached = defaultConfig.vehicle.tetherAttached;
          this.vehicleTether.stiffnessNm = defaultConfig.vehicle.tetherStiffnessNm;
          this.vehicleTether.dampingNPerMs = defaultConfig.vehicle.tetherDamping;
        },
        onVehicleTunablesChange: () => {


          this.vehicle.applyTunables(defaultConfig.vehicle);
        },
        onOverlayToggle: (key, active) => {
          this.overlayState[key] = active;
          this.overlaySystem.setVisible(key, active);
          if (key === 'pressureHeatmap') {
            this.fluidRenderer.mode = active ? 'PRESSURE' : 'DYE';
          }
        }
      },
      this.overlayState,
      this.overlaySystem.tunables,
      this.vehicleInit
    );
    const inspectorHost = document.createElement('div');
    inspectorHost.className = 'tweakpane-host';
    inspectorHost.appendChild(this.controlPanel.pane.element);
    const inspectorContainer = (this.inspector as unknown as { container?: HTMLElement }).container;
    if (inspectorContainer) {
      inspectorContainer.appendChild(inspectorHost);
    } else {
      document.body.appendChild(inspectorHost);
    }

    const urlState = parseSimStateFromUrl();
    if (urlState.preset) {
      this.applyPreset(urlState.preset);
    }
    if (urlState.pitch !== undefined) {
      this.shaft.commandedPitchDeg = urlState.pitch;
      this.inspector.thrusterPitch = urlState.pitch;
    }
    if (urlState.handedness) {
      this.activeHandedness = urlState.handedness;
      this.inspector.thrusterHandedness = urlState.handedness;
    }
    if (urlState.stator) {
      const isSlotted = urlState.stator === "slotted";
      this.inspector.statorSlotted = isSlotted;
      for (const t of this.propArray.thrusters) {
        t.stator.config.vaneType = isSlotted ? "slotted" : (urlState.stator === "none" ? "none" : "solid");
      }
    }
    if (urlState.supplyV !== undefined) {
      this.inspector.supplyV = urlState.supplyV;
      this.bus.supplyV = urlState.supplyV;
    }
    if (urlState.tetherFt !== undefined) {
      this.inspector.tetherFt = urlState.tetherFt;
      this.bus.tetherResistance = calculateTetherResistanceFromMeters(urlState.tetherFt / 3.28084, this.inspector.tetherAwg);
      this.inspector.tetherResistance = this.bus.tetherResistance;
    }
    if (urlState.tetherAwg !== undefined) {
      this.inspector.tetherAwg = urlState.tetherAwg;
      this.bus.tetherResistance = calculateTetherResistanceFromMeters(this.inspector.tetherM, urlState.tetherAwg);
      this.inspector.tetherResistance = this.bus.tetherResistance;
    }

    const isFirstVisit = (() => {
      try {
        if (typeof localStorage === "undefined") return false;
        return localStorage.getItem("seaperch_first_run_seen") !== "true";
      } catch {
        return false;
      }
    })();

    if (isFirstVisit) {
      (Object.keys(this.overlayState) as Array<keyof OverlayState>).forEach(k => {
        this.overlayState[k] = false;
        this.overlaySystem.setVisible(k, false);
      });
      this.stageOverlays.state = { ...this.overlayState };
      this.stageOverlays.render();
      this.renderer.playIntroCameraMove();
    } else {
      this.renderer.resetOrbitView();
    }

    console.log('[App] IBM Quantum-inspired instrument UI ready.');
    this.start();
  }

  
  private showNotification(msg: string): void {
    if (typeof document === "undefined") return;
    const existing = document.querySelector(".toast-notification");
    existing?.remove();
    const toast = document.createElement("div");
    toast.className = "toast-notification";
    toast.innerHTML = `<span>ℹ️</span><span>${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, 3000);
  }

  private attachDeviceLossListeners(): void {
    const rendererAny = this.renderer.renderer as any;


    const device = rendererAny?.backend?.device ?? rendererAny?._device;
    if (device && typeof device.lost?.then === 'function') {
      device.lost.then((info: { reason?: string } | undefined) => {
        console.warn(`[App] WebGPU device lost (reason: ${info?.reason ?? 'unknown'})`);
        void this.recovery.handleDeviceLoss();
      });
    }



    const dom = rendererAny?.domElement as HTMLElement | undefined;
    if (dom && typeof dom.addEventListener === 'function') {
      const onContextLost = (e: Event) => {
        e.preventDefault();
        console.warn('[App] WebGL2 context lost');
        void this.recovery.handleDeviceLoss();
      };
      dom.addEventListener('webglcontextlost', onContextLost as EventListener);
    }


    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
          console.log('[App] Manual device-loss simulation (Shift+D)');
          void this.recovery.handleDeviceLoss();
        }
      });
    }
  }

  public applyPreset(presetKey: string): void {
    const p = ALL_PRESETS.find(x => x.key === presetKey);
    if (!p) return;

    if (presetKey === "stress") {
      this.fluidSolver.setResolution(2048, 1024);
      this.fluidRenderer.resize(2048, 1024);
      this.coupler.config.centerY = 512;
      this.hull.config.y = 502;
      this.adaptiveRes.baseWidth = 2048;
      this.adaptiveRes.baseHeight = 1024;
      this.adaptiveRes.setScale(1.0);
      this.metricsData.resolutionScale = 1.0;
            (Object.keys(this.overlayState) as Array<keyof OverlayState>).forEach(k => {
        this.overlayState[k] = true;
        this.overlaySystem.setVisible(k, true);
      });
      this.fluidRenderer.mode = "PRESSURE";
    }
    this.activePresetKey = p.key;
    this.activeThrottle = p.throttle;
    this.activeRpm = p.rpm;
    this.metricsData.thrust_N = p.thrust_N;
    this.activeCurrent_A = p.current_A;

    applyPresetToState(this.presetState, p);

    this.metricsData.presetName = p.name;
    this.metricsData.thermalBurstRemainingS = this.presetState.burstRemainingS;
    this.header.setPreset(p.key);


    for (let i = 0; i < this.propArray.thrusters.length; i++) {
      const th = p.throttleVector && p.throttleVector[i] !== undefined ? p.throttleVector[i] : p.throttle;
      this.propArray.thrusters[i].throttle = th;
    }


    defaultConfig.electrical.supplyVoltage = 12.0;
    defaultConfig.electrical.tetherLengthFt = 15.0;
    const rTether = calculateTetherResistanceFromMeters(15.0 / 3.28084, 24);
    defaultConfig.electrical.tetherResistance = rTether;
    this.bus.supplyV = 12.0;
    this.bus.tetherResistance = rTether;
    this.inspector.supplyV = 12.0;
    this.inspector.tetherFt = 15.0;
    this.inspector.tetherAwg = 24;
    this.inspector.tetherResistance = rTether;


    this.activeDesignId = 'candidateA';
    this.renderer.prop3D?.setDesign(getPropDesign('candidateA'));


    this.activeMaterial = 'rigid10k';
    this.renderer.prop3D?.setMaterial('rigid10k');


    for (const t of this.propArray.thrusters) {
      t.stator.config.vaneType = 'slotted';
      t.stator.config.incidenceDeg = -5.2;
      t.stator.config.slotChordPct = 40.0;
    }
    this.renderer.prop3D?.setStatorAttached(true);
    this.renderer.prop3D?.setStatorSlotted(true);
    this.renderer.prop3D?.setStatorIncidence(-5.2);
    this.inspector.statorAttached = true;
    this.inspector.statorSlotted = true;
    this.inspector.statorIncidenceDeg = -5.2;

    this.inspector.thrusterThrottle = p.throttle;
    this.inspector.thrusterRpm = p.rpm;
    this.shaft.commandedRpm = p.rpm * this.activeThrottle;


    if (this.controlPanel) {
      this.controlPanel.propState.design = 'candidateA';
      this.controlPanel.propState.material = 'rigid10k';
      this.controlPanel.propState.rpm = p.rpm;
      this.controlPanel.electricalState.supplyV = 12.0;
      this.controlPanel.electricalState.tetherLengthFt = 15.0;
      this.controlPanel.electricalState.tetherAwg = 24;
      this.controlPanel.electricalState.tetherResistance = rTether;
      this.controlPanel.arrayState.statorAttached = true;
      this.controlPanel.arrayState.statorSlotted = true;
      this.controlPanel.arrayState.statorIncidenceDeg = -5.2;
      this.controlPanel.update();
    }



    if (this.runState === 'running') {
      this.fluidSolver.jet.config.enabled = Math.abs(p.throttle) > 0.05;
      this.fluidSolver.jet.config.vx = Math.max(1.8, Math.abs(p.throttle) * 3.5);
      this.fluidSolver.jet.triggerBurst(this.fluidSolver.grid, Math.max(2.0, Math.abs(p.throttle) * 2.5));
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

  
  private computeThrustCurve(designId: string): ThrustCurvePoint[] {
    const design = getPropDesign(designId);
    const D = design.diameterMm * 1e-3;
    const curve: ThrustCurvePoint[] = [];
    const n = 8;
    const va = 0.5;
    for (let i = 0; i < n; i++) {
      const J = (i / (n - 1)) * 1.4;
      const rpm = (va * 60) / (J * D);
      if (!isFinite(rpm) || rpm <= 0) {
        curve.push({ J, thrustN: 0 });
        continue;
      }
      const bemt = solveBEMT(Math.min(8000, rpm), va, {
        design,
        material: this.activeMaterial,
        handedness: this.activeHandedness
      });
      curve.push({ J, thrustN: bemt.thrustN });
    }
    return curve;
  }

  private update(currentTimeMs: number): void {
    const frameStart = performance.now();


    this.physicsAdvancedDt = 0;
    if (this.runState === 'running') {
      this.clock.tick(currentTimeMs, (dt) => {
        this.runDurationSec += dt;
        this.physicsAdvancedDt += dt;


        this.shaft.commandedRpm = this.activeRpm * this.activeThrottle;
        this.shaft.update(dt);


        const advanceSpeed = this.coupler.sampleInflowVelocity(this.fluidSolver.grid);


        const design = getPropDesign(this.activeDesignId);
        const bemt = solveBEMT(this.shaft.currentRpm, advanceSpeed, {
          design,
          material: this.activeMaterial,
          handedness: this.activeHandedness,
          pitchMm: Math.tan((this.shaft.currentPitchDeg * Math.PI) / 180.0) * (2.0 * Math.PI * 0.015) * 1e3
        });


        this.bus.supplyV = this.inspector.supplyV;
        this.bus.thermalEnabled = this.inspector.thermalActive;
        this.bus.setAmbientTemperature(this.inspector.ambientTempC);

        const hydroTorque = Math.abs(bemt.torqueNm);
        const loadTorqueFn = () => hydroTorque;

        const busTelemetry = this.bus.solveBusNetwork(
          [this.activeThrottle, 0, 0],
          [loadTorqueFn, () => 0, () => 0]
        );

        this.bus.stepThermal(dt);

        const motor0 = busTelemetry.motors[0];
        this.motorTemp_C = motor0.windingTempC;


        const couplingTelemetry = this.coupler.injectCouplingForces(this.fluidSolver.grid, bemt, dt);
        this.hull.applyDrag(this.fluidSolver.grid, dt);




        const vehicleAdvances = this.vehicleCoupler.update(
          this.fluidSolver.grid,
          this.vehicle,
          this.propArray.thrusters,
          this.vehicleAmbientFlowWorld
        );






        if (this.propArray.thrusters.length > 0) {
          this.propArray.thrusters[0].throttle = this.activeThrottle;
          if (this.propArray.thrusters.length > 1) {
            this.propArray.thrusters[1].throttle = this.activeThrottle;
          }
        }



        const arraySummary = this.propArray.evaluate(
          undefined,
          vehicleAdvances,
          [
            this.vehicle.angularVelocityBodyRadS[0],
            this.vehicle.angularVelocityBodyRadS[1],
            this.vehicle.angularVelocityBodyRadS[2]
          ],
          advanceSpeed > 1e-6 ? advanceSpeed : 0.0
        );
        this.lastAdvanceSpeedMs = advanceSpeed;





        this.vehicleForceMarineN = [
          arraySummary.totalForceN[0],
          arraySummary.totalForceN[1],
          arraySummary.totalForceN[2]
        ];
        this.vehicleMomentMarineNm = [
          arraySummary.totalMomentNm[0],
          arraySummary.totalMomentNm[1],
          arraySummary.totalMomentNm[2]
        ];
        this.vehicleTether.attached = defaultConfig.vehicle.tetherAttached;
        this.vehicleTether.stiffnessNm = defaultConfig.vehicle.tetherStiffnessNm;
        this.vehicleTether.dampingNPerMs = defaultConfig.vehicle.tetherDamping;

        this.vehicleTether.anchorWorld = [
          this.vehicleInit.tetherAnchorSwayM,
          this.vehicleInit.tetherAnchorHeaveM,
          this.vehicleInit.tetherAnchorSurgeM
        ];
        this.vehiclePosePrevious = this.vehiclePoseCurrent;
        this.vehicleTelemetry = stepVehicleSubstepped(
          this.vehicle,
          dt,
          defaultConfig.vehicle.vehicleSubstepDivider,
          { forceBodyMarine: this.vehicleForceMarineN, momentBodyMarine: this.vehicleMomentMarineNm },
          undefined,
          DEFAULT_TANK_BOUNDARIES,
          this.vehicleTether,
          [this.vehicleAmbientFlowWorld.x, this.vehicleAmbientFlowWorld.y, this.vehicleAmbientFlowWorld.z]
        );
        this.vehiclePoseCurrent = {
          position: [this.vehicle.position.x, this.vehicle.position.y, this.vehicle.position.z],
          yawRad: this.vehicle.getEulerDegrees().yawDeg * (Math.PI / 180),
          scale: 1
        };




        this.vehicleCoupler.injectSlipstream(this.fluidSolver.grid, this.vehicle, arraySummary, dt);




        this.fluidSolver.step(dt);


        tickThermalBurst(this.presetState, dt);


        let maxV = 0;
        let sumV = 0;
        let maxVort = 0;
        const g = this.fluidSolver.grid;
        const len = g.size;
        const sampleStep = Math.max(1, Math.floor(len / 512));
        let sampleCount = 0;
        for (let c = 0; c < len; c += sampleStep) {
          const spd = Math.hypot(g.u[c], g.v[c]);
          if (spd > maxV) maxV = spd;
          sumV += spd;
          const vr = Math.abs(g.curl[c] || 0);
          if (vr > maxVort) maxVort = vr;
          sampleCount++;
        }
        const meanV = sampleCount > 0 ? sumV / sampleCount : 0;


        const busPowerW = busTelemetry.terminalV * busTelemetry.totalBusCurrentA;
        const nRps = Math.abs(this.shaft.currentRpm) / 60.0;
        const Dm = 0.042;
        const advanceJ = nRps > 0.1 ? advanceSpeed / (nRps * Dm) : 0;
        const mechHydThrustW = Math.max(0, arraySummary.totalForceN[0]) * Math.max(0, advanceSpeed);
        const efficiencyPct = busPowerW > 0.01 ? Math.min(100.0, (mechHydThrustW / busPowerW) * 100.0) : 0.0;


        let specStatus: SpecStatus = 'within_spec';
        let specStatusLabel = 'WITHIN SPEC';
        if (motor0.isCutout || motor0.thermalState === 'CUTOUT') {
          specStatus = 'thermal_cutout';
          specStatusLabel = 'CUTOUT ACTIVE';
        } else if (motor0.windingTempC >= 85.0 || this.presetState.specViolationLatched || (this.presetState.burstRemainingS !== null && this.presetState.burstRemainingS <= 0)) {
          specStatus = 'thermal_warn';
          specStatusLabel = 'THERMAL WARN';
        } else if (busTelemetry.totalBusCurrentA > 1.6) {
          specStatus = 'limit_exceeded';
          specStatusLabel = 'OVERCURRENT';
        }


        this.metricsData.thrust_N = arraySummary.totalForceN[0];
        this.metricsData.torque_Nm = Math.abs(arraySummary.totalMomentNm[0]);
        this.metricsData.power_W = busPowerW;
        this.metricsData.efficiency_pct = efficiencyPct;
        this.metricsData.advance_ratio_J = advanceJ;
        this.metricsData.rpm = this.shaft.currentRpm;
        this.metricsData.pitch_deg = this.shaft.currentPitchDeg;
        this.metricsData.inflow_velocity_ms = advanceSpeed;
        this.metricsData.max_velocity_domain_ms = maxV;
        this.metricsData.bus_V = busTelemetry.terminalV;
        this.metricsData.current_A = busTelemetry.totalBusCurrentA;
        this.metricsData.temp_C = this.motorTemp_C;
        this.metricsData.thermalBurstRemainingS = this.presetState.burstRemainingS;
        this.metricsData.specStatus = specStatus;
        this.metricsData.specStatusLabel = specStatusLabel;
        this.metricsData.netThrustVector_N = arraySummary.totalForceN;
        this.metricsData.netTorqueVector_Nm = arraySummary.totalMomentNm;
        this.metricsData.rollRatePrediction_deg_m = arraySummary.ledgerSummary.predictedRollRateDegPerM;
        while (this.scratchDtDr.length < bemt.elements.length) {
          this.scratchDtDr.push({ rOverR: 0, dT: 0 });
        }
        this.scratchDtDr.length = bemt.elements.length;
        for (let i = 0; i < bemt.elements.length; i++) {
          this.scratchDtDr[i].rOverR = bemt.elements[i].rOverR;
          this.scratchDtDr[i].dT = bemt.elements[i].dT;
        }
        this.metricsData.dT_dr = this.scratchDtDr;

        while (this.scratchPerUnitTel.length < arraySummary.thrusters.length) {
          this.scratchPerUnitTel.push({ id: "", thrust_N: 0, torque_Nm: 0, rpm: 0, current_A: 0, temp_C: 20 });
        }
        this.scratchPerUnitTel.length = arraySummary.thrusters.length;
        for (let i = 0; i < arraySummary.thrusters.length; i++) {
          const t = arraySummary.thrusters[i];
          const item = this.scratchPerUnitTel[i];
          item.id = t.unit.id;
          item.thrust_N = t.netThrustN;
          item.torque_Nm = t.netTorqueNm;
          item.rpm = t.rpm;
          item.current_A = Math.abs(t.rpm) * 0.00034;
          item.temp_C = this.motorTemp_C;
        }
        this.metricsData.perUnitTelemetry = this.scratchPerUnitTel;


        if (this.recorder.isActive()) {
          this.recorder.record({
            t: this.runDurationSec,
            dt,
            fps: this.metricsData.fps,
            thrusters: arraySummary.thrusters.map((th, idx) => ({
              rpm: th.rpm,
              pitchDeg: this.shaft.currentPitchDeg,
              thrustN: th.netThrustN,
              torqueNm: th.netTorqueNm,
              currentA: this.bus.lastTelemetry?.motors[idx]?.currentA ?? (Math.abs(th.rpm) * 0.00034),
              vTermV: this.bus.lastTelemetry?.motors[idx]?.terminalVoltageV ?? busTelemetry.terminalV,
              tMotorC: this.bus.motors[idx]?.windingTempC ?? this.motorTemp_C
            })),
            busV: busTelemetry.terminalV,
            iTotalA: busTelemetry.totalBusCurrentA,
            pTotalW: busPowerW,
            pos: [this.vehicle.position.x, this.vehicle.position.y, this.vehicle.position.z],
            vel: [this.scratchVehicleWorldVelocity.x, this.scratchVehicleWorldVelocity.y, this.scratchVehicleWorldVelocity.z],
            quat: [this.vehicle.quaternion.w, this.vehicle.quaternion.x, this.vehicle.quaternion.y, this.vehicle.quaternion.z],
            omega: [this.vehicle.angularVelocityBodyRadS[0], this.vehicle.angularVelocityBodyRadS[1], this.vehicle.angularVelocityBodyRadS[2]],
            rollDevPerM: this.metricsData.rollRatePrediction_deg_m ?? NaN,
            fluidMaxV: maxV,
            fluidMeanV: meanV,
            fluidMaxVorticity: maxVort,
            pressureIters: defaultConfig.fluid.pressureIterations,
            residual: 0.0001,
            gpuMs: this.metricsData.gpuMs
          });
        }


        this.inspector.thrusterVterm = motor0.terminalVoltageV;
        this.inspector.thrusterCurrentA = motor0.currentA;
        this.inspector.thrusterTempC = motor0.windingTempC;
        this.inspector.thrusterThermalState = motor0.thermalState;


        this.stageOverlays.updateCouplingBadge(
          couplingTelemetry.thrustAgreementPct,
          couplingTelemetry.bemtThrustN,
          couplingTelemetry.gridMomentumThrustN
        );


        if (this.renderer.prop3D) {

          this.renderer.prop3D.setMotorTemperature(motor0.windingTempC, 0);
        }
      });
    }


    const grid = this.fluidSolver.grid;
    this.overlayCtx.grid = grid;
    this.overlayCtx.gridDxM = this.coupler.config.gridDxM;
    this.overlayCtx.gridCenter.set(0, 0, 0);
    this.overlayCtx.vehicle = this.vehicle;



    const atRest = this.runState !== 'running';
    const latestSummary = this.propArray.evaluate(
      undefined, undefined, undefined,
      atRest ? 0.0 : this.lastAdvanceSpeedMs
    );
    this.overlayCtx.summary = latestSummary;



    this.overlayCtx.physicsDt = atRest ? 0 : this.physicsAdvancedDt;
    this.overlayCtx.elapsed = currentTimeMs * 0.001;
    this.overlayCtx.motorTempsC.length = 0;
    this.overlayCtx.motorCurrentsA.length = 0;
    for (let m = 0; m < this.propArray.thrusters.length; m++) {
      this.overlayCtx.motorTempsC.push(this.bus.motors[m]?.windingTempC ?? 20.0);
      this.overlayCtx.motorCurrentsA.push(this.bus.lastTelemetry?.motors[m]?.currentA ?? 0);
    }


    const renderDt = Math.min(0.05, Math.max(0.001, (currentTimeMs - this.lastRenderTime) * 0.001));
    this.lastRenderTime = currentTimeMs;
    this.overlayCtx.dt = renderDt;
    this.overlaySystem.update(renderDt, this.overlayCtx);


    this.fluidRenderer.render(this.fluidSolver.grid);





    const clockAlpha = this.runState === 'running' ? this.clock.getAlpha() : 0;
    this.vehicleInterpolatedPose = computeInterpolatedPose(
      this.vehiclePosePrevious,
      this.vehiclePoseCurrent,
      clockAlpha
    );
    this.vehicleRenderPose = this.vehicleInterpolatedPose;
    this.renderer.vehicle3D?.setInterpolatedPose(this.vehicleInterpolatedPose);


    this.gpuTimer.begin();
    this.renderer.render(
      currentTimeMs * 0.001,
      defaultConfig.water.causticIntensity,
      this.fluidSolver.grid,
      renderDt,
      this.shaft.bladePhaseRad,
      this.shaft.currentRpm
    );
    this.gpuTimer.end();

    const gpuResult = this.gpuTimer.resolve();
    this.metricsData.gpuMs = gpuResult.durationMs;


    const frameElapsed = performance.now() - frameStart;
    this.metricsData.frameMs = frameElapsed;
    this.adaptiveRes.recordFrameTime(frameElapsed);
    this.metricsData.resolutionScale = this.adaptiveRes.currentScale;
    this.metricsData.readbackLatencyMs = this.fluidSolver.readbackLatencyMs;

    this.metricsData.overlayMs = this.overlaySystem.overlayMs;

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdateTime >= 500) {
      this.metricsData.fps = (this.frameCount * 1000) / (now - this.lastFpsUpdateTime);
      this.frameCount = 0;
      this.lastFpsUpdateTime = now;
    }


    if (this.runState !== 'running') {


      const staticSummary = this.propArray.evaluate(undefined, undefined, undefined, 0.0);
      this.metricsData.rollRatePrediction_deg_m = staticSummary.ledgerSummary.predictedRollRateDegPerM;
      this.metricsData.netThrustVector_N = staticSummary.totalForceN;
      this.metricsData.netTorqueVector_Nm = staticSummary.totalMomentNm;
    }
    this.hudStrip.update(this.metricsData, currentTimeMs);




    this.inspector.setVehicleTelemetry(this.buildVehicleTelemetryView());
  }

  
  private static marineToWorld(surge: number, sway: number, heave: number): [number, number, number] {
    return [sway, heave, surge];
  }

  private applyVehicleInitPose(): void {
    const { surgeM, swayM, heaveM, yawDeg } = this.vehicleInit;
    const [wx, wy, wz] = App.marineToWorld(surgeM, swayM, heaveM);
    this.vehicle.reset([wx, wy, wz], (yawDeg * Math.PI) / 180);
    this.vehicleTelemetry = null;
    this.renderer.vehicle3D?.setPose(this.vehicle.position, this.vehicle.quaternion);
  }

  private syncVehicleInitFromBody(): void {
    const p = this.vehicle.position;
    this.vehicleInit.swayM = p.x;
    this.vehicleInit.heaveM = p.y;
    this.vehicleInit.surgeM = p.z;
    this.vehicleInit.yawDeg = this.vehicle.getEulerDegrees().yawDeg;
  }

  private buildVehicleTelemetryView(): VehicleTelemetryView {
    const v = this.vehicle;
    const euler = v.getEulerDegrees();
    const t = this.vehicleTelemetry;
    const c = defaultConfig.vehicle;
    const worldVelocity = v.worldVelocity(this.scratchVehicleWorldVelocity);
    return {
      positionWorldM: [v.position.x, v.position.y, v.position.z],
      velocityWorldMs: [worldVelocity.x, worldVelocity.y, worldVelocity.z],
      velocityBodyMs: [v.velocityBodyMs[0], v.velocityBodyMs[1], v.velocityBodyMs[2]],
      eulerDeg: euler,
      ratesRadS: [
        v.angularVelocityBodyRadS[0],
        v.angularVelocityBodyRadS[1],
        v.angularVelocityBodyRadS[2]
      ],
      buoyancyForceN: v.buoyancyForces.netBuoyancyForceN,
      netVerticalForceN: t ? t.appliedForceBodyN[2] : 0,
      dragForceN: t ? t.dragForceBodyN : [0, 0, 0],
      restoringTorqueNm: t ? t.restoringTorqueBodyNm : [0, 0, 0],
      thrustForceMarineN: this.vehicleForceMarineN,
      thrustMomentMarineNm: this.vehicleMomentMarineNm,
      staticStabilityMm: c.cobAboveCogMm,
      dryMassG: v.dryMassKg * 1e3,
      displacedVolumeCm3: c.displacedVolumeCm3,
      inertiaBody: v.rigidBodyInertiaKgM2,
      addedMassBody: [
        v.spatialMass.addedTranslationalKg[0],
        v.spatialMass.addedTranslationalKg[1],
        v.spatialMass.addedTranslationalKg[2]
      ],
      rollDeviationDegPerM: this.metricsData.rollRatePrediction_deg_m ?? NaN,
      tetherAttached: defaultConfig.vehicle.tetherAttached,
      grounded: t?.isGrounded ?? false,
      broaching: t?.isBroaching ?? false,
      angularRateClamped: t?.angularRateClamped ?? false
    };
  }

  private exportTelemetryCsv(): void {
    if (this.recorder.getCount() === 0) {
      this.recorder.start();
      const staticSummary = this.propArray.evaluate(undefined, undefined, undefined, 0.0);
      this.recorder.record({
        t: this.runDurationSec,
        dt: 1 / 60,
        fps: this.metricsData.fps,
        thrusters: staticSummary.thrusters.map((th, _idx) => ({
          rpm: th.rpm || this.activeRpm,
          pitchDeg: this.shaft.currentPitchDeg,
          thrustN: th.netThrustN || (this.metricsData.thrust_N / Math.max(1, staticSummary.thrusters.length)),
          torqueNm: th.netTorqueNm || (this.metricsData.torque_Nm / Math.max(1, staticSummary.thrusters.length)),
          currentA: this.activeCurrent_A / Math.max(1, staticSummary.thrusters.length),
          vTermV: this.metricsData.bus_V,
          tMotorC: this.metricsData.temp_C
        })),
        busV: this.metricsData.bus_V,
        iTotalA: this.metricsData.current_A,
        pTotalW: this.metricsData.power_W,
        pos: [this.vehicle.position.x, this.vehicle.position.y, this.vehicle.position.z],
        vel: [0, 0, 0],
        quat: [this.vehicle.quaternion.w, this.vehicle.quaternion.x, this.vehicle.quaternion.y, this.vehicle.quaternion.z],
        omega: [0, 0, 0],
        rollDevPerM: this.metricsData.rollRatePrediction_deg_m ?? 1.8,
        fluidMaxV: 0,
        fluidMeanV: 0,
        fluidMaxVorticity: 0,
        pressureIters: defaultConfig.fluid.pressureIterations,
        residual: 0.0001,
        gpuMs: this.metricsData.gpuMs
      });
      this.recorder.stop();
    }
    this.recorder.downloadCsv();
  }
}


if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
  });
}

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
