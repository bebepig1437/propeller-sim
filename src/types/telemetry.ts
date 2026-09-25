import type { SimulationMedium } from '../core/config';

export interface HudMetricsData {
  thrustN: number;
  torqueNm: number;
  rpm: number;
  inflowSpeedMs: number;
  advanceRatioJ: number;
  efficiency: number | null;
  medium: SimulationMedium;
  timeScale: number;
  pShaftW?: number;
  pIdealW?: number;
}
