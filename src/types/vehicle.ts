export type PropellerMaterial = 'rigid10k' | 'pa12cf15' | 'petg';

export interface PropellerMass {
  rigid10k: number;
  pa12cf15: number;
  petg: number;
}

export interface VehicleMass {
  frame_g: number;
  hardware_g: number;
  motor_unit_g: number;
  motor_count: number;
  prop_g: PropellerMass;
}

export interface VehicleBuoyancy {
  displaced_cm3: number;
  rho_kg_m3: number;
  cob_above_cog_mm: number;
}

export interface MotorConfig {
  model: string;
  Ra_ohm: number;
  Io_A: number;
  kv_rpm_per_V: number;
  no_load_rpm_at_10v8: number;
  stall_torque_Nm: number;
  kt_Nm_per_A: number;
  ke_Vs_per_rad: number;
}

export interface TetherConfig {
  length_ft: number;
  awg: number;
  R_roundtrip_ohm: number;
  supply_V: number;
}

export type PropellerHandedness = 'CW' | 'CCW';

export interface PropellerConfig {
  D_mm: number;
  hub_od_mm: number;
  hub_len_mm: number;
  blades: number;
  KQ: number;
  blade_phase_offset_deg: number;
  handedness: PropellerHandedness[];
}

export interface RollReduction {
  none: number;
  solid: number;
  slotted: number;
}

export interface StatorConfig {
  vanes: number;
  profile: string;
  slot_chord_pct: number;
  incidence_deg: number;
  rake_deg: number;
  forward_thrust_gain_N: number;
  reverse_thrust_penalty_N: number;
  roll_reduction_deg_per_m: RollReduction;
}

export interface OperatingPoint {
  label: string;
  throttle: number;
  rpm: number;
  thrust_N: number;
  current_A: number;
  burst_s: number | null;
}

export interface VehicleConfig {
  id: string;
  name: string;
  mass: VehicleMass;
  buoyancy: VehicleBuoyancy;
  motor: MotorConfig;
  tether: TetherConfig;
  propeller: PropellerConfig;
  stator: StatorConfig;
  operating_points: OperatingPoint[];
}
