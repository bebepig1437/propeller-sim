import { Pane } from 'tweakpane';
import type { SimConfig } from '../core/config';
import type { OverlayState, OverlayTunables } from '../render/overlays';
import { MAX_STREAMLINES, MAX_PARTICLES_TUNABLE } from '../render/overlays';

export interface TelemetryMetrics {
  fps: number;
  frameMs: number;
  gpuMs: number;
  fluidMs: number;
  substeps: number;
  backend: string;

  // GPU Fluid Per-Pass Timings (Phase 2)
  submitMs: number;
  sourcesMs: number;
  curlMs: number;
  vorticityMs: number;
  advectMs: number;
  divergenceMs: number;
  pressureMs: number;
  projectMs: number;
  totalFluidMs: number;

  // Compare Mode (CPU vs GPU diff)
  compareMaxDiffU: number;
  compareMaxDiffV: number;
  compareMaxDiffDye: number;
  compareRmsDiff: number;
}

/**
 * Phase 6b editable vehicle state shown in the "Vehicle" group. The pose/anchor
 * fields are MARINE-ordered (surge, sway, heave) and mapped to the world frame
 * by the app using the upright remap in src/render/frameMap.ts.
 */
export interface VehiclePanelState {
  surgeM: number;
  swayM: number;
  heaveM: number;
  yawDeg: number;
  tetherAnchorSurgeM: number;
  tetherAnchorSwayM: number;
  tetherAnchorHeaveM: number;
}

export interface PanelCallbacks {
  /** Re-poses the vehicle to the edited initial pose. */
  onVehicleInitPoseChange?: () => void;
  onVehicleResetPose?: () => void;
  /** Tether on/off, anchor or spring constants changed. */
  onVehicleTetherChange?: () => void;
  /** Drag or added-mass coefficient changed (re-derives the body properties). */
  onVehicleTunablesChange?: () => void;
  onInjectBurst: () => void;
  onResetFluid: () => void;
  onRenderModeChange?: (mode: string) => void;
  onResolutionChange?: (preset: '1024x512' | '512x256' | '256x128') => void;
  onBackendChange?: (backend: 'gpu' | 'cpu') => void;
  onPressureMethodChange?: (method: 'jacobi' | 'multigrid') => void;
  onCompareToggle?: (active: boolean) => void;
  onSetSideCutawayView?: () => void;
  onResetOrbitView?: () => void;
  onSunChange?: (elevation: number, azimuth: number) => void;
  onOverlayToggle?: (key: keyof OverlayState, active: boolean) => void;
}

export class ControlPanel {
  public pane: Pane;
  private metrics: TelemetryMetrics;
  private overlayBindings: Map<keyof OverlayState, any> = new Map();
  private syncingOverlays = false;
  private vehicleFolder: ReturnType<Pane['addFolder']> | null = null;

