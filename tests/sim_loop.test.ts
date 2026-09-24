import { describe, it, expect } from 'vitest';
import { SimClock } from '../src/core/clock';

describe('fixed_dt_stability', () => {
  it('advances physics only in exact fixed slices regardless of frame delta jitter', () => {
    const clock = new SimClock(1 / 60, 4);
    clock.start(0);

    let elapsedS = 0;
    let maxDeviationS = 0;
    const step = (dt: number) => {
      elapsedS += dt;
      maxDeviationS = Math.max(maxDeviationS, Math.abs(dt - 1 / 60));
    };

    const frameDeltasMs = [10, 12, 33, 41, 8, 100, 15, 27, 64, 5, 23, 90, 16, 14, 100, 11];
    let timeMs = 0;
    let totalSubsteps = 0;

    for (const deltaMs of frameDeltasMs) {
      timeMs += deltaMs;
      const alpha = clock.tick(timeMs, step);
      totalSubsteps += clock.getSubstepsExecuted();
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }

    expect(maxDeviationS).toBe(0);
    const expectedSimSeconds = (totalSubsteps * 1) / 60;
    expect(elapsedS).toBeCloseTo(expectedSimSeconds, 12);
    expect(totalSubsteps).toBeGreaterThan(10);
  });

  it('drops accumulated time instead of spiraling when the frame budget collapses', () => {
    const clock = new SimClock(1 / 60, 4);
    clock.start(0);

    let substeps = 0;
    for (let frame = 1; frame <= 5; frame++) {
      clock.tick(frame * 250, () => substeps++);
    }

    expect(clock.getSubstepsExecuted()).toBe(4);
    expect(substeps).toBe(20);
    expect(clock.getDroppedTimeS()).toBeGreaterThan(0);
    expect(clock.getAlpha()).toBeLessThan(1);
  });

  it('reproduces the same simulated elapsed time for any frame pacing that covers the same wall time', () => {
    const fast = new SimClock(1 / 60, 4);
    const slow = new SimClock(1 / 60, 4);
    fast.start(0);
    slow.start(0);

    let fastAdvancedS = 0;
    let slowAdvancedS = 0;
    for (let frame = 1; frame <= 120; frame++) {
      fast.tick(frame * 16.6, (dt) => {
        fastAdvancedS += dt;
      });
      if (frame % 2 === 0) {
        slow.tick((frame / 2) * 33.2, (dt) => {
          slowAdvancedS += dt;
        });
      }
    }

    expect(Math.abs(fastAdvancedS - slowAdvancedS)).toBeLessThan(0.01);
    expect(fast.getFixedDeltaTime()).toBe(slow.getFixedDeltaTime());
  });
});
