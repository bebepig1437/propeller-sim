import { describe, it, expect } from 'vitest';
import { profileFullStep } from '../src/sim/profile';

describe('Per-pass performance budget', () => {
  it('pressure solve under 4 ms', () => {
    const p = profileFullStep({ width: 1024, height: 512 });
    expect(p.pressure).toBeLessThan(4.0);
  });

  it('total step under 16.67 ms', () => {
    const p = profileFullStep({ width: 1024, height: 512 });
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(16.67);
  });

  it('no pass dominates the budget alone', () => {
    const p = profileFullStep({ width: 1024, height: 512 });
    const total = Object.values(p).reduce((a, b) => a + b, 0);
    for (const [name, ms] of Object.entries(p)) {
      expect(ms / total, `${name} dominates`).toBeLessThan(0.5);
    }
  });
});