  constructor(
    config: SimConfig,
    metrics: TelemetryMetrics,
    callbacks?: PanelCallbacks,
    overlayState?: OverlayState,
    overlayTunables?: OverlayTunables,
    vehicleInit?: VehiclePanelState
  ) {
    this.metrics = metrics;

    this.pane = new Pane({
      title: 'Simulation Telemetry & Controls',
      expanded: true
    });

    // Performance Folder (Phase 0)
    const perfFolder = this.pane.addFolder({ title: 'Engine Telemetry (Phase 0)', expanded: true });
    perfFolder.addBinding(this.metrics, 'fps', { readonly: true, label: 'FPS', format: (v: number) => v.toFixed(1) });
    perfFolder.addBinding(this.metrics, 'frameMs', { readonly: true, label: 'Render ms', format: (v: number) => v.toFixed(2) });
    perfFolder.addBinding(this.metrics, 'fluidMs', { readonly: true, label: 'Fluid ms', format: (v: number) => v.toFixed(2) });
    perfFolder.addBinding(this.metrics, 'substeps', { readonly: true, label: 'Substeps' });
    perfFolder.addBinding(this.metrics, 'backend', { readonly: true, label: 'Backend' });

    // Fluid Core Controls (Phase 1 & Phase 2)
    const fluidFolder = this.pane.addFolder({ title: 'Fluid Solver (Phases 1 & 2)', expanded: true });
    
    // Backend Switcher (GPU TSL vs CPU Reference)
    const backendBinding = fluidFolder.addBinding(config.fluid, 'backend', {
      options: { 'GPU (TSL Compute)': 'gpu', 'CPU (Reference)': 'cpu' },
      label: 'Backend'
    });
    backendBinding.on('change', (ev) => {
      callbacks?.onBackendChange?.(ev.value as 'gpu' | 'cpu');
    });

    // Resolution Scaler (1024x512, 512x256, 256x128)
    const resBinding = fluidFolder.addBinding(config.fluid, 'resolutionPreset', {
      options: { '1024x512 (Ultra)': '1024x512', '512x256 (High)': '512x256', '256x128 (Standard)': '256x128' },
      label: 'Resolution'
    });
    resBinding.on('change', (ev) => {
      callbacks?.onResolutionChange?.(ev.value as '1024x512' | '512x256' | '256x128');
    });

    // Multigrid vs Jacobi Solver
    const solverBinding = fluidFolder.addBinding(config.fluid, 'pressureMethod', {
      options: { 'Multigrid (V-Cycle)': 'multigrid', 'Jacobi Poisson': 'jacobi' },
      label: 'Poisson Solver'
    });
    solverBinding.on('change', (ev) => {
      callbacks?.onPressureMethodChange?.(ev.value as 'jacobi' | 'multigrid');
    });

    // Side-by-side CPU vs GPU Compare Mode
    const compareBinding = fluidFolder.addBinding(config.fluid, 'compareMode', {
      label: 'Compare CPU/GPU'
    });
    compareBinding.on('change', (ev) => {
      callbacks?.onCompareToggle?.(ev.value);
    });

    fluidFolder.addBinding(config.fluid, 'inflowActive', { label: 'Inflow Jet' });
    fluidFolder.addBinding(config.fluid, 'inflowVelocity', { min: 0.1, max: 6.0, step: 0.1, label: 'Jet Velocity' });
    fluidFolder.addBinding(config.fluid, 'viscosity', { min: 0.0, max: 0.005, step: 0.0001, label: 'Viscosity' });
    fluidFolder.addBinding(config.fluid, 'vorticityStrength', { min: 0.0, max: 8.0, step: 0.2, label: 'Vorticity' });
    fluidFolder.addBinding(config.fluid, 'pressureIterations', { min: 5, max: 100, step: 1, label: 'Pressure Iters' });
    fluidFolder.addBinding(config.fluid, 'advectionScheme', {
      options: { 'MacCormack (2nd order)': 'maccormack', 'Semi-Lagrangian': 'semi-lagrangian' },
      label: 'Advection'
    });

    // Inflow action buttons
    const injectBtn = fluidFolder.addButton({ title: 'Inject Plume Burst' });
    injectBtn.on('click', () => {
      callbacks?.onInjectBurst();
    });

    const resetBtn = fluidFolder.addButton({ title: 'Reset Fluid Grid' });
    resetBtn.on('click', () => {
      callbacks?.onResetFluid();
    });

    // Per-Pass Timings Folder (gpuTimer results & submit time)
    const gpuTimingFolder = this.pane.addFolder({ title: 'GPU Fluid Pass Timings (Phase 2)', expanded: false });
    gpuTimingFolder.addBinding(this.metrics, 'submitMs', { readonly: true, label: 'CPU Submit ms', format: (v: number) => v.toFixed(3) });
    gpuTimingFolder.addBinding(this.metrics, 'sourcesMs', { readonly: true, label: 'Sources ms', format: (v: number) => v.toFixed(3) });
    gpuTimingFolder.addBinding(this.metrics, 'curlMs', { readonly: true, label: 'Curl ms', format: (v: number) => v.toFixed(3) });
    gpuTimingFolder.addBinding(this.metrics, 'vorticityMs', { readonly: true, label: 'Vorticity ms', format: (v: number) => v.toFixed(3) });
    gpuTimingFolder.addBinding(this.metrics, 'advectMs', { readonly: true, label: 'Advection ms', format: (v: number) => v.toFixed(3) });
    gpuTimingFolder.addBinding(this.metrics, 'divergenceMs', { readonly: true, label: 'Divergence ms', format: (v: number) => v.toFixed(3) });
    gpuTimingFolder.addBinding(this.metrics, 'pressureMs', { readonly: true, label: 'Pressure ms', format: (v: number) => v.toFixed(3) });
    gpuTimingFolder.addBinding(this.metrics, 'projectMs', { readonly: true, label: 'Project ms', format: (v: number) => v.toFixed(3) });
    gpuTimingFolder.addBinding(this.metrics, 'totalFluidMs', { readonly: true, label: 'Total Step ms', format: (v: number) => v.toFixed(3) });

    // Compare Error Metrics
    const compareFolder = this.pane.addFolder({ title: 'CPU vs GPU Difference (256×128)', expanded: false });
    compareFolder.addBinding(this.metrics, 'compareMaxDiffU', { readonly: true, label: 'Max |Δu|', format: (v: number) => v.toFixed(6) });
    compareFolder.addBinding(this.metrics, 'compareMaxDiffV', { readonly: true, label: 'Max |Δv|', format: (v: number) => v.toFixed(6) });
    compareFolder.addBinding(this.metrics, 'compareMaxDiffDye', { readonly: true, label: 'Max |Δdye|', format: (v: number) => v.toFixed(6) });
    compareFolder.addBinding(this.metrics, 'compareRmsDiff', { readonly: true, label: 'RMS Diff', format: (v: number) => v.toFixed(6) });

    // Water & Environment (Phase 3)
    const waterFolder = this.pane.addFolder({ title: 'Water & Environment (Phase 3)', expanded: true });
    waterFolder.addBinding(config.water, 'surfaceVisible', { label: 'Surface Visible' });
    waterFolder.addBinding(config.water, 'waveAmplitude', { min: 0.0, max: 0.02, step: 0.001, label: 'Gerstner Amp (m)' });
    waterFolder.addBinding(config.water, 'waveFrequency', { min: 0.5, max: 8.0, step: 0.1, label: 'Gerstner Freq' });
    waterFolder.addBinding(config.water, 'waveSpeed', { min: 0.1, max: 3.0, step: 0.1, label: 'Wave Speed' });
    waterFolder.addBinding(config.water, 'foamThreshold', { min: 0.5, max: 5.0, step: 0.1, label: 'Foam Threshold' });
    waterFolder.addBinding(config.water, 'causticIntensity', { min: 0.0, max: 3.0, step: 0.1, label: 'Caustics' });
    waterFolder.addBinding(config.water, 'transmission', { min: 0.1, max: 1.0, step: 0.02, label: 'Transmission' });
    waterFolder.addBinding(config.water, 'roughness', { min: 0.01, max: 0.3, step: 0.01, label: 'Roughness' });

    const sunElBinding = waterFolder.addBinding(config.water, 'sunElevation', { min: 5, max: 85, step: 1, label: 'Sun Elevation (°)' });
    const sunAzBinding = waterFolder.addBinding(config.water, 'sunAzimuth', { min: 0, max: 360, step: 5, label: 'Sun Azimuth (°)' });
    const updateSun = () => {
      callbacks?.onSunChange?.(config.water.sunElevation, config.water.sunAzimuth);
    };
    sunElBinding.on('change', updateSun);
    sunAzBinding.on('change', updateSun);

    const cutawayBtn = waterFolder.addButton({ title: 'Preset: Side Cutaway View' });
    cutawayBtn.on('click', () => {
      callbacks?.onSetSideCutawayView?.();
    });

    const orbitBtn = waterFolder.addButton({ title: 'Preset: Orbit View' });
    orbitBtn.on('click', () => {
      callbacks?.onResetOrbitView?.();
    });

    // Overlays (Phase 6): shared-state toggles + tuning knobs
    if (overlayState && overlayTunables) {
      const overlayFolder = this.pane.addFolder({ title: 'Overlays (Phase 6)', expanded: false });

      const overlayKeys: (keyof OverlayState)[] = [
        'velocityVectors',
        'streamlines',
        'pressureHeatmap',
        'vorticity',
        'particles',
        'thrustArrows',
        'torqueArrows',
        'thermal',
        'currentFlow'
      ];
      for (const key of overlayKeys) {
        const binding = overlayFolder.addBinding(overlayState, key, { label: ControlPanel.OVERLAY_LABELS[key] });
        binding.on('change', (ev) => {
          if (this.syncingOverlays) return; // external sync, no echo
          callbacks?.onOverlayToggle?.(key, ev.value as boolean);
        });
        this.overlayBindings.set(key, binding);
      }

      // Directive 7: tunables are hard-capped at the panel to match the
      // runtime caps (MAX_STREAMLINES / MAX_PARTICLES_TUNABLE) — no path can
      // dial CPU integration past the frame budget.
      overlayFolder.addBinding(overlayTunables, 'vectorStride', { min: 8, max: 96, step: 4, label: 'Vector Stride' });
      overlayFolder.addBinding(overlayTunables, 'vectorScale', { min: 0.01, max: 0.12, step: 0.005, label: 'Vector Scale' });
      overlayFolder.addBinding(overlayTunables, 'streamlineCount', { min: 10, max: MAX_STREAMLINES, step: 5, label: 'Streamlines' });
      overlayFolder.addBinding(overlayTunables, 'particleCount', { min: 200, max: MAX_PARTICLES_TUNABLE, step: 200, label: 'Particles' });
      overlayFolder.addBinding(overlayTunables, 'rollIndicatorGain', { min: 0.2, max: 4.0, step: 0.1, label: 'Roll Gain' });
    }

    // Vehicle rigid body (Phase 6b)
    if (vehicleInit) {
      this.buildVehicleGroup(config, vehicleInit, callbacks);
    }
  }

