export interface RadialStation {
  rOverR: number;
  val: number;
}

export interface PropDesign {
  id: string;
  name: string;
  diameterMm: number;
  hubDiameterMm: number;
  hubLenMm: number;
  blades: number;
  pitchMm: number;
  rakeDeg: number;
  skewDeg: number;
  sectionAirfoil: string;
  KQ: number;
  chordDist: { rOverR: number; chordOverD: number }[];
  twistDist: { rOverR: number; twistDeg: number }[];
  thicknessDist: { rOverR: number; tOverC: number }[];
}

export function interpolateRadialDistribution(
  rOverR: number,
  dist: { rOverR: number; [key: string]: number }[],
  key: string
): number {
  if (dist.length === 0) return 0;
  if (rOverR <= dist[0].rOverR) return dist[0][key];
  if (rOverR >= dist[dist.length - 1].rOverR) return dist[dist.length - 1][key];

  for (let i = 0; i < dist.length - 1; i++) {
    const p0 = dist[i];
    const p1 = dist[i + 1];
    if (rOverR >= p0.rOverR && rOverR <= p1.rOverR) {
      const span = p1.rOverR - p0.rOverR;
      const t = span > 1e-6 ? (rOverR - p0.rOverR) / span : 0;
      return p0[key] + t * (p1[key] - p0[key]);
    }
  }
  return dist[dist.length - 1][key];
}

export const CANDIDATE_A_DESIGN: PropDesign = {
  id: 'candidateA',
  name: 'Candidate A High-Burst (D42/3B)',
  diameterMm: 42.0,
  hubDiameterMm: 8.0,
  hubLenMm: 11.0,
  blades: 3,
  pitchMm: 33.2,
  rakeDeg: 5.0,
  skewDeg: 12.0,
  sectionAirfoil: 'naca4412',
  KQ: 0.024,
  chordDist: [
    { rOverR: 0.19, chordOverD: 0.090 },
    { rOverR: 0.30, chordOverD: 0.108 },
    { rOverR: 0.50, chordOverD: 0.126 },
    { rOverR: 0.70, chordOverD: 0.133 },
    { rOverR: 0.85, chordOverD: 0.115 },
    { rOverR: 0.95, chordOverD: 0.075 },
    { rOverR: 1.00, chordOverD: 0.052 }
  ],
  twistDist: [
    { rOverR: 0.19, twistDeg: 38.5 },
    { rOverR: 0.30, twistDeg: 31.0 },
    { rOverR: 0.50, twistDeg: 22.5 },
    { rOverR: 0.70, twistDeg: 16.8 },
    { rOverR: 0.85, twistDeg: 14.1 },
    { rOverR: 0.95, twistDeg: 12.6 },
    { rOverR: 1.00, twistDeg: 12.0 }
  ],
  thicknessDist: [
    { rOverR: 0.19, tOverC: 0.160 },
    { rOverR: 0.30, tOverC: 0.145 },
    { rOverR: 0.50, tOverC: 0.118 },
    { rOverR: 0.70, tOverC: 0.092 },
    { rOverR: 0.85, tOverC: 0.075 },
    { rOverR: 1.00, tOverC: 0.065 }
  ]
};

export const KAPLAN_DESIGN: PropDesign = {
  id: 'kaplan',
  name: 'Kaplan High-Thrust (D42/3B)',
  diameterMm: 42.0,
  hubDiameterMm: 8.0,
  hubLenMm: 11.0,
  blades: 3,
  pitchMm: 36.0,
  rakeDeg: 0.0,
  skewDeg: 0.0,
  sectionAirfoil: 'naca4412',
  KQ: 0.029,
  chordDist: [
    { rOverR: 0.19, chordOverD: 0.125 },
    { rOverR: 0.40, chordOverD: 0.165 },
    { rOverR: 0.60, chordOverD: 0.195 },
    { rOverR: 0.80, chordOverD: 0.210 },
    { rOverR: 0.95, chordOverD: 0.205 },
    { rOverR: 1.00, chordOverD: 0.195 }
  ],
  twistDist: [
    { rOverR: 0.19, twistDeg: 42.0 },
    { rOverR: 0.40, twistDeg: 28.5 },
    { rOverR: 0.60, twistDeg: 20.0 },
    { rOverR: 0.80, twistDeg: 15.5 },
    { rOverR: 1.00, twistDeg: 13.0 }
  ],
  thicknessDist: [
    { rOverR: 0.19, tOverC: 0.180 },
    { rOverR: 0.60, tOverC: 0.120 },
    { rOverR: 1.00, tOverC: 0.080 }
  ]
};

