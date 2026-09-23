import { describe, it, expect } from 'vitest';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';

describe('Readback ring slot reuse', () => {
  it('returns frames in strictly increasing dispatch order', () => {
    const s = new GpuFluidSolver({ width: 64, height: 32 });
    const size = (s as any).readbackRingSize ?? 3;
    const seen: number[] = [];
    for (let i = 0; i < size * 5; i++) {
      s.dispatch();
      const f = s.consumeReadback();
      if (f) seen.push((f as any).dispatchIndex);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    }
  });

  it('never returns a frame marked not-ready', () => {
    const s = new GpuFluidSolver({ width: 64, height: 32 });
    for (let i = 0; i < 30; i++) {
      s.dispatch();
      const f = s.consumeReadback();
      if (f) expect((f as any).state ?? 'ready').toBe('ready');
    }
  });

  it('after consuming a slot, the next consumeReadback call returns strictly higher dispatchIndex or null, never same index', () => {
    const s = new GpuFluidSolver({ width: 64, height: 32 });
    let lastConsumedIndex = -1;
    for (let i = 0; i < 20; i++) {
      s.dispatch();
      const first = s.consumeReadback();
      if (first) {
        expect(first.dispatchIndex).toBeGreaterThan(lastConsumedIndex);
        lastConsumedIndex = first.dispatchIndex;

        const second = s.consumeReadback();
        if (second) {
          expect(second.dispatchIndex).toBeGreaterThan(first.dispatchIndex);
          lastConsumedIndex = second.dispatchIndex;
        } else {
          expect(second).toBeNull();
        }
      }
    }
  });
});
