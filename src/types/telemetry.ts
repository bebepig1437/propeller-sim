export type PropellerMaterial = 'rigid10k' | 'pa12cf15' | 'petg';

export type SpecStatus = 'within_spec' | 'thermal_warn' | 'thermal_cutout' | 'limit_exceeded';

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
