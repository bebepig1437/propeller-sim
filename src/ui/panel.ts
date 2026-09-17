import { Pane } from 'tweakpane';
import type { SimConfig } from '../core/config';

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

export interface PanelCallbacks {
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
}

export class ControlPanel {
  public pane: Pane;
  private metrics: TelemetryMetrics;

  constructor(config: SimConfig, metrics: TelemetryMetrics, callbacks?: PanelCallbacks) {
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
  }

  public update(): void {
    this.pane.refresh();
  }

  public dispose(): void {
    this.pane.dispose();
  }
}
