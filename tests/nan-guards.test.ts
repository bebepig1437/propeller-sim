import { describe, it, expect } from 'vitest';
import { solveBemt } from '../src/prop/bemt';
import { makeGrid } from '../src/fluid/grid';
import { solvePressure } from '../src/fluid/pressure';

describe('NaN guards at known NaN sites', () => {
  it('BEMT returns finite output at RPM = 0.5 with inflow', () => {
    const r = solveBemt({ rpm: 0.5, advanceSpeedMs: 1.0, pitchDeg: 10, designId: 'candidateA' });
    for (const e of r.elements) {
      expect(Number.isFinite(e.dT)).toBe(true);
      expect(Number.isFinite(e.dQ)).toBe(true);
    }
  });

  it('BEMT returns finite output at reverse inflow', () => {
    const r = solveBemt({ rpm: 3800, advanceSpeedMs: -2.0, pitchDeg: 10, designId: 'candidateA' });
    expect(Number.isFinite(r.thrustN)).toBe(true);
    expect(Number.isFinite(r.torqueNm)).toBe(true);
  });

  it('BEMT returns finite output at very high advance ratio', () => {
    const r = solveBemt({ rpm: 100, advanceSpeedMs: 20, pitchDeg: 10, designId: 'candidateA' });
    expect(Number.isFinite(r.thrustN)).toBe(true);
  });

  it('pressure solve with a fully-solid boundary does not divide by zero', () => {
    const g = makeGrid(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const idx = y * 16 + x;
        g.solid[idx] = 1;
      }
    }
    expect(() => solvePressure(g, 10)).not.toThrow();
  });
});
