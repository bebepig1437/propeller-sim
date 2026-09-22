import { describe, it, expect, vi } from 'vitest';
import {
  applyPresetToState,
  createDefaultPresetState,
  tickThermalBurst,
  type PresetRuntimeState,
  type PresetSpecInput
} from '../src/core/presetState';
import { TelemetryRecorder, type TelemetrySample } from '../src/telemetry/recorder';
import { calculateTetherResistanceFromMeters } from '../src/power/tether';

const BREAKOUT_BURST: PresetSpecInput = {
  key: 'breakout',
  name: 'Breakout Burst',
  throttle: 1.0,
  rpm: 4140,
  thrust_N: 4.73,
  current_A: 1.41,
  burst_s: 18
};

function makeSample(overrides: Partial<TelemetrySample> = {}): TelemetrySample {
  return {
    t: 1.23456789,
    dt: 0.01666667,
    fps: 60.0,
    thrusters: [0, 1, 2].map((i) => ({
      rpm: 4140 + i,
      pitchDeg: 18.0,
      thrustN: 4.73000001 + i,
      torqueNm: 0.024,
      currentA: 1.41,
      vTermV: 10.82,
      tMotorC: 20.0
    })),
    busV: 10.82,
    iTotalA: 1.41,
    pTotalW: 15.25,
    pos: [0.1, 0.2, 0.3],
    vel: [0.4, 0.5, 0.6],
    quat: [1.0, 0.0, 0.0, 0.0],
    omega: [0.01, 0.02, 0.03],
    rollDevPerM: 1.8,
    fluidMaxV: 3.5,
    fluidMeanV: 0.4,
    fluidMaxVorticity: 12.5,
    pressureIters: 20,
    residual: 0.0001,
    gpuMs: 2.1,
    ...overrides
  };
}

