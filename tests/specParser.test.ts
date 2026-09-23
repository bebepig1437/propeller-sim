import { describe, it, expect, vi } from 'vitest';
import { parseSpecText, type SpecParseResult } from '../src/config/specParser';

const CANONICAL_CANDIDATE_A_SPEC = `
Reconciled High-Burst Vector-Skewed Propulsor (Slotted-Vane Cartridge & 2.03 mm Split-Collet Interface)

Skeletal Frame Mass: 39.5 g (bare carbon-fiber/PETG truss; strictly frame-only).
Propulsion Core (3-Motor Architecture): 3x potted Mabuchi RC-280RA motor canisters
(wax/epoxy encapsulation, 28.0 mm OD PVC housings, silicone lead strain reliefs) = 126.0 g (42.0 g/unit).
Vertical Propulsion Stack: 42 mm bespoke 4-blade rotor (1.85 g) + modular slotted stator
assembly (4.20 g) + M2 stainless hardware & brass inserts (3.80 g) = 9.85 g.
Horizontal Propulsion Stack: 2x 36 mm mirrored rotors (3.20 g) + mounting brackets/clamps (5.20 g) = 8.40 g.
Fasteners, Tether Gland & Wiring Harness: 5.25 g.
Total Dry Mass: 189.0 g.

Submerged volume V_sub = 210.0 cm^3.
Net positive buoyancy F_buoy = +21.0 g-force (+0.206 N).
Metacentric height BG = 14.5 mm.

Motor Terminal Conditions: Nominal 12.0 V source delivered over 15 ft 24 AWG tether
(R_tether = 0.782 Ohm round-trip loop). Under 1.25 A load, terminal voltage drop yields
exactly V_term = 10.82 V.

Armature resistance: Ra = 4.50 Ohm
No-load speed: n0 = 9800 RPM (163.33 rev/s = 1026.3 rad/s)
No-load current: I0 = 0.18 A
Stall current: I_stall = 10.80 / 4.50 = 2.40 A
Stall torque: tau_stall = 0.0260 N.m (26.0 mN.m)
Torque constant: kt = 0.01171 N.m/A
Back-EMF constant: ke = 0.00973 V.s/rad (1.019 mV/RPM)

Throttle Map (10.8 V Rail):
100% Burst: V_eff = 10.80 V | Duty = 100% | 4140 RPM | Current = 1.41 A | T_up ~ +4.73 N | Safe Thermal Run = 18 s max.
88% Heavy Lift: V_eff = 9.51 V | Duty = 88.1% | 3800 RPM | Current = 1.25 A | T_up ~ +3.99 N | Safe Thermal Run = 50 s max.
67% Continuous Cruise: V_eff = 7.24 V | Duty = 67.0% | 3000 RPM | Current = 0.85 A | T_up ~ +2.49 N | Continuous.
-84% Full Dive: V_eff = 9.07 V | Duty = 84.0% | 3650 RPM | Current = 1.18 A | T_down ~ -2.82 N | Safe Thermal Run = 65 s max.

Shaft bore: 2.03 +0.02/-0.00 mm.
Shaft: 2.000 mm (0.0787 in) Mabuchi shaft.
Material: SLA Rigid 10K Resin (rho = 1.65 g/cm^3). Rotor Mass = 1.85 g; I_zz = 3.98e-7 kg.m^2.

Stator: 3-vane slotted stator. Slot chord 40%. Incidence -5.2 deg.
`;

function getFieldValue(result: SpecParseResult, key: string): any {
  const f = result.fields.find(x => x.key === key);
  return f ? f.value : undefined;
}

