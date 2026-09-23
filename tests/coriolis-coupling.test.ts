import { describe, it, expect } from 'vitest';
import { runCoupledManeuver } from '../src/vehicle/integrator';
import { MSS_COUPLED_REFERENCE } from './fixtures/mss-coupled';

describe('Coriolis is actually exercised in coupled motion', () => {
  it('heading drift matches MSS within 5%', () => {
    const sim = runCoupledManeuver({ durationS: 5, dt: 1 / 60, surgeN: 1, yawNm: 0.02 });
    const err = Math.abs(sim.headingRad - MSS_COUPLED_REFERENCE.headingRad) / Math.abs(MSS_COUPLED_REFERENCE.headingRad);
    expect(err).toBeLessThan(0.05);
  });

  it('fails when Coriolis is disabled — proving the term is active', () => {
    const sim = runCoupledManeuver({ durationS: 5, dt: 1 / 60, surgeN: 1, yawNm: 0.02, useCoriolis: false });
    const err = Math.abs(sim.headingRad - MSS_COUPLED_REFERENCE.headingRad) / Math.abs(MSS_COUPLED_REFERENCE.headingRad);
    expect(err).toBeGreaterThan(0.05);
  });
});
