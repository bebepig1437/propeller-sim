import { describe, it, expect } from 'vitest';
import { SimClock } from '../src/core/clock';
import { defaultConfig } from '../src/core/config';
import { calculateTetherVoltageDrop } from '../src/power/tether';
import { GpuTimer } from '../src/telemetry/gpuTimer';

describe('SimClock Fixed-Timestep Accumulator', () => {
  it('steps at precisely fixedDeltaTime', () => {
    const clock = new SimClock(1.0 / 60.0, 5);
    clock.start(0);

    let substeps = 0;
    let accumulatedTime = 0;

    clock.tick(50, (dt) => {
      substeps++;
      accumulatedTime += dt;
    });

    expect(substeps).toBe(3);
    expect(accumulatedTime).toBeCloseTo(3 / 60, 4);
  });

  it('clamps substeps to maxSubsteps to avoid spiral of death', () => {
    const maxSubsteps = 5;
    const clock = new SimClock(1.0 / 60.0, maxSubsteps);
    clock.start(0);

    let substeps = 0;
    clock.tick(500, () => {
      substeps++;
    });

    expect(substeps).toBe(maxSubsteps);
    expect(clock.getSubstepsExecuted()).toBe(maxSubsteps);
  });

  it('calculates interpolation alpha in [0, 1)', () => {
    const clock = new SimClock(1.0 / 60.0, 5);
    clock.start(0);

    const alpha = clock.tick(25, () => {});
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeCloseTo(0.5, 1);
  });
});

describe('Central Config Invariants', () => {
  it('contains all required electrical and hydrodynamic parameters', () => {
    expect(defaultConfig.electrical.supplyVoltage).toBe(12.0);
    expect(defaultConfig.electrical.tetherResistance).toBe(0.782);
    expect(defaultConfig.propulsion.diameterMm).toBe(42.0);
    expect(defaultConfig.clock.maxSubsteps).toBe(4);
  });
});

describe('Electrical Tether Model', () => {
  it('calculates terminal voltage sag accurately for Candidate A breakout point', () => {
    const currentA = 1.41;
    const tether = calculateTetherVoltageDrop(currentA, defaultConfig.electrical);

    expect(tether.supplyV).toBe(12.0);
    expect(tether.voltageDropV).toBeCloseTo(1.10, 2);
    expect(tether.terminalV).toBeCloseTo(10.90, 2);
  });
});

describe('GpuTimer', () => {
  it('initializes cleanly and measures CPU fallback duration', () => {
    const timer = new GpuTimer();
    expect(timer.getBackend()).toBe('cpu-fallback');

    timer.begin();
    const start = performance.now();
    while (performance.now() - start < 2) {}
    timer.end();

    const result = timer.resolve();
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.backend).toBe('cpu-fallback');
  });
});

describe('FlowVisualization Memory Allocation & Buffer Reuse (F7)', () => {
  it('updates particle positions in-place without reallocating Float32Array or attributes', async () => {
    const { FlowVisualization } = await import('../src/render/flowViz');
    const THREE = await import('three');
    const flowViz = new FlowVisualization({ particleCount: 1200 });

    const points = flowViz.group.children.find((c) => c instanceof THREE.Points) as THREE.Points;
    expect(points).toBeDefined();

    const posAttr = points.geometry.attributes.position as THREE.BufferAttribute;
    const originalArray = posAttr.array;
    expect(originalArray.length).toBe(1200 * 3);

    for (let frame = 0; frame < 120; frame++) {
      flowViz.update(1.0 / 60.0, 4.5, new THREE.Vector3(0, 0, 0));
      expect(posAttr.array).toBe(originalArray);
      expect(points.geometry.attributes.position).toBe(posAttr);
    }
  });
});

describe('Teardown Resource Disposal (F8)', () => {
  it('disposes all geometries and materials across pipe, prop3D, and flowViz', async () => {
    const { PipeTestStand } = await import('../src/render/pipe');
    const { FlowVisualization } = await import('../src/render/flowViz');
    const { Propeller3D } = await import('../src/prop/geometry');

    const pipe = new PipeTestStand();
    const flowViz = new FlowVisualization();
    const prop = new Propeller3D();

    expect(() => {
      pipe.dispose();
      flowViz.dispose();
      prop.dispose();
    }).not.toThrow();
  });
});
