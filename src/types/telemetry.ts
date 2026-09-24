export interface HudMetricsData {
  thrust_N: number;
  torque_Nm: number;
  rpm: number;
  inflow_velocity_ms: number;
  advance_ratio_J: number;
  tip_mach: number;
  timeScale: number;
  fps: number;
  frameMs: number;
}
