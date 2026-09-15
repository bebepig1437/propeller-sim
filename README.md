# SeaPerch Propeller & Vehicle Simulator — Candidate A

[![Deploy to GitHub Pages](https://github.com/bebepig1437/propeller-sim/actions/workflows/deploy.yml/badge.svg)](https://github.com/bebepig1437/propeller-sim/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Physics: 60Hz Symplectic](https://img.shields.io/badge/Physics-60Hz%20Symplectic-cyan.svg)](CONVENTIONS.md)

Physics-based, browser-runtime underwater vehicle simulator for **Candidate A** (Reconciled High-Burst Vector-Skewed Propulsor). Incorporates Blade Element Momentum Theory (BEMT), 2D Eulerian fluid coupling, electromechanical DC motor & tether electrical losses, slotted stator vane swirl recovery, and full 6-DOF rigid body dynamics.

---

## 🌊 Overview & Architecture

Candidate A is not merely a propeller animation—it is an underwater vehicle simulator where the fluid environment and the physical robot dynamically interact across multiple domains:

```
                                  ┌────────────────────────┐
                                  │  Candidate A JSON Spec │
                                  └───────────┬────────────┘
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼
        ┌─────────────────────────┐                       ┌─────────────────────────┐
        │ Electrical Tether & Bus │                       │  Hydrostatics (CoB/CoG) │
        │ 15ft 24AWG, V_sag, Derat│                       │ +0.197N Buoy, 12.5mm Arm│
        └────────────┬────────────┘                       └────────────┬────────────┘
                     │ Terminal Voltage                                │ Restoring Torque
                     ▼                                                 ▼
        ┌─────────────────────────┐                       ┌─────────────────────────┐
        │  Mabuchi RC-280RA Model │                       │  6-DOF Dynamics Engine  │
        │ Equilibrium RPM & Torque│                       │ Symplectic Euler & Drag │
        └────────────┬────────────┘                       └────────────▲────────────┘
                     │ RPM, Torque                                     │
                     ▼                                                 │ Prop Forces & Moments
        ┌─────────────────────────┐   Inflow Va   ┌────────────────────┴────┐
        │ Continuous-Inflow BEMT  │◄──────────────┤ Actuator Disc Coupler   │
        │ Post-Stall Polar Blend  ├──────────────►│ Thrust & Swirl Injection│
        └────────────┬────────────┘  Thrust/Torque└────────────▲────────────┘
                     │                                         │
                     ▼                                         ▼
        ┌─────────────────────────┐                       ┌─────────────────────────┐
        │ Stator Swirl Recovery   │                       │ 2D Eulerian Fluid Core  │
        │ +0.04N Gain, Roll Cancel│                       │ MacCormack + Vorticity  │
        └─────────────────────────┘                       └─────────────────────────┘
```

---

## 🚀 Key Physical Models

### 1. 2D Eulerian Fluid Core (`src/fluid/`)
- Uniform $256 \times 128$ (or $1024 \times 512$ Ultra) grid with ping-pong `Float32Array` buffers.
- Switchable advection: 1st-order **Semi-Lagrangian** or 2nd-order unconditionally monotonic **MacCormack**.
- **Fedkiw Vorticity Confinement** restoring sub-grid turbulent energy and vortex rings.
- Discrete Poisson pressure solve with Jacobi relaxation or Multigrid V-Cycle.
- Automatic **WebGPU compute (TSL)** with zero-dependency **CPU reference fallback**.

### 2. 3D Water Free Surface & Optics (`src/render/`)
- $512 \times 512$ vertex heightfield mesh ($262,144$ vertices) driven dynamically by the 2D fluid velocity field ($\frac{d\eta}{dt} = v_{\text{surf}} \cdot 0.15 - 4.0\eta$).
- 4-octave **Gerstner wave superposition** with tunable amplitude and frequency for fine capillary ripple detail.
- **Physical Water Material**: Screen-space refraction (`transmission: 0.88`, $\eta = 1.333$), Beer-Lambert exponential depth absorption, Fresnel reflection-refraction balance, and clearcoat specular highlights.
- **Dual Scrolling Normal Maps**: Procedural micro-facet ripple generator (`DualScrollingNormalMapGenerator`).
- **Dynamic Vorticity Foam**: Real-time vertex color modulation generating soft-edged white aerated foam where local vorticity shear exceeds `foamThreshold`.
- **Submerged Test Tank**: Transparent acrylic/glass walls (`ior: 1.52`, `opacity: 0.22`), floor scale reference grid, and animated caustic filaments.
- **Environment & Lighting**: Procedural sky dome with horizon atmospheric gradient and tunable sun direction.
- **Camera Controls**: Three.js OrbitControls with interactive **"Side Cutaway View"** preset for direct cross-sectional fluid vector analysis.

### 3. Blade Element Momentum Theory (`src/prop/`)
- Sectional hydrofoil lift and drag polars with **Viterna-Corrigan post-stall blending**.
- Unconditionally continuous quadratic momentum equation solving for positive induced inflow $v_i$ for all advance speeds $V_a \ge 0$.
- Candidate A rotational inertia variants:
  - **Rigid 10K** ($1.80\,\text{g}$, $\tau = 12.5\,\text{ms}$)
  - **PA12-CF15** ($1.25\,\text{g}$, $\tau = 8.7\,\text{ms}$)
  - **PETG** ($1.38\,\text{g}$, $\tau = 9.6\,\text{ms}$)

### 3. DC Motor & Tether Electrical Network (`src/power/`, `src/prop/motor.ts`)
- Electromechanical DC motor model: $R_a = 4.50\,\Omega$, $I_0 = 0.18\,\text{A}$, $K_t = 0.01171\,\text{N}\cdot\text{m/A}$, $K_e = 0.00973\,\text{V}\cdot\text{s/rad}$.
- Non-linear multi-motor power distribution bus with **$15\,\text{ft}$ $24\,\text{AWG}$ roundtrip tether sag** ($R_{\text{tether}} = 0.782\,\Omega$).
- First-order thermal dissipation tracking motor winding heat and burst duration windows.

### 4. Slotted Stator Vane Swirl Recovery & Torque Ledger (`src/prop/stator.ts`, `src/prop/torqueLedger.ts`)
- Modified NACA 63-012 stator cascade with $40\%$ slotted chord and $-5.2^\circ$ incidence.
- Swirl momentum recovery yielding **$+0.04\,\text{N}$ thrust boost** at breakout condition.
- Counter-rotating Port (CW) and Starboard (CCW) propellers combined with stator counter-torque cancel **$>90\%$ of roll reaction moment**, cutting residual roll from $14.8^\circ/\text{m}$ down to $1.8^\circ/\text{m}$.
- Gyroscopic precession cross-product torque ledger: $\vec{\tau}_{\text{gyro}} = \vec{\omega}_{\text{pitch}} \times \mathbf{I}_{\text{prop}} \vec{\omega}_{\text{spin}}$.

### 5. 6-DOF Vehicle Rigid Body Dynamics & Hydrostatics (`src/vehicle/`)
- **Dry mass**: $179.9\,\text{g}$ ($0.1799\,\text{kg}$); **Displaced mass**: $0.2000\,\text{kg}$ ($200\,\text{cm}^3$ at $1000\,\text{kg/m}^3$).
- **Net Positive Buoyancy**: $+0.1971\,\text{N}$ upward force.
- **Metacentric Restoring Moment**: Center of Buoyancy $12.5\,\text{mm}$ directly above Center of Gravity along body vertical axis ($+Y_b$), self-righting roll and pitch perturbations via closed-form zero-allocation quaternion formulation.
- **Added Mass Matrix**: Hydrodynamic virtual mass and inertia entrained in surge, sway, and heave.
- **Test Tank Boundaries**: Floor contact clamping ($y \ge -0.25\,\text{m}$), free surface limit ($y \le +0.22\,\text{m}$), and cylindrical wall clamping ($r \le 1.1\,\text{m}$).

### 6. Scientific 3D Overlays & Telemetry Instrumentation (`src/render/overlays.ts`, `src/ui/`)
- **3D Vectors**: Cyan thruster thrust arrows, emerald green net thrust vector, reaction torque circular arcs.
- **Contracting Streamtube Envelope**: Wireframe streamtubes visualizing BEMT slipstream contraction downstream ($R_\infty = R_0 \sqrt{\frac{V_a + v_i}{V_a + 2v_i}}$).
- **HUD & Stripchart**: Live heads-up display with operating presets (`BREAKOUT`, `HEAVY LIFT`, `CRUISE`, `FULL DIVE`, `REVERSE STATION`), manual throttle slider, and 4-channel real-time rolling canvas stripchart.

---

## ⚡ Performance Benchmarks

All hot paths are strictly zero-allocation, eliminating garbage collection micro-stutter during continuous $60\,\text{Hz}$ execution:

| Subsystem | Execution Time (CPU) | Frame Budget | Margin |
| :--- | :--- | :--- | :--- |
| **Eulerian Fluid Core** ($256 \times 128$) | $5.8 - 8.5\,\text{ms}$ | $10.0\,\text{ms}$ | **PASS** |
| **Continuous-Inflow BEMT** | $0.08\,\text{ms}$ | $0.20\,\text{ms}$ | **PASS** |
| **DC Motor & Tether Network** | $0.05\,\text{ms}$ | $0.15\,\text{ms}$ | **PASS** |
| **Actuator Disc Coupling** | $0.35\,\text{ms}$ | $1.00\,\text{ms}$ | **PASS** |
| **6-DOF Rigid Body Integrator** | $0.04\,\text{ms}$ | $0.15\,\text{ms}$ | **PASS** |
| **Full End-to-End Pipeline Step** | **$6.93\,\text{ms}$** | **$16.67\,\text{ms}$** | **2.4× Real-Time** |

---

## 🛠️ Getting Started

### Prerequisites
- Node.js 20+ (Node 22 LTS recommended)
- Modern browser with WebGL2 or WebGPU support

### Installation & Development
```bash
# Clone the repository
git clone https://github.com/bebepig1437/propeller-sim.git
cd propeller-sim

# Install dependencies
npm install

# Start development server
npm run dev
```

Visit `http://localhost:5173/` in your browser.

### Running Tests
```bash
# Run the complete automated test suite (85 tests across 11 suites)
npm test
```

### Production Build
```bash
# Typecheck and bundle with Vite
npm run build
```

---

## 📐 Conventions & Coordinate Systems

Detailed coordinate frames, sign conventions, and SI units are documented in [CONVENTIONS.md](CONVENTIONS.md):
- **World Frame**: $+X$ Starboard, $+Y$ Up (anti-gravity), $+Z$ Aft, $-Z$ Fore.
- **Vehicle Body Frame**: $+X_b$ Sway (Starboard), $+Y_b$ Heave (Up / Dorsal), $+Z_b$ Surge (Bow / Forward).
- **Hydrostatic Stability**: $\vec{r}_{\text{CoB}} = (0, +0.0125\,\text{m}, 0)$ relative to CoG.

---

## 📄 License
MIT License. Created for SeaPerch Autonomous Vehicle & Propeller Hydrodynamics Research.
