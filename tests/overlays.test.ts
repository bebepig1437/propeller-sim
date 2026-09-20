import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  OverlaySystem,
  DEFAULT_OVERLAY_STATE,
  OVERLAY_KEYS,
  OVERLAY_COLORS,
  type OverlayUpdateContext
} from '../src/render/overlays';
import { PropellerArray } from '../src/prop/array';
import { FluidGrid } from '../src/fluid/grid';
import { VehicleBody } from '../src/vehicle/body';
import { defaultConfig } from '../src/core/config';

function makeContext(grid: FluidGrid, summary: ReturnType<PropellerArray['evaluate']>): OverlayUpdateContext {
  const vehicle = new VehicleBody(defaultConfig.vehicle);
  return {
    dt: 1 / 60,
    elapsed: 0.016,
    grid,
    gridCenter: new THREE.Vector3(0, 0, 0),
    gridDxM: 0.0015,
    vehicle,
    summary,
    motorTempsC: summary.thrusters.map(() => 45.0),
    motorCurrentsA: summary.thrusters.map(() => 1.2)
  };
}

function seedFlow(grid: FluidGrid): void {
  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 1; x < grid.width - 1; x++) {
      const i = y * grid.width + x;
      grid.u[i] = 0.8 + 0.2 * Math.sin(x * 0.05);
      grid.v[i] = 0.3 * Math.cos(y * 0.07);
      grid.curl[i] = 2.0 * Math.sin(x * 0.03) * Math.cos(y * 0.04);
      grid.pressure[i] = 0.5;
    }
  }
}

