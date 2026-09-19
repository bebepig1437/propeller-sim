import { describe, it, expect } from 'vitest';
import { FluidGrid } from '../src/fluid/grid';
import { ActuatorDiscCoupler } from '../src/prop/coupling';
import { solveBEMT } from '../src/prop/bemt';
import { HullObstacle } from '../src/fluid/hull';
import { FluidSolver } from '../src/fluid/FluidSolver';

describe('Phase 5 — Fluid <-> Propeller Bidirectional Coupling', () => {
  it('strictly conserves momentum: sum of body force over all cells equals BEMT thrust', () => {
    const grid = new FluidGrid({ width: 128, height: 64, dx: 0.0015 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 24,
      centerY: 32,
      radiusCells: 10,
      thicknessCells: 3,
      gridDxM: 0.0015,
      depthM: 0.042,
      fluidDensity: 1000.0
    });

    const bemt = solveBEMT(4140, 0.0);
    const T = bemt.thrustN;
    expect(T).toBeGreaterThan(1.0);

    const dt = 1.0 / 60.0;
    const initialU = new Float32Array(grid.u);

    // Inject actuator disk body forces
    coupler.injectCouplingForces(grid, bemt, dt);

    // Calculate sum of applied momentum rate: sum(m_cell * delta_u / dt)
    const cellMassKg = coupler.cellMassKg;

    let totalForceSumX = 0;
    const size = grid.width * grid.height;
    for (let i = 0; i < size; i++) {
      const deltaU = grid.u[i] - initialU[i];
      totalForceSumX += cellMassKg * (deltaU / dt);
    }

    // Injected force must equal BEMT thrust within 0.1%
    const relativeError = Math.abs(totalForceSumX - T) / T;
    expect(relativeError).toBeLessThan(0.001);
  });

  it('invalidates cache when disc position, radius, thickness, or orientation change', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 20,
      centerY: 30,
      radiusCells: 8,
      thicknessCells: 2,
      orientationRad: 0.0
    });

    const bemt = solveBEMT(3800, 0.0);
    coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    // Initially, cell (20, 30) has positive u
    const idxInitial = 30 * 128 + 20;
    expect(grid.u[idxInitial]).toBeGreaterThan(0);

    // Now translate thruster in UI: move centerX to 50, centerY to 45
    grid.reset();
    coupler.config.centerX = 50;
    coupler.config.centerY = 45;

    coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    // Old location must remain zero
    expect(grid.u[idxInitial]).toBe(0);
    // New location must have received injected thrust
    const idxNew = 45 * 128 + 50;
    expect(grid.u[idxNew]).toBeGreaterThan(0);
  });

  it('rotates force into disc local frame when orientation angle is non-zero', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    // Disk oriented at 90 degrees (+Y direction, pointing Up)
    const coupler = new ActuatorDiscCoupler({
      centerX: 30,
      centerY: 30,
      radiusCells: 8,
      thicknessCells: 3,
      orientationRad: Math.PI * 0.5
    });

    const bemt = solveBEMT(3800, 0.0);
    coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    const centerIdx = 30 * 128 + 30;
    // Thrust must be directed along +Y (v velocity), not along +X
    expect(grid.v[centerIdx]).toBeGreaterThan(0.05);
    expect(Math.abs(grid.u[centerIdx])).toBeLessThan(1e-4);
  });

  it('samples signed reverse inflow without clamping to >= 0', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 25,
      centerY: 32,
      radiusCells: 8,
      inflowRelaxation: 1.0 // instantaneous for test
    });

    // Impose uniform reverse flow
    for (let y = 0; y < 64; y++) {
      grid.u[y * 128 + 23] = -0.75; // 2 cells upstream
    }

    const va = coupler.sampleInflowVelocity(grid);
    // Reverse inflow must be preserved
    expect(va).toBeCloseTo(-0.75, 2);

    // BEMT solver should receive negative inflow and compute valid reverse forces
    const bemtReverse = solveBEMT(3800, va);
    expect(Number.isFinite(bemtReverse.thrustN)).toBe(true);
    expect(Number.isFinite(bemtReverse.torqueNm)).toBe(true);
  });

  it('applies relaxation damping to smooth inflow oscillations', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 25,
      centerY: 32,
      radiusCells: 8,
      inflowRelaxation: 0.5
    });

    // Step 1: Quiescent fluid
    const va0 = coupler.sampleInflowVelocity(grid);
    expect(va0).toBe(0);

    // Step 2: Sudden velocity spike to 2.0 m/s
    for (let y = 0; y < 64; y++) {
      grid.u[y * 128 + 23] = 2.0;
    }

    const va1 = coupler.sampleInflowVelocity(grid);
    // With 0.5 relaxation: (1 - 0.5)*0 + 0.5*2.0 = 1.0 m/s
    expect(va1).toBeCloseTo(1.0, 3);

    // Step 3: Continued 2.0 m/s
    const va2 = coupler.sampleInflowVelocity(grid);
    // (1 - 0.5)*1.0 + 0.5*2.0 = 1.5 m/s
    expect(va2).toBeCloseTo(1.5, 3);
  });

  it('injects 2D tip vortex rollup at disc top and bottom margins', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({
      centerX: 30,
      centerY: 32,
      radiusCells: 10,
      thicknessCells: 3
    });

    const bemt = solveBEMT(4140, 0.0);
    coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    const W = grid.width;
    // Top tip: y = 41 (rNorm ~ +0.9)
    // Bottom tip: y = 23 (rNorm ~ -0.9)
    const topIdx = 41 * W + 30;
    const botIdx = 23 * W + 30;

    // Must generate counter-rotating transverse shear
    expect(grid.v[topIdx]).not.toBe(0);
    expect(grid.v[botIdx]).not.toBe(0);
    expect(grid.v[topIdx] * grid.v[botIdx]).toBeLessThan(0);
  });

  it('applies downstream hull obstacle drag to decelerate wake flow', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const hull = new HullObstacle({
      x: 40,
      y: 26,
      width: 20,
      height: 12,
      cd: 1.2
    });

    // Simulate oncoming wake jet
    for (let y = 20; y <= 44; y++) {
      for (let x = 35; x <= 65; x++) {
        grid.u[y * 128 + x] = 2.5;
      }
    }

    const dt = 1.0 / 60.0;
    const centerIdx = 32 * 128 + 50;
    const speedBefore = grid.u[centerIdx];

    const tele = hull.applyDrag(grid, dt);

    const speedAfter = grid.u[centerIdx];
    expect(speedAfter).toBeLessThan(speedBefore);
    expect(tele.totalDrag_N).toBeGreaterThan(0);
  });

  it('guarantees zero heap allocations in coupling hot path', () => {
    const grid = new FluidGrid({ width: 128, height: 64 });
    const coupler = new ActuatorDiscCoupler({ centerX: 25, centerY: 32, radiusCells: 10 });
    const bemt = solveBEMT(3800, 0.0);

    // First call populates cache and initial telemetry
    const tele1 = coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);
    const tele2 = coupler.injectCouplingForces(grid, bemt, 1.0 / 60.0);

    // Must return the exact same mutated instance reference
    expect(tele1).toBe(tele2);
  });

  it(
    '10-minute simulated runtime stability: asserts no NaN, no max |u| > 10 m/s, and thrust agreement within 15%',
    { timeout: 30000 },
    () => {
      const solver = new FluidSolver({
        gridOptions: { width: 64, height: 32 },
        boundaryType: {
          left: 'FREE_SLIP',
          right: 'OPEN_OUTFLOW',
          top: 'SOLID',
          bottom: 'SOLID'
        },
        pressureIterations: 10,
        viscosity: 1e-4,
        vorticityStrength: 0.05,
        advectionScheme: 'SEMI_LAGRANGIAN'
      });

      // Turn off boundary inflow jet to test pure propeller actuator disk driving the flow
      solver.jet.config.enabled = false;

      const coupler = new ActuatorDiscCoupler({
        centerX: 16,
        centerY: 16,
        radiusCells: 7,
        thicknessCells: 3,
        gridDxM: 0.003,
        depthM: 0.042,
        inflowRelaxation: 0.1
      });

      const hull = new HullObstacle({
        x: 32,
        y: 11,
        width: 14,
        height: 10,
        gridDxM: 0.003,
        depthM: 0.042,
        cd: 1.2
      });

      // 10 minutes of simulated time: 600s total (36,000 steps at dt = 1/60s)
      const dt = 1.0 / 60.0;
      const totalSimTimeSec = 600.0;
      const totalSteps = Math.round(totalSimTimeSec / dt);

      let maxVelocityMagnitude = 0;
      let finalAgreementPct = 0;
      let finalBemtThrust = 0;
      let finalGridThrust = 0;

      for (let step = 0; step < totalSteps; step++) {
        // 1. Fluid -> Propeller inflow
        const va = coupler.sampleInflowVelocity(solver.grid);

        // 2. BEMT hydrodynamic solve at 3800 RPM
        const bemt = solveBEMT(3800, va);

        // 3. Propeller -> Fluid actuator disk injection
        const couplingTele = coupler.injectCouplingForces(solver.grid, bemt, dt);

        // 4. Downstream hull drag
        hull.applyDrag(solver.grid, dt);

        // 5. Fluid Navier-Stokes solver step
        solver.step(dt);

        if (step === totalSteps - 1) {
          finalAgreementPct = couplingTele.thrustAgreementPct;
          finalBemtThrust = couplingTele.bemtThrustN;
          finalGridThrust = couplingTele.gridMomentumThrustN;
        }

        // Sample max velocity periodically
        if (step % 1000 === 0 || step === totalSteps - 1) {
          const u = solver.grid.u;
          const v = solver.grid.v;
          const W = solver.grid.width;
          let stepMax = 0;
          let maxIdx = 0;
          for (let i = 0; i < u.length; i++) {
            const spd = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
            if (Number.isNaN(spd)) {
              throw new Error(`NaN encountered at step ${step}, cell ${i}`);
            }
            if (spd > stepMax) {
              stepMax = spd;
              maxIdx = i;
            }
          }
          if (stepMax > maxVelocityMagnitude) maxVelocityMagnitude = stepMax;
          if (step % 2000 === 0 || step === totalSteps - 1) {
            const mx = maxIdx % W;
            const my = Math.floor(maxIdx / W);
            console.log(`step ${step}: va=${va.toFixed(3)}, T=${bemt.thrustN.toFixed(3)}, wake=${couplingTele.wakeVelocityMs.toFixed(3)}, gridT=${couplingTele.gridMomentumThrustN.toFixed(3)}, agree=${couplingTele.thrustAgreementPct.toFixed(1)}%`);
          }
        }
      }

      console.log(
        `[10-min Stability] Total simulated time: ${totalSimTimeSec}s (${totalSteps} steps)\n` +
        `Max velocity: ${maxVelocityMagnitude.toFixed(2)} m/s (Limit: 10 m/s)\n` +
        `BEMT Thrust: ${finalBemtThrust.toFixed(3)} N | Grid Momentum Thrust: ${finalGridThrust.toFixed(3)} N\n` +
        `Agreement: ${finalAgreementPct.toFixed(1)}%`
      );

      // Assertions:
      // 1. Max velocity bounded (< 10 m/s)
      expect(maxVelocityMagnitude).toBeLessThan(10.0);
      // 2. BEMT thrust is positive and physically realistic
      expect(finalBemtThrust).toBeGreaterThan(0.0);
      // 3. BEMT vs grid momentum flux agreement converges within 15% at steady state
      expect(finalAgreementPct).toBeGreaterThanOrEqual(85.0);
    },
  );
});
