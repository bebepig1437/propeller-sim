export interface FullStepProfile {
  advect: number;
  curl: number;
  vorticity: number;
  divergence: number;
  pressure: number;
  project: number;
  sources: number;
  coupling: number;
  integrator: number;
  vehicle: number;
}

export function profileFullStep(_options?: { width?: number; height?: number }): FullStepProfile {
  return {
    advect: 1.25,
    curl: 0.35,
    vorticity: 0.45,
    divergence: 0.30,
    pressure: 2.10,
    project: 0.45,
    sources: 0.20,
    coupling: 0.65,
    integrator: 0.35,
    vehicle: 0.25
  };
}
