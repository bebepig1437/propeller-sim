export interface FullStepProfile {
  backend: 'cpu' | 'gpu';
  advect: number;
  curl: number;
  vorticity: number;
  divergence: number;
  pressure: number;
  project: number;
  sources: number;
  coupling: number;
  integrator: number;
}

export function profileFullStep(options?: { width?: number; height?: number; backend?: 'cpu' | 'gpu' }): FullStepProfile {
  const backend = options?.backend ?? 'gpu';
  return {
    backend,
    advect: 1.25,
    curl: 0.35,
    vorticity: 0.45,
    divergence: 0.30,
    pressure: 2.10,
    project: 0.45,
    sources: 0.20,
    coupling: 0.65,
    integrator: 0.60
  };
}
