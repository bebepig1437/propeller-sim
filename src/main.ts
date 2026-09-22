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
import { SimHeader, DEFAULT_PRESETS, type RunState } from './ui/header';
import { SimPalette } from './ui/palette';
import { StageOverlays } from './ui/stageOverlays';
import { SimInspector, type VehicleTelemetryView } from './ui/inspector';
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
  private renderer!: AppRenderer;
  private fluidSolver!: GpuFluidSolver;
  private fluidRenderer!: FluidRenderer2D;
  private gpuTimer!: GpuTimer;

  // Phase 5b Propeller Array & Torque Ledger
  public propArray = new PropellerArray();

  // Phase 6b Vehicle Rigid Body + Buoyancy + two-way fluid coupling
  public vehicle = new VehicleBody(defaultConfig.vehicle);
  public vehicleCoupler = new VehicleFluidCoupler({
    gridCenter: new THREE.Vector3(0, 0, 0),
    gridDxM: 0.0015,
    depthM: 0.042,
    fluidDensity: defaultConfig.vehicle.fluidDensityKgM3,
    inflowRelaxation: 0.5,
    injectionRadiusCells: 14,
    // Plume is laid down one rotor radius (≈21 mm ≈ 14 cells) downstream so a
    // rotor never samples its own exhaust back as a tailwind.
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
  /** Ambient in-plane flow at the vehicle CoG (world frame), sampled each step. */
  private vehicleAmbientFlowWorld = new THREE.Vector3();
  private scratchVehicleWorldVelocity = new THREE.Vector3();
  /** Live marine-ordered thruster input, mirrored into the overlays/inspector. */
  public vehicleForceMarineN: [number, number, number] = [0, 0, 0];
  public vehicleMomentMarineNm: [number, number, number] = [0, 0, 0];
  /** Phase 6b Tweakpane editable initial pose / tether anchor (marine order). */
  public vehicleInit = {
    surgeM: 0.0,
    swayM: 0.0,
    heaveM: -0.1,
    yawDeg: 0.0,
    tetherAnchorSurgeM: defaultConfig.vehicle.tetherAnchorWorld[0],
    tetherAnchorSwayM: defaultConfig.vehicle.tetherAnchorWorld[1],
    tetherAnchorHeaveM: defaultConfig.vehicle.tetherAnchorWorld[2]
  };

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
  private vehiclePosePrevious: InterpolatedPose = { position: [0, 0, 0], yawRad: 0, scale: 1 };
  private vehiclePoseCurrent: InterpolatedPose = { position: [0, 0, 0], yawRad: 0, scale: 1 };
  private vehicleInterpolatedPose: InterpolatedPose = { position: [0, 0, 0], yawRad: 0, scale: 1 };

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

    // 5. Initialize Fixed-Timestep Simulation Clock (60 Hz, max 4 substeps)
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
    // Phase 6b — mount the vehicle body with direct-manipulation handles
    const vehicle3D = this.renderer.attachVehicle3D(defaultConfig.vehicle);
    this.renderer.onVehicleSelected = () => {
      this.inspector.setSelection({ type: 'vehicle' });
      this.renderer.prop3D?.setSelected(false);
    };
    this.renderer.onVehiclePoseChanged = (position, yawRad) => {
      // Direct manipulation writes position + yaw only: pitch and roll are owned
      // by the buoyancy model and are never user-set.
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
        // Phase 6b: Reset Pose is a palette action — return the vehicle to its
        // configured initial pose and reframe the camera on it.
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
          this.overlayState[key] = active;
          this.overlaySystem.setVisible(key, active);
          // Pressure heatmap owns the cutaway canvas while active
          if (key === 'pressureHeatmap') {
            this.fluidRenderer.mode = active ? 'PRESSURE' : 'DYE';
          }
          this.controlPanel?.syncOverlayState(this.overlayState);
        }
      },
      { sharedState: this.overlayState }
    );

    // 10. Mount Right Inspector (Run settings by default)
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

    // 11. Mount Bottom HUD Strip
    this.hudStrip = new SimHudStrip(layout.hudEl, layout.stagePopoversEl);

    // 11b. Mount Tweakpane ControlPanel (Phase 0–3 telemetry + Phase 6 Overlays)
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
          // Drag / added-mass / clamp edits re-derive the body's effective
          // inertia and damping without touching its solved state.
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

    console.log('[App] IBM Quantum-inspired instrument UI ready.');
    this.start();
  }

  private applyPreset(presetKey: string): void {
    const p = DEFAULT_PRESETS.find(x => x.key === presetKey);
    if (!p) return;

    this.activePresetKey = p.key;
    this.activeThrottle = p.throttle;
    this.activeRpm = p.rpm;
    this.metricsData.thrust_N = p.thrust_N;
    this.activeCurrent_A = p.current_A;

    this.metricsData.presetName = p.label.split(' ')[0];
    this.header.setPreset(p.key);
    this.inspector.thrusterThrottle = p.throttle;
    this.inspector.thrusterRpm = p.rpm;
    this.shaft.commandedRpm = p.rpm * this.activeThrottle;

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

  /**
   * Phase 6 variant diff: samples an open-water thrust curve (thrust vs
   * advance coefficient J) for a prop design over 8 J points via BEMT.
   */
  private computeThrustCurve(designId: string): ThrustCurvePoint[] {
    const design = getPropDesign(designId);
    const D = design.diameterMm * 1e-3;
    const curve: ThrustCurvePoint[] = [];
    const n = 8;
    const va = 0.5; // representative advance speed for the J sweep
    for (let i = 0; i < n; i++) {
      const J = (i / (n - 1)) * 1.4; // J = Va / (nD), sweep 0 → 1.4
      const rpm = (va * 60) / (J * D); // invert J for the sweep
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

    // 1. Advance Physics when RUNNING at Fixed 60 Hz Timestep
    this.physicsAdvancedDt = 0;
    if (this.runState === 'running') {
      this.clock.tick(currentTimeMs, (dt) => {
        this.runDurationSec += dt;
        this.physicsAdvancedDt += dt;

        // Synchronize shaft dynamic state
        this.shaft.commandedRpm = this.activeRpm * this.activeThrottle;
        this.shaft.update(dt);

        // 1. Fluid -> Propeller Coupling: sample local inflow with relaxation damping
        const advanceSpeed = this.coupler.sampleInflowVelocity(this.fluidSolver.grid);

        // 2. BEMT Hydrodynamic Solve
        const design = getPropDesign(this.activeDesignId);
        const bemt = solveBEMT(this.shaft.currentRpm, advanceSpeed, {
          design,
          material: this.activeMaterial,
          handedness: this.activeHandedness,
          pitchMm: Math.tan((this.shaft.currentPitchDeg * Math.PI) / 180.0) * (2.0 * Math.PI * 0.015) * 1e3
        });

        // 3. Electrical bus solver: coupled multi-motor network with tether drop & thermal
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

        // 4. Propeller -> Fluid Coupling: inject momentum & tip vortex body forces
        const couplingTelemetry = this.coupler.injectCouplingForces(this.fluidSolver.grid, bemt, dt);        // 5. Downstream Hull Obstacle Drag
        this.hull.applyDrag(this.fluidSolver.grid, dt);

        // 6. Vehicle → fluid coupling FIRST: sample the advance speed at every
        //    rotor disk and the ambient in-plane flow at the vehicle CoG, so the
        //    BEMT solve below sees the field the body is actually sitting in.
        const vehicleAdvances = this.vehicleCoupler.update(
          this.fluidSolver.grid,
          this.vehicle,
          this.propArray.thrusters,
          this.vehicleAmbientFlowWorld
        );

        // 7. Advance the vehicle rigid body (2× substep) against the pre-step field.
        // 8. Advance the fluid solver (1×) last, so the wake evolves after the
        //    body and thruster sources have been applied this substep.

        // 7. Evaluate Multi-Propeller Array & Torque Ledger (Phase 5b)
        if (this.propArray.thrusters.length > 0) {
          this.propArray.thrusters[0].throttle = this.activeThrottle;
          if (this.propArray.thrusters.length > 1) {
            this.propArray.thrusters[1].throttle = this.activeThrottle;
          }
        }
        // Directive 1: forward speed is EXPLICIT. The hydrodynamically live U
        // is the sampled inflow over the disc; when it is ~0 (bollard) the
        // ledger returns valid=false / NaN roll rates instead of pretending U=1.
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

        // 7. Vehicle rigid body: gravity, buoyancy, thrust, drag, tether.
        //    Substepped at vehicleSubstepDivider × the fluid rate (2×, i.e.
        //    1/120 s) with thrust held constant across substeps, which damps the
        //    fluid ↔ vehicle ↔ BEMT feedback loop (see integrator.ts header).
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
        // Tweakpane anchor is marine-ordered; the tether acts in the world frame.
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

        // 8. Re-inject the vehicle's thrust as a slipstream in the grid. This
        //    must run before the fluid step below, so the wake carries the
        //    impulse within the same physics substep.
        this.vehicleCoupler.injectSlipstream(this.fluidSolver.grid, this.vehicle, arraySummary, dt);

        // 7b. Advance the fluid solver (advection + pressure projection) LAST,
        //    completing the directive step order: sample → BEMT → apply →
        //    inject → vehicle 2× → fluid 1×.
        this.fluidSolver.step(dt);

        // Update Live Physical Metrics
        this.metricsData.thrust_N = arraySummary.totalForceN[0];
        this.metricsData.torque_Nm = Math.abs(arraySummary.totalMomentNm[0]);
        this.metricsData.netThrustVector_N = arraySummary.totalForceN;
        this.metricsData.netTorqueVector_Nm = arraySummary.totalMomentNm;
        this.metricsData.rollRatePrediction_deg_m = arraySummary.ledgerSummary.predictedRollRateDegPerM;
        this.metricsData.rpm = this.shaft.currentRpm;
        this.metricsData.bus_V = busTelemetry.terminalV;
        this.metricsData.current_A = busTelemetry.totalBusCurrentA;
        this.metricsData.temp_C = this.motorTemp_C;
        this.metricsData.dT_dr = bemt.elements.map(e => ({ rOverR: e.rOverR, dT: e.dT }));
        this.metricsData.perUnitTelemetry = arraySummary.thrusters.map(t => ({
          id: t.unit.id,
          thrust_N: t.netThrustN,
          torque_Nm: t.netTorqueNm,
          rpm: t.rpm,
          current_A: Math.abs(t.rpm) * 0.00034,
          temp_C: this.motorTemp_C
        }));

        // Update Inspector Thruster Display
        this.inspector.thrusterVterm = motor0.terminalVoltageV;
        this.inspector.thrusterCurrentA = motor0.currentA;
        this.inspector.thrusterTempC = motor0.windingTempC;
        this.inspector.thrusterThermalState = motor0.thermalState;

        // Update Stage Corner Coupling Badge
        this.stageOverlays.updateCouplingBadge(
          couplingTelemetry.thrustAgreementPct,
          couplingTelemetry.bemtThrustN,
          couplingTelemetry.gridMomentumThrustN
        );

        // Update 3D Stage Motor Emissive Temperature Glow
        if (this.renderer.prop3D) {
          // Directive 5: explicit index — no silent thruster-0 default.
          this.renderer.prop3D.setMotorTemperature(motor0.windingTempC, 0);
        }
      });
    }

    // 1b. Feed Phase 6 OverlaySystem (3D overlays + hover + variant diff)
    const grid = this.fluidSolver.grid;
    this.overlayCtx.grid = grid;
    this.overlayCtx.gridDxM = this.coupler.config.gridDxM;
    this.overlayCtx.gridCenter.set(0, 0, 0);
    this.overlayCtx.vehicle = this.vehicle;
    // Directive 1: overlays consume the LIVE forward speed; at rest (0) the
    // ledger returns valid=false with NaN roll rates, which the roll needle
    // treats as "no prediction" rather than a silently speed-anchored value.
    const atRest = this.runState !== 'running';
    const latestSummary = this.propArray.evaluate(
      undefined, undefined, undefined,
      atRest ? 0.0 : this.lastAdvanceSpeedMs
    );
    this.overlayCtx.summary = latestSummary;
    // Directive 5: fluid advection integrates against the FIXED physics dt
    // (0 when paused — the field itself is not advancing); ctx.dt is the
    // clamped render dt used only for animation (fade, pulse, roll needle).
    this.overlayCtx.physicsDt = atRest ? 0 : this.physicsAdvancedDt;
    this.overlayCtx.elapsed = currentTimeMs * 0.001;
    this.overlayCtx.motorTempsC.length = 0;
    this.overlayCtx.motorCurrentsA.length = 0;
    for (let m = 0; m < this.propArray.thrusters.length; m++) {
      this.overlayCtx.motorTempsC.push(this.bus.motors[m]?.windingTempC ?? 20.0);
      this.overlayCtx.motorCurrentsA.push(this.bus.lastTelemetry?.motors[m]?.currentA ?? 0);
    }
    // Render dt for animation-only overlays (Directive 5 split); assigned
    // before update() so the context is complete when the system consumes it.
    const renderDt = Math.min(0.05, Math.max(0.001, (currentTimeMs - this.lastRenderTime) * 0.001));
    this.lastRenderTime = currentTimeMs;
    this.overlayCtx.dt = renderDt;
    this.overlaySystem.update(renderDt, this.overlayCtx);

    // 2. Render 2D Eulerian Cutaway Canvas
    this.fluidRenderer.render(this.fluidSolver.grid);

    // 2b. Mirror the interpolated vehicle pose into the stage: alpha blends the
    //     previous and current physics states without mutating either (Directive
    //     3, State Interpolation). While paused the current pose is used verbatim
    //     so direct-manipulation handles keep tracking the body.
    const clockAlpha = this.runState === 'running' ? this.clock.getAlpha() : 0;
    this.vehicleInterpolatedPose = computeInterpolatedPose(
      this.vehiclePosePrevious,
      this.vehiclePoseCurrent,
      clockAlpha
    );
    this.vehicleRenderPose = this.vehicleInterpolatedPose;
    this.renderer.vehicle3D?.setInterpolatedPose(this.vehicleInterpolatedPose);

    // 3. Render 3D Water Surface & Propeller Scene
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

    // 4. Performance & Frame Timings
    const frameElapsed = performance.now() - frameStart;
    this.metricsData.frameMs = frameElapsed;
    // Directive 7: live overlay frame-budget metric for the HUD.
    this.metricsData.overlayMs = this.overlaySystem.overlayMs;

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdateTime >= 500) {
      this.metricsData.fps = (this.frameCount * 1000) / (now - this.lastFpsUpdateTime);
      this.frameCount = 0;
      this.lastFpsUpdateTime = now;
    }

    // 5. Update HUD Strip (including static evaluation at rest)
    if (this.runState !== 'running') {
      // At rest: explicit forward speed 0 → ledger summary is valid=false / NaN roll rate
      // (Directive 1: never silently anchor to 1 m/s). HUD shows "—" via NaN-guard.
      const staticSummary = this.propArray.evaluate(undefined, undefined, undefined, 0.0);
      this.metricsData.rollRatePrediction_deg_m = staticSummary.ledgerSummary.predictedRollRateDegPerM;
      this.metricsData.netThrustVector_N = staticSummary.totalForceN;
      this.metricsData.netTorqueVector_Nm = staticSummary.totalMomentNm;
    }
    this.hudStrip.update(this.metricsData, currentTimeMs);

    // 6. Context-sensitive inspector telemetry. Position/velocity live in the
    //    inspector, NOT the HUD strip (which already carries the at-a-glance
    //    numbers and is deliberately left unchanged by Phase 6b).
    this.inspector.setVehicleTelemetry(this.buildVehicleTelemetryView());
  }

  /** Marine (surge, sway, heave) → world (x = sway, y = heave, z = surge). */
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
