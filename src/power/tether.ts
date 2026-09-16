import type { SimConfig } from '../core/config';

export interface TetherVoltageDrop {
  supplyV: number;
  terminalV: number;
  voltageDropV: number;
  totalCurrentA: number;
  jouleLossWatts: number;
  tetherEfficiency: number;
}

export interface TetherSpec {
  lengthFt: number;
  awg: number;
  resistanceOhm: number;
  supplyV: number;
}

/**
 * Standard copper wire resistance per foot (single conductor, 20C).
 */
export const AWG_RESISTANCE_OHM_PER_FT: Record<number, number> = {
  20: 0.01015,
  22: 0.01614,
  24: 0.02567, // 15ft round-trip = 30ft * 0.02567 ~ 0.770 - 0.782 Ohm
  26: 0.04081,
  28: 0.06490
};

/**
 * Calculates round-trip electrical resistance for 2-conductor copper tether.
 */
export function calculateTetherResistance(lengthFt = 15.0, awg = 24): number {
  const rPerFt = AWG_RESISTANCE_OHM_PER_FT[awg] ?? 0.02567;
  return 2.0 * lengthFt * rPerFt;
}

/**
 * Evaluates tether voltage drop, terminal voltage, and ohmic losses.
 */
export function calculateTetherVoltageDrop(
  totalCurrentA: number,
  config: SimConfig['electrical']
): TetherVoltageDrop {
  return calculateTetherState(totalCurrentA, config.supplyVoltage, config.tetherResistance);
}

/**
 * General tether state calculation with custom supply voltage and resistance.
 */
export function calculateTetherState(
  totalCurrentA: number,
  supplyV = 12.0,
  tetherResistance = 0.782
): TetherVoltageDrop {
  const i = Math.max(0, totalCurrentA);
  const voltageDropV = i * tetherResistance;
  const terminalV = Math.max(0, supplyV - voltageDropV);
  const jouleLossWatts = Math.pow(i, 2) * tetherResistance;
  const tetherEfficiency = supplyV > 0.01 ? terminalV / supplyV : 0;

  return {
    supplyV,
    terminalV,
    voltageDropV,
    totalCurrentA: i,
    jouleLossWatts,
    tetherEfficiency
  };
}
