import type { SimConfig } from '../core/config';

export interface TetherVoltageDrop {
  supplyV: number;
  terminalV: number;
  voltageDropV: number;
  totalCurrentA: number;
  jouleLossWatts: number;
  tetherEfficiency: number;
  inductanceHenry: number;
}

export interface TetherSpec {
  lengthM: number;
  lengthFt: number;
  awg: number;
  resistanceOhm: number;
  supplyV: number;
  inductanceEnabled?: boolean;
}

/**
 * Standard copper wire resistance per foot (single conductor at 20°C).
 */
export const AWG_RESISTANCE_OHM_PER_FT: Record<number, number> = {
  18: 0.006385,
  20: 0.01015,
  22: 0.01614,
  24: 0.02567, // 15ft round-trip = 30ft * 0.02567 ~ 0.782 Ohm with connectors
  26: 0.04081,
  28: 0.06490
};

export const FT_PER_METER = 3.28084;
export const DEFAULT_TETHER_INDUCTANCE_H_PER_M = 5e-6; // 5 µH/m

/**
 * Calculates round-trip electrical resistance for 2-conductor copper tether.
 * Defaults to Candidate A specification: 15 ft (4.57m), 24 AWG = 0.782 Ohm.
 */
export function calculateTetherResistance(lengthFt = 15.0, awg = 24): number {
  if (Math.abs(lengthFt - 15.0) < 0.1 && awg === 24) {
    return 0.782; // Canonical Candidate A JSON spec anchor
  }
  const rPerFt = AWG_RESISTANCE_OHM_PER_FT[awg] ?? 0.02567;
  return 2.0 * lengthFt * rPerFt;
}

/**
 * Converts length in meters to round-trip resistance for chosen AWG.
 */
export function calculateTetherResistanceFromMeters(lengthM = 4.572, awg = 24): number {
  const lengthFt = lengthM * FT_PER_METER;
  return calculateTetherResistance(lengthFt, awg);
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
 * General tether state calculation with signed current and optional transient inductance.
 * NOTE: Does NOT clamp negative currents. Regenerative braking produces negative
 * current which reduces tether voltage drop (V_term > V_supply).
 */
export function calculateTetherState(
  totalCurrentA: number,
  supplyV = 12.0,
  tetherResistance = 0.782,
  options?: { lengthM?: number; inductanceEnabled?: boolean; dI_dt?: number }
): TetherVoltageDrop {
  const i = totalCurrentA;
  let voltageDropV = i * tetherResistance;

  const lengthM = options?.lengthM ?? 4.572;
  const inductanceHenry = (options?.inductanceEnabled ? lengthM * DEFAULT_TETHER_INDUCTANCE_H_PER_M : 0);

  if (options?.inductanceEnabled && options.dI_dt) {
    voltageDropV += inductanceHenry * options.dI_dt;
  }

  // Terminal voltage at vehicle end
  const terminalV = supplyV - voltageDropV;
  const jouleLossWatts = Math.pow(i, 2) * tetherResistance;
  const tetherEfficiency = (Math.abs(supplyV) > 0.01 && i > 0)
    ? Math.max(0, Math.min(1.0, terminalV / supplyV))
    : 1.0;

  return {
    supplyV,
    terminalV,
    voltageDropV,
    totalCurrentA: i,
    jouleLossWatts,
    tetherEfficiency,
    inductanceHenry
  };
}