describe('specParser test suite', () => {
  it('Test 1 — Full Candidate A parse', () => {
    const res = parseSpecText(CANONICAL_CANDIDATE_A_SPEC);

    expect(getFieldValue(res, 'Ra_ohm')).toBe(4.50);
    expect(getFieldValue(res, 'Io_A')).toBe(0.18);
    expect(getFieldValue(res, 'no_load_rpm')).toBe(9800);
    expect(getFieldValue(res, 'stall_torque_Nm')).toBeCloseTo(0.0260, 5);
    expect(getFieldValue(res, 'kt_Nm_per_A')).toBeCloseTo(0.01171, 5);
    expect(getFieldValue(res, 'ke_Vs_per_rad')).toBeCloseTo(0.00973, 5);
    expect(getFieldValue(res, 'supply_V')).toBe(12.0);
    expect(getFieldValue(res, 'R_tether_ohm')).toBeCloseTo(0.782, 5);
    expect(getFieldValue(res, 'D_mm')).toBe(42.0);
    expect(getFieldValue(res, 'blade_count')).toBe(4);
    expect(getFieldValue(res, 'total_dry_mass_g')).toBe(189.0);
    expect(getFieldValue(res, 'displaced_cm3')).toBe(210.0);
    expect(getFieldValue(res, 'net_buoyancy_N')).toBeCloseTo(0.206, 3);
    expect(getFieldValue(res, 'BG_mm')).toBe(14.5);
    expect(getFieldValue(res, 'motor_count')).toBe(3);
    expect(getFieldValue(res, 'stator_attached')).toBe(true);
    expect(getFieldValue(res, 'slot_chord_pct')).toBe(40);
    expect(getFieldValue(res, 'incidence_deg')).toBe(-5.2);
  });

  it('Test 2 — Operating point extraction', () => {
    const res = parseSpecText(CANONICAL_CANDIDATE_A_SPEC);
    const ops = getFieldValue(res, 'operating_points');

    expect(Array.isArray(ops)).toBe(true);
    expect(ops.length).toBe(4);

    const burst = ops.find((x: any) => x.label.includes('burst'));
    expect(burst).toBeDefined();
    expect(burst.throttle).toBe(1.0);
    expect(burst.rpm).toBe(4140);
    expect(burst.current_A).toBe(1.41);
    expect(burst.thrust_N).toBe(4.73);
    expect(burst.burst_s).toBe(18);

    const heavy = ops.find((x: any) => x.label.includes('heavy'));
    expect(heavy).toBeDefined();
    expect(heavy.throttle).toBe(0.88);
    expect(heavy.rpm).toBe(3800);
    expect(heavy.current_A).toBe(1.25);
    expect(heavy.thrust_N).toBe(3.99);
    expect(heavy.burst_s).toBe(50);

    const cruise = ops.find((x: any) => x.label.includes('cruise'));
    expect(cruise).toBeDefined();
    expect(cruise.throttle).toBe(0.67);
    expect(cruise.rpm).toBe(3000);
    expect(cruise.current_A).toBe(0.85);
    expect(cruise.thrust_N).toBe(2.49);
    expect(cruise.burst_s).toBeNull();

    const dive = ops.find((x: any) => x.label.includes('dive'));
    expect(dive).toBeDefined();
    expect(dive.throttle).toBe(-0.84);
    expect(dive.rpm).toBe(3650);
    expect(dive.current_A).toBe(1.18);
    expect(dive.thrust_N).toBe(-2.82);
    expect(dive.burst_s).toBe(65);
  });

  it('Test 3 — Unit normalization', () => {
    const res = parseSpecText(CANONICAL_CANDIDATE_A_SPEC);
    const dMm = getFieldValue(res, 'D_mm');
    expect(dMm).toBe(42.0);
    const dM = dMm * 1e-3;
    expect(dM).toBeCloseTo(0.042, 6);

    const vCm3 = getFieldValue(res, 'displaced_cm3');
    expect(vCm3).toBe(210.0);
    const vM3 = vCm3 * 1e-6;
    expect(vM3).toBeCloseTo(0.00021, 8);

    const mG = getFieldValue(res, 'total_dry_mass_g');
    expect(mG).toBe(189.0);
    const mKg = mG * 1e-3;
    expect(mKg).toBeCloseTo(0.189, 5);
  });

  it('Test 4 — Missing field handling', () => {
    const specNoTether = `
Armature resistance: Ra = 4.50 Ohm
No-load speed: n0 = 9800 RPM
No-load current: I0 = 0.18 A
Stall torque: tau_stall = 0.0260 N.m
Torque constant: kt = 0.01171 N.m/A
Vertical Propulsion Stack: 42 mm bespoke 4-blade rotor (1.85 g)
Total Dry Mass: 189.0 g.
Submerged volume V_sub = 210.0 cm^3.
`;
    const res = parseSpecText(specNoTether);
    expect(res.missing).toContain('supply_V');
    expect(res.missing).toContain('R_tether_ohm');
    expect(res.fields.some(f => f.key === 'supply_V')).toBe(false);
  });

  it('Test 5 — Conflict detection', () => {
    const specWithConflict = `
Armature resistance: Ra = 4.50 Ohm
No-load speed: n0 = 9800 RPM
No-load current: I0 = 0.18 A
Stall torque: tau_stall = 0.0260 N.m
Torque constant: kt = 0.01171 N.m/A
Back-EMF constant: ke = 0.00973 V.s/rad
Nominal 12.0 V source delivered over 15 ft 24 AWG tether (R_tether = 0.782 Ohm)
Vertical Propulsion Stack: 42 mm bespoke 4-blade rotor (1.85 g)
Total Dry Mass: 189.0 g.
Submerged volume V_sub = 210.0 cm^3.
Stall torque: tau_stall = 0.0255 N.m
`;
    const res = parseSpecText(specWithConflict);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.some(w => w.includes('conflicting') && w.includes('stall_torque_Nm'))).toBe(true);
    const field = res.fields.find(f => f.key === 'stall_torque_Nm');
    expect(field).toBeDefined();
    expect(field?.confidence).toBe('medium');
  });

  it('Test 6 — Determinism', () => {
    const res1 = parseSpecText(CANONICAL_CANDIDATE_A_SPEC);
    const res2 = parseSpecText(CANONICAL_CANDIDATE_A_SPEC);
    expect(res1).toEqual(res2);
  });

  it('Test 7 — No network, no side effects', () => {
    const globalFetch = vi.fn();
    const origFetch = globalThis.fetch;
    globalThis.fetch = globalFetch;

    try {
      const res = parseSpecText(CANONICAL_CANDIDATE_A_SPEC);
      expect(res).toBeDefined();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('Test 8 — Idempotence of apply', () => {
    const res1 = parseSpecText(CANONICAL_CANDIDATE_A_SPEC);
    const serialized = `
Armature resistance: Ra = ${res1.vehicle.motor.Ra_ohm} Ohm
No-load speed: n0 = ${res1.vehicle.motor.no_load_rpm_at_10v8} RPM
No-load current: I0 = ${res1.vehicle.motor.Io_A} A
Stall torque: tau_stall = ${res1.vehicle.motor.stall_torque_Nm} N.m
Torque constant: kt = ${res1.vehicle.motor.kt_Nm_per_A} N.m/A
Back-EMF constant: ke = ${res1.vehicle.motor.ke_Vs_per_rad} V.s/rad
Nominal ${res1.vehicle.tether.supply_V} V source delivered over ${res1.vehicle.tether.length_ft} ft ${res1.vehicle.tether.awg} AWG tether (R_tether = ${res1.vehicle.tether.R_roundtrip_ohm} Ohm)
Vertical Propulsion Stack: ${res1.vehicle.propeller.D_mm} mm bespoke ${res1.vehicle.propeller.blades}-blade rotor (${res1.vehicle.mass.prop_g.rigid10k} g)
Total Dry Mass: ${res1.vehicle.mass.frame_g + res1.vehicle.mass.hardware_g + res1.vehicle.mass.motor_unit_g * res1.vehicle.mass.motor_count + res1.vehicle.mass.prop_g.rigid10k * res1.vehicle.mass.motor_count} g.
Submerged volume V_sub = ${res1.vehicle.buoyancy.displaced_cm3} cm^3.
Stator: ${res1.vehicle.stator.vanes}-vane slotted stator. Slot chord ${res1.vehicle.stator.slot_chord_pct}%. Incidence ${res1.vehicle.stator.incidence_deg} deg.
`;
    const res2 = parseSpecText(serialized);
    expect(res2.vehicle.motor.Ra_ohm).toBe(res1.vehicle.motor.Ra_ohm);
    expect(res2.vehicle.motor.no_load_rpm_at_10v8).toBe(res1.vehicle.motor.no_load_rpm_at_10v8);
    expect(res2.vehicle.motor.kt_Nm_per_A).toBeCloseTo(res1.vehicle.motor.kt_Nm_per_A, 5);
    expect(res2.vehicle.tether.supply_V).toBe(res1.vehicle.tether.supply_V);
    expect(res2.vehicle.propeller.D_mm).toBe(res1.vehicle.propeller.D_mm);
    expect(res2.vehicle.stator.vanes).toBe(res1.vehicle.stator.vanes);
    expect(res2.vehicle.stator.slot_chord_pct).toBe(res1.vehicle.stator.slot_chord_pct);
  });
});
