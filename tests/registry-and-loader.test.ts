import { describe, it, expect } from 'vitest';
import { ServiceRegistry } from '../src/core/registry';
import { loadVehicleConfig } from '../src/config/vehicleLoader';

describe('ServiceRegistry', () => {
  it('register / get round-trips', () => {
    ServiceRegistry.clear();
    ServiceRegistry.register('x', { a: 1 });
    expect(ServiceRegistry.get<{ a: number }>('x')?.a).toBe(1);
  });
  it('missing key returns undefined', () => {
    ServiceRegistry.clear();
    expect(ServiceRegistry.get('nope')).toBeUndefined();
  });
});

describe('loadVehicleConfig', () => {
  it('loads candidateA with authoritative values', async () => {
    const v = await loadVehicleConfig('candidateA');
    expect(v.motor.Ra_ohm).toBe(4.5);
    expect(v.propeller.D_mm).toBe(42);
    expect(v.stator.incidence_deg).toBeCloseTo(-5.2);
  });
  it('rejects malformed JSON', async () => {
    await expect(loadVehicleConfig('__malformed__')).rejects.toThrow();
  });
});
