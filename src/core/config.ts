export const DEBUG = false;

export type AdvectionScheme = 'semi-lagrangian' | 'maccormack';
export type BoundaryConditionType = 'solid' | 'outflow' | 'free-slip';
export type PropellerMaterialType = 'rigid10k' | 'pa12cf15' | 'petg';
export type SimulationMedium = 'water' | 'air';

export interface MediumProperties {
  density: number;
  dynamicViscosity: number;
}

export const MEDIUMS: Record<SimulationMedium, MediumProperties> = {
  air: { density: 1.225, dynamicViscosity: 1.81e-5 },
  water: { density: 1000.0, dynamicViscosity: 1.002e-3 }
};

export interface SimConfig {
  simulationMode: 'tunnel';
  pipe: {
    lengthM: number;
    radiusM: number;
    diameterM: number;
    propellerXFraction: number;
  };
  tunnel: {
    lengthM: number;
    diameterM: number;
    radiusM: number;
    heightM: number;
    depthM: number;
    inflowVelocity: number;
    wallMode: 'free-slip' | 'no-slip';
    propellerXFraction: number;
  };
  fluidGrid: {
    width: number;
    height: number;
  };
  fluid: {
    nx: number;
    ny: number;
    backend: 'gpu' | 'cpu';
    viscosity: number;
    vorticityStrength: number;
    pressureIterations: number;
    inflowActive: boolean;
    inflowVelocity: number;
  };
  electrical: {
    supplyVoltage: number;
    tetherResistance: number;
    motorRa: number;
    motorIo: number;
    motorKv: number;
    motorKt: number;
    motorKe: number;
  };
  propulsion: {
    designId: string;
    diameterMm: number;
    blades: number;
    pitchMm: number;
    targetRpm: number;
    minRpm: number;
    maxRpm: number;
  };
  clock: {
    targetFps: number;
    fixedDeltaTime: number;
    maxSubsteps: number;
    timeScale: number;
  };
  visualization: {
    timeScale: number;
    mode: 'dye_velocity' | 'dye_vorticity' | 'off';
    showWakeEnvelope: boolean;
    showVelocityVectors: boolean;
    showTipVortices: boolean;
    showParticleTracers: boolean;
  };
}

export const ACCENT_COLORS = {
  thrust: 0xff7700,
  torque: 0xd946ef,
  inflow: 0x3b82f6,
  neutral: 0x64748b,
  current: 0x00f2ff
};

export const defaultConfig: SimConfig = {
  simulationMode: 'tunnel',
  pipe: {
    lengthM: 0.190,
    radiusM: 0.055,
    diameterM: 0.110,
    propellerXFraction: 0.40
  },
  tunnel: {
    lengthM: 0.190,
    diameterM: 0.110,
    radiusM: 0.055,
    heightM: 0.110,
    depthM: 0.110,
    inflowVelocity: 1.5,
    wallMode: 'free-slip',
    propellerXFraction: 0.40
  },
  fluidGrid: {
    width: 256,
    height: 128
  },
  fluid: {
    nx: 256,
    ny: 128,
    backend: 'gpu',
    viscosity: 0.0001,
    vorticityStrength: 0.25,
    pressureIterations: 24,
    inflowActive: true,
    inflowVelocity: 1.5
  },
  electrical: {
    supplyVoltage: 12.0,
    tetherResistance: 0.782,
    motorRa: 4.50,
    motorIo: 0.18,
    motorKv: 907.4,
    motorKt: 0.01171,
    motorKe: 0.00973
  },
  propulsion: {
    designId: 'candidateA',
    diameterMm: 42.0,
    blades: 3,
    pitchMm: 34.0,
    targetRpm: 4140,
    minRpm: 0,
    maxRpm: 6000
  },
  clock: {
    targetFps: 60,
    fixedDeltaTime: 1.0 / 60.0,
    maxSubsteps: 120,
    timeScale: 1.0
  },
  visualization: {
    timeScale: 1.0,
    mode: 'dye_velocity',
    showWakeEnvelope: false,
    showVelocityVectors: false,
    showTipVortices: true,
    showParticleTracers: true
  }
};
