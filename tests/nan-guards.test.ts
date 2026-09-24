import { describe, it, expect } from 'vitest';
import { solveBemt, type BEMTElemResult } from '../src/prop/bemt';

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
});
