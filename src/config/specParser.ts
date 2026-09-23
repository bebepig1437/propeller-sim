import type { VehicleConfig, OperatingPoint } from '../types/vehicle';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ParsedField {
  key: string;
  value: number | string | boolean | OperatingPoint[];
  unit: string;
  confidence: ConfidenceLevel;
  sourceLine: number | null;
}

export type VehicleSpec = VehicleConfig;

export interface SpecParseResult {
  fields: ParsedField[];
  warnings: string[];
  missing: string[];
  vehicle: VehicleSpec;
  raw: string;
}

interface RawLine {
  text: string;
  lineNum: number;
}

function normalizeInput(text: string): RawLine[] {
  const lines = text.split(/\r?\n/);
  return lines.map((raw, idx) => {
    let t = raw
      .replace(/×/g, 'x')
      .replace(/→/g, '->')
      .replace(/≈/g, '~')
      .replace(/·/g, '.')
      .replace(/[–—]/g, '-')
      .replace(/Ω/g, 'Ohm')
      .replace(/µ/g, 'u')
      .trim();
    return { text: t, lineNum: idx + 1 };
  });
}

function findMatches(lines: RawLine[], pattern: RegExp): Array<{ match: RegExpExecArray; line: RawLine }> {
  const out: Array<{ match: RegExpExecArray; line: RawLine }> = [];
  for (const l of lines) {
    if (!l.text) continue;
    pattern.lastIndex = 0;
    const m = pattern.exec(l.text);
    if (m) {
      out.push({ match: m, line: l });
    }
  }
  return out;
}