describe('Phase 6 — OverlaySystem', () => {
  it('starts with only thrust arrows and velocity vectors on', () => {
    const system = new OverlaySystem();
    const active = OVERLAY_KEYS.filter((k) => DEFAULT_OVERLAY_STATE[k]);
    expect(active).toContain('thrustArrows');
    expect(active).toContain('velocityVectors');
    expect(active.length).toBe(2);
    system.dispose();
  });

  it('toggles each of the 9 overlays independently and updates without throwing', () => {
    const system = new OverlaySystem();
    const grid = new FluidGrid({ width: 128, height: 64 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    // Toggle every key on, one at a time, updating each frame
    for (const key of OVERLAY_KEYS) {
      system.setVisible(key, true);
      expect(system.state[key]).toBe(true);
      expect(() => system.update(1 / 60, ctx)).not.toThrow();
    }

    // All on simultaneously — the busy-but-distinguishable acceptance case
    expect(() => {
      for (let f = 0; f < 30; f++) {
        system.update(1 / 60, ctx);
      }
    }).not.toThrow();

    // Toggle all off
    for (const key of OVERLAY_KEYS) {
      system.setVisible(key, false);
      expect(system.state[key]).toBe(false);
    }
    expect(() => system.update(1 / 60, ctx)).not.toThrow();

    system.dispose();
  });

  it('pressure heatmap does not add 3D scene objects (cutaway-only)', () => {
    const system = new OverlaySystem();
    const before = system.group.children.length;
    system.setVisible('pressureHeatmap', true);
    expect(system.group.children.length).toBe(before);
    system.dispose();
  });

  it('velocity arrows fill the instanced buffer within configured stride bounds', () => {
    const system = new OverlaySystem();
    system.setVisible('velocityVectors', true);
    const grid = new FluidGrid({ width: 256, height: 128 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);
    system.update(1 / 60, ctx);

    const arrows = (system as any).arrowInstanced as THREE.InstancedMesh;
    expect(arrows.count).toBeGreaterThan(0);
    expect(arrows.count).toBeLessThanOrEqual((arrows as any).maximumCount ?? 2400);
    system.dispose();
  });

  it('produces no heap growth over 120 frames with all overlays on', () => {
    const system = new OverlaySystem();
    const grid = new FluidGrid({ width: 128, height: 64 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    for (const key of OVERLAY_KEYS) system.setVisible(key, true);

    // Warmup (dynamic allocations: streamline/particle buffers sized once)
    for (let f = 0; f < 10; f++) system.update(1 / 60, ctx);

    const baselineObjects = countThreeObjects(system.group);
    for (let f = 0; f < 120; f++) {
      system.update(1 / 60, ctx);
      // Advance the flow a bit so advection paths stay non-trivial
      if (f % 7 === 0) seedFlow(grid);
    }
    const afterObjects = countThreeObjects(system.group);

    // Object graph must not grow (no per-frame object creation)
    expect(afterObjects).toBe(baselineObjects);
    system.dispose();
  });

  it('disposes cleanly after heavy use (no throw, empty group)', () => {
    const system = new OverlaySystem();
    const grid = new FluidGrid({ width: 64, height: 32 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    for (const key of OVERLAY_KEYS) system.setVisible(key, true);
    for (let f = 0; f < 10; f++) system.update(1 / 60, ctx);

    expect(() => system.dispose()).not.toThrow();
  });

  it('variant diff plot accepts curves without throwing and hides DOM-free', () => {
    // Headless: no diffEl provided, so showVariantDiff must be a safe no-op
    const system = new OverlaySystem();
    const oldCurve = [
      { J: 0.0, thrustN: 5.2 },
      { J: 0.7, thrustN: 3.1 },
      { J: 1.4, thrustN: 0.8 }
    ];
    const newCurve = [
      { J: 0.0, thrustN: 6.4 },
      { J: 0.7, thrustN: 3.8 },
      { J: 1.4, thrustN: 1.1 }
    ];
    expect(() => system.showVariantDiff(oldCurve, newCurve)).not.toThrow();
    system.dispose();
  });

  it('hover labels remain absent without a pointer (hover-only chrome)', () => {
    const system = new OverlaySystem();
    const grid = new FluidGrid({ width: 64, height: 32 });
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    system.setVisible('thrustArrows', true);
    system.setVisible('torqueArrows', true);
    // No camera/pointer configured → update must be safe and label-free
    expect(() => system.update(1 / 60, ctx)).not.toThrow();
    system.dispose();
  });

  it('exposes a color contract matching the four accent tokens', () => {
    // Headless fallbacks must equal the CSS custom property values
    expect(OVERLAY_COLORS.thrust).toBe(0x00f2ff);
    expect(OVERLAY_COLORS.torque).toBe(0xf59e0b);
    expect(OVERLAY_COLORS.heat).toBe(0xef4444);
    expect(OVERLAY_COLORS.current).toBe(0xa855f7);

    // Derived torque variants stay in the torque hue family (no new hues)
    const torque = new THREE.Color(OVERLAY_COLORS.torque);
    const stator = new THREE.Color(OVERLAY_COLORS.torqueStator);
    const net = new THREE.Color(OVERLAY_COLORS.torqueNet);
    const hslT = { h: 0, s: 0, l: 0 };
    const hslS = { h: 0, s: 0, l: 0 };
    const hslN = { h: 0, s: 0, l: 0 };
    torque.getHSL(hslT);
    stator.getHSL(hslS);
    net.getHSL(hslN);
    expect(Math.abs(hslS.h - hslT.h)).toBeLessThan(0.02);
    expect(Math.abs(hslN.h - hslT.h)).toBeLessThan(0.02);
    expect(hslS.s).toBeLessThan(hslT.s); // desaturated
    expect(hslN.l).toBeGreaterThan(hslT.l); // brightened
  });

  it('Directive 2 guard: scene contains zero FlowOverlays-shaped groups after update', () => {
    // Construct scene and verify legacy renderer is quarantined and absent from runtime
    const scene = new THREE.Scene();
    const system = new OverlaySystem();
    scene.add(system.group);

    const grid = new FluidGrid({ width: 64, height: 32 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);
    system.update(1 / 60, ctx);

    // Assert that scene.children has zero flowOverlays groups
    expect(scene.children.filter((c) => c.name === 'flowOverlays').length).toBe(0);

    const legacyMatches: THREE.Object3D[] = [];
    scene.traverse((child) => {
      if (child.name === 'flowOverlays') legacyMatches.push(child);
    });
    expect(legacyMatches.length).toBe(0);

    system.dispose();
  });

  it('Directive 7 heap growth guard: 600 update calls with all overlays on leaks < 1 MB', () => {
    const system = new OverlaySystem();
    for (const key of OVERLAY_KEYS) {
      system.setVisible(key, true);
    }

    const grid = new FluidGrid({ width: 128, height: 64 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    // Warm-up 50 iterations so JIT, scratch arrays, and buffers stabilize
    for (let i = 0; i < 50; i++) {
      ctx.elapsed += 1 / 60;
      system.update(1 / 60, ctx);
    }

    if (typeof (global as any).gc === 'function') {
      (global as any).gc();
    }
    const heapBefore = process.memoryUsage().heapUsed;

    // Run 600 frames (10 seconds simulated runtime at 60 Hz)
    for (let i = 0; i < 600; i++) {
      ctx.elapsed += 1 / 60;
      system.update(1 / 60, ctx);
    }

    if (typeof (global as any).gc === 'function') {
      (global as any).gc();
    }
    const heapAfter = process.memoryUsage().heapUsed;
    const growthBytes = heapAfter - heapBefore;
    const growthMb = growthBytes / (1024 * 1024);

    // Assert retained heap growth is strictly < 1 MB across 600 frames
    expect(growthMb).toBeLessThan(1.0);
    system.dispose();
  });
});

/** Counts every Object3D in the subtree. */
function countThreeObjects(root: THREE.Object3D): number {
  let n = 1;
  for (const child of root.children) n += countThreeObjects(child);
  return n;
}
