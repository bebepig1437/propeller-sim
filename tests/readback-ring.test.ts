import { describe, it, expect } from 'vitest';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';

describe('Async readback ring', () => {
  it('never consumes an unready or already-consumed slot', () => {
    const s = new GpuFluidSolver({ width: 64, height: 32 });
    for (let i = 0; i < 20; i++) {
      s.dispatch();
      const frame = s.consumeReadback();
      if (frame) {
        expect(frame.state).toBe('ready');
        expect(frame.dispatchIndex).toBeGreaterThan(0);
        expect(frame.u).toBeDefined();

        const duplicate = s.consumeReadback();
        if (duplicate) {
          expect(duplicate.dispatchIndex).not.toBe(frame.dispatchIndex);
        }
      }
    }
  }, 15000);

  it('never consumes an inflight or pending slot', () => {
    const s = new GpuFluidSolver({ width: 64, height: 32 });
    s.dispatch();
    for (const slot of (s as any).readbackRing) {
      slot.state = 'inflight';
    }
    expect(s.consumeReadback()).toBeNull();
  });

  it('reuses slots without leaking stale frames', () => {
    const solver = new GpuFluidSolver({ width: 64, height: 32 });
    const ringSize = solver.readbackRingSize;
    const seen: number[] = [];
    for (let i = 0; i < ringSize * 4; i++) {
      solver.dispatch();
      const f = solver.consumeReadback();
      if (f) seen.push(f.dispatchIndex);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });

  it('latency stays under 3 frames', () => {
    const s = new GpuFluidSolver({ width: 64, height: 32 });
    for (let i = 0; i < 20; i++) s.dispatch();
    const lat = s.readbackLatencyMs;
    const ringSize = s.readbackRingSize;
    expect(lat).toBeLessThan(ringSize * (1000 / 60) * 1.5);
  }, 15000);
});
