/**
 * Propeller rotational inertia and angular dynamics.
 * Supports Candidate A materials: Rigid 10K, PA12-CF15, PETG.
 */

export type PropellerMaterial = 'rigid10k' | 'pa12cf15' | 'petg';

export interface MaterialSpec {
  name: string;
  densityKgM3: number;
  massGrams: number;
  youngsModulusGpa: number;
  dampingRatio: number;
}

export const MATERIAL_SPECS: Record<PropellerMaterial, MaterialSpec> = {
  rigid10k: {
    name: 'Formlabs Rigid 10K (Nanoparticle SLA)',
    densityKgM3: 1650,
    massGrams: 1.80,
    youngsModulusGpa: 10.0,
    dampingRatio: 0.015
  },
  pa12cf15: {
    name: 'PA12-CF15 (Carbon-Fiber Nylon SLS)',
    densityKgM3: 1150,
    massGrams: 1.25,
    youngsModulusGpa: 8.5,
    dampingRatio: 0.035
  },
  petg: {
    name: 'PETG (FDM Standard Co-polyester)',
    densityKgM3: 1270,
    massGrams: 1.38,
    youngsModulusGpa: 2.1,
    dampingRatio: 0.050
  }
};

export interface InertiaBreakdown {
  material: PropellerMaterial;
  massTotalGrams: number;
  hubMassGrams: number;
  bladesMassGrams: number;
  iHubKgM2: number;
  iBladesKgM2: number;
  iDryKgM2: number;
  iAddedMassWaterKgM2: number;
  iTotalEffectiveKgM2: number;
  spinUpTimeConstantMs: number;
}

/**
 * Calculates accurate polar moment of inertia (I_xx) about the rotation axis
 * for 42mm marine propeller with 8mm hub and 3 blades.
 */
export function calculatePropellerInertia(
  material: PropellerMaterial,
  diameterMm = 42.0,
  hubOdMm = 8.0,
  hubLenMm = 11.0,
  boreDiameterMm = 2.0
): InertiaBreakdown {
  const spec = MATERIAL_SPECS[material];
  const totalMassG = spec.massGrams;
  const totalMassKg = totalMassG * 1e-3;

  const R = (diameterMm / 2.0) * 1e-3;
  const Rhub = (hubOdMm / 2.0) * 1e-3;
  const Rbore = (boreDiameterMm / 2.0) * 1e-3;
  const Lhub = hubLenMm * 1e-3;

  // Hub geometric volume (cylinder with central bore)
  const hubVolumeM3 = Math.PI * (Rhub * Rhub - Rbore * Rbore) * Lhub;
  const hubMassKg = Math.min(totalMassKg * 0.45, hubVolumeM3 * spec.densityKgM3);
  const bladesMassKg = Math.max(0.0001, totalMassKg - hubMassKg);

  // Hub polar moment of inertia (thick cylinder)
  // I_hub = 0.5 * m_hub * (R_hub^2 + R_bore^2)
  const iHub = 0.5 * hubMassKg * (Rhub * Rhub + Rbore * Rbore);

  // Blades polar moment of inertia
  // Each blade mass element dm(r) is integrated from Rhub to R:
  // For standard tapered blade, radius of gyration k_blade ~ 0.62 * R
  const kBlade = 0.62 * R;
  const iBlades = bladesMassKg * (kBlade * kBlade);

  const iDry = iHub + iBlades;

  // Hydrodynamic added mass moment of inertia for propeller rotating in water
  // I_added ~ 0.25 * rho_water * R^5 (Lewis / SNAME marine hydrodynamic convention)
  const rhoWater = 1000.0;
  const iAddedMass = 0.22 * rhoWater * Math.pow(R, 5);

  const iTotalEffective = iDry + iAddedMass;

  // Estimated spin-up electrical-mechanical time constant:
  // tau = I_total * omega_rated / Q_stall (at 0.026 Nm stall torque, 4140 RPM)
  const omegaRated = (4140 * 2 * Math.PI) / 60.0;
  const stallTorqueNm = 0.0260;
  const spinUpTimeConstantMs = (iTotalEffective * omegaRated / stallTorqueNm) * 1000.0;

  return {
    material,
    massTotalGrams: totalMassG,
    hubMassGrams: hubMassKg * 1e3,
    bladesMassGrams: bladesMassKg * 1e3,
    iHubKgM2: iHub,
    iBladesKgM2: iBlades,
    iDryKgM2: iDry,
    iAddedMassWaterKgM2: iAddedMass,
    iTotalEffectiveKgM2: iTotalEffective,
    spinUpTimeConstantMs
  };
}

/**
 * Calculates angular acceleration given motor drive torque and hydrodynamic load:
 * alpha = (Q_motor - Q_hydro) / I_effective
 */
export function calculateAngularAcceleration(
  qMotorNm: number,
  qHydroNm: number,
  iTotalKgM2: number
): number {
  return (qMotorNm - qHydroNm) / Math.max(1e-9, iTotalKgM2);
}
