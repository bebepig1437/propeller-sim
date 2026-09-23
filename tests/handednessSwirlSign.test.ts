import { describe, it, expect } from 'vitest';
import { FluidSolver } from '../src/fluid/FluidSolver';
import { ActuatorDiscCoupler } from '../src/prop/coupling';
import { solveBemt } from '../src/prop/bemt';
import { PropellerArray } from '../src/prop/array';

describe('Directive 1 — Handedness Swirl Sign Fluid Coupling', () => {
  it('asserts that CW and CCW thrusters coaxially at equal |RPM| produce opposite-sign tangential momentum at disk centroid', () => {
    const W = 256;
    const H = 128;
    const dt = 1.0 / 60.0;
    const centerX = 40;
    const centerY = 64;
    const radiusCells = 14;

    const solverCW = new FluidSolver({ gridOptions: { width: W, height: H } });
    const couplerCW = new ActuatorDiscCoupler({
      centerX,
      centerY,
      radiusCells,
      orientationRad: 0.0 
    });
    const bemtCW = solveBemt(4140, 0, { handedness: 'CW' });
    couplerCW.injectCouplingForces(solverCW.grid, bemtCW, dt, -1);

    const solverCCW = new FluidSolver({ gridOptions: { width: W, height: H } });
    const couplerCCW = new ActuatorDiscCoupler({
      centerX,
      centerY,
      radiusCells,
      orientationRad: 0.0
    });
    const bemtCCW = solveBemt(4140, 0, { handedness: 'CCW' });
    couplerCCW.injectCouplingForces(solverCCW.grid, bemtCCW, dt, +1);

    const sampleY = centerY + Math.round(radiusCells * 0.7);
    const sampleIdx = sampleY * W + centerX;

    const cellMassCW = couplerCW.cellMassKg;
    const cellMassCCW = couplerCCW.cellMassKg;

    const pInjectedCW = cellMassCW * solverCW.grid.v[sampleIdx];
    const pInjectedCCW = cellMassCCW * solverCCW.grid.v[sampleIdx];

    expect(Math.abs(pInjectedCW)).toBeGreaterThan(1e-7);
    expect(Math.abs(pInjectedCCW)).toBeGreaterThan(1e-7);
    expect(pInjectedCW * pInjectedCCW).toBeLessThan(0);
    expect(Math.sign(pInjectedCW)).toBe(-1);
    expect(Math.sign(pInjectedCCW)).toBe(1);

    expect(Math.abs(Math.abs(pInjectedCW) - Math.abs(pInjectedCCW))).toBeLessThan(1e-6);
    expect(Math.abs(pInjectedCW + pInjectedCCW)).toBeLessThan(1e-6);

    solverCW.step(dt);
    solverCCW.step(dt);

    const vCW = solverCW.grid.v[sampleIdx];
    const vCCW = solverCCW.grid.v[sampleIdx];
    const momentumCW = cellMassCW * vCW;
    const momentumCCW = cellMassCCW * vCCW;

    expect(momentumCW * momentumCCW).toBeLessThan(0);
    expect(Math.abs(Math.abs(momentumCW) - Math.abs(momentumCCW))).toBeLessThan(5e-5);
    expect(Math.abs(momentumCW + momentumCCW)).toBeLessThan(5e-5);
  });

  it('verifies PropellerArray contra_rotating_coaxial outputs opposite swirl signs for paired units', () => {
    const array = new PropellerArray();
    array.applyHandednessPreset('contra_rotating_coaxial');

    const summary = array.evaluate([1.0, 1.0]);
    expect(summary.thrusters.length).toBe(2);

    const unit0 = summary.thrusters[0];
    const unit1 = summary.thrusters[1];

    expect(unit0.unit.handedness).toBe('CW');
    expect(unit1.unit.handedness).toBe('CCW');

    expect(unit0.swirlSign).toBe(-1);
    expect(unit1.swirlSign).toBe(1);
    expect(unit0.swirlSign + unit1.swirlSign).toBe(0);

    expect(unit0.bemt.torqueNm).toBeLessThan(0);
    expect(unit1.bemt.torqueNm).toBeGreaterThan(0);
    expect(unit0.bemt.torqueNm + unit1.bemt.torqueNm).toBeCloseTo(0, 6);
  });
});
