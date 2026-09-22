import { calculateTetherResistanceFromMeters } from '../power/tether';
import type { PropellerMaterial } from '../prop/rigidbody';
import type { StatorVaneType } from '../prop/stator';

export interface PresetRuntimeState {
  presetKey: string;
  presetName: string;
  throttle: number;
  throttleVector: [number, number, number];
  rpm: number;
  thrustN: number;
  currentA: number;
  burstMaxS: number | null;
  burstRunTimeS: number;
  burstRemainingS: number | null;
  specViolationLatched: boolean;
  supplyV: number;
  tetherLengthFt: number;
  tetherAwg: number;
  tetherResistanceOhm: number;
  designId: 'candidateA' | 'kaplan' | 'wageningen';
  material: PropellerMaterial;
  statorVaneType: StatorVaneType;
  statorIncidenceDeg: number;
  statorSlotChordPct: number;
}

export interface PresetSpecInput {
  key: string;
  name: string;
  throttle: number;
  throttleVector?: [number, number, number];
  rpm: number;
  thrust_N: number;
  current_A: number;
  burst_s: number | null;
}

export const TETHER_LENGTH_FT = 15.0;
export const TETHER_AWG = 24;
export const BUS_SUPPLY_V = 12.0;

export function createDefaultPresetState(): PresetRuntimeState {
  return {
    presetKey: 'breakout',
    presetName: 'Breakout Burst',
    throttle: 1.0,
    throttleVector: [1.0, 1.0, 1.0],
    rpm: 4140,
    thrustN: 4.73,
    currentA: 1.41,
    burstMaxS: 18.0,
    burstRunTimeS: 0.0,
    burstRemainingS: 18.0,
    specViolationLatched: false,
    supplyV: BUS_SUPPLY_V,
    tetherLengthFt: TETHER_LENGTH_FT,
    tetherAwg: TETHER_AWG,
    tetherResistanceOhm: calculateTetherResistanceFromMeters(TETHER_LENGTH_FT / 3.28084, TETHER_AWG),
    designId: 'candidateA',
    material: 'rigid10k',
    statorVaneType: 'slotted',
    statorIncidenceDeg: -5.2,
    statorSlotChordPct: 40.0
  };
}

export function applyPresetToState(state: PresetRuntimeState, preset: PresetSpecInput): PresetRuntimeState {
  const throttleVector: [number, number, number] = preset.throttleVector ?? [preset.throttle, preset.throttle, preset.throttle];

  state.presetKey = preset.key;
  state.presetName = preset.name;
  state.throttle = preset.throttle;
  state.throttleVector = throttleVector;
  state.rpm = preset.rpm;
  state.thrustN = preset.thrust_N;
  state.currentA = preset.current_A;

  state.burstMaxS = preset.burst_s;
  state.burstRunTimeS = 0.0;
  state.burstRemainingS = preset.burst_s;
  state.specViolationLatched = false;

  state.supplyV = BUS_SUPPLY_V;
  state.tetherLengthFt = TETHER_LENGTH_FT;
  state.tetherAwg = TETHER_AWG;
  state.tetherResistanceOhm = calculateTetherResistanceFromMeters(TETHER_LENGTH_FT / 3.28084, TETHER_AWG);

  state.designId = 'candidateA';
  state.material = 'rigid10k';
  state.statorVaneType = 'slotted';
  state.statorIncidenceDeg = -5.2;
  state.statorSlotChordPct = 40.0;

  return state;
}

export function tickThermalBurst(state: PresetRuntimeState, dtS: number): boolean {
  if (state.burstMaxS === null) {
    state.burstRemainingS = null;
    return false;
  }

  state.burstRunTimeS += dtS;
  state.burstRemainingS = Math.max(0, state.burstMaxS - state.burstRunTimeS);

  if (state.burstRemainingS <= 0) {
    const justExpired = !state.specViolationLatched;
    state.specViolationLatched = true;
    if (justExpired) {
      console.warn(`[Thermal Burst] ${state.presetName} window expired after ${state.burstRunTimeS.toFixed(2)} s — spec limit violation latched`);
    }
    return justExpired;
  }

  return false;
}