export function parseSpecText(text: string): SpecParseResult {
  const lines = normalizeInput(text);
  const fields: ParsedField[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];

  const rawValues: Record<string, { value: any; unit: string; confidence: ConfidenceLevel; line: number | null }[]> = {};

  const recordValue = (
    key: string,
    value: any,
    unit: string,
    confidence: ConfidenceLevel,
    line: number | null
  ) => {
    if (!rawValues[key]) rawValues[key] = [];
    rawValues[key].push({ value, unit, confidence, line });
  };

  const raMatches = findMatches(lines, /(?:R_?a|armature resistance)\s*[:=]\s*([0-9.]+)\s*(?:Ohm)?/i);
  for (const m of raMatches) {
    recordValue('Ra_ohm', parseFloat(m.match[1]), 'Ohm', 'high', m.line.lineNum);
  }

  const noLoadRpmMatches = findMatches(lines, /(?:n_?0|no-load speed)\s*[:=]\s*([0-9.]+)\s*RPM/i);
  for (const m of noLoadRpmMatches) {
    recordValue('no_load_rpm', parseFloat(m.match[1]), 'RPM', 'high', m.line.lineNum);
  }

  const noLoadCurrentMatches = findMatches(lines, /(?:I_?0|no-load current)\s*[:=]\s*([0-9.]+)\s*A/i);
  for (const m of noLoadCurrentMatches) {
    recordValue('Io_A', parseFloat(m.match[1]), 'A', 'high', m.line.lineNum);
  }

  const stallCurrentMatches = findMatches(lines, /(?:I_?stall|stall current)\s*[:=]\s*(?:[0-9.]+\s*\/\s*[0-9.]+\s*=\s*)?([0-9.]+)\s*A/i);
  for (const m of stallCurrentMatches) {
    recordValue('stall_current_A', parseFloat(m.match[1]), 'A', 'high', m.line.lineNum);
  }

  const stallTorqueMatches = findMatches(lines, /(?:tau_stall|stall torque)\s*[:=]\s*([0-9.]+)\s*(?:N\.?m|Nm)/i);
  for (const m of stallTorqueMatches) {
    recordValue('stall_torque_Nm', parseFloat(m.match[1]), 'N.m', 'high', m.line.lineNum);
  }

  const ktMatches = findMatches(lines, /kt\s*[:=]\s*([0-9.]+)\s*N\.?m\/A/i);
  for (const m of ktMatches) {
    recordValue('kt_Nm_per_A', parseFloat(m.match[1]), 'N.m/A', 'high', m.line.lineNum);
  }

  const keMatches = findMatches(lines, /ke\s*[:=]\s*([0-9.]+)\s*V\.?s\/rad/i);
  for (const m of keMatches) {
    recordValue('ke_Vs_per_rad', parseFloat(m.match[1]), 'V.s/rad', 'high', m.line.lineNum);
  }

  const motorCountMatches = findMatches(lines, /([0-9]+)\s*x\s+potted\s+([A-Za-z0-9\-]+)\s+motor/i);
  if (motorCountMatches.length > 0) {
    recordValue('motor_count', parseInt(motorCountMatches[0].match[1], 10), 'count', 'high', motorCountMatches[0].line.lineNum);
    recordValue('motor_model', motorCountMatches[0].match[2], 'string', 'high', motorCountMatches[0].line.lineNum);
  } else {
    const fallbackArch = findMatches(lines, /([0-9]+)-Motor Architecture/i);
    if (fallbackArch.length > 0) {
      recordValue('motor_count', parseInt(fallbackArch[0].match[1], 10), 'count', 'medium', fallbackArch[0].line.lineNum);
    }
    const fallbackModel = findMatches(lines, /Mabuchi\s+([A-Za-z0-9\-]+)/i);
    if (fallbackModel.length > 0) {
      recordValue('motor_model', `Mabuchi ${fallbackModel[0].match[1]}`, 'string', 'medium', fallbackModel[0].line.lineNum);
    }
  }

  const motorUnitMassMatches = findMatches(lines, /\(([0-9.]+)\s*g\/unit\)/i);
  for (const m of motorUnitMassMatches) {
    recordValue('motor_unit_mass_g', parseFloat(m.match[1]), 'g', 'high', m.line.lineNum);
  }

  const supplyVMatches = findMatches(lines, /(?:Nominal\s+)?([0-9.]+)\s*V\s+source/i);
  for (const m of supplyVMatches) {
    recordValue('supply_V', parseFloat(m.match[1]), 'V', 'high', m.line.lineNum);
  }

  const tetherLengthMatches = findMatches(lines, /([0-9.]+)\s*ft\s+([0-9]+)\s*AWG/i);
  for (const m of tetherLengthMatches) {
    recordValue('tether_length_ft', parseFloat(m.match[1]), 'ft', 'high', m.line.lineNum);
    recordValue('tether_awg', parseInt(m.match[2], 10), 'AWG', 'high', m.line.lineNum);
  }

  const rtetherMatches = findMatches(lines, /(?:R_tether\s*[:=]|loop\))\s*[:=]?\s*([0-9.]+)\s*Ohm/i);
  for (const m of rtetherMatches) {
    recordValue('R_tether_ohm', parseFloat(m.match[1]), 'Ohm', 'high', m.line.lineNum);
  }

  const rotorMatches = findMatches(lines, /([0-9.]+)\s*mm\s+bespoke\s+([0-9]+)-blade\s+rotor\s*(?:\(([0-9.]+)\s*g\))?/i);
  for (const m of rotorMatches) {
    recordValue('D_mm', parseFloat(m.match[1]), 'mm', 'high', m.line.lineNum);
    recordValue('blade_count', parseInt(m.match[2], 10), 'count', 'high', m.line.lineNum);
    if (m.match[3]) {
      recordValue('rotor_mass_g', parseFloat(m.match[3]), 'g', 'high', m.line.lineNum);
    }
  }

  const izzMatches = findMatches(lines, /I_zz\s*=\s*([0-9.e\-]+)\s*kg\.m\^2/i);
  for (const m of izzMatches) {
    recordValue('rotor_Izz_kg_m2', parseFloat(m.match[1]), 'kg.m^2', 'high', m.line.lineNum);
  }

  const frameMassMatches = findMatches(lines, /Skeletal Frame Mass:\s*([0-9.]+)\s*g/i);
  for (const m of frameMassMatches) {
    recordValue('frame_g', parseFloat(m.match[1]), 'g', 'high', m.line.lineNum);
  }

  const dryMassMatches = findMatches(lines, /Total Dry Mass:\s*([0-9.]+)\s*g/i);
  for (const m of dryMassMatches) {
    recordValue('total_dry_mass_g', parseFloat(m.match[1]), 'g', 'high', m.line.lineNum);
  }

  const volumeMatches = findMatches(lines, /(?:Submerged volume\s+)?V_sub\s*=\s*([0-9.]+)\s*cm\^3/i);
  for (const m of volumeMatches) {
    recordValue('displaced_cm3', parseFloat(m.match[1]), 'cm^3', 'high', m.line.lineNum);
  }

  const buoyancyMatches = findMatches(lines, /F_buoy\s*=\s*\+?([0-9.]+)\s*g-force\s*\(\+?([0-9.]+)\s*N\)/i);
  for (const m of buoyancyMatches) {
    recordValue('net_buoyancy_g_force', parseFloat(m.match[1]), 'g-force', 'high', m.line.lineNum);
    recordValue('net_buoyancy_N', parseFloat(m.match[2]), 'N', 'high', m.line.lineNum);
  }

  const bgMatches = findMatches(lines, /(?:Metacentric height\s+)?BG\s*=\s*([0-9.]+)\s*mm/i);
  for (const m of bgMatches) {
    recordValue('BG_mm', parseFloat(m.match[1]), 'mm', 'high', m.line.lineNum);
  }

  const statorVaneMatches = findMatches(lines, /([0-9]+)-vane\s+slotted\s+stator/i);
  for (const m of statorVaneMatches) {
    recordValue('vanes', parseInt(m.match[1], 10), 'count', 'high', m.line.lineNum);
    recordValue('stator_attached', true, 'boolean', 'high', m.line.lineNum);
  }

  const slotChordMatches = findMatches(lines, /Slot chord\s+([0-9.]+)%/i);
  for (const m of slotChordMatches) {
    recordValue('slot_chord_pct', parseFloat(m.match[1]), '%', 'high', m.line.lineNum);
  }

  const incidenceMatches = findMatches(lines, /Incidence\s+([-0-9.]+)\s*deg/i);
  for (const m of incidenceMatches) {
    recordValue('incidence_deg', parseFloat(m.match[1]), 'deg', 'high', m.line.lineNum);
  }

  const materialMatches = findMatches(lines, /Material:\s*([^(\n\r]+)(?:\(rho\s*=\s*([0-9.]+)\s*g\/cm\^3\))?/i);
  for (const m of materialMatches) {
    recordValue('material_name', m.match[1].trim(), 'string', 'high', m.line.lineNum);
    if (m.match[2]) {
      recordValue('material_rho_g_cm3', parseFloat(m.match[2]), 'g/cm^3', 'high', m.line.lineNum);
    }
  }

  const operatingPoints: OperatingPoint[] = [];
  const throttleMapPattern = /([-+]?[0-9]+)%\s+([^:]+):\s*V_eff\s*=\s*([0-9.]+)\s*V\s*\|\s*Duty\s*=\s*([0-9.]+)%\s*\|\s*([0-9]+)\s*RPM\s*\|\s*Current\s*=\s*([0-9.]+)\s*A\s*\|\s*T_(?:up|down)\s*~?\s*([-+0-9.]+)\s*N\s*\|\s*(?:Safe Thermal Run\s*=\s*([0-9]+)\s*s\s*max|Continuous)/i;

  for (const l of lines) {
    const tm = throttleMapPattern.exec(l.text);
    if (tm) {
      const pct = parseFloat(tm[1]);
      const rawLabel = tm[2].trim().toLowerCase().replace(/\s+/g, '_');
      const rpm = parseInt(tm[5], 10);
      const current = parseFloat(tm[6]);
      const thrust = parseFloat(tm[7]);
      const burst = tm[8] ? parseInt(tm[8], 10) : null;

      operatingPoints.push({
        label: rawLabel,
        throttle: pct / 100.0,
        rpm,
        current_A: current,
        thrust_N: thrust,
        burst_s: burst
      });
    }
  }

  if (operatingPoints.length > 0) {
    recordValue('operating_points', operatingPoints, 'list', 'high', null);
  }

  for (const [key, entries] of Object.entries(rawValues)) {
    if (entries.length > 1) {
      const firstVal = entries[0].value;
      const conflict = entries.some(e => e.value !== firstVal);
      if (conflict) {
        const desc = entries.map(e => `${e.value} ${e.unit} (line ${e.line})`).join(' and ');
        warnings.push(`Found conflicting values for ${key}: ${desc}. Using line ${entries[0].line}.`);
        fields.push({
          key,
          value: entries[0].value,
          unit: entries[0].unit,
          confidence: 'medium',
          sourceLine: entries[0].line
        });
        continue;
      }
    }
    fields.push({
      key,
      value: entries[0].value,
      unit: entries[0].unit,
      confidence: entries[0].confidence,
      sourceLine: entries[0].line
    });
  }

  const getSingle = (k: string): any => {
    const f = fields.find(x => x.key === k);
    return f ? f.value : undefined;
  };

  if (getSingle('kv_rpm_per_V') === undefined) {
    const n0 = getSingle('no_load_rpm');
    const vTerm = 10.8;
    if (n0 !== undefined) {
      const derivedKv = parseFloat((n0 / vTerm).toFixed(1));
      fields.push({ key: 'kv_rpm_per_V', value: derivedKv, unit: 'RPM/V', confidence: 'low', sourceLine: null });
    }
  }

  if (getSingle('stall_current_A') === undefined) {
    const ra = getSingle('Ra_ohm');
    if (ra !== undefined && ra > 0) {
      const derivedIStall = parseFloat((10.8 / ra).toFixed(2));
      fields.push({ key: 'stall_current_A', value: derivedIStall, unit: 'A', confidence: 'low', sourceLine: null });
    }
  }

  if (getSingle('ke_Vs_per_rad') === undefined) {
    const kt = getSingle('kt_Nm_per_A');
    if (kt !== undefined) {
      fields.push({ key: 'ke_Vs_per_rad', value: kt, unit: 'V.s/rad', confidence: 'low', sourceLine: null });
    }
  }

  if (getSingle('R_tether_ohm') === undefined) {
    const lenFt = getSingle('tether_length_ft');
    const awg = getSingle('tether_awg');
    if (lenFt !== undefined && awg !== undefined) {
      const m = lenFt * 0.3048;
      const rPerM = awg === 24 ? 0.0842 : 0.05;
      const derivedR = parseFloat((m * 2 * rPerM).toFixed(3));
      fields.push({ key: 'R_tether_ohm', value: derivedR, unit: 'Ohm', confidence: 'low', sourceLine: null });
    }
  }

  if (getSingle('net_buoyancy_N') === undefined) {
    const vSub = getSingle('displaced_cm3');
    const dryG = getSingle('total_dry_mass_g');
    if (vSub !== undefined && dryG !== undefined) {
      const netN = parseFloat((((vSub - dryG) * 1e-3) * 9.80665).toFixed(3));
      fields.push({ key: 'net_buoyancy_N', value: netN, unit: 'N', confidence: 'low', sourceLine: null });
    }
  }

  const requiredFields = [
    'Ra_ohm',
    'Io_A',
    'no_load_rpm',
    'stall_torque_Nm',
    'kt_Nm_per_A',
    'ke_Vs_per_rad',
    'supply_V',
    'R_tether_ohm',
    'D_mm',
    'blade_count',
    'total_dry_mass_g',
    'displaced_cm3'
  ];

  for (const rf of requiredFields) {
    if (getSingle(rf) === undefined) {
      missing.push(rf);
    }
  }

  const vSpec: VehicleSpec = {
    id: 'imported_spec',
    name: (getSingle('motor_model') as string) || 'Imported Spec Propulsor',
    mass: {
      frame_g: getSingle('frame_g') ?? 39.5,
      hardware_g: 9.0,
      motor_unit_g: getSingle('motor_unit_mass_g') ?? 42.0,
      motor_count: getSingle('motor_count') ?? 3,
      prop_g: {
        rigid10k: getSingle('rotor_mass_g') ?? 1.85,
        pa12cf15: (getSingle('rotor_mass_g') ?? 1.85) * 0.69,
        petg: (getSingle('rotor_mass_g') ?? 1.85) * 0.76
      }
    },
    buoyancy: {
      displaced_cm3: getSingle('displaced_cm3') ?? 210.0,
      rho_kg_m3: 1000.0,
      cob_above_cog_mm: getSingle('BG_mm') ?? 14.5
    },
    geometry: {
      frame_length_m: 0.20,
      frame_width_m: 0.16,
      frame_height_m: 0.14,
      frame_truss: {
        node_count: 8,
        node_mass_fraction: 0.6,
        rail_mass_fraction: 0.4,
        corner_half_gap_m: 0.088
      },
      prop_inertia_zz_kgm2: {
        rigid10k: getSingle('rotor_Izz_kg_m2') ?? 3.98e-7,
        pa12cf15: (getSingle('rotor_Izz_kg_m2') ?? 3.98e-7) * 0.69,
        petg: (getSingle('rotor_Izz_kg_m2') ?? 3.98e-7) * 0.76
      },
      rotor_mounts: [
        { id: 'port', surge_m: 0.0, sway_m: -0.075, heave_m: 0.0, spin_axis: 'surge' },
        { id: 'starboard', surge_m: 0.0, sway_m: 0.075, heave_m: 0.0, spin_axis: 'surge' },
        { id: 'vertical', surge_m: 0.0, sway_m: 0.0, heave_m: 0.0, spin_axis: 'heave' }
      ]
    },
    motor: {
      model: (getSingle('motor_model') as string) || 'Mabuchi RC-280RA',
      Ra_ohm: getSingle('Ra_ohm') ?? 4.50,
      Io_A: getSingle('Io_A') ?? 0.18,
      kv_rpm_per_V: getSingle('kv_rpm_per_V') ?? 907.4,
      no_load_rpm_at_10v8: getSingle('no_load_rpm') ?? 9800,
      stall_torque_Nm: getSingle('stall_torque_Nm') ?? 0.0260,
      kt_Nm_per_A: getSingle('kt_Nm_per_A') ?? 0.01171,
      ke_Vs_per_rad: getSingle('ke_Vs_per_rad') ?? 0.00973
    },
    tether: {
      length_ft: getSingle('tether_length_ft') ?? 15,
      awg: getSingle('tether_awg') ?? 24,
      R_roundtrip_ohm: getSingle('R_tether_ohm') ?? 0.782,
      supply_V: getSingle('supply_V') ?? 12.0
    },
    propeller: {
      D_mm: getSingle('D_mm') ?? 42.0,
      hub_od_mm: 8.0,
      hub_len_mm: 11.0,
      blades: getSingle('blade_count') ?? 4,
      KQ: 0.024,
      blade_phase_offset_deg: 0,
      handedness: ['CW', 'CCW', 'CW']
    },
    stator: {
      vanes: getSingle('vanes') ?? 3,
      profile: 'modified NACA 63-012',
      slot_chord_pct: getSingle('slot_chord_pct') ?? 40,
      incidence_deg: getSingle('incidence_deg') ?? -5.2,
      rake_deg: 35,
      forward_thrust_gain_N: 0.04,
      reverse_thrust_penalty_N: 0.09,
      roll_reduction_deg_per_m: { none: 14.8, solid: 1.4, slotted: 1.8 }
    },
    operating_points: operatingPoints.length > 0 ? operatingPoints : [
      { label: 'breakout', throttle: 1.00, rpm: 4140, thrust_N: 4.73, current_A: 1.41, burst_s: 18 },
      { label: 'heavy_lift', throttle: 0.881, rpm: 3800, thrust_N: 3.99, current_A: 1.25, burst_s: 50 },
      { label: 'cruise', throttle: 0.670, rpm: 3000, thrust_N: 2.49, current_A: 0.85, burst_s: null },
      { label: 'full_dive', throttle: -0.840, rpm: 3650, thrust_N: -2.82, current_A: 1.18, burst_s: 65 }
    ]
  };

  return {
    fields,
    warnings,
    missing,
    vehicle: vSpec,
    raw: text
  };
}
