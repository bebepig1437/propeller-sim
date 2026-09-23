export const DEBUG = false;

export interface RotorMountTuning {
  id: string;
  surgeM: number;
  swayM: number;
  heaveM: number;
  spinAxis: 'surge' | 'sway' | 'heave';
}

export type AdvectionScheme = 'semi-lagrangian' | 'maccormack';
export type BoundaryConditionType = 'solid' | 'outflow' | 'free-slip';
export type PropellerMaterialType = 'rigid10k' | 'pa12cf15' | 'petg';

export interface SimConfig {
  simulationMode: 'tunnel' | 'pool';
  vehicleDynamicsEnabled: boolean;
  propellerVisualSpinEnabled: boolean;
  tunnel: {
    lengthM: number;
    heightM: number;
    depthM: number;
    inflowVelocity: number;
    wallMode: 'free-slip' | 'no-slip';
  };
  testSection: {
    xFraction: number;
    yFraction: number;
  };
  fluidGrid: {
    width: number;
    height: number;
  };

  fluid: {
    nx: number;
    ny: number;
    resolutionPreset: '384x96' | '256x64' | '1024x512' | '512x256' | '256x128';
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

  electrical: {
    supplyVoltage: number;
    tetherResistance: number;
    tetherLengthFt: number;
    motorRa: number;
    motorIo: number;
    motorKv: number;
    motorKt: number;
    motorKe: number;
  };

  propulsion: {
    diameterMm: number;
    hubOdMm: number;
    hubLenMm: number;
    blades: number;
    pitchMm: number;
    KQ: number;
    activeMaterial: PropellerMaterialType;
    targetRpm: number;
    advanceSpeedMs: number;
    couplingEnabled: boolean;
    statorIncidenceDeg: number;
    statorSlotChordPct: number;
    statorGainN: number;
    statorPenaltyN: number;
  };

  vehicle: {
    frameMassG: number;
    hardwareMassG: number;
    motorUnitMassG: number;
    motorCount: number;
    displacedVolumeCm3: number;
    cobAboveCogMm: number;
    fluidDensityKgM3: number;

    frameLengthM: number;
    frameWidthM: number;
    frameHeightM: number;
    propInertiaZzKgM2: number;

    frameTrussNodeCount: number;
    frameTrussNodeMassFraction: number;
    frameTrussRailMassFraction: number;
    frameTrussCornerHalfGapM: number;
    rotorMounts: RotorMountTuning[];

    dragCdASurge: number;
    dragCdASway: number;
    dragCdAHeave: number;
    dragLinSurge: number;
    dragLinSway: number;
    dragLinHeave: number;
    rotDragQuadRoll: number;
    rotDragQuadPitch: number;
    rotDragQuadYaw: number;
    rotDragLinRoll: number;
    rotDragLinPitch: number;
    rotDragLinYaw: number;

    addedMassTranslationalScale: number;
    addedMassSurgeFactor: number;
    addedMassSwayFactor: number;
    addedMassHeaveFactor: number;
    addedMassRollFactor: number;
    addedMassPitchFactor: number;
    addedMassYawFactor: number;

    tetherAttached: boolean;
    tetherAnchorWorld: [number, number, number];
    tetherStiffnessNm: number;
    tetherDamping: number;

    vehicleSubstepDivider: number;
    angularRateClampRadS: number;
  };

  clock: {
    targetFps: number;
    fixedDeltaTime: number;
    maxSubsteps: number;
  };

  render: {
    exposure: number;
    fogDensity: number;
    showGroundGrid: boolean;
    showDebugOverlay: boolean;
  };

  water: {
    surfaceElevation: number;
    waveAmplitude: number;
    waveFrequency: number;
    waveSpeed: number;
    foamThreshold: number;
    causticIntensity: number;
    surfaceVisible: boolean;
    transmission: number;
    roughness: number;
    sunElevation: number;
    sunAzimuth: number;
  };
}

export const defaultConfig: SimConfig = {
  simulationMode: 'tunnel',
  vehicleDynamicsEnabled: false,
  propellerVisualSpinEnabled: false,
  tunnel: {
    lengthM: 2.4,
    heightM: 0.5,
    depthM: 0.5,
    inflowVelocity: 1.5,
    wallMode: 'free-slip'
  },
  testSection: {
    xFraction: 0.25,
    yFraction: 0.50
  },
  fluidGrid: {
    width: 256,
    height: 64
  },
  fluid: {
    nx: 256,
    ny: 64,
    resolutionPreset: '256x64',
    backend: 'gpu',
    pressureMethod: 'jacobi',
    compareMode: false,
    viscosity: 0.0001,
    vorticityStrength: 0.25,
    pressureIterations: 24,
    advectionScheme: 'semi-lagrangian',
    boundaryCondition: 'free-slip',
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
    fluidDensityKgM3: 1000.0,

    frameLengthM: 0.20,
    frameWidthM: 0.16,
    frameHeightM: 0.14,
    propInertiaZzKgM2: 3.92e-7,

    frameTrussNodeCount: 8,
    frameTrussNodeMassFraction: 0.6,
    frameTrussRailMassFraction: 0.4,
    frameTrussCornerHalfGapM: 0.088,
    rotorMounts: [
      { id: 'port', surgeM: 0.0, swayM: -0.075, heaveM: 0.0, spinAxis: 'surge' },
      { id: 'starboard', surgeM: 0.0, swayM: 0.075, heaveM: 0.0, spinAxis: 'surge' },
      { id: 'vertical', surgeM: 0.0, swayM: 0.0, heaveM: 0.0, spinAxis: 'heave' }
    ],

    dragCdASurge: 0.0079,
    dragCdASway: 0.0129,
    dragCdAHeave: 0.0227,
    dragLinSurge: 0.15,
    dragLinSway: 0.35,
    dragLinHeave: 0.45,
    rotDragQuadRoll: 4.5e-4,
    rotDragQuadPitch: 9.5e-4,
    rotDragQuadYaw: 8.5e-4,
    rotDragLinRoll: 0.005,
    rotDragLinPitch: 0.008,
    rotDragLinYaw: 0.008,

    addedMassTranslationalScale: 1.0,
    addedMassSurgeFactor: 0.85,
    addedMassSwayFactor: 1.0,
    addedMassHeaveFactor: 1.2,
    addedMassRollFactor: 0.00075,
    addedMassPitchFactor: 0.00125,
    addedMassYawFactor: 0.0011,

    tetherAttached: false,
    tetherAnchorWorld: [0, 0.22, 0],
    tetherStiffnessNm: 0.8,
    tetherDamping: 0.35,

    vehicleSubstepDivider: 2,
    angularRateClampRadS: 10.0
  },
  clock: {
    targetFps: 60,
    fixedDeltaTime: 1.0 / 60.0,
    maxSubsteps: 4
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
