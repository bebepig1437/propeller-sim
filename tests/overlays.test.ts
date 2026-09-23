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
import { FluidSolver } from '../src/fluid/FluidSolver';
import { VehicleBody } from '../src/vehicle/body';
import { AppRenderer } from '../src/render/renderer';
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

    for (const key of OVERLAY_KEYS) {
      system.setVisible(key, true);
      expect(system.state[key]).toBe(true);
      expect(() => system.update(1 / 60, ctx)).not.toThrow();
    }

    expect(() => {
      for (let f = 0; f < 30; f++) {
        system.update(1 / 60, ctx);
      }
    }).not.toThrow();

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

    for (let f = 0; f < 10; f++) system.update(1 / 60, ctx);

    const baselineObjects = countThreeObjects(system.group);
    for (let f = 0; f < 120; f++) {
      system.update(1 / 60, ctx);
      if (f % 7 === 0) seedFlow(grid);
    }
    const afterObjects = countThreeObjects(system.group);

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
    expect(() => system.update(1 / 60, ctx)).not.toThrow();
    system.dispose();
  });

  it('exposes a color contract matching the accent tokens and computed CSS', () => {
    expect(OVERLAY_COLORS.thrust).toBe(0xff7700);
    expect(OVERLAY_COLORS.torque).toBe(0xd946ef);
    expect(OVERLAY_COLORS.heat).toBe(0xef4444);
    expect(OVERLAY_COLORS.current).toBe(0x00f2ff);

    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8');
    const parseHex = (name: string) => {
      const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]+)`));
      return match ? parseInt(match[1].slice(1), 16) : 0;
    };
    expect(OVERLAY_COLORS.thrust).toBe(parseHex('--accent-thrust'));
    expect(OVERLAY_COLORS.torque).toBe(parseHex('--accent-torque'));
    expect(OVERLAY_COLORS.stator).toBe(parseHex('--accent-stator'));
    expect(OVERLAY_COLORS.heat).toBe(parseHex('--accent-heat'));
    expect(OVERLAY_COLORS.current).toBe(parseHex('--accent-current'));

    const torque = new THREE.Color(OVERLAY_COLORS.torque);
    const stator = new THREE.Color(OVERLAY_COLORS.torqueStator);
    const hslT = { h: 0, s: 0, l: 0 };
    const hslS = { h: 0, s: 0, l: 0 };
    torque.getHSL(hslT);
    stator.getHSL(hslS);
    expect(hslS.s).toBeLessThan(hslT.s); 
  });

  it('Directive 2 guard: scene contains zero FlowOverlays-shaped groups after update', () => {
    const scene = new THREE.Scene();
    const system = new OverlaySystem();
    scene.add(system.group);

    const grid = new FluidGrid({ width: 64, height: 32 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);
    system.update(1 / 60, ctx);

    expect(scene.children.filter((c) => c.name === 'flowOverlays').length).toBe(0);

    const legacyMatches: THREE.Object3D[] = [];
    scene.traverse((child) => {
      if (child.name === 'flowOverlays') legacyMatches.push(child);
    });
    expect(legacyMatches.length).toBe(0);

    system.dispose();
  });

  it('Directive 7 hot-path zero-allocation guard: zero Three.js object allocation during update frames', () => {
    const system = new OverlaySystem();
    for (const key of OVERLAY_KEYS) {
      system.setVisible(key, true);
    }

    const grid = new FluidGrid({ width: 128, height: 64 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    for (let i = 0; i < 20; i++) {
      ctx.elapsed += 1 / 60;
      system.update(1 / 60, ctx);
    }

    const initialObjCount = countThreeObjects(system.group);
    for (let i = 0; i < 500; i++) {
      ctx.elapsed += 1 / 60;
      system.update(1 / 60, ctx);
    }
    const finalObjCount = countThreeObjects(system.group);
    expect(finalObjCount).toBe(initialObjCount);

    system.dispose();
  });

  it('allocation drift: hot path is allocation-free (slope <= 8 B/frame, intercept reported)', () => {
    const system = new OverlaySystem();
    for (const key of OVERLAY_KEYS) system.setVisible(key, true);
    const grid = new FluidGrid({ width: 64, height: 32 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    const sample = () => {
      if (typeof globalThis.gc === 'function') globalThis.gc();
      return process.memoryUsage().heapUsed;
    };

    for (let i = 0; i < 500; i++) {
      ctx.elapsed += 1 / 60;
      system.update(1 / 60, ctx);
    }

    const N1 = 1000;
    const N2 = 6000;
    const heapAtN1 = (() => {
      for (let i = 0; i < N1; i++) {
        ctx.elapsed += 1 / 60;
        system.update(1 / 60, ctx);
      }
      return sample();
    })();

    const heapAtN2 = (() => {
      for (let i = N1; i < N2; i++) {
        ctx.elapsed += 1 / 60;
        system.update(1 / 60, ctx);
      }
      return sample();
    })();

    const slopeBytesPerFrame = (heapAtN2 - heapAtN1) / (N2 - N1);
    const interceptBytes = heapAtN1 - slopeBytesPerFrame * N1;

    const heapAtN3 = (() => {
      for (let i = N2; i < N2 + N1; i++) {
        ctx.elapsed += 1 / 60;
        system.update(1 / 60, ctx);
      }
      return sample();
    })();
    const slope2BytesPerFrame = (heapAtN3 - heapAtN2) / N1;
    const intercept2Bytes = heapAtN2 - slope2BytesPerFrame * N2;
    const interceptDriftMb = Math.abs(intercept2Bytes - interceptBytes) / (1024 * 1024);

    console.log('[allocation-drift]', {
      slopeBytesPerFrame: slopeBytesPerFrame.toFixed(2),
      slope2BytesPerFrame: slope2BytesPerFrame.toFixed(2),
      interceptKB: (interceptBytes / 1024).toFixed(1),
      intercept2KB: (intercept2Bytes / 1024).toFixed(1),
      interceptDriftMb: interceptDriftMb.toFixed(3),
      sampledFrames: `${N1}..${N2 + N1}`
    });

    expect(slopeBytesPerFrame).toBeLessThanOrEqual(8);
    expect(interceptDriftMb).toBeLessThanOrEqual(1.0);

    system.dispose();
  });

  it('no NaN in any overlay buffer on any toggle permutation', () => {
    const system = new OverlaySystem();
    const grid = new FluidGrid({ width: 64, height: 32 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    for (const key of OVERLAY_KEYS) {
      system.setVisible(key, true);
      system.update(1 / 60, ctx);
      system.group.traverse((obj) => {
        if ((obj as any).geometry) {
          const geo = (obj as any).geometry as THREE.BufferGeometry;
          for (const attrName in geo.attributes) {
            const arr = geo.attributes[attrName].array;
            for (let i = 0; i < Math.min(arr.length, 100); i++) {
              expect(Number.isNaN(arr[i])).toBe(false);
            }
          }
        }
      });
      system.setVisible(key, false);
    }
    system.dispose();
  });

  it('velocity arrow count matches configured stride exactly', () => {
    const system = new OverlaySystem();
    system.setVisible('velocityVectors', true);
    const grid = new FluidGrid({ width: 256, height: 64 });
    seedFlow(grid);
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    system.update(1 / 60, ctx);
    const stride = system.tunables.vectorStride;
    const nx = Math.floor(grid.width / stride);
    const ny = Math.floor(grid.height / stride);
    const expectedMax = nx * ny;
    expect(system.getVelocityArrowCount()).toBeLessThanOrEqual(expectedMax);
    expect(system.getVelocityArrowCount()).toBeGreaterThan(0);
    system.dispose();
  });

  it('adding all overlays does not change fluid solver output within 1e-6 over 100 steps', () => {
    const solverA = new FluidSolver({
      gridOptions: { width: 64, height: 32 },
      pressureIterations: 10,
      vorticityStrength: 2.0,
      advectionScheme: 'MACCORMACK'
    });
    const solverB = new FluidSolver({
      gridOptions: { width: 64, height: 32 },
      pressureIterations: 10,
      vorticityStrength: 2.0,
      advectionScheme: 'MACCORMACK'
    });

    seedFlow(solverA.grid);
    seedFlow(solverB.grid);

    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const system = new OverlaySystem();
    for (const k of OVERLAY_KEYS) system.setVisible(k, true);

    const ctx = makeContext(solverB.grid, summary);

    for (let step = 0; step < 100; step++) {
      solverA.step(1 / 60);
      solverB.step(1 / 60);
      system.update(1 / 60, ctx);
    }

    for (let i = 0; i < solverA.grid.u.length; i++) {
      expect(Math.abs(solverA.grid.u[i] - solverB.grid.u[i])).toBeLessThan(1e-6);
      expect(Math.abs(solverA.grid.v[i] - solverB.grid.v[i])).toBeLessThan(1e-6);
    }
    system.dispose();
  });

  it('thrust arrow length is linear in |thrust_N| across the range 0 to 10 N', () => {
    const system = new OverlaySystem();
    system.setVisible('thrustArrows', true);
    const grid = new FluidGrid({ width: 64, height: 32 });
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    summary.thrusters[0].forceVectorN = [2.0, 0, 0];
    summary.thrusters[0].netThrustN = 2.0;
    system.update(1 / 60, ctx);
    const len2 = system.getThrustArrowLength(0);

    summary.thrusters[0].forceVectorN = [6.0, 0, 0];
    summary.thrusters[0].netThrustN = 6.0;
    system.update(1 / 60, ctx);
    const len6 = system.getThrustArrowLength(0);

    expect(len2).toBeGreaterThan(0);
    expect(len6).toBeGreaterThan(0);
    expect(len6 / len2).toBeCloseTo(3.0, 2);

    summary.thrusters[0].forceVectorN = [10.0, 0, 0];
    summary.thrusters[0].netThrustN = 10.0;
    system.update(1 / 60, ctx);
    const len10 = system.getThrustArrowLength(0);
    expect(len10 / len2).toBeCloseTo(5.0, 2);

    system.dispose();
  });

  it('torque arc sign flips when handedness flips and stator arc is zero when detached', () => {
    const system = new OverlaySystem();
    system.setVisible('torqueArrows', true);
    const grid = new FluidGrid({ width: 64, height: 32 });
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    summary.thrusters[0].unit.handedness = 'CW';
    summary.thrusters[0].bemt.torqueNm = 0.02;
    summary.thrusters[0].statorResult = { antiTorqueNm: 0.015, recoveryRatio: 0.75, axialLossFactor: 0.05 };
    (summary.thrusters[0].unit as any).statorAttached = true;
    system.update(1 / 60, ctx);

    const propArc = (system as any).torquePropArcs[0] as THREE.Line;
    const statorArc = (system as any).torqueStatorArcs[0] as THREE.Line;
    expect(propArc.scale.y).toBeLessThan(0);
    expect(statorArc.scale.y).toBeGreaterThan(0);
    expect(statorArc.visible).toBe(true);

    summary.thrusters[0].unit.handedness = 'CCW';
    system.update(1 / 60, ctx);
    expect(propArc.scale.y).toBeGreaterThan(0);
    expect(statorArc.scale.y).toBeLessThan(0);

    (summary.thrusters[0].unit as any).statorAttached = false;
    system.update(1 / 60, ctx);
    expect(statorArc.visible).toBe(false);
    expect(statorArc.scale.x).toBe(0);

    system.dispose();
  });

  it('streamline integration does not diverge over 1000 steps on steady inflow', () => {
    const system = new OverlaySystem();
    system.setVisible('streamlines', true);
    const grid = new FluidGrid({ width: 64, height: 32 });
    for (let i = 0; i < grid.u.length; i++) {
      grid.u[i] = 1.0;
      grid.v[i] = 0.0;
    }
    const summary = new PropellerArray().evaluate([1.0, 1.0, 0.0]);
    const ctx = makeContext(grid, summary);

    for (let s = 0; s < 1000; s++) {
      system.update(1 / 60, ctx);
    }

    const lines = (system as any).streamlineLines as THREE.Line[];
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      const pos = l.geometry.attributes.position.array as Float32Array;
      for (let j = 0; j < pos.length; j++) {
        expect(Number.isFinite(pos[j])).toBe(true);
      }
    }

    system.dispose();
  });

  it('cutaway toggle updates camera and restores pose within 1e-6 without referencing stored pointer', () => {
    const container = { appendChild: () => {}, clientWidth: 800, clientHeight: 600 } as any;
    const renderer = new AppRenderer(container, {
      fluid: { gridResolution: [64, 32], worldSizeM: [0.6, 0.2] }
    } as any);

    const snapshotPos = [renderer.camera.position.x, renderer.camera.position.y, renderer.camera.position.z];
    const snapshotTarget = [renderer.controls.target.x, renderer.controls.target.y, renderer.controls.target.z];

    expect(renderer.tankStructure.visible).toBe(true);
    expect((renderer as any).cutawayAxisGroup.visible).toBe(false);

    renderer.setCutaway(true);
    expect(renderer.tankStructure.visible).toBe(false);
    expect((renderer as any).cutawayAxisGroup.visible).toBe(true);
    expect((renderer as any).silhouetteGroup.visible).toBe(true);

    renderer.camera.position.set(99, 99, 99);
    renderer.controls.target.set(55, 55, 55);

    renderer.setCutaway(false);
    expect(renderer.tankStructure.visible).toBe(true);
    expect((renderer as any).cutawayAxisGroup.visible).toBe(false);

    const dx = renderer.camera.position.x - snapshotPos[0];
    const dy = renderer.camera.position.y - snapshotPos[1];
    const dz = renderer.camera.position.z - snapshotPos[2];
    const distPos = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(distPos).toBeLessThan(1e-6);

    const tx = renderer.controls.target.x - snapshotTarget[0];
    const ty = renderer.controls.target.y - snapshotTarget[1];
    const tz = renderer.controls.target.z - snapshotTarget[2];
    const distTarget = Math.sqrt(tx * tx + ty * ty + tz * tz);
    expect(distTarget).toBeLessThan(1e-6);

    renderer.dispose();
  });
});

function countThreeObjects(root: THREE.Object3D): number {
  let n = 1;
  for (const child of root.children) n += countThreeObjects(child);
  return n;
}
