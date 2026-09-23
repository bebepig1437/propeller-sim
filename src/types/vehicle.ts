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

/** Frame truss lumped-mass distribution used for the inertia tensor. */
export interface FrameTrussConfig {
  /** Number of corner truss nodes (SeaPerch box frame: 8). */
  node_count: number;
  /** Fraction of frame mass in the corner nodes; remainder in the rails. */
  node_mass_fraction: number;
  /** Fraction of frame mass in the rails (node_fraction + rail_fraction = 1). */
  rail_mass_fraction: number;
  /** Half-diagonal distance (m) from CoG to each corner node. */
  corner_half_gap_m: number;
}

export type RotorSpinAxis = 'surge' | 'sway' | 'heave';

export interface RotorMountConfig {
  id: string;
  surge_m: number;
  sway_m: number;
  heave_m: number;
  spin_axis: RotorSpinAxis;
}

export interface VehicleGeometry {
  frame_length_m: number;
  frame_width_m: number;
  frame_height_m: number;
  frame_truss: FrameTrussConfig;
  prop_inertia_zz_kgm2: PropellerMass;
  rotor_mounts: RotorMountConfig[];
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
  geometry?: VehicleGeometry;
  motor: MotorConfig;
  tether: TetherConfig;
  propeller: PropellerConfig;
  stator: StatorConfig;
  operating_points: OperatingPoint[];
}
