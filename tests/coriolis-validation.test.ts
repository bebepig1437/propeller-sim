import { describe, it, expect } from 'vitest';
import { stepSurgeManeuver } from '../src/vehicle/integrator';
import { MSS_REFERENCE } from './fixtures/mss-step-surge';

describe('Coriolis enabled: step-surge matches MSS reference', () => {
  it('final velocity within 5%', () => {
    const sim = stepSurgeManeuver({ durationS: 10, dt: 1 / 60, forceN: 1.0 });
    const err = Math.abs(sim.finalVelocityMs - MSS_REFERENCE.finalVelocityMs) / MSS_REFERENCE.finalVelocityMs;
    expect(err).toBeLessThan(0.05);
  });

  it('rise time within 10%', () => {
    const sim = stepSurgeManeuver({ durationS: 10, dt: 1 / 60, forceN: 1.0 });
    const err = Math.abs(sim.riseTimeS - MSS_REFERENCE.riseTimeS) / MSS_REFERENCE.riseTimeS;
    expect(err).toBeLessThan(0.10);
  });
});
