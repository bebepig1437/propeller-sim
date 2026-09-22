

import { FluidGrid } from './grid';

export interface TemporalUpsamplerOptions {
  targetWidth: number;
  targetHeight: number;
  historyWeight?: number;
}

export class TemporalUpsampler {
  public targetWidth: number;
  public targetHeight: number;
  public historyWeight: number;

  private prevBuffer: Float32Array;
  private currentBuffer: Float32Array;
  private isFirstFrame = true;

  constructor(options: TemporalUpsamplerOptions) {
    this.targetWidth = options.targetWidth;
    this.targetHeight = options.targetHeight;
    this.historyWeight = options.historyWeight ?? 0.82;

    const size = this.targetWidth * this.targetHeight;
    this.prevBuffer = new Float32Array(size);
    this.currentBuffer = new Float32Array(size);
  }

  public resize(width: number, height: number): void {
    if (this.targetWidth === width && this.targetHeight === height) return;
    this.targetWidth = width;
    this.targetHeight = height;
    const size = width * height;
    this.prevBuffer = new Float32Array(size);
    this.currentBuffer = new Float32Array(size);
    this.isFirstFrame = true;
  }

  public reset(): void {
    this.prevBuffer.fill(0);
    this.currentBuffer.fill(0);
    this.isFirstFrame = true;
  }

  public upsample(
    grid: FluidGrid,
    sourceField: Float32Array,
    dt: number,
    outBuffer?: Float32Array
  ): Float32Array {
    const Wt = this.targetWidth;
    const Ht = this.targetHeight;
    const Wg = grid.width;
    const Hg = grid.height;

    const out = outBuffer ?? this.currentBuffer;
    const prev = this.prevBuffer;
    const alpha = this.isFirstFrame ? 0.0 : this.historyWeight;

    const scaleX = (Wg - 1) / Math.max(1, Wt - 1);
    const scaleY = (Hg - 1) / Math.max(1, Ht - 1);
    const pixelVelScaleX = (Wt / Wg) / grid.dx;
    const pixelVelScaleY = (Ht / Hg) / grid.dx;

    for (let Y = 0; Y < Ht; Y++) {
      const gy = Y * scaleY;
      const targetRow = Y * Wt;

      for (let X = 0; X < Wt; X++) {
        const gx = X * scaleX;
        const targetIdx = targetRow + X;

        const currentSample = grid.sampleBilinear(sourceField, gx, gy);

        if (this.isFirstFrame) {
          out[targetIdx] = currentSample;
          continue;
        }

        const u = grid.sampleBilinear(grid.u, gx, gy);
        const v = grid.sampleBilinear(grid.v, gx, gy);

        const prevX = X - u * pixelVelScaleX * dt;
        const prevY = Y - v * pixelVelScaleY * dt;

        let historySample = currentSample;

        if (prevX >= 0 && prevX < Wt - 1 && prevY >= 0 && prevY < Ht - 1) {
          const px0 = Math.floor(prevX);
          const py0 = Math.floor(prevY);
          const px1 = px0 + 1;
          const py1 = py0 + 1;
          const fx = prevX - px0;
          const fy = prevY - py0;

          const p00 = prev[py0 * Wt + px0];
          const p10 = prev[py0 * Wt + px1];
          const p01 = prev[py1 * Wt + px0];
          const p11 = prev[py1 * Wt + px1];

          historySample = (1 - fy) * ((1 - fx) * p00 + fx * p10) + fy * ((1 - fx) * p01 + fx * p11);

          const minNeighbor = Math.min(p00, p10, p01, p11, currentSample);
          const maxNeighbor = Math.max(p00, p10, p01, p11, currentSample);
          historySample = Math.max(minNeighbor, Math.min(maxNeighbor, historySample));
        }

        out[targetIdx] = (1.0 - alpha) * currentSample + alpha * historySample;
      }
    }

    this.prevBuffer.set(out);
    this.isFirstFrame = false;
    return out;
  }
}
