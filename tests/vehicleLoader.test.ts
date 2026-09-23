import { describe, it, expect } from 'vitest';
import { loadVehicleConfig } from '../src/config/vehicleLoader';

describe('loadVehicleConfig smoke tests', () => {
  it('loads candidateA with authoritative values', async () => {
    const v = await loadVehicleConfig('candidateA');
    expect(v.motor.Ra_ohm).toBe(4.50);
    expect(v.propeller.D_mm).toBe(42.0);
    expect(v.stator.incidence_deg).toBeCloseTo(-5.2);
  });

  it('rejects malformed JSON with an explicit thrown error', async () => {
    await expect(loadVehicleConfig('__malformed__')).rejects.toThrow();
  });
});
