import type { FluidGrid } from './grid';

export interface InflowJetConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  dyeDensity: number;
  enabled: boolean;
}

export class InflowJet {
  public config: InflowJetConfig;

  constructor(config?: Partial<InflowJetConfig>) {
    this.config = {
      x: config?.x ?? 2,
      y: config?.y ?? 56,
      width: config?.width ?? 6,
      height: config?.height ?? 16,
      vx: config?.vx ?? 2.5,
      vy: config?.vy ?? 0.0,
      dyeDensity: config?.dyeDensity ?? 1.0,
      enabled: config?.enabled ?? true
    };
  }

  public inject(grid: FluidGrid, simTime = 0): void {
    if (!this.config.enabled) return;

    const W = grid.width;
    const H = grid.height;
    const u = grid.u;
    const v = grid.v;
    const dye = grid.dye;

    const xStart = Math.max(1, Math.floor(this.config.x));
    const xEnd = Math.min(W - 2, Math.floor(this.config.x + this.config.width));
    const yStart = Math.max(1, Math.floor(this.config.y));
    const yEnd = Math.min(H - 2, Math.floor(this.config.y + this.config.height));

    // Slight periodic swirl perturbation to initiate interesting Kelvin-Helmholtz vortex shedding
    const perturbation = Math.sin(simTime * 8.0) * 0.15 * this.config.vx;

    for (let y = yStart; y <= yEnd; y++) {
      const rowOffset = y * W;
      // Smooth parabolic profile across jet opening
      const yNorm = ((y - yStart) / (yEnd - yStart) - 0.5) * 2.0; // [-1, 1]
      const profile = Math.max(0, 1.0 - yNorm * yNorm);

      for (let x = xStart; x <= xEnd; x++) {
        const idx = rowOffset + x;
        u[idx] = this.config.vx * profile;
        v[idx] = (this.config.vy + perturbation) * profile;
        dye[idx] = Math.min(1.0, dye[idx] + this.config.dyeDensity * profile);
      }
    }
  }

  public triggerBurst(grid: FluidGrid, strength = 3.0): void {
    const origVx = this.config.vx;
    this.config.vx *= strength;
    this.inject(grid);
    this.config.vx = origVx;
  }
}
