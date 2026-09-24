import { describe, it, expect } from 'vitest';
import { FluidGrid } from '../src/fluid/grid';
import { InflowJet } from '../src/fluid/sources';

describe('Fluid Grid & Sources', () => {
  it('FluidGrid supports bounds checking get/set and interior/boundary classification', () => {
    const grid = new FluidGrid({ width: 16, height: 8 });
    expect(grid.inBounds(0, 0)).toBe(true);
    expect(grid.inBounds(15, 7)).toBe(true);
    expect(grid.inBounds(16, 7)).toBe(false);
    expect(grid.inBounds(0, 8)).toBe(false);
    expect(grid.inBounds(-1, 0)).toBe(false);

    expect(grid.isBoundary(0, 0)).toBe(true);
    expect(grid.isBoundary(15, 4)).toBe(true);
    expect(grid.isBoundary(8, 0)).toBe(true);
    expect(grid.isBoundary(8, 7)).toBe(true);
    expect(grid.isInterior(0, 0)).toBe(false);
    expect(grid.isInterior(8, 4)).toBe(true);
    expect(grid.isBoundary(8, 4)).toBe(false);

    grid.set(grid.u, 5, 3, 12.34);
    expect(grid.get(grid.u, 5, 3)).toBeCloseTo(12.34, 4);

    expect(() => grid.get(grid.u, -1, 3)).toThrow(RangeError);
    expect(() => grid.get(grid.u, 16, 3)).toThrow(RangeError);
    expect(() => grid.set(grid.v, 5, 8, 1.0)).toThrow(RangeError);
  });

  it('InflowJet injects velocity and dye into FluidGrid', () => {
    const grid = new FluidGrid({ width: 32, height: 16 });
    const jet = new InflowJet({
      x: 2,
      y: 4,
      width: 4,
      height: 8,
      vx: 2.5,
      enabled: true
    });

    jet.inject(grid);
    let totalDye = 0;
    for (let i = 0; i < grid.size; i++) {
      totalDye += grid.dye[i];
    }
    expect(totalDye).toBeGreaterThan(0);
    expect(grid.u[grid.idx(3, 8)]).toBeGreaterThan(0);
  });
});
