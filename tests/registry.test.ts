import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceRegistry } from '../src/core/registry';

describe('ServiceRegistry smoke tests', () => {
  beforeEach(() => {
    ServiceRegistry.clear();
  });

  it('register, get, and has work as expected', () => {
    expect(ServiceRegistry.has('serviceA')).toBe(false);
    expect(ServiceRegistry.get('serviceA')).toBeUndefined();

    ServiceRegistry.register('serviceA', { value: 42 });
    expect(ServiceRegistry.has('serviceA')).toBe(true);
    expect(ServiceRegistry.get<{ value: number }>('serviceA')?.value).toBe(42);
  });

  it('duplicate key policy: overwrites existing registration', () => {
    ServiceRegistry.register('item', { version: 1 });
    ServiceRegistry.register('item', { version: 2 });
    expect(ServiceRegistry.get<{ version: number }>('item')?.version).toBe(2);
  });

  it('clear purges all registered keys', () => {
    ServiceRegistry.register('a', 1);
    ServiceRegistry.register('b', 2);
    expect(ServiceRegistry.has('a')).toBe(true);
    expect(ServiceRegistry.has('b')).toBe(true);

    ServiceRegistry.clear();
    expect(ServiceRegistry.has('a')).toBe(false);
    expect(ServiceRegistry.has('b')).toBe(false);
    expect(ServiceRegistry.get('a')).toBeUndefined();
    expect(ServiceRegistry.get('b')).toBeUndefined();
  });

  it('missing key returns undefined', () => {
    expect(ServiceRegistry.get('nonexistent')).toBeUndefined();
  });
});