  /**
   * Phase 6b — "Vehicle" group: initial pose, tether, drag coefficients and
   * added-mass coefficients (the last two behind "advanced" folds).
   */
  private buildVehicleGroup(
    config: SimConfig,
    vehicleInit: VehiclePanelState,
    callbacks?: PanelCallbacks
  ): void {
    const folder = this.pane.addFolder({ title: 'Vehicle (Phase 6b)', expanded: false });
    this.vehicleFolder = folder;

    const pose = folder.addFolder({ title: 'Initial Pose', expanded: true });
    const poseFields: [keyof VehiclePanelState, string, number, number, number][] = [
      ['surgeM', 'Surge X_b (m)', -0.4, 0.4, 0.005],
      ['swayM', 'Sway Y_b (m)', -0.4, 0.4, 0.005],
      ['heaveM', 'Heave Z_b (m, up)', -0.25, 0.22, 0.005],
      ['yawDeg', 'Yaw Z (\u00B0)', -180, 180, 1]
    ];
    for (const [key, label, min, max, step] of poseFields) {
      pose.addBinding(vehicleInit, key, { min, max, step, label }).on('change', () => {
        callbacks?.onVehicleInitPoseChange?.();
      });
    }
    pose.addButton({ title: 'Reset Pose' }).on('click', () => {
      callbacks?.onVehicleResetPose?.();
    });

    const tether = folder.addFolder({ title: 'Tether', expanded: false });
    tether.addBinding(config.vehicle, 'tetherAttached', { label: 'Attached' }).on('change', () => {
      callbacks?.onVehicleTetherChange?.();
    });
    const anchorFields: [keyof VehiclePanelState, string][] = [
      ['tetherAnchorSurgeM', 'Anchor Surge X (m)'],
      ['tetherAnchorSwayM', 'Anchor Sway Y (m)'],
      ['tetherAnchorHeaveM', 'Anchor Heave Z (m)']
    ];
    for (const [key, label] of anchorFields) {
      tether.addBinding(vehicleInit, key, { min: -1.2, max: 1.2, step: 0.01, label }).on('change', () => {
        callbacks?.onVehicleTetherChange?.();
      });
    }
    tether.addBinding(config.vehicle, 'tetherStiffnessNm', { min: 0.1, max: 10, step: 0.1, label: 'Stiffness k (N/m)' }).on('change', () => {
      callbacks?.onVehicleTetherChange?.();
    });
    tether.addBinding(config.vehicle, 'tetherDamping', { min: 0, max: 4, step: 0.05, label: 'Damping c (N\u00B7s/m)' }).on('change', () => {
      callbacks?.onVehicleTetherChange?.();
    });

    const drag = folder.addFolder({ title: 'Drag Coefficients (advanced)', expanded: false });
    const dragFields: [keyof SimConfig['vehicle'], string, number, number, number][] = [
      ['dragCdASurge', 'CdA Surge (m\u00B2)', 0.001, 0.05, 0.0005],
      ['dragCdASway', 'CdA Sway (m\u00B2)', 0.001, 0.05, 0.0005],
      ['dragCdAHeave', 'CdA Heave (m\u00B2)', 0.001, 0.08, 0.0005],
      ['dragLinSurge', 'Linear Surge (N\u00B7s/m)', 0, 2, 0.01],
      ['dragLinSway', 'Linear Sway (N\u00B7s/m)', 0, 2, 0.01],
      ['dragLinHeave', 'Linear Heave (N\u00B7s/m)', 0, 2, 0.01],
      ['rotDragLinRoll', 'Rot Linear Roll (N\u00B7m\u00B7s/rad)', 0.0005, 0.05, 0.0005],
      ['rotDragLinPitch', 'Rot Linear Pitch', 0.0005, 0.05, 0.0005],
      ['rotDragLinYaw', 'Rot Linear Yaw', 0.0005, 0.05, 0.0005]
    ];
    for (const [key, label, min, max, step] of dragFields) {
      drag.addBinding(config.vehicle, key, { min, max, step, label }).on('change', () => {
        callbacks?.onVehicleTunablesChange?.();
      });
    }

    const addedMass = folder.addFolder({ title: 'Added Mass (advanced)', expanded: false });
    const amFactors: [keyof SimConfig['vehicle'], string, number, number, number][] = [
      ['addedMassSurgeFactor', 'Surge factor', 0, 3, 0.05],
      ['addedMassSwayFactor', 'Sway factor', 0, 3, 0.05],
      ['addedMassHeaveFactor', 'Heave factor', 0, 3, 0.05]
    ];
    for (const [key, label, min, max, step] of amFactors) {
      addedMass.addBinding(config.vehicle, key, { min, max, step, label }).on('change', () => {
        callbacks?.onVehicleTunablesChange?.();
      });
    }
    const amRotational: [keyof SimConfig['vehicle'], string][] = [
      ['addedMassRollFactor', 'Rot Roll (kg\u00B7m\u00B2)'],
      ['addedMassPitchFactor', 'Rot Pitch (kg\u00B7m\u00B2)'],
      ['addedMassYawFactor', 'Rot Yaw (kg\u00B7m\u00B2)']
    ];
    for (const [key, label] of amRotational) {
      addedMass.addBinding(config.vehicle, key, { min: 0, max: 0.01, step: 0.0001, label }).on('change', () => {
        callbacks?.onVehicleTunablesChange?.();
      });
    }

    folder.addBinding(config.vehicle, 'vehicleSubstepDivider', { min: 1, max: 4, step: 1, label: 'Substep \u00D7 fluid' }).on('change', () => {
      callbacks?.onVehicleTunablesChange?.();
    });
    folder.addBinding(config.vehicle, 'angularRateClampRadS', { min: 2, max: 40, step: 1, label: 'Rate Clamp (rad/s)' }).on('change', () => {
      callbacks?.onVehicleTunablesChange?.();
    });
  }

  /** Re-reads the vehicle bindings after an external pose change. */
  public refreshVehicleGroup(): void {
    this.vehicleFolder?.refresh();
  }

  private static OVERLAY_LABELS: Record<keyof OverlayState, string> = {
    velocityVectors: 'Velocity Vectors',
    streamlines: 'Streamlines',
    pressureHeatmap: 'Pressure Heatmap',
    vorticity: 'Vorticity',
    particles: 'Particles',
    thrustArrows: 'Thrust Arrows',
    torqueArrows: 'Torque Arrows',
    thermal: 'Thermal',
    currentFlow: 'Current Flow'
  };

  public update(): void {
    this.pane.refresh();
  }

  /**
   * Syncs the Tweakpane overlay bindings from an external state change
   * (e.g. icon-strip click) without re-firing change callbacks.
   */
  public syncOverlayState(state: OverlayState): void {
    this.syncingOverlays = true;
    for (const [key, binding] of this.overlayBindings) {
      if (binding && key in state) {
        (binding as any).value = state[key];
      }
    }
    this.syncingOverlays = false;
  }

  public dispose(): void {
    this.pane.dispose();
  }
}
