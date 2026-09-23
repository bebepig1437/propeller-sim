import { describe, it, expect } from 'vitest';
import { solveBemt, type BEMTElemResult } from '../src/prop/bemt';
import { makeGrid } from '../src/fluid/grid';
import { solvePressure } from '../src/fluid/pressure';

function assertAllElementFieldsFinite(elements: BEMTElemResult[]) {
  expect(elements.length).toBeGreaterThan(0);
  for (const e of elements) {
    for (const [key, val] of Object.entries(e)) {
      if (typeof val === 'number') {
        expect(Number.isFinite(val), `Element field ${key} must be finite`).toBe(true);
      }
    }
  }
}

describe('NaN guards at known NaN sites', () => {
  it('BEMT returns finite output on all element fields at RPM = 0.5', () => {
    const r = solveBemt(0.5, 1.0);
    assertAllElementFieldsFinite(r.elements);
    expect(Number.isFinite(r.thrustN)).toBe(true);
    expect(Number.isFinite(r.torqueNm)).toBe(true);
  });

  it('BEMT stationary prop (RPM = 0) produces finite nonzero drag fallback', () => {
    const r = solveBemt(0, 1.0);
    assertAllElementFieldsFinite(r.elements);
    expect(r.thrustN).not.toBe(0);
    expect(Number.isFinite(r.thrustN)).toBe(true);
    for (const e of r.elements) {
      expect(e.dT).not.toBe(0);
      expect(Number.isFinite(e.dT)).toBe(true);
    }
  });

  it('BEMT returns finite output on all element fields at reverse inflow', () => {
    const r = solveBemt(3800, -2.0);
    assertAllElementFieldsFinite(r.elements);
    expect(Number.isFinite(r.thrustN)).toBe(true);
    expect(Number.isFinite(r.torqueNm)).toBe(true);
  });

  it('BEMT returns finite output on all element fields at J = 5', () => {
    const r = solveBemt(100, 0.35);
    assertAllElementFieldsFinite(r.elements);
    expect(r.advanceRatioJ).toBeCloseTo(5.0, 1);
    expect(Number.isFinite(r.thrustN)).toBe(true);
    expect(Number.isFinite(r.advanceRatioJ)).toBe(true);
  });

  it('pressure solve with a fully-solid boundary returns finite zero pressure field', () => {
    const g = makeGrid(16, 16);
    g.solid.fill(1);
    const res = solvePressure(g, 10);
    expect(res.finalResidual).toBe(0);
    for (let i = 0; i < g.pressure.length; i++) {
      expect(Number.isFinite(g.pressure[i])).toBe(true);
      expect(g.pressure[i]).toBe(0);
    }
  });
});
