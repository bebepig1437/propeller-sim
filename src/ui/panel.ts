

import { Pane } from 'tweakpane';
import { SimConfig } from '../core/config';
import { OverlayState, OverlayTunables, MAX_STREAMLINES, MAX_PARTICLES_TUNABLE } from '../render/overlays';
import { HandednessPreset } from '../prop/array';

export interface TelemetryMetrics {
  fps: number;
  frameMs: number;
  gpuMs: number;
  fluidMs?: number;
  substeps?: number;
  backend?: string;
  submitMs?: number;
  sourcesMs?: number;
  curlMs?: number;
  vorticityMs?: number;
  advectMs?: number;
  divergenceMs?: number;
  pressureMs?: number;
  projectMs?: number;
  totalFluidMs?: number;
}

export interface VehiclePanelState {
  surgeM: number;
  swayM: number;
  heaveM: number;
  yawDeg: number;
  tetherAnchorSurgeM: number;
  tetherAnchorSwayM: number;
  tetherAnchorHeaveM: number;
}

export interface PropellerPanelState {
  design: 'candidateA' | 'kaplan' | 'wageningen';
  material: 'rigid10k' | 'pa12cf15' | 'petg';
  rpm: number;
  pitchDeg: number;
  handedness: 'CW' | 'CCW';
}

export interface ElectricalPanelState {
  supplyV: number;
  tetherLengthFt: number;
  tetherAwg: number;
  tetherResistance: number;
  ambientTempC: number;
  thermalEnabled: boolean;
}

export interface ArrayPanelState {
  propulsorCount: number;
  handednessPreset: HandednessPreset;
  u0Throttle: number;
  u1Throttle: number;
  u2Throttle: number;
  statorAttached: boolean;
  statorSlotted: boolean;
  statorIncidenceDeg: number;
}

export interface PanelCallbacks {
  onBackendChange?: (backend: 'gpu' | 'cpu') => void;
  onResolutionChange?: (preset: '1024x512' | '512x256' | '256x128') => void;
  onPressureMethodChange?: (method: 'jacobi' | 'multigrid') => void;
  onInjectBurst?: () => void;
  onResetFluid?: () => void;
  onVehicleInitPoseChange?: () => void;
  onVehicleResetPose?: () => void;
  onVehicleTetherChange?: () => void;
  onVehicleTunablesChange?: () => void;
  onSetSideCutawayView?: () => void;
  onResetOrbitView?: () => void;
  onSunChange?: (elevation: number, azimuth: number) => void;
  onOverlayToggle?: (key: keyof OverlayState, active: boolean) => void;

  onPropDesignChange?: (design: 'candidateA' | 'kaplan' | 'wageningen') => void;
  onPropMaterialChange?: (material: 'rigid10k' | 'pa12cf15' | 'petg') => void;
  onPropRpmChange?: (rpm: number) => void;
  onPropPitchChange?: (pitchDeg: number) => void;
  onPropHandednessChange?: (h: 'CW' | 'CCW') => void;

  onElectricalChange?: () => void;
  onArrayChange?: () => void;
}

export class ControlPanel {
  public pane: Pane;
  private metrics: TelemetryMetrics;
  private overlayBindings: Map<keyof OverlayState, any> = new Map();
  private syncingOverlays = false;
  private vehicleFolder: ReturnType<Pane['addFolder']> | null = null;

  public propState: PropellerPanelState = {
    design: 'candidateA',
    material: 'rigid10k',
    rpm: 4140,
    pitchDeg: 18.0,
    handedness: 'CW'
  };

  public electricalState: ElectricalPanelState = {
    supplyV: 12.0,
    tetherLengthFt: 15.0,
    tetherAwg: 24,
    tetherResistance: 0.782,
    ambientTempC: 20.0,
    thermalEnabled: true
  };

  public arrayState: ArrayPanelState = {
    propulsorCount: 3,
    handednessPreset: 'all_cw',
    u0Throttle: 1.0,
    u1Throttle: 1.0,
    u2Throttle: 1.0,
    statorAttached: true,
    statorSlotted: true,
    statorIncidenceDeg: -5.2
  };