describe('telemetry_presets', () => {
  it('preset_state_assignment: Breakout Burst configures all electrical, throttle and geometric state vectors', () => {
    const state: PresetRuntimeState = createDefaultPresetState();
    applyPresetToState(state, BREAKOUT_BURST);

    expect(state.presetKey).toBe('breakout');
    expect(state.presetName).toBe('Breakout Burst');
    expect(state.throttle).toBe(1.0);
    expect(state.throttleVector).toEqual([1.0, 1.0, 1.0]);
    expect(state.rpm).toBe(4140);
    expect(state.thrustN).toBeCloseTo(4.73, 10);
    expect(state.currentA).toBeCloseTo(1.41, 10);

    expect(state.supplyV).toBe(12.0);
    expect(state.tetherLengthFt).toBe(15.0);
    expect(state.tetherAwg).toBe(24);
    expect(state.tetherResistanceOhm).toBeCloseTo(calculateTetherResistanceFromMeters(15.0 / 3.28084, 24), 10);
    expect(state.tetherResistanceOhm).toBeGreaterThan(0);

    expect(state.designId).toBe('candidateA');
    expect(state.material).toBe('rigid10k');
    expect(state.statorVaneType).toBe('slotted');
    expect(state.statorIncidenceDeg).toBe(-5.2);
    expect(state.statorSlotChordPct).toBe(40.0);

    expect(state.burstMaxS).toBe(18);
    expect(state.burstRunTimeS).toBe(0.0);
    expect(state.burstRemainingS).toBe(18);
    expect(state.specViolationLatched).toBe(false);
  });

  it('thermal_countdown: 18s timer ticks synchronously with sim time and latches spec violation at expiry', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const state: PresetRuntimeState = createDefaultPresetState();
      applyPresetToState(state, BREAKOUT_BURST);

      const dt = 1.0 / 60.0;
      const stepsUntilExpiry = Math.round(18.0 / dt);

      let expiryStep = -1;
      let transitionCount = 0;

      for (let step = 0; step < stepsUntilExpiry; step++) {
        const justExpired = tickThermalBurst(state, dt);
        if (justExpired) {
          transitionCount++;
          if (expiryStep < 0) expiryStep = step;
        }
      }

      expect(expiryStep).toBeGreaterThanOrEqual(stepsUntilExpiry - 2);
      expect(expiryStep).toBeLessThanOrEqual(stepsUntilExpiry);
      expect(state.specViolationLatched).toBe(true);
      expect(state.burstRemainingS).toBe(0);

      for (let step = stepsUntilExpiry + 1; step < stepsUntilExpiry + 10; step++) {
        expect(tickThermalBurst(state, dt)).toBe(false);
        expect(state.specViolationLatched).toBe(true);
      }

      expect(transitionCount).toBe(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('spec limit violation');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('thermal_countdown: unlimited presets never latch a violation', () => {
    const state: PresetRuntimeState = createDefaultPresetState();
    applyPresetToState(state, { ...BREAKOUT_BURST, key: 'cruise', name: 'Continuous Cruise', burst_s: null });

    for (let step = 0; step < 60 * 3600; step++) {
      tickThermalBurst(state, 1.0 / 60.0);
    }

    expect(state.burstRemainingS).toBeNull();
    expect(state.specViolationLatched).toBe(false);
  });

  it('csv_data_completeness: exported CSV row contains all 24 required telemetry columns within 1e-5', () => {
    const recorder = new TelemetryRecorder();
    recorder.start();

    const sample = makeSample();
    recorder.record(sample);

    const csv = recorder.generateCsv();
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);

    const header = lines[0].split(',');
    const row = lines[1].split(',');

    const requiredColumns = [
      't_s', 'dt_s', 'fps',
      'u0_rpm', 'u0_pitch_deg', 'u0_thrust_N', 'u0_torque_Nm', 'u0_current_A', 'u0_vterm_V', 'u0_tmotor_C',
      'u1_rpm', 'u1_pitch_deg', 'u1_thrust_N', 'u1_torque_Nm', 'u1_current_A', 'u1_vterm_V', 'u1_tmotor_C',
      'u2_rpm', 'u2_pitch_deg', 'u2_thrust_N', 'u2_torque_Nm', 'u2_current_A', 'u2_vterm_V', 'u2_tmotor_C',
      'v_bus_V', 'i_total_A', 'p_total_W',
      'pos_x_m', 'pos_y_m', 'pos_z_m',
      'vel_x_ms', 'vel_y_ms', 'vel_z_ms',
      'quat_w', 'quat_x', 'quat_y', 'quat_z',
      'omega_p_rads', 'omega_q_rads', 'omega_r_rads',
      'roll_dev_deg_per_m',
      'fluid_max_v_ms', 'fluid_mean_v_ms', 'fluid_max_vorticity_s',
      'pressure_iters', 'pressure_residual', 'gpu_total_ms'
    ];

    for (const col of requiredColumns) {
      expect(header).toContain(col);
    }
    expect(header.length).toBeGreaterThanOrEqual(requiredColumns.length);

    const columnIndex = new Map(header.map((name, idx) => [name, idx]));
    const read = (col: string): number => parseFloat(row[columnIndex.get(col) as number]);

    expect(read('t_s')).toBeCloseTo(1.23456789, 5);
    expect(read('dt_s')).toBeCloseTo(0.01666667, 5);
    expect(read('fps')).toBeCloseTo(60.0, 5);
    expect(read('u0_thrust_N')).toBeCloseTo(4.73000001, 5);
    expect(read('u1_thrust_N')).toBeCloseTo(5.73000001, 5);
    expect(read('u2_thrust_N')).toBeCloseTo(6.73000001, 5);
    expect(read('v_bus_V')).toBeCloseTo(10.82, 5);
    expect(read('i_total_A')).toBeCloseTo(1.41, 5);
    expect(read('p_total_W')).toBeCloseTo(15.25, 5);
    expect(read('pos_x_m')).toBeCloseTo(0.1, 5);
    expect(read('vel_z_ms')).toBeCloseTo(0.6, 5);
    expect(read('quat_w')).toBeCloseTo(1.0, 5);
    expect(read('omega_r_rads')).toBeCloseTo(0.03, 5);
    expect(read('roll_dev_deg_per_m')).toBeCloseTo(1.8, 5);
    expect(read('fluid_max_v_ms')).toBeCloseTo(3.5, 5);
    expect(read('fluid_mean_v_ms')).toBeCloseTo(0.4, 5);
    expect(read('fluid_max_vorticity_s')).toBeCloseTo(12.5, 5);
    expect(read('gpu_total_ms')).toBeCloseTo(2.1, 5);
  });

  it('csv_data_completeness: per-pass solver timing columns and residual formatting are present', () => {
    const recorder = new TelemetryRecorder();
    recorder.start();
    recorder.record(makeSample({
      sourcesMs: 0.11,
      curlMs: 0.12,
      vorticityMs: 0.13,
      advectMs: 0.14,
      divergenceMs: 0.15,
      pressureMs: 0.16,
      projectMs: 0.17,
      residual: 1.234e-4
    }));

    const csv = recorder.generateCsv();
    const header = csv.split('\n')[0].split(',');
    const row = csv.split('\n')[1].split(',');
    const index = new Map(header.map((name, idx) => [name, idx]));

    const expectedPerPass: Record<string, number> = {
      sources_ms: 0.11,
      curl_ms: 0.12,
      vorticity_ms: 0.13,
      advect_ms: 0.14,
      divergence_ms: 0.15,
      pressure_ms: 0.16,
      project_ms: 0.17
    };

    for (const [col, expected] of Object.entries(expectedPerPass)) {
      expect(header).toContain(col);
      expect(parseFloat(row[index.get(col) as number])).toBeCloseTo(expected, 5);
    }

    expect(row[index.get('pressure_residual') as number]).toBe('1.234e-4');
  });
});
