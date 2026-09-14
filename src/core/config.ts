export type AdvectionScheme = 'semi-lagrangian' | 'maccormack';
export type BoundaryConditionType = 'solid' | 'outflow' | 'free-slip';
export type PropellerMaterialType = 'rigid10k' | 'pa12cf15' | 'petg';

export interface SimConfig {
  // Fluid Simulation Tunables
  fluid: {
    nx: number;
    ny: number;
    resolutionPreset: '1024x512' | '512x256' | '256x128';
    backend: 'gpu' | 'cpu';
    pressureMethod: 'jacobi' | 'multigrid';
    compareMode: boolean;
    viscosity: number;
    vorticityStrength: number;
    pressureIterations: number;
    advectionScheme: AdvectionScheme;
    boundaryCondition: BoundaryConditionType;
    inflowActive: boolean;
    inflowVelocity: number;
    inflowRadius: number;
    inflowDyeDensity: number;
  };

  // Motor & Electrical Tunables (Candidate A)
  electrical: {
    supplyVoltage: number;       // V (12.0)
    tetherResistance: number;    // Ohm (0.782)
    tetherLengthFt: number;      // ft (15)
    motorRa: number;             // Ohm (4.50)
    motorIo: number;             // A (0.18)
    motorKv: number;             // RPM/V (907.4)
    motorKt: number;             // Nm/A (0.01171)
    motorKe: number;             // Vs/rad (0.00973)
  };

  // Propeller & Stator Tunables
  propulsion: {
    diameterMm: number;          // mm (42.0)
    hubOdMm: number;             // mm (8.0)
    hubLenMm: number;            // mm (11.0)
    blades: number;              // 3
    pitchMm: number;             // mm (34.0)
    KQ: number;                  // 0.024
    activeMaterial: PropellerMaterialType;
    targetRpm: number;           // RPM (4140)
    advanceSpeedMs: number;      // m/s (0.0)
    couplingEnabled: boolean;    // Two-way fluid-propeller coupling (Phase 5)
    statorIncidenceDeg: number;  // -5.2 deg
    statorSlotChordPct: number;  // 40%
    statorGainN: number;         // 0.04 N
    statorPenaltyN: number;      // 0.09 N
  };

  // Vehicle Dynamics & Hydrostatics
  vehicle: {
    frameMassG: number;          // 39.5 g
    hardwareMassG: number;       // 9.0 g
    motorUnitMassG: number;      // 42.0 g
    motorCount: number;          // 3
    displacedVolumeCm3: number;  // 200.0 cm3
    cobAboveCogMm: number;       // 12.5 mm
    fluidDensityKgM3: number;    // 1000.0 kg/m3
  };

  // Clock & Execution Tunables
  clock: {
    targetFps: number;           // 60 Hz
    fixedDeltaTime: number;      // 1 / 60 s (~0.01667)
    maxSubsteps: number;         // 5 (clamp to avoid spiral of death)
  };

  // Render & Debug
  render: {
    exposure: number;
    fogDensity: number;
    showGroundGrid: boolean;
    showDebugOverlay: boolean;
  };

  // Water & Environment (Phase 3)
  water: {
    surfaceElevation: number;  // m (+0.22)
    waveAmplitude: number;     // m (0.005)
    waveFrequency: number;     // rad/m (2.5)
    waveSpeed: number;         // speed multiplier (1.1)
    foamThreshold: number;     // shear threshold (1.8)
    causticIntensity: number;  // intensity multiplier (1.0)
    surfaceVisible: boolean;   // true
    transmission: number;      // 0.88
    roughness: number;         // 0.04
    sunElevation: number;      // deg (45.0)
    sunAzimuth: number;        // deg (60.0)
  };
}

export const defaultConfig: SimConfig = {
  fluid: {
    nx: 1024,
    ny: 512,
    resolutionPreset: '1024x512',
    backend: 'gpu',
    pressureMethod: 'jacobi',
    compareMode: false,
    viscosity: 0.0001,
    vorticityStrength: 0.25,
    pressureIterations: 30,
    advectionScheme: 'semi-lagrangian',
    boundaryCondition: 'solid',
    inflowActive: true,
    inflowVelocity: 1.5,
    inflowRadius: 10,
    inflowDyeDensity: 1.0
  },
  electrical: {
    supplyVoltage: 12.0,
    tetherResistance: 0.782,
    tetherLengthFt: 15.0,
    motorRa: 4.50,
    motorIo: 0.18,
    motorKv: 907.4,
    motorKt: 0.01171,
    motorKe: 0.00973
  },
  propulsion: {
    diameterMm: 42.0,
    hubOdMm: 8.0,
    hubLenMm: 11.0,
    blades: 3,
    pitchMm: 34.0,
    KQ: 0.024,
    activeMaterial: 'rigid10k',
    targetRpm: 4140,
    advanceSpeedMs: 0.0,
    couplingEnabled: true,
    statorIncidenceDeg: -5.2,
    statorSlotChordPct: 40.0,
    statorGainN: 0.04,
    statorPenaltyN: 0.09
  },
  vehicle: {
    frameMassG: 39.5,
    hardwareMassG: 9.0,
    motorUnitMassG: 42.0,
    motorCount: 3,
    displacedVolumeCm3: 200.0,
    cobAboveCogMm: 12.5,
    fluidDensityKgM3: 1000.0
  },
  clock: {
    targetFps: 60,
    fixedDeltaTime: 1.0 / 60.0,
    maxSubsteps: 5
  },
  render: {
    exposure: 1.1,
    fogDensity: 0.08,
    showGroundGrid: true,
    showDebugOverlay: true
  },
  water: {
    surfaceElevation: 0.22,
    waveAmplitude: 0.005,
    waveFrequency: 2.5,
    waveSpeed: 1.1,
    foamThreshold: 1.8,
    causticIntensity: 1.0,
    surfaceVisible: true,
    transmission: 0.88,
    roughness: 0.04,
    sunElevation: 45.0,
    sunAzimuth: 60.0
  }
};
