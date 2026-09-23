import { describe, it, expect } from 'vitest';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';

describe('Async readback ring', () => {
  it('never consumes a pending slot', () => {
    const s = new GpuFluidSolver({ width: 64, height: 32 });
    for (let i = 0; i < 20; i++) {
      s.dispatch();
      const frame = s.consumeReadback();
      if (frame) {
        expect(frame.pending).toBe(false);
      }
    }
  }, 15000);

  it('latency stays under 3 frames', () => {
    const s = new GpuFluidSolver({ width: 64, height: 32 });
    for (let i = 0; i < 20; i++) s.dispatch();
    const lat = s.readbackLatencyMs;
    expect(lat).toBeLessThan(50);
  }, 15000);
});