  constructor(
    config: SimConfig,
    metrics: TelemetryMetrics,
    callbacks?: PanelCallbacks,
    overlayState?: OverlayState,
    overlayTunables?: OverlayTunables,
    vehicleInit?: VehiclePanelState
  ) {
    this.metrics = Object.assign({ submitMs: 0, sourcesMs: 0, curlMs: 0, vorticityMs: 0, advectMs: 0, divergenceMs: 0, pressureMs: 0, projectMs: 0 }, metrics);

    this.pane = new Pane({
      title: 'Simulation Parameters & Telemetry',
      expanded: true
    });


    const fluidFolder = this.pane.addFolder({ title: 'Fluid', expanded: true });
    fluidFolder.addBinding(config.fluid, 'viscosity', { min: 0.0, max: 0.005, step: 0.0001, label: 'Viscosity' });
    fluidFolder.addBinding(config.fluid, 'vorticityStrength', { min: 0.0, max: 8.0, step: 0.2, label: 'Vorticity' });
    fluidFolder.addBinding(config.fluid, 'pressureIterations', { min: 5, max: 100, step: 1, label: 'Pressure Iters' });
    fluidFolder.addBinding(config.fluid, 'inflowVelocity', { min: 0.1, max: 6.0, step: 0.1, label: 'Inflow Velocity' });
    fluidFolder.addBinding(config.fluid, 'inflowActive', { label: 'Inflow Jet Active' });

    const injectBtn = fluidFolder.addButton({ title: 'Inject Plume Burst' });
    injectBtn.on('click', () => callbacks?.onInjectBurst?.());

    const resetBtn = fluidFolder.addButton({ title: 'Reset Fluid Grid' });
    resetBtn.on('click', () => callbacks?.onResetFluid?.());


    const propFolder = this.pane.addFolder({ title: 'Propeller', expanded: true });
    propFolder.addBinding(this.propState, 'design', {
      options: { 'Candidate A (BEMT)': 'candidateA', 'Kaplan (Ducted)': 'kaplan', 'Wageningen B-Series': 'wageningen' },
      label: 'Design'
    }).on('change', ev => callbacks?.onPropDesignChange?.(ev.value as any));

    propFolder.addBinding(this.propState, 'material', {
      options: { 'Rigid 10K (1.80g)': 'rigid10k', 'PA12-CF15 (1.25g)': 'pa12cf15', 'PETG (1.38g)': 'petg' },
      label: 'Material'
    }).on('change', ev => callbacks?.onPropMaterialChange?.(ev.value as any));

    propFolder.addBinding(this.propState, 'rpm', { min: 0, max: 6000, step: 20, label: 'RPM' })
      .on('change', ev => callbacks?.onPropRpmChange?.(ev.value));

    propFolder.addBinding(this.propState, 'pitchDeg', { min: -30, max: 30, step: 0.5, label: 'Pitch (°)' })
      .on('change', ev => callbacks?.onPropPitchChange?.(ev.value));

    propFolder.addBinding(this.propState, 'handedness', {
      options: { 'Right-Hand (CW)': 'CW', 'Left-Hand (CCW)': 'CCW' },
      label: 'Handedness'
    }).on('change', ev => callbacks?.onPropHandednessChange?.(ev.value as any));


    const elecFolder = this.pane.addFolder({ title: 'Electrical', expanded: false });
    elecFolder.addBinding(this.electricalState, 'supplyV', { min: 9.0, max: 18.0, step: 0.1, label: 'Supply V' })
      .on('change', () => callbacks?.onElectricalChange?.());

    elecFolder.addBinding(this.electricalState, 'tetherLengthFt', { min: 0, max: 100, step: 1, label: 'Tether Length (ft)' })
      .on('change', () => callbacks?.onElectricalChange?.());

    elecFolder.addBinding(this.electricalState, 'tetherAwg', {
      options: { '18 AWG (thick)': 18, '20 AWG': 20, '22 AWG': 22, '24 AWG (spec)': 24, '26 AWG (thin)': 26 },
      label: 'AWG'
    }).on('change', () => callbacks?.onElectricalChange?.());

    elecFolder.addBinding(this.electricalState, 'ambientTempC', { min: 0, max: 45, step: 0.5, label: 'Ambient Temp (°C)' })
      .on('change', () => callbacks?.onElectricalChange?.());

    elecFolder.addBinding(this.electricalState, 'thermalEnabled', { label: 'Thermal On/Off' })
      .on('change', () => callbacks?.onElectricalChange?.());


    const arrayFolder = this.pane.addFolder({ title: 'Array', expanded: false });
    arrayFolder.addBinding(this.arrayState, 'propulsorCount', { min: 1, max: 6, step: 1, label: 'Propulsor Count' })
      .on('change', () => callbacks?.onArrayChange?.());

    arrayFolder.addBinding(this.arrayState, 'handednessPreset', {
      options: {
        'All CW': 'all_cw',
        'All CCW': 'all_ccw',
        'Tandem (2x)': 'tandem',
        'Contra-Rotating Coaxial': 'contra_rotating_coaxial',
        'Symmetric Counter-Rotating': 'symmetric_counter_rotating'
      },
      label: 'Handedness Preset'
    }).on('change', () => callbacks?.onArrayChange?.());

    const perUnitFolder = arrayFolder.addFolder({ title: 'Per-Unit Overrides', expanded: false });
    perUnitFolder.addBinding(this.arrayState, 'u0Throttle', { min: -1.0, max: 1.0, step: 0.05, label: 'Unit 0 Throttle' })
      .on('change', () => callbacks?.onArrayChange?.());
    perUnitFolder.addBinding(this.arrayState, 'u1Throttle', { min: -1.0, max: 1.0, step: 0.05, label: 'Unit 1 Throttle' })
      .on('change', () => callbacks?.onArrayChange?.());
    perUnitFolder.addBinding(this.arrayState, 'u2Throttle', { min: -1.0, max: 1.0, step: 0.05, label: 'Unit 2 Throttle' })
      .on('change', () => callbacks?.onArrayChange?.());

    const statorFolder = arrayFolder.addFolder({ title: 'Stator', expanded: true });
    statorFolder.addBinding(this.arrayState, 'statorAttached', { label: 'Stator Attached' })
      .on('change', () => callbacks?.onArrayChange?.());
    statorFolder.addBinding(this.arrayState, 'statorSlotted', { label: 'Slotted Vane' })
      .on('change', () => callbacks?.onArrayChange?.());
    statorFolder.addBinding(this.arrayState, 'statorIncidenceDeg', { min: -15.0, max: 15.0, step: 0.2, label: 'Incidence (°)' })
      .on('change', () => callbacks?.onArrayChange?.());


    if (vehicleInit) {
      this.buildVehicleGroup(config, vehicleInit, callbacks);
    }


    if (overlayState && overlayTunables) {
      const overlayFolder = this.pane.addFolder({ title: 'Overlays', expanded: false });

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
          if (this.syncingOverlays) return;
          callbacks?.onOverlayToggle?.(key, ev.value as boolean);
        });
        this.overlayBindings.set(key, binding);
      }

      overlayFolder.addBinding(overlayTunables, 'vectorStride', { min: 8, max: 96, step: 4, label: 'Vector Stride' });
      overlayFolder.addBinding(overlayTunables, 'vectorScale', { min: 0.01, max: 0.12, step: 0.005, label: 'Vector Scale' });
      overlayFolder.addBinding(overlayTunables, 'streamlineCount', { min: 10, max: MAX_STREAMLINES, step: 5, label: 'Streamlines' });
      overlayFolder.addBinding(overlayTunables, 'particleCount', { min: 200, max: MAX_PARTICLES_TUNABLE, step: 200, label: 'Particles' });
      overlayFolder.addBinding(overlayTunables, 'rollIndicatorGain', { min: 0.2, max: 4.0, step: 0.1, label: 'Roll Gain' });
    }


    const renderFolder = this.pane.addFolder({ title: 'Rendering', expanded: false });
    const resBinding = renderFolder.addBinding(config.fluid, 'resolutionPreset', {
      options: { '1024x512 (Ultra)': '1024x512', '512x256 (High)': '512x256', '256x128 (Standard)': '256x128' },
      label: 'Resolution Scale'
    });
    resBinding.on('change', (ev) => callbacks?.onResolutionChange?.(ev.value as any));

    renderFolder.addBinding(config.water, 'surfaceVisible', { label: 'Surface Visible' });
    renderFolder.addBinding(config.water, 'waveAmplitude', { min: 0.0, max: 0.02, step: 0.001, label: 'Wave Amplitude' });
    renderFolder.addBinding(config.water, 'causticIntensity', { min: 0.0, max: 3.0, step: 0.1, label: 'Caustics' });
    renderFolder.addBinding(config.water, 'transmission', { min: 0.1, max: 1.0, step: 0.02, label: 'Transmission' });

    const cutawayBtn = renderFolder.addButton({ title: 'Preset: Side Cutaway View' });
    cutawayBtn.on('click', () => callbacks?.onSetSideCutawayView?.());

    const orbitBtn = renderFolder.addButton({ title: 'Preset: Orbit View' });
    orbitBtn.on('click', () => callbacks?.onResetOrbitView?.());


    const diagFolder = this.pane.addFolder({ title: 'Diagnostics', expanded: false });
    diagFolder.addBinding(this.metrics, 'fps', { readonly: true, label: 'FPS', format: (v: number) => v.toFixed(1) });
    diagFolder.addBinding(this.metrics, 'frameMs', { readonly: true, label: 'Frame ms', format: (v: number) => v.toFixed(2) });
    diagFolder.addBinding(this.metrics, 'gpuMs', { readonly: true, label: 'Total GPU ms', format: (v: number) => v.toFixed(2) });
    diagFolder.addBinding(this.metrics, 'submitMs', { readonly: true, label: 'CPU Submit ms', format: (v: number) => (v ?? 0).toFixed(3) });
    diagFolder.addBinding(this.metrics, 'sourcesMs', { readonly: true, label: 'Sources ms', format: (v: number) => (v ?? 0).toFixed(3) });
    diagFolder.addBinding(this.metrics, 'curlMs', { readonly: true, label: 'Curl ms', format: (v: number) => (v ?? 0).toFixed(3) });
    diagFolder.addBinding(this.metrics, 'vorticityMs', { readonly: true, label: 'Vorticity ms', format: (v: number) => (v ?? 0).toFixed(3) });
    diagFolder.addBinding(this.metrics, 'advectMs', { readonly: true, label: 'Advection ms', format: (v: number) => (v ?? 0).toFixed(3) });
    diagFolder.addBinding(this.metrics, 'divergenceMs', { readonly: true, label: 'Divergence ms', format: (v: number) => (v ?? 0).toFixed(3) });
    diagFolder.addBinding(this.metrics, 'pressureMs', { readonly: true, label: 'Pressure ms', format: (v: number) => (v ?? 0).toFixed(3) });
    diagFolder.addBinding(this.metrics, 'projectMs', { readonly: true, label: 'Project ms', format: (v: number) => (v ?? 0).toFixed(3) });
  }

  private buildVehicleGroup(
    config: SimConfig,
    vehicleInit: VehiclePanelState,
    callbacks?: PanelCallbacks
  ): void {
    const folder = this.pane.addFolder({ title: 'Vehicle', expanded: false });
    this.vehicleFolder = folder;

    const pose = folder.addFolder({ title: 'Initial Pose', expanded: true });
    const poseFields: [keyof VehiclePanelState, string, number, number, number][] = [
      ['surgeM', 'Surge X_b (m)', -0.4, 0.4, 0.005],
      ['swayM', 'Sway Y_b (m)', -0.4, 0.4, 0.005],
      ['heaveM', 'Heave Z_b (m, up)', -0.25, 0.22, 0.005],
      ['yawDeg', 'Yaw Z (°)', -180, 180, 1]
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
    tether.addBinding(config.vehicle, 'tetherDamping', { min: 0, max: 4, step: 0.05, label: 'Damping c (N·s/m)' }).on('change', () => {
      callbacks?.onVehicleTetherChange?.();
    });

    const drag = folder.addFolder({ title: 'Drag', expanded: false });
    const dragFields: [keyof SimConfig['vehicle'], string, number, number, number][] = [
      ['dragCdASurge', 'CdA Surge (m²)', 0.001, 0.05, 0.0005],
      ['dragCdASway', 'CdA Sway (m²)', 0.001, 0.05, 0.0005],
      ['dragCdAHeave', 'CdA Heave (m²)', 0.001, 0.08, 0.0005],
      ['dragLinSurge', 'Linear Surge (N·s/m)', 0, 2, 0.01],
      ['dragLinSway', 'Linear Sway (N·s/m)', 0, 2, 0.01],
      ['dragLinHeave', 'Linear Heave (N·s/m)', 0, 2, 0.01],
      ['rotDragLinRoll', 'Rot Linear Roll (N·m·s/rad)', 0.0005, 0.05, 0.0005],
      ['rotDragLinPitch', 'Rot Linear Pitch', 0.0005, 0.05, 0.0005],
      ['rotDragLinYaw', 'Rot Linear Yaw', 0.0005, 0.05, 0.0005]
    ];
    for (const [key, label, min, max, step] of dragFields) {
      drag.addBinding(config.vehicle, key, { min, max, step, label }).on('change', () => {
        callbacks?.onVehicleTunablesChange?.();
      });
    }

    const addedMass = folder.addFolder({ title: 'Added-Mass', expanded: false });
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
  }

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
