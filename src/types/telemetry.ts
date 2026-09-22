export type PropellerMaterial = 'rigid10k' | 'pa12cf15' | 'petg';

export type SpecStatus = 'within_spec' | 'thermal_warn' | 'thermal_cutout' | 'limit_exceeded';

export interface TelemetryState {
  timestamp: number;
  throttle: number;
  voltage_supply: number;
  voltage_terminal: number;
  current_A: number;
  rpm: number;
  thrust_N: number;
  torque_reaction_Nm: number;
  roll_torque_Nm: number;
  thermal_burst_remaining_s: number | null;
  selected_preset: string;
  active_material: PropellerMaterial;
  net_buoyancy_g: number;
}

export interface HudMetricsData {
  thrust_N: number;
  torque_Nm: number;
  power_W: number;
  efficiency_pct: number;
  advance_ratio_J: number;
  rpm: number;
  pitch_deg: number;
  inflow_velocity_ms: number;
  max_velocity_domain_ms: number;

  bus_V: number;
  current_A: number;
  temp_C: number;

  rollRatePrediction_deg_m?: number;
  netThrustVector_N?: [number, number, number];
  netTorqueVector_Nm?: [number, number, number];

  perUnitTelemetry?: {
    id: string;
    thrust_N: number;
    torque_Nm: number;
    rpm: number;
    current_A: number;
    temp_C: number;
  }[];
  dT_dr?: { rOverR: number; dT: number }[];

  fps: number;
  frameMs: number;
  gpuMs: number;
  overlayMs?: number;
  resolutionScale?: number;
  readbackLatencyMs?: number;
  
  renderTier?: 'WebGPU' | 'WebGL2' | 'CPU';
  presetName: string;


  thermalBurstRemainingS: number | null;
  specStatus: SpecStatus;
  specStatusLabel: string;
}
