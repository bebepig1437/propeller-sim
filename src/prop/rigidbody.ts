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

  const hubVolumeM3 = Math.PI * (Rhub * Rhub - Rbore * Rbore) * Lhub;
  const hubMassKg = Math.min(totalMassKg * 0.45, hubVolumeM3 * spec.densityKgM3);
  const bladesMassKg = Math.max(0.0001, totalMassKg - hubMassKg);

  const iHub = 0.5 * hubMassKg * (Rhub * Rhub + Rbore * Rbore);

  const kBlade = 0.62 * R;
  const iBlades = bladesMassKg * (kBlade * kBlade);

  const iDry = iHub + iBlades;

  const rhoWater = 1000.0;
  const iAddedMass = 0.22 * rhoWater * Math.pow(R, 5);

  const iTotalEffective = iDry + iAddedMass;

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

export function calculateAngularAcceleration(
  qMotorNm: number,
  qHydroNm: number,
  iTotalKgM2: number
): number {
  return (qMotorNm - qHydroNm) / Math.max(1e-9, iTotalKgM2);
}

export class PropellerShaft {
  public commandedRpm = 0;
  public currentRpm = 0;
  public commandedPitchDeg = 18.0;
  public currentPitchDeg = 18.0;
  public bladePhaseRad = 0;
  public tauRpm = 0.15;
  public tauPitch = 0.05;

  constructor(initialRpm = 0, initialPitchDeg = 18.0) {
    this.commandedRpm = initialRpm;
    this.currentRpm = initialRpm;
    this.commandedPitchDeg = initialPitchDeg;
    this.currentPitchDeg = initialPitchDeg;
  }

  public update(dt: number): void {
    if (dt <= 0) return;

    const alphaRpm = Math.min(1.0, dt / Math.max(1e-3, this.tauRpm));
    this.currentRpm += (this.commandedRpm - this.currentRpm) * alphaRpm;

    const alphaPitch = Math.min(1.0, dt / Math.max(1e-3, this.tauPitch));
    this.currentPitchDeg += (this.commandedPitchDeg - this.currentPitchDeg) * alphaPitch;

    const omega = (this.currentRpm * 2.0 * Math.PI) / 60.0;
    this.bladePhaseRad = (this.bladePhaseRad + omega * dt) % (2.0 * Math.PI);
  }

  public getBlurAlpha(): number {
    const absRpm = Math.abs(this.currentRpm);
    if (absRpm < 500) return 0.0;
    return Math.min(1.0, (absRpm - 500) / 1500.0);
  }
}
