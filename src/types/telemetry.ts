export type PropellerMaterial = 'rigid10k' | 'pa12cf15' | 'petg';

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