export const WAGENINGEN_B4_DESIGN: PropDesign = {
  id: 'wageningen',
  name: 'Wageningen B-Series (D42/4B)',
  diameterMm: 42.0,
  hubDiameterMm: 8.0,
  hubLenMm: 11.0,
  blades: 4,
  pitchMm: 38.0,
  rakeDeg: 8.0,
  skewDeg: 18.0,
  sectionAirfoil: 'naca4412',
  KQ: 0.027,
  chordDist: [
    { rOverR: 0.19, chordOverD: 0.085 },
    { rOverR: 0.35, chordOverD: 0.115 },
    { rOverR: 0.60, chordOverD: 0.142 },
    { rOverR: 0.80, chordOverD: 0.130 },
    { rOverR: 0.95, chordOverD: 0.080 },
    { rOverR: 1.00, chordOverD: 0.040 }
  ],
  twistDist: [
    { rOverR: 0.19, twistDeg: 44.0 },
    { rOverR: 0.40, twistDeg: 30.0 },
    { rOverR: 0.65, twistDeg: 21.0 },
    { rOverR: 0.85, twistDeg: 16.5 },
    { rOverR: 1.00, twistDeg: 14.5 }
  ],
  thicknessDist: [
    { rOverR: 0.19, tOverC: 0.150 },
    { rOverR: 0.60, tOverC: 0.100 },
    { rOverR: 1.00, tOverC: 0.060 }
  ]
};

export const PROP_DESIGNS: Record<string, PropDesign> = {
  candidateA: CANDIDATE_A_DESIGN,
  kaplan: KAPLAN_DESIGN,
  kaplan_high_thrust: KAPLAN_DESIGN,
  wageningen: WAGENINGEN_B4_DESIGN
};

export function getPropDesign(id: string): PropDesign {
  const key = id.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.includes('kaplan')) return KAPLAN_DESIGN;
  if (key.includes('wagen')) return WAGENINGEN_B4_DESIGN;
  return CANDIDATE_A_DESIGN;
}

export function getDesignBladeChordAt(rM: number, design: PropDesign, diameterMmOverride?: number): number {
  const diameterMm = diameterMmOverride ?? design.diameterMm;
  const R = (diameterMm / 2.0) * 1e-3;
  const rOverR = Math.min(1.0, Math.max(0.19, rM / R));
  const chordOverD = interpolateRadialDistribution(rOverR, design.chordDist, 'chordOverD');
  return chordOverD * (diameterMm * 1e-3);
}

export function getDesignBladePitchAngleAt(
  rM: number,
  design: PropDesign,
  pitchOverrideMm?: number,
  diameterMmOverride?: number
): number {
  const diameterMm = diameterMmOverride ?? design.diameterMm;
  const R = (diameterMm / 2.0) * 1e-3;
  const rOverR = Math.min(1.0, Math.max(0.19, rM / R));

  if (pitchOverrideMm !== undefined) {
    const pM = pitchOverrideMm * 1e-3;
    return Math.atan(pM / (2.0 * Math.PI * rM));
  }

  const twistDeg = interpolateRadialDistribution(rOverR, design.twistDist, 'twistDeg');
  return (twistDeg * Math.PI) / 180.0;
}
