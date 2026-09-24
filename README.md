# Propeller Pipe Flow Simulation

This tool simulates a propeller operating in a controlled water flow. It measures the thrust and torque the propeller produces at a given RPM and inflow speed, and shows the resulting wake.

[![Deploy to GitHub Pages](https://github.com/bebepig1437/propeller-sim/actions/workflows/deploy.yml/badge.svg)](https://github.com/bebepig1437/propeller-sim/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Physics: 60Hz Symplectic](https://img.shields.io/badge/Physics-60Hz%20Symplectic-cyan.svg)](CONVENTIONS.md)

---

## 1. Overview & Test Stand Scene

The simulation models an enclosed cylindrical test pipe through which fluid flows axially:

1. **Test Pipe:** Transparent 1.0 m cylindrical tube along the +X axis (radius: 0.06 m).
2. **Centerline Shaft:** Mechanical through-shaft running along the pipe axis.
3. **Propeller:** 42 mm parametric rotor (Candidate A, Kaplan, or Wageningen B-Series) mounted at 25% of pipe length from the inlet, spinning unconditionally at live physical RPM.
4. **Flow Visualization:** Particle slipstream and hub thrust force vector indicating momentum transfer.
5. **Telemetry HUD:** Exactly four live physical readouts: Thrust ($N$), Torque ($mN\cdot m$), Shaft Speed ($\text{RPM}$), and Inflow Speed ($m/s$).

---

## 2. Physics Pipeline

Every simulation substep executes a deterministic physical chain:

1. **Shaft Dynamics:** `shaft.update(dt)` advances rotor phase angle ($\text{bladePhaseRad}$) and rotational velocity.
2. **Inflow Sampling:** `coupler.sampleInflowVelocity(grid)` samples axial flow velocity at the propeller disk.
3. **BEMT Aerodynamics:** `solveBemt(rpm, advanceSpeed, { design, pitchMm })` solves sectional lift/drag equations with Viterna post-stall extrapolation.
4. **Actuator Disk Coupling:** `coupler.injectCouplingForces(grid, bemt, dt)` transfers momentum directly into the Eulerian fluid velocity field.
5. **Fluid Simulation:** `gpuFluidSolver.step(dt)` executes real-time incompressible Navier-Stokes projection on the GPU.

---

## 3. Local Development & Verification

### Commands
```bash
# 1. Install dependencies
npm ci

# 2. Run automated test suite
npm test

# 3. Run performance benchmark
npm run bench

# 4. Check TypeScript types
npx tsc --noEmit

# 5. Build production bundle
npm run build

# 6. Launch local dev server
npm run dev
```
