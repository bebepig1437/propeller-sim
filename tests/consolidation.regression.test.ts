import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = resolve(__dirname, '..');

describe('Consolidation regression guards', () => {
  it('phase-doc-required files exist', () => {
    const required = [
      'src/core/config.ts',
      'src/core/clock.ts',
      'src/fluid/grid.ts',
      'src/fluid/advect.ts',
      'src/fluid/pressure.ts',
      'src/fluid/vorticity.ts',
      'src/fluid/sources.ts',
      'src/fluid/boundary.ts',
      'src/prop/bemt.ts',
      'src/prop/geometry.ts',
      'src/prop/polar.ts',
      'src/prop/rigidbody.ts',
      'src/prop/motor.ts',
      'src/prop/array.ts',
      'src/prop/stator.ts',
      'src/prop/torqueLedger.ts',
      'src/power/tether.ts',
      'src/power/bus.ts',
      'src/vehicle/body.ts',
      'src/vehicle/buoyancy.ts',
      'src/vehicle/drag.ts',
      'src/vehicle/integrator.ts',
      'CONVENTIONS.md',
    ];
    for (const f of required) {
      expect(existsSync(resolve(ROOT, f)), `missing ${f}`).toBe(true);
    }
  });

  it('design registry and registry stub are either present or documented', () => {
    const conventions = readFileSync(resolve(ROOT, 'CONVENTIONS.md'), 'utf8');
    const hasDesigns = existsSync(resolve(ROOT, 'src/prop/designs/index.ts'));
    const hasRegistry = existsSync(resolve(ROOT, 'src/core/registry.ts'));
    if (!hasDesigns) {
      expect(conventions).toMatch(/designs\/index\.ts|prop design registry/i);
    }
    if (!hasRegistry) {
      expect(conventions).toMatch(/registry|no circular imports/i);
    }
  });

  it('empirical stator constants are labeled', () => {
    const stator = readFileSync(resolve(ROOT, 'src/prop/stator.ts'), 'utf8');
    expect(stator).toMatch(/EMPIRICAL/i);
  });

  it('physics modules cite their source paper', () => {
    const citations: Array<[string, RegExp]> = [
      ['src/fluid/advect.ts', /MacCormack|Stam|Harris/i],
      ['src/fluid/vorticity.ts', /Fedkiw/i],
      ['src/fluid/pressure.ts', /Jacobi|multigrid|Poisson/i],
      ['src/prop/bemt.ts', /Prandtl|XROTOR|OpenProp|BEMT/i],
    ];
    for (const [f, re] of citations) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      expect(src, `${f} missing citation`).toMatch(re);
    }
  });
});
