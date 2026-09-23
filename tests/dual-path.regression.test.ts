import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

describe('No shim modules', () => {
  const mustBeReal = [
    'src/prop/motor.ts',
    'src/core/clock.ts',
    'src/fluid/pressure.ts',
    'src/prop/bemt.ts',
  ];
  for (const f of mustBeReal) {
    it(`${f} is not a one-line re-export shim`, () => {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      const lines = src.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
      expect(lines.length, `${f} looks like a shim`).toBeGreaterThan(3);
    });
  }

  it('no dual-name exported aliases', () => {
    const files = ['src/prop/bemt.ts', 'src/fluid/pressure.ts'];
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      const aliases = src.match(/export const \w+: typeof \w+/g) ?? [];
      expect(aliases, `${f} exports a typeof alias`).toHaveLength(0);
    }
  });
});
