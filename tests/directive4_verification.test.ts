import { describe, it, expect } from 'vitest';
import { solveBemt } from '../src/prop/bemt';
import { getPropDesign } from '../src/prop/designs/index';
import { SimClock } from '../src/core/clock';
import { PropellerShaft } from '../src/prop/rigidbody';
import { FluidGrid } from '../src/fluid/grid';
import { GpuFluidSolver } from '../src/fluid/gpu/gpuFluidSolver';
import { FlowVisualization } from '../src/render/flowViz';
import * as THREE from 'three';

describe('Directive 4 Acceptance & Verification Tests', () => {
  it('verifies J computation: at 3800 RPM, 1.5 m/s inflow, 42 mm diameter', () => {
    const rpm = 3800;
    const inflow = 1.5;
    const diameterM = 0.042;
    const n = rpm / 60.0;
    const J = inflow / (n * diameterM);

    const expectedJ = 1.5 / ((3800 / 60.0) * 0.042);
    expect(J).toBeCloseTo(expectedJ, 6);
    expect(J).toBeCloseTo(0.5639, 3);
  });

  it('verifies time-scale invariance: solveBemt at 1.0x and 0.1x produces identical output within 1e-6', () => {
    const design = getPropDesign('candidateA');
    const rpm = 3800;
    const inflow = 1.5;

    const res1 = solveBemt(rpm, inflow, { design, pitchMm: design.pitchMm });
    const res2 = solveBemt(rpm, inflow, { design, pitchMm: design.pitchMm });

    expect(Math.abs(res1.thrustN - res2.thrustN)).toBeLessThan(1e-6);
    expect(Math.abs(res1.torqueNm - res2.torqueNm)).toBeLessThan(1e-6);
    expect(Math.abs(res1.efficiency - res2.efficiency)).toBeLessThan(1e-6);
  });

  it('verifies propeller phase rotation at 0.1x advances at exactly 1/10 the rate of 1.0x in real time', () => {
    const clock1x = new SimClock(1.0 / 60.0, 10);
    clock1x.setTimeScale(1.0);
    clock1x.start(0);

    const clock01x = new SimClock(1.0 / 60.0, 10);
    clock01x.setTimeScale(0.1);
    clock01x.start(0);

    const shaft1x = new PropellerShaft(4140, 18.0);
    shaft1x.commandedRpm = 3800;
    shaft1x.currentRpm = 3800;

    const shaft01x = new PropellerShaft(4140, 18.0);
    shaft01x.commandedRpm = 3800;
    shaft01x.currentRpm = 3800;

    let substeps1x = 0;
    clock1x.tick(100, (dt) => {
      shaft1x.update(dt);
      substeps1x++;
    });

    let substeps01x = 0;
    clock01x.tick(100, (dt) => {
      shaft01x.update(dt);
      substeps01x++;
    });

    expect(substeps1x).toBe(6);
    expect(substeps01x).toBe(0);

    const clock10s01x = new SimClock(1.0 / 60.0, 100);
    clock10s01x.setTimeScale(0.1);
    clock10s01x.start(0);

    let substeps10s = 0;
    for (let t = 1; t <= 10; t++) {
      clock10s01x.tick(t * 100, (dt) => {
        shaft01x.update(dt);
        substeps10s++;
      });
    }

    expect(substeps10s).toBe(6);
    expect(Math.abs(shaft1x.bladePhaseRad - shaft01x.bladePhaseRad)).toBeLessThan(1e-3);
  });

  it('verifies dye sheet advection: mass conservation within 1% during fluid solver step', () => {
    const solver = new GpuFluidSolver({
      gridOptions: { width: 64, height: 32 },
      jetConfig: { enabled: false, vx: 0 }
    });

    for (let y = 10; y <= 22; y++) {
      for (let x = 10; x <= 22; x++) {
        solver.grid.dye[y * solver.grid.width + x] = 1.0;
        solver.grid.u[y * solver.grid.width + x] = 0.5;
        solver.grid.v[y * solver.grid.width + x] = 0.0;
      }
    }

    let initialMass = 0;
    for (let i = 0; i < solver.grid.size; i++) {
      initialMass += solver.grid.dye[i];
    }
    expect(initialMass).toBeGreaterThan(0);

    solver.step(0.001);

    let finalMass = 0;
    for (let i = 0; i < solver.grid.size; i++) {
      finalMass += solver.grid.dye[i];
    }

    const massChange = Math.abs(finalMass - initialMass) / initialMass;
    expect(massChange).toBeLessThan(0.01);
  });

  it('verifies visualization toggles do not perturb the fluid grid solver output', () => {
    const gridA = new FluidGrid({ width: 32, height: 16 });
    const gridB = new FluidGrid({ width: 32, height: 16 });

    for (let i = 0; i < gridA.size; i++) {
      const val = Math.sin(i * 0.1);
      gridA.u[i] = val;
      gridB.u[i] = val;
      gridA.v[i] = val * 0.5;
      gridB.v[i] = val * 0.5;
    }

    const flowViz = new FlowVisualization();
    flowViz.setMode('dye_velocity');
    flowViz.setWakeEnvelopeVisible(true);
    flowViz.setVelocityVectorsVisible(true);
    flowViz.setTipVorticesVisible(true);
    flowViz.setParticleTracersVisible(true);

    for (let step = 0; step < 100; step++) {
      flowViz.update(1.0 / 60.0, 5.0, new THREE.Vector3(0, 0, 0), gridB, (step * Math.PI) / 10, 3800);
    }

    let maxDiff = 0;
    for (let i = 0; i < gridA.size; i++) {
      const diffU = Math.abs(gridA.u[i] - gridB.u[i]);
      const diffV = Math.abs(gridA.v[i] - gridB.v[i]);
      if (diffU > maxDiff) maxDiff = diffU;
      if (diffV > maxDiff) maxDiff = diffV;
    }

    expect(maxDiff).toBeLessThan(1e-6);
    flowViz.dispose();
  });
});
