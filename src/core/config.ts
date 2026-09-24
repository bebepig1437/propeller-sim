export const DEBUG = false;

export type AdvectionScheme = 'semi-lagrangian' | 'maccormack';
export type BoundaryConditionType = 'solid' | 'outflow' | 'free-slip';
export type PropellerMaterialType = 'rigid10k' | 'pa12cf15' | 'petg';

export interface SimConfig {
  simulationMode: 'tunnel';
  pipe: {
    lengthM: number;
    radiusM: number;
  };
  tunnel: {
    lengthM: number;
    heightM: number;
    depthM: number;
    inflowVelocity: number;
    wallMode: 'free-slip' | 'no-slip';
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
    lengthM: 1.0,
    radiusM: 0.06
  },
  tunnel: {
    lengthM: 1.0,
    heightM: 0.12,
    depthM: 0.12,
    inflowVelocity: 1.5,
    wallMode: 'free-slip'
  },
  fluidGrid: {
    width: 256,
    height: 64
  },
  fluid: {
    nx: 256,
    ny: 64,
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
    maxSubsteps: 4
  }
};
