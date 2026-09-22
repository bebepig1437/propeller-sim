/**
 * SIMULATION CONFIGURATION & COORDINATE CONVENTIONS
 *
 * Coordinate system (right-handed):
 *   +X: Downstream / Starboard in 2D fluid grid (+X downstream)
 *   +Y: Up (anti-gravity, towards water surface)
 *   +Z: Into screen / Aft (viewer facing)
 *
 * All internal calculations use strict SI units (m, s, kg, N, Nm, W, V, A, rad).
 * Display units are converted exclusively in UI layer.
 * See CONVENTIONS.md for official signs, frames, and marine SNAME dynamics.
 */
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

    // Frame geometry (mirrors public/vehicles/candidateA.json "geometry" section)
    frameLengthM: number;        // Surge extent, 0.20 m
    frameWidthM: number;         // Sway extent, 0.16 m
    frameHeightM: number;        // Heave extent, 0.14 m
    propInertiaZzKgM2: number;   // Single prop spin-axis inertia (Rigid 10K: 3.92e-7)

    // Frame truss lumped-mass model (mirrors candidateA.json "geometry.frame_truss"):
    // the inertia tensor is built from these 8 corner nodes + 12 rail midpoints.
    frameTrussNodeCount: number;          // 8 corner nodes
    frameTrussNodeMassFraction: number;   // 0.6 of frame mass in nodes
    frameTrussRailMassFraction: number;   // 0.4 in the 12 rails
    frameTrussCornerHalfGapM: number;     // 0.088 m CoG→corner offset
    rotorMounts: RotorMountTuning[];      // marine body mount points + spin axes

    // Quadratic drag Cd*A (m^2) — frame-face derived, see src/vehicle/drag.ts provenance
    dragCdASurge: number;
    dragCdASway: number;
    dragCdAHeave: number;
    // Linear viscous drag (N·s/m) per body axis — dominates at creeping speeds
    dragLinSurge: number;
    dragLinSway: number;
    dragLinHeave: number;
    // Rotational drag: quadratic c_rot |w|w + linear c_lin w, per body axis
    rotDragQuadRoll: number;
    rotDragQuadPitch: number;
    rotDragQuadYaw: number;
    rotDragLinRoll: number;
    rotDragLinPitch: number;
    rotDragLinYaw: number;

    // Added-mass coefficients (multiples of 0.5 * rho * V_displaced for translation;
    // ellipsoid-coefficient rotational diagonal). See vehicle/body.ts derivation.
    addedMassTranslationalScale: number; // default 1.0 -> 0.5 * rho * V per axis base
    addedMassSurgeFactor: number;        // 0.85 (slender along surge)
    addedMassSwayFactor: number;         // 1.00
    addedMassHeaveFactor: number;        // 1.20 (flat top/bottom plates entrain more)
    addedMassRollFactor: number;
    addedMassPitchFactor: number;
    addedMassYawFactor: number;

    // Tether (spring to anchor when attached)
    tetherAttached: boolean;      // default false: free-swimming vehicle
    tetherAnchorWorld: [number, number, number]; // spring anchor, world frame
    tetherStiffnessNm: number;    // spring constant k (N/m)
    tetherDamping: number;        // damping c (N·s/m)

    // Integrator
    vehicleSubstepDivider: number; // 2 -> vehicle steps at 2x fluid rate (1/120 s)
    angularRateClampRadS: number;  // energy-injection guard for explicit Euler (10 rad/s)
  };

  // Clock & Execution Tunables
  clock: {
    targetFps: number;           // 60 Hz
    fixedDeltaTime: number;      // 1 / 60 s (~0.01667)
    maxSubsteps: number;         // 4 (clamp to avoid spiral of death)
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
    fluidDensityKgM3: 1000.0,

    // Frame geometry — candidateA.json "geometry" section (0.20 x 0.16 x 0.14 m)
    frameLengthM: 0.20,
    frameWidthM: 0.16,
    frameHeightM: 0.14,
    propInertiaZzKgM2: 3.92e-7, // Rigid 10K single prop

    // Frame truss lumped-mass model (candidateA.json geometry.frame_truss)
    frameTrussNodeCount: 8,
    frameTrussNodeMassFraction: 0.6,
    frameTrussRailMassFraction: 0.4,
    frameTrussCornerHalfGapM: 0.088,
    rotorMounts: [
      { id: 'port', surgeM: 0.0, swayM: -0.075, heaveM: 0.0, spinAxis: 'surge' },
      { id: 'starboard', surgeM: 0.0, swayM: 0.075, heaveM: 0.0, spinAxis: 'surge' },
      { id: 'vertical', surgeM: 0.0, swayM: 0.0, heaveM: 0.0, spinAxis: 'heave' }
    ],

    // Quadratic drag Cd*A (m^2) — frame-face derived, see src/vehicle/drag.ts provenance
    dragCdASurge: 0.0079,
    dragCdASway: 0.0129,
    dragCdAHeave: 0.0227,
    dragLinSurge: 0.15,
    dragLinSway: 0.35,
    dragLinHeave: 0.45,
    // Rotational damping (quadratic N·m·s²/rad², linear N·m·s/rad) per body axis
    rotDragQuadRoll: 4.5e-4,
    rotDragQuadPitch: 9.5e-4,
    rotDragQuadYaw: 8.5e-4,
    rotDragLinRoll: 0.005,
    rotDragLinPitch: 0.008,
    rotDragLinYaw: 0.008,

    // Added mass — factors on 0.5*rho*V = 0.1 kg translational base (see body.ts)
    addedMassTranslationalScale: 1.0,
    addedMassSurgeFactor: 0.85,
    addedMassSwayFactor: 1.0,
    addedMassHeaveFactor: 1.2,
    // Rotational diagonal from bounding-ellipsoid shape factors (body.ts)
    addedMassRollFactor: 0.00075,
    addedMassPitchFactor: 0.00125,
    addedMassYawFactor: 0.0011,

    // Tether spring (free-swimming by default)
    tetherAttached: false,
    tetherAnchorWorld: [0, 0.22, 0], // surface supply point
    tetherStiffnessNm: 0.8,
    tetherDamping: 0.35,

    // Integrator
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
