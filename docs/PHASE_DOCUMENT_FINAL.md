# prop-sim — Complete Phase Document (Final)

Everything in one place. Master context, reference oracles, design language, JSON schema, all 13 phases fully detailed, critical rules, and execution order.

---

## 0. Master Context Block

Paste this into AGY as a persistent rules file (`.agy/rules.md` or `AGENTS.md`) at project start. It applies to every phase.

```text
PROJECT: prop-sim — real-time interactive underwater vehicle simulator with
fluid coupling, controllable-pitch propellers, and live force readouts.
Runs in the browser. No server. No build step for the end user.

RUNTIME: modern Chrome/Edge. WebGPU preferred, WebGL2 fallback required.

STACK:
- Vite + TypeScript (strict)
- three.js with WebGPURenderer + TSL (Three Shading Language)
- Tweakpane for controls
- Vitest for physics unit tests
- GitHub Actions → GitHub Pages for deploy

ARCHITECTURE (do not deviate):
- 2D Eulerian grid is the physics truth: velocity, pressure, dye.
- Rendering is 3D: free surface is a heightfield driven by the 2D field.
- Propellers are actuator disks + BEMT. Blades are rendered but not
  resolved in the fluid grid.
- Motor + tether electrical model sits between throttle command and RPM.
- Vehicle is a 6-DOF rigid body with buoyancy and added mass.
- Fixed timestep with accumulator, substeps, render interpolation.
- All tunables live in src/core/config.ts as one typed object.
- Vehicle-specific data lives in public/vehicles/*.json. Never hardcode
  vehicle parameters in TypeScript.
- No circular imports. Use the registry for cross-module access.
- Every phase must end with a runnable `npm run dev` and no TS errors.

CONVENTIONS:
- SI units everywhere internally. Display units in UI only.
- Coordinate system: Three.js world frame is right-handed (+X East/downstream,
  +Y Up, +Z Aft/into screen). Document it in a header comment in core/config.ts.
- Marine 6-DOF body frame: Surge = +X, Sway = +Y, Heave = +Z.
  Roll = X, Pitch = Y, Yaw = Z.
- Right-handed. Quaternions for orientation, Euler only for display.
- All GPU passes get a name and a timestamp query.
- Comment the math. Cite the paper inline where an algorithm comes from.
- Sign conventions are documented in a single CONVENTIONS.md at repo root.
  Every module that flips a sign references that file.

REFERENCE ORACLES (use for validation, not as dependencies):
- BEMT: XROTOR (Drela), OpenProp, NACA TR-594 / TR-640 / TR-658
  tabulated Ct/Cp/eta vs J. UIUC airfoil database for polars.
- Fluid: Stam 1999 "Stable Fluids", Harris GPU Gems 1 Ch. 38,
  PhiFlow (CPU/GPU reference for 2D Eulerian).
- Motor + prop equilibrium: QPROP (Drela), Mabuchi RS-280 datasheet.
- 6-DOF underwater: Fossen "Handbook of Marine Craft", MSS toolbox,
  UUV Simulator. BlueROV2 published thrust/power curves for
  real-thruster sanity checks.
- Propeller OW tests: ITTC recommended procedures for open-water tests.

VALIDATION RULE: every physics module that has a public oracle must
ship with a Vitest that compares against it and reports % error. If
the error exceeds the phase tolerance, the phase is not done.

NO THIRD-PARTY RUNTIME DEPENDENCIES. Oracles are compared offline or
in tests. They are never imported into src/.

CURRENT PHASE: <phase number and name>
DELIVERABLE FOR THIS PHASE: <paste from phase prompt>
```

---

## Reference Oracles and What Each Phase Validates Against

```text
Phase 1   Fluid CPU        -> Stam 1999, Harris GPU Gems 1 Ch. 38.
                              PhiFlow 2D Eulerian for a fixed IC.
Phase 2   Fluid GPU        -> CPU reference (Phase 1) is the oracle.
                              Readback round-trip is the acceptance gate.
Phase 3   Water rendering  -> visual only. Pavel Dobryakov WebGL fluid
                              sim as a plausibility reference, not an oracle.
Phase 4   BEMT             -> XROTOR / OpenProp for the same geometry and
                              J sweep. UIUC polars for section lift/drag.
                              NACA TR-594 for end-to-end Kt/Kq/eta.
Phase 4b  Motor + tether   -> QPROP for motor-prop equilibrium. Mabuchi
                              RS-280 datasheet for Ra, Io, kt, ke. Spec
                              anchor points (3800 RPM / 10.82 V / 1.25 A).
Phase 5   Coupling         -> internal: BEMT thrust vs grid momentum flux
                              must converge within 15%. No public oracle.
Phase 5b  Stator / ledger  -> spec IMU numbers (1.8 vs 14.8 deg/m).
                              No public oracle for the slotted vane; label
                              empirical constants as empirical.
Phase 6   Overlays         -> visual only.
Phase 6b  6-DOF            -> Fossen MSS / UUV Simulator for step-response
                              trajectory comparison. BlueROV2 for
                              added-mass and drag coefficient ranges.
Phase 7   UI / presets     -> spec operating_points table.
Phase 8   Perf             -> internal budget. No oracle.
Phase 9   Ship             -> ITTC open-water procedures for the
                              validation plot format.
```

---

## Design Language

The app is a physics instrument, not a dashboard. It should read the way IBM Quantum Composer reads: a small stage, a small palette, a Run button, and everything else behind a tab or a fold. The default view must be comprehensible to someone who has never seen the simulator. Depth is opt-in.

### Principles

1. **One primary action.**
   RUN is the only prominent button. Everything else is either a discrete control in the left palette or a toggle in the right inspector. There is never a second button competing with RUN for the eye.

2. **Stage first, chrome second.**
   The 3D viewport occupies the majority of the window at rest. The palette and inspector are narrow and collapse to icons below a breakpoint. The user's first impression is water, a vehicle, and a propeller, not a control panel.

3. **Physical primitives, not parameters.**
   The user drags a thruster, not a "position vector". The user rotates a stator, not a "vane incidence angle". Every numeric field is a fallback for the direct manipulation, not the primary interface. IBM's composer does this with gates; you do it with thrusters, vanes, and the vehicle.

4. **Orthogonal controls.**
   Each control changes exactly one physical thing. No control changes "performance mode" and silently alters three unrelated parameters. If a preset needs to change several things, it is a preset, not a slider.

5. **Closed by default.**
   Advanced physics (added mass, drag coefficients, thermal constants, solver tolerances) is behind an "Advanced" fold. It is never on screen at rest. The user who needs it knows to look; the user who does not is not intimidated.

6. **Numbers in the HUD, prose in the panel.**
   The HUD shows live values with units. The panel shows what each control does in one short sentence, and nothing else. No physics lectures in the UI.

7. **One accent color per meaning.**
   Thrust is one color. Torque is another. Heat is a third. Current is a fourth. These are used consistently across the 3D overlays, the HUD, and the stripcharts. The user learns the mapping once.

### Layout

```text
Desktop (>= 1280px):
  +----------------------------------------------------------+
  |  header: title  |  preset dropdown  |  RUN  |  share     |
  +---------+--------------------------------------+---------+
  |         |                                      |         |
  | palette |              STAGE                   | inspector|
  |  (left) |            (3D viewport)             | (right) |
  |         |                                      |         |
  |         |                                      |         |
  +---------+--------------------------------------+---------+
  |  HUD strip: thrust torque rpm current temp | fps        |
  +----------------------------------------------------------+

Tablet (>= 768px):
  Palette collapses to icons. Inspector becomes a bottom sheet.

Phone (< 768px):
  Stage only, with a single floating RUN. Everything else is a sheet.
```

- **Palette (left, top to bottom):**
  - Vehicle: load candidateA, load custom, reset pose
  - Thrusters: add, remove, select. Selected thruster highlights in the stage.
  - Stator: attach / detach to selected thruster, slot on/off
  - Prop design: candidateA / kaplan / wageningen
  - Material: rigid10k / pa12cf15 / petg
  - Presets: the five operating points

- **Inspector (right, only the selected object's controls):**
  - If nothing selected: run settings (supply V, tether length, ambient temp, thermal on/off)
  - If a thruster selected: throttle, RPM, pitch, handedness, stator
  - If the vehicle selected: mass props (read-only), tether anchor, drag coefficients under Advanced
  - If the fluid selected (via stage click): viscosity, vorticity, inflow, resolution scale

- **Stage:**
  - Orbit camera. Scroll zoom. Right-drag pan.
  - Click a thruster to select. Selected object gets a subtle outline.
  - Cutaway toggle is a small icon in the stage corner, not a panel item.
  - Overlay toggles are a vertical strip of icons on the stage's right edge, each with a hover tooltip. Not in the panel.

- **HUD Strip (bottom, always visible):**
  - Left: thrust, torque, RPM, bus V, total current, max motor temp (exactly 6 values at rest; predicted roll rate is the 7th when stator/torque ledger active).
  - Right: fps, frame ms, GPU ms, current preset name / resolution multiplier.
  - Each value is monospace, right-aligned, unit-suffixed.
  - Clicking any value opens a small plot popover with that channel over the last 30s. This is the stripchart, on demand, not always on screen. Multiple popovers can be pinned in the stage corner.

- **Visual Language:**
  - Dark neutral background (`#0e1116` class), not pure black.
  - Water is the only saturated large surface. Everything else is grayscale plus the four accent colors.
  - Typography: one sans for labels, one monospace for numbers.
  - No drop shadows except on floating sheets. No gradients except the water and the colormaps.
  - Buttons: flat, single accent on hover, no rounded-3xl pills.
  - Iconography: single-weight line icons, consistent stroke.

- **Run Behavior:**
  - Press RUN. Within 2 seconds: water flows, prop spins, slipstream forms, HUD numbers populate, thermal timer starts.
  - Press RUN again: pause. Press again: resume. Never a separate stop button.
  - The Run button shows state: idle, running, paused, or error. It is the same button.

- **First-Run Experience:**
  - On first visit: stage renders with candidateA preloaded, all overlays off, RUN pulsing once. A single line of text under RUN: "Press RUN to start."
  - No tour. No modal. No tooltips on first load. The default state must be legible without explanation.

---

## 1. Vehicle JSON Schema

File: `public/vehicles/candidateA.json`

Every phase from 4 onward reads from this. No hardcoded vehicle numbers in TypeScript.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "UnderwaterVehicleConfig",
  "type": "object",
  "required": ["id", "name", "mass", "buoyancy", "motor", "tether", "propeller", "stator", "operating_points"],
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" },
    "mass": {
      "type": "object",
      "required": ["frame_g", "hardware_g", "motor_unit_g", "motor_count", "prop_g"],
      "properties": {
        "frame_g": { "type": "number" },
        "hardware_g": { "type": "number" },
        "motor_unit_g": { "type": "number" },
        "motor_count": { "type": "integer" },
        "prop_g": {
          "type": "object",
          "properties": {
            "rigid10k": { "type": "number" },
            "pa12cf15": { "type": "number" },
            "petg": { "type": "number" }
          }
        }
      }
    },
    "buoyancy": {
      "type": "object",
      "required": ["displaced_cm3", "rho_kg_m3", "cob_above_cog_mm"],
      "properties": {
        "displaced_cm3": { "type": "number" },
        "rho_kg_m3": { "type": "number" },
        "cob_above_cog_mm": { "type": "number" }
      }
    },
    "motor": {
      "type": "object",
      "required": ["model", "Ra_ohm", "Io_A", "kv_rpm_per_V", "kt_Nm_per_A", "ke_Vs_per_rad"],
      "properties": {
        "model": { "type": "string" },
        "Ra_ohm": { "type": "number" },
        "Io_A": { "type": "number" },
        "kv_rpm_per_V": { "type": "number" },
        "no_load_rpm_at_10v8": { "type": "number" },
        "stall_torque_Nm": { "type": "number" },
        "kt_Nm_per_A": { "type": "number" },
        "ke_Vs_per_rad": { "type": "number" }
      }
    },
    "tether": {
      "type": "object",
      "required": ["length_ft", "awg", "R_roundtrip_ohm", "supply_V"],
      "properties": {
        "length_ft": { "type": "number" },
        "awg": { "type": "integer" },
        "R_roundtrip_ohm": { "type": "number" },
        "supply_V": { "type": "number" }
      }
    },
    "propeller": {
      "type": "object",
      "required": ["D_mm", "hub_od_mm", "hub_len_mm", "blades", "KQ", "handedness"],
      "properties": {
        "D_mm": { "type": "number" },
        "hub_od_mm": { "type": "number" },
        "hub_len_mm": { "type": "number" },
        "blades": { "type": "integer" },
        "KQ": { "type": "number" },
        "blade_phase_offset_deg": { "type": "number" },
        "handedness": { "type": "array", "items": { "type": "string" } }
      }
    },
    "stator": {
      "type": "object",
      "required": ["vanes", "profile", "slot_chord_pct", "incidence_deg", "forward_thrust_gain_N", "reverse_thrust_penalty_N"],
      "properties": {
        "vanes": { "type": "integer" },
        "profile": { "type": "string" },
        "slot_chord_pct": { "type": "number" },
        "incidence_deg": { "type": "number" },
        "rake_deg": { "type": "number" },
        "forward_thrust_gain_N": { "type": "number" },
        "reverse_thrust_penalty_N": { "type": "number" },
        "roll_reduction_deg_per_m": { "type": "object" }
      }
    },
    "operating_points": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["label", "throttle", "rpm", "thrust_N", "current_A"]
      }
    }
  }
}
```

Concrete `candidateA.json` instance values:
```json
{
  "id": "candidateA",
  "name": "Reconciled High-Burst Vector-Skewed Propulsor",
  "mass": {
    "frame_g": 39.5,
    "hardware_g": 9.0,
    "motor_unit_g": 42.0,
    "motor_count": 3,
    "prop_g": { "rigid10k": 1.80, "pa12cf15": 1.25, "petg": 1.38 }
  },
  "buoyancy": {
    "displaced_cm3": 200.0,
    "rho_kg_m3": 1000.0,
    "cob_above_cog_mm": 12.5
  },
  "motor": {
    "model": "Mabuchi RC-280RA",
    "Ra_ohm": 4.50,
    "Io_A": 0.18,
    "kv_rpm_per_V": 907.4,
    "no_load_rpm_at_10v8": 9800,
    "stall_torque_Nm": 0.0260,
    "kt_Nm_per_A": 0.01171,
    "ke_Vs_per_rad": 0.00973
  },
  "tether": {
    "length_ft": 15,
    "awg": 24,
    "R_roundtrip_ohm": 0.782,
    "supply_V": 12.0
  },
  "propeller": {
    "D_mm": 42.0,
    "hub_od_mm": 8.0,
    "hub_len_mm": 11.0,
    "blades": 3,
    "KQ": 0.024,
    "blade_phase_offset_deg": 0,
    "handedness": ["CW", "CCW", "CW"]
  },
  "stator": {
    "vanes": 3,
    "profile": "modified NACA 63-012",
    "slot_chord_pct": 40,
    "incidence_deg": -5.2,
    "rake_deg": 35,
    "forward_thrust_gain_N": 0.04,
    "reverse_thrust_penalty_N": 0.09,
    "roll_reduction_deg_per_m": { "none": 14.8, "solid": 1.4, "slotted": 1.8 }
  },
  "operating_points": [
    { "label": "breakout",        "throttle":  1.000, "rpm": 4140, "thrust_N":  4.73, "current_A": 1.41, "burst_s": 18 },
    { "label": "heavy_lift",      "throttle":  0.881, "rpm": 3800, "thrust_N":  3.99, "current_A": 1.25, "burst_s": 50 },
    { "label": "cruise",          "throttle":  0.670, "rpm": 3000, "thrust_N":  2.49, "current_A": 0.85, "burst_s": null },
    { "label": "full_dive",       "throttle": -0.840, "rpm": 3650, "thrust_N": -2.82, "current_A": 1.18, "burst_s": 65 },
    { "label": "reverse_station", "throttle": -0.480, "rpm": 2100, "thrust_N": -0.93, "current_A": 0.51, "burst_s": null }
  ]
}
```

---

## 2. Phase Map

```text
Phase 0   Scaffold                        — repo, renderer, deploy pipeline
Phase 1   Fluid CPU reference             — correct physics before GPU
Phase 2   Fluid GPU port (TSL)            — same physics, 100x grid
Phase 3   Water rendering                 — 3D free surface + material
Phase 4   Propeller + BEMT + variants     — parametric prop, forces
Phase 4b  Motor + tether electrical       — throttle → RPM → current
Phase 5   Fluid ↔ prop coupling           — bidirectional momentum
Phase 5b  Multi-prop + CW/CCW + stator    — torque ledger
Phase 6   Overlays                        — vectors, heatmaps, forces
Phase 6b  Vehicle rigid body + buoyancy   — 6-DOF, stability
Phase 7   UI + telemetry + presets        — the RUN button
Phase 8   Perf + robustness               — worker, adaptive res, recovery
Phase 9   Ship                            — README, validation, deploy
```

---

## 3. Critical Rules — [REVISED & CONSOLIDATED]

1. **Config Immutability**: Values from `public/vehicles/candidateA.json` must be loaded dynamically into `src/core/config.ts`. Hardcoded physical specs in engine logic are forbidden.
2. **Fixed-Timestep Accumulator**: Simulation physics always steps at 60 Hz ($\Delta t = 1/60\,\text{s}$). Render interpolation ($\alpha \in [0, 1)$) smoothly bridges visual frames. Max 5 substeps per frame to prevent spiral of death.
3. **Renderer Fallback**: `WebGPURenderer` is the primary target with automated fallback to `WebGLRenderer` on unsupported clients.
4. **Zero-Allocation Hot Paths**: Inner loops, physics integrators, and fluid iterations must avoid garbage collection churn. Preallocate Float32Arrays and reuse scratch vectors.
5. **Physical Units**: Strict standard SI units internally (meters, kg, seconds, N, Nm, rad/s, V, A, Ohm, $\text{kg/m}^3$). Units shown in UI only.
6. **Coordinate Frame Fidelity**: Three.js world frame is right-handed (+X East/downstream, +Y Up, +Z Aft/into screen). Marine 6-DOF body frame: Surge = +X, Sway = +Y, Heave = +Z; Roll = X, Pitch = Y, Yaw = Z. Never map sway to X or heave to Y. Test with a pure-surge impulse that must not produce sway or heave motion.
7. **Phase Progression Gate**: Never skip CPU reference validation before GPU acceleration. Never start Phase 5 before Phase 4 is validated. Never start Phase 6b before Phase 5b passes.
8. **Fix GPU Readback Before Trusting Any GPU Number**: A `StorageBufferAttribute` in three.js TSL is a GPU-side buffer. The CPU Float32Arrays used to construct it are NOT updated by compute dispatches. Until explicitly read back, every consumer (rendering, telemetry, coupling, CPU fallback, compare mode) reads stale data. Phase 2 acceptance requires a readback round-trip test proving `grid.u/v/dye` reflect GPU dispatches.
9. **Compare Mode Must Compare, Not Self-Compare**: `GpuFluidSolver.runCompareValidation` must NOT call `cpuSolver.step()` on the live grid. Correct pattern:
   - Read GPU u/v/dye into separate arrays.
   - Copy live CPU grid into backup arrays.
   - Step a CPU solver owning the copy.
   - Diff GPU vs CPU copy.
   - Restore live CPU grid from the backup.
10. **BEMT Aerodynamic Recomputation & Tip Loss Denominator**: After the induction loop exits, recompute `vAxial`, `vTangential`, `W`, `phi`, `alpha`, `cl`, `cd` from the converged $v_i, v_{i\theta}$ before computing $dL, dD, dT, dQ$. Correct Prandtl tip loss denominator: $f_{\text{Tip}} = (B/2) \cdot (R - r) / (r \cdot \sin(\phi))$, NOT $/(R \cdot \sin(\phi))$. Clamp efficiency $\eta \in [0, 1]$.
11. **CW/CCW Tangential Sign Flip**: Tangential inflow at a blade section is $V_\theta = \omega r \pm V_{\text{swirl}}$. CW vs CCW changes the sign of the $\pm$. It is not a cosmetic mesh swap; it physically governs torque signs.
12. **Torque Ledger is the True Deliverable**: Net roll torque after stator rectification must match the spec's IMU numbers ($1.8^\circ/\text{m}$ with slotted stator vs $14.8^\circ/\text{m}$ without).
13. **The Two Hard Places**: High-resolution pressure solve (Phases 2 & 8) and bidirectional coupling stability (Phase 5). Substep, damp relaxation, and budget patience there.

---

## 4. Execution Order

1. Create repo. Paste Master Context Block, Reference Oracles, Design Language, and Consolidated Rules into persistent rules.
2. Copy the JSON schema and candidate A instance into `public/vehicles/candidateA.json`.
3. Run **Phase 0 — Scaffold**. Verify static layout, RUN button, responsive breakpoints. Tag `phase-0`.
4. Run **Phase 1 — Fluid CPU Reference**. Verify divergence $< 10^{-3}$, dye mass conservation, CFL guards, vorticity epsilon. Tag `phase-1`.
5. Run **Phase 2 — Fluid GPU Port**. Verify 1024x512 at 60fps, true GPU timestamp queries, readback test passes, compare mode clean. Tag `phase-2`.
6. Run **Phase 3 — Water Rendering**. Verify heightfield driven by authoritative fluid field, conservative height energy, foam decay, refraction stability. Tag `phase-3`.
7. Run **Phase 4 — Propeller + BEMT**. Procedural geometry, UIUC polar validation, $K_Q$ anchor ($12.58\,\text{mN}\cdot\text{m}$ at 3800 RPM), J-sweep. Tag `phase-4`.
8. Run **Phase 4b — Motor + Tether**. Reproduce $3800\,\text{RPM} / 10.82\,\text{V} / 1.25\,\text{A}$ anchor, thermal cutout at 18s (100% throttle, 20°C water). Tag `phase-4b`.
9. Run **Phase 5 — Coupling**. Bi-directional momentum transfer, 15% convergence between BEMT thrust and grid momentum flux. Tag `phase-5`.
10. Run **Phase 5b — Multi-Prop + Stator**. Alternating CW/CCW array, slotted stator roll torque reduction ($1.8^\circ/\text{m}$ vs $14.8^\circ/\text{m}$). Tag `phase-5b`.
11. Run **Phase 6 — Overlays**. Instanced arrows, streamlines, heatmaps, force/torque vectors, strict color palette, no persistent chrome on stage. Tag `phase-6`.
12. Run **Phase 6b — Vehicle Rigid Body**. 6-DOF semi-implicit Euler, positive buoyancy restoring (+0.197 N), hover & self-righting tests. Tag `phase-6b`.
13. Run **Phase 7 — UI + Presets**. Single RUN button, 5 Candidate A operating presets, 30s popover stripcharts, `/validation` route. Tag `phase-7`.
14. Run **Phase 8 — Perf + Robustness**. Web Worker physics/render, smooth 250ms adaptive resolution cross-fade, WebGPU recovery. Tag `phase-8`.
15. Run **Phase 9 — Ship**. Clean first-run experience, PWA offline, shareable URL state, validation report, deploy to Pages. Tag `phase-9`.

---

## Detailed Phase Specifications

### Phase 0 — Scaffold

**Goal:** Repo exists, blank three.js scene renders, design system initialized, responsive 3-region layout verified, deploy pipeline green.

```text
Build the full repo skeleton from the architecture. Empty modules with
typed exports and TODO comments are fine.

Repo shape:
prop-sim/
├─ index.html
├─ vite.config.ts
├─ package.json
├─ tsconfig.json
├─ CONVENTIONS.md
├─ .github/workflows/deploy.yml
├─ public/
│  ├─ polars/
│  └─ vehicles/candidateA.json
└─ src/
   ├─ main.ts
   ├─ core/
   │  ├─ clock.ts
   │  ├─ config.ts
   │  └─ registry.ts
   ├─ fluid/
   │  ├─ grid.ts
   │  ├─ advect.ts
   │  ├─ pressure.ts
   │  ├─ vorticity.ts
   │  ├─ boundary.ts
   │  └─ gpu/
   ├─ prop/
   │  ├─ bemt.ts
   │  ├─ geometry.ts
   │  ├─ polar.ts
   │  ├─ rigidbody.ts
   │  ├─ array.ts
   │  ├─ stator.ts
   │  ├─ torqueLedger.ts
   │  └─ designs/index.ts
   ├─ motor/
   │  └─ motor.ts
   ├─ power/
   │  ├─ tether.ts
   │  └─ bus.ts
   ├─ vehicle/
   │  ├─ body.ts
   │  ├─ buoyancy.ts
   │  ├─ drag.ts
   │  └─ integrator.ts
   ├─ render/
   │  ├─ renderer.ts
   │  ├─ surface.ts
   │  ├─ water.ts
   │  ├─ overlays.ts
   │  └─ particles.ts
   ├─ ui/
   │  ├─ panel.ts
   │  ├─ hud.ts
   │  └─ plots.ts
   └─ telemetry/
      ├─ gpuTimer.ts
      └─ logger.ts

> **Layout deviations (the shipped tree is authoritative).** Phase 0 sketched
> `src/prop/motor.ts` and `src/fluid/sources.ts`; neither path exists in the repo.
> The electromechanical DC motor model ships at `src/motor/motor.ts` (it is an
> electrical machine, not a propeller solver), and inflow/plume sources ship as
> `FluidSolver.jet` plus `src/fluid/FluidRenderer2D.ts` rather than as a separate
> module. Later phases also added `src/sim/`, `src/workers/`, `src/scene/`,
> `src/config/`, `src/types/`, and `src/validation.ts`. See CONVENTIONS.md §5 for the
> authoritative module map, including the two distinct coupling modules.

Requirements:
- Vite + TS strict + three.js + Tweakpane + Vitest installed.
- WebGPURenderer initialized with automatic WebGL2 fallback. Render an
  empty scene with a ground plane and an orbit camera.
- src/core/config.ts holds every tunable in one typed object.
- src/core/clock.ts implements a fixed-timestep accumulator (60 Hz sim,
  render interpolation, max 5 substeps per frame to avoid spiral of death).
- telemetry/gpuTimer.ts wraps timestamp queries, works on both backends.
- Tweakpane panel mounted, showing FPS and frame ms.
- CONVENTIONS.md documents coordinate system, sign conventions, units.
- GitHub Actions workflow deploying to Pages on push to main.

UI skeleton:
- Build the three-region layout (palette / stage / inspector) and
  the HUD strip as static shells. No functionality yet, just the
  regions, the dividers, and the responsive breakpoints.
- Add the RUN button in the header, wired to a no-op that logs.
- Confirm the stage is the largest region at every breakpoint.
- Ship the color tokens and typography as CSS variables in
  src/index.css. Every later phase uses these tokens, never raw hex.

ACCEPTANCE:
- `npm run dev` shows a lit plane + stats panel.
- `npm run build` succeeds.
- Pushing to main publishes a live URL.
- CONVENTIONS.md exists and is accurate.
- Resizing from 1920 to 375 does not break the layout.
- The stage is always the largest region.
- No control is visible at rest that is not in the palette,
  inspector, header, or HUD strip.
```

---

### Phase 1 — Fluid CPU Reference

**Goal:** Correct physics on the CPU before parallelizing. Do not skip.

```text
Implement a 2D Eulerian fluid on a uniform grid, CPU-only, typed arrays.
Grid default 256x128, configurable. In src/fluid/:

grid.ts:
- Ping-pong Float32Array buffers for u, v (velocity), pressure,
  divergence, dye, curl.
- get/set with bounds checking. Interior vs boundary handling explicit.

advect.ts:
- Semi-Lagrangian first. Add MacCormack as a switchable mode.
- MacCormack: forward advect, backward advect, correct, clamp to
  local min/max to prevent overshoot.

vorticity.ts:
- Curl computation from velocity.
- Vorticity confinement force (Fedkiw 2001, "Visual Simulation of Smoke").
  Cite the paper in a header comment. Force = eps * h * (N × omega).
- Protect against zero division: VORTICITY_GRADIENT_EPSILON = 1e-7.

pressure.ts:
- Jacobi Poisson solve. Configurable iteration count (default 40).
- Report residual after each iteration so convergence is visible.
- Optionally a multigrid mode (start with Jacobi; add multigrid in Phase 2
  if Jacobi at 1024x512 can't hit 60fps).

sources.ts:
- Rectangular inflow jet that injects velocity + dye at a configurable
  boundary region. Used in Phase 5 for the propeller body force.

boundary.ts:
- Solid walls, open outflow, free-slip. Selectable per edge.

Wire it into the RAF loop at fixed timestep (60 Hz). Render the dye field
to a debug canvas overlay (2D, not the 3D scene yet). Add Tweakpane controls:
viscosity, vorticity strength, pressure iterations, inflow velocity,
inflow on/off button.

Vitest tests:
- Divergence of the field after projection is ~0 (max abs < 1e-3).
- A single injected vortex conserves total dye mass within 1%.
- Pressure residual decreases monotonically over iterations.
- CFL guard test: inject a velocity spike that would violate CFL at
  dt=1/60 and verify the solver substeps or clamps rather than
  producing NaN.
- Vorticity confinement epsilon test: in an irrotational field, verify
  the confinement force is exactly zero (no NaN from dividing by
  |grad|omega|| ~ 0). Epsilon threshold must be documented.

ACCEPTANCE:
- Pressing "Inject" shows a plume that advects and swirls on the debug canvas.
- Tests pass.
- Report measured ms per full step at 256x128 in the HUD.
- Report max |divergence| after projection in the HUD. Must be < 1e-3
  for a steady inflow. This number is the Phase 2 oracle.
```

---

### Phase 2 — Fluid GPU Port (TSL Compute)

**Goal:** Same physics, 100x the grid (1024x512), maintaining 60fps.

```text
Port every pass from Phase 1 to TSL compute nodes in src/fluid/gpu/.
Use storage textures / storage buffers via three.js TSL compute.

One compute node per pass:
- advect (MacCormack, two dispatches for forward/backward + a correct pass)
- curl
- vorticity confinement
- divergence
- pressure (N iterations in one dispatch or a loop)
- project (subtract pressure gradient)
- sources (inflow + body force injection)

Requirements:
- Keep the CPU implementation as a reference and a fallback. A config
  flag switches between them. Both must produce visually identical results.
- Every pass wrapped in gpuTimer so per-pass ms shows in Tweakpane.
- Raise the default grid to 1024x512. Add a resolution scaler.
- Add multigrid pressure solve if Jacobi at 1024x512 can't hit 60fps.
  Multigrid: restrict → solve coarse → prolongate → correct. V-cycle.
- Cite the original papers in comments. MacCormack 1969, Fedkiw 2001,
  Harris GPU Gems 1 Ch 38.

Readback:
- After every dispatch chain, explicitly copy GPU storage buffers back
  into the CPU Float32Arrays that the rest of the app reads. Use
  renderer.readRenderTargetPixels or the TSL equivalent for storage
  buffers. This is mandatory until all consumers are rewritten to read
  from GPU textures directly.
- Add a Vitest that runs one step on GPU, reads back, and asserts that
  grid.u has changed from its initial value. If it has not, readback
  is broken and every downstream number is stale.

Compare mode:
- runCompareValidation must NOT call cpuSolver.step() on the live grid.
  Correct pattern:
    1. Read GPU u/v/dye into gpuU/gpuV/gpuDye.
    2. Copy live CPU grid into cpuCopyU/cpuCopyV/cpuCopyDye.
    3. Step a CPU solver that owns cpuCopy* (not the live grid).
    4. Diff gpuU vs cpuCopyU, gpuV vs cpuCopyV, gpuDye vs cpuCopyDye.
    5. Restore live CPU grid from the backup taken in step 2.
- The compare mode must not mutate any live state.

Telemetry:
- Remove hardcoded maxDivergence: 0.005, pressureResidual: 0.001,
  totalDyeMass: 0. Either compute them from readback, or mark them
  as "unavailable on GPU" and have the HUD show "--".

Timing:
- performance.now() around renderer.compute measures CPU submission,
  not GPU execution. Use telemetry/gpuTimer.ts timestamp queries for
  real per-pass GPU ms. Keep the CPU-side timer as "submitMs" and
  label it distinctly.

Lifecycle:
- Add dispose(): release every StorageBufferAttribute and compute node.
- Add a resize path: if grid.width/height change, recreate buffers and
  nodes. Do not reuse buffers sized for the old grid.

CFL:
- Before dispatching advect, compute max |u|, |v| on the GPU (or read
  back a reduction) and choose the substep count. Do not pass raw dt
  into the advect node at high injection.

ACCEPTANCE:
- 1024x512 fluid at 60fps on the target machine.
- Per-pass timings visible in Tweakpane from real timestamp queries.
- CPU and GPU results match within tolerance in a side-by-side test
  (compare mode runs both at 256x128 and shows diff without state corruption).
- Readback Vitest passes: grid.u changes after a GPU step.
- dispose() releases all GPU resources; resizing the grid recreates
  them without leaking.
- max |divergence| reported from readback matches Phase 1's CPU value
  within 10%.
```

---

### Phase 3 — Water Rendering

**Goal:** Transform the 2D simulation into a believable 3D free-surface water presentation.

```text
Build the 3D presentation layer in src/render/.

surface.ts:
- A heightfield mesh (512x512 verts default). Height driven by the 2D
  fluid field: integrate vertical velocity at the surface, plus a
  Gerstner wave component for high-frequency detail the grid can't resolve.
- Bilinear interpolation sampling of the 2D field.
- Clamping: bilinear sampling must clamp at grid edges and return zero
  contribution outside the domain, not extrapolate (no phantom tank waves).
- Conservative height integration: sum of |h| over mesh must not grow
  without input. Verify with total heightfield energy diagnostic.

Gerstner + fluid blend:
- Cutoff: fluid-driven displacement for wavelengths above ~2*dx; Gerstner
  for wavelengths below. No dual-band overlap.
- Gerstner amplitude scales with local fluid velocity magnitude (still
  water does not ripple uniformly).
- Gerstner wave direction advected by local fluid velocity (prevents
  visual shear artifacts).

water.ts:
- Water material:
    - Screen-space refraction of scene behind it (guaranteed feedback-free).
    - Depth-based absorption (Beer-Lambert law using physical constants).
    - Fresnel term for reflection vs refraction blend.
    - Animated normal detail driven by sim clock (not wall clock).
    - Foam mask driven by field vorticity/velocity from readback.
    - Foam decay: configurable foam lifetime (default 5s) so recirculation
      zones do not saturate.
    - Foam advected by fluid velocity field, not Gerstner waves.

Tank & Environment:
- Transparent walls, floor with subtle scale grid.
- Procedural sky / HDRI reflections (purely visual; no physics leak).
- OrbitControls + Side cutaway preset view (raw 2D field with axis labels
  and numeric colorbar, reading the exact field physics reads).

Stage as the Primary Surface:
- Resting composition: water, vehicle, propeller, tank.
- Cutaway icon lives in stage corner.
- Overlay toggles: vertical icon strip on stage right edge with hover tooltips.
- No floating text boxes, legend boxes, or persistent chrome on stage.

Vitest / Manual Gates:
- Still-water test: inflow off, vehicle at rest 10s -> heightfield energy
  flat within 1%, refraction stable.
- Injection response test: inflow on -> heightfield rises monotonically
  for the first second above the source.
- Cutaway consistency test: 10 random cells match physics read path.
- Foam decay test: foam clears within 5s after burst shutoff.

ACCEPTANCE:
- Press Inject: water visibly rises and flows in 3D with foam at high shear.
- Heightfield energy diagnostic consistent with injected momentum.
- Side cutaway shows 2D field cleanly with axis labels and colorbar.
- Still-water test passes.
- 60fps maintained with independent heightfield and fluid scalers.
- Toggling cutaway, orbit, or environment does not alter sim telemetry.
- Screenshot at rest is comprehensible to someone who has never seen it.
```

---

### Phase 4 — Propeller + BEMT + Variant System

**Goal:** Procedural propeller exists, spins, produces verified forces, and supports direct manipulation.

```text
In src/prop/:

geometry.ts:
- Parametric propeller generator. Inputs: D, hub_d, blades, chord_dist[],
  twist_dist[], thickness_dist[], rake, skew, section airfoil per station.
- Generate procedural mesh for runtime swapping.
- 3 built-in designs:
    - "candidateA" (D=42mm, 3 blades, matched to vehicle JSON)
    - "kaplan_high_thrust" (higher solidity, more blade area)
    - "wageningen_b4" (B-series, 4 blades, wide operating range)
- Handedness flag: CW or CCW. Flips tangential velocity sign in BEMT
  and swaps blade mesh chirality.

polar.ts:
- Load Cl/Cd polars from public/polars/*.json.
- Bundle NACA 4412, NACA 63-012, flat-plate low-Re approximation.
- Interpolate over alpha, Re, and surface roughness for the 3 materials
  (rigid10k smooth, pa12cf15 medium, petg rough). Roughness shifts Cd_min.

bemt.ts:
- Blade element momentum theory implementation:
    - Prandtl tip loss F_tip and root loss F_root.
    - Damped fixed-point induction factor iteration (~30 iters, tol 1e-4).
    - Local Reynolds calculation.
- Outputs: thrust T, torque Q, power P, eta, J = V/(nD), radial profiles
  dT/dr, dQ/dr, alpha(r), Cl(r), Cd(r).
- Sign conventions: forward thrust positive when J > 0 and pitch > 0.
- Reverse inflow handling: when advanceSpeedMs + vi <= 0, branch to
  reverse-flow / windmill drag model.
- Stationary prop handling: for |rpm| < 1, return vi=viTheta=0 and compute
  drag-only forces (no empty array).

BEMT Correctness Fixes (Mandatory):
- Recompute vAxial, vTangential, W, phi, alpha, cl, cd after induction
  loop converges, before computing dL, dD, dT, dQ.
- Correct Prandtl tip loss denominator:
  fTip = (B/2) * (R - r) / (r * sin(phi))  [using r, not R].
- Verify hub loss formula against OpenProp/XROTOR.
- Clamp efficiency eta to [0, 1].

rigidbody.ts (shaft state):
- RPM first-order lag (tau configurable, default 0.15s).
- Pitch servo lag (tau configurable, default 0.05s).
- Integrate blade phase at real RPM. Dynamic blur/fade above 500 RPM.

Variant Registry:
- src/prop/designs/index.ts exports PropDesign objects. Clean separation
  between design data and BEMT solver.

Direct Manipulation & UI:
- Propeller selectable in stage. Selecting highlights thruster and opens
  thruster inspector.
- Mount axis drag moves thruster; panel updates.
- Arc handle on prop tip allows dragging pitch directly; slider follows.
- Handedness is a two-state toggle on the prop itself.
- Design and Material are palette entries, global to selected slot.

HUD & Plots:
- Thrust (N, g-force), torque (mN·m), power (W), eta, J.
- Small live dT/dr profile popover.

Vitest:
- Validate against 3 UIUC database points. Report % error.
- candidateA anchor: KQ = 0.024 at n = 63.33 rev/s produces Q = 12.58 mN·m
  within 2%.
- Handedness test: CW to CCW produces |T| and |Q| equal within 1e-6, with
  opposite torque sign.
- J-sweep validation: sweep J in [0, 1.2], compare Kt, Kq, eta against
  XROTOR/NACA reference table. Tolerance: 15% Kt/Kq, 10% eta.
- No NaN in element array for any (rpm, J) combination.

ACCEPTANCE:
- Swap designs/materials at runtime; thrust and torque update plausibly.
- Switch CW<->CCW: torque sign flips while thrust remains forward.
- candidateA matches KQ-derived torque at 3800 RPM.
- User can change design, material, RPM, pitch, and handedness without
  opening the inspector.
```

---

### Phase 4b — Motor + Tether Electrical Model

**Goal:** Reproduce exact vehicle operating points, electrical bus sag, and thermal dynamics.

```text
In src/motor/motor.ts, src/power/tether.ts, and src/power/bus.ts.

motor.ts:
- DC motor model using vehicle JSON parameters:
  Ra (4.50 ohm), Io (0.18 A), kv (907.4 rpm/V), kt (0.01171 Nm/A),
  ke (0.00973 Vs/rad), stall_torque (0.026 Nm).
- Modes:
  (a) Voltage mode: given V_term, solve operating point iteratively
      omega = (V_term - I*Ra) / ke with torque balance.
  (b) RPM mode: given commanded RPM, solve required V_term and current.
- Thermal model per motor: first-order lumped thermal mass:
  C_th in J/K, R_th in K/W, ambient water temp T_amb.
  T_motor(t) = T_amb + (T_prev - T_amb)*exp(-dt/tau) + I^2*Ra*dt/C_th
  Thermal warnings: WARN at 85°C, CUTOUT at 100°C.
- Efficiency: mechanical power out / electrical power in.

tether.ts:
- Tether series resistance R = 0.782 ohm (15 ft, 24 AWG round-trip).
- Fixed surface supply voltage (12.0 V default).
- Terminal voltage: V_term = V_bus - I_total * R_tether.
- I_total is the algebraic sum of currents over all active motors.
  Multi-motor loading sags the bus proportionally.
- Optional inductance L ~ 5 uH/m (config toggle, default off).

bus.ts:
- System solver: given throttle vector [t1, t2, t3], solve per-motor
  currents, sum bus load, compute sag, iterate to convergence
  (single Newton step converges for this linear network).
- Exposes: V_term_i, I_i, RPM_i, Q_i, T_motor_i, V_bus, I_total, P_total.

UI & Visual Design Integration:
- Electrical controls (Supply V, tether length, AWG, ambient temp,
  thermal on/off) live in the Inspector when nothing is selected.
- HUD strip shows exactly 6 values at rest: thrust, torque, RPM, bus V,
  total current, max motor temp. Monospace, unit-suffixed.
- Thermal visualization: selected thruster's motor body glows with a
  temperature-mapped emissive color in the stage (no 3D label clutter).
  Exact temperature shown in the inspector and HUD.

Vitest:
- Operating Point Anchor: 100% throttle on 1 motor, bus V = 12.0 V,
  tether = 0.782 ohm reproduces V_term = 10.82 V ± 0.01 V and
  I = 1.25 A ± 0.02 A at 3800 RPM.
- Thermal Timing: motor at 1.41 A in 20°C water reaches 85°C in
  18s ± 20%. Calibrate C_th/R_th to match.
- Sum-of-currents Sag Linearity: 3 motors drawing 1.0 A each sag the
  bus identically to 1 motor drawing 3.0 A.

ACCEPTANCE:
- Throttle slider adjusts current, bus sag, RPM, and temperature realistically.
- The 3800 RPM / 10.82 V / 1.25 A anchor point is reproduced exactly.
- Thermal cutout triggers at 18s under 100% throttle in 20°C water.
- At rest, the HUD strip contains exactly six values.
```

---

### Phase 5 — Fluid ↔ Propeller Coupling

**Goal:** Realize bidirectional momentum coupling between BEMT and Eulerian fluid.

```text
Implement bidirectional momentum exchange between actuator disk and grid.

PROP -> FLUID (Momentum Source):
- Represent propeller as an actuator disk on the 2D fluid grid.
- Distribute BEMT axial force dT and swirl torque dQ into grid cells
  inside disk radius as body forces.
- Conservation: total momentum injected into grid must integrate to
  match BEMT thrust.
- Swirl component generates visible slipstream vortex structure.
- Diagnostic: track BEMT thrust vs grid momentum flux; verify convergence
  to within 15%.

FLUID -> PROP (Inflow Velocity):
- Sample fluid grid velocity at the actuator disk location.
- Provide sampled velocity as advance velocity V_inf into BEMT.
- Close the feedback loop: prop accelerates fluid -> fluid increases
  advance velocity -> BEMT thrust adjusts.
- Damping: apply relaxation (alpha = 0.5) to advance velocity updates.
- Substepping: run coupling substeps at 2x fluid rate if necessary.

Hull Interaction:
- Add hull obstacle downstream in the fluid grid.
- Applies drag force to flow, redirecting and dissipating slipstream.

UI & Visual Design Integration:
- Coupling is a physical behavior, not a dashboard knob. Relaxation
  damping is located under Advanced fold.
- Zero-overlay visibility: slipstream must be clearly visible in water
  rendering with all overlays turned OFF.
- BEMT-vs-grid agreement is a subtle badge in the stage corner when
  the coupling overlay is enabled, never cluttering HUD at rest.

ACCEPTANCE:
- Turning prop on generates a visible, persistent slipstream.
- BEMT thrust and grid-momentum thrust agree within 15% at steady state.
- Turning prop off allows slipstream to decay smoothly.
- Zero numerical instability or divergence over 10 minutes of run.
```

---

### Phase 5b — Multi-Prop, CW/CCW, Stator Vanes

**Goal:** Model Candidate A's multi-rotor array, counter-rotation, and stator vane swirl rectification.

```text
In src/prop/array.ts, src/prop/stator.ts, and src/prop/torqueLedger.ts.

array.ts (Thruster Array):
- Support 1 to N propulsors (candidateA default: 3).
- Per unit: position vec3, orientation quat, handedness (CW/CCW),
  design, motor params, throttle command [-1, +1].
- Handedness presets: "all_cw", "all_ccw", "alternating" (CW, CCW, CW),
  "contra_rotating_coaxial" (CRP, 0 net torque), "tandem".
- Sum forces and torques: net vehicle torque = sum(r_i × F_i) + sum(Q_i * axis_i).

stator.ts (Stator Vane System):
- Configurable per propulsor: N vanes (3), incidence (-5.2 deg),
  rake (35 deg), profile (modified NACA 63-012), slot chord pct (40%).
- Slotted vane physics: slot models Cd reduction in stalled regime
  when |alpha| > alpha_stall, recovering reverse thrust capability.
- Flow rectification: converts tangential swirl into axial velocity.
  Empirical gains from candidateA.json:
    - Forward thrust gain: +0.04 N
    - Reverse thrust penalty: -0.09 N (slotted) vs -0.43 N (solid)
    - Swirl recovery counter-torque:
      Q_stator = rho * A_disk * V_swirl_removed * r_mean
      Opposes prop reaction torque.

torqueLedger.ts (The Master Output):
- Computes frame-by-frame:
    Q_prop_total   = sum of reaction torques from all propellers
    Q_stator_total = sum of counter-torques from stator vanes
    Q_net          = Q_prop_total + Q_stator_total
    omega_roll     = Q_net / (I_vehicle + I_added_mass)
- Roll deviation prediction in deg/m at 1 m/s forward travel.

UI & Direct Manipulation:
- Thruster manipulation in stage: select and drag to reposition/reorient.
- Palette controls: add/remove thruster, attach/detach stator, slot toggle.
- Incidence angle: draggable arc handle on stator in stage.
- Torque Ledger HUD: predicted roll rate is displayed as the 7th value
  in the HUD strip using the torque accent color, with hover tooltip
  indicating "Predicted Roll Rate".

Vitest:
- CRP Test: contra-rotating coaxial pair produces net Q < 1e-6.
- IMU Alignment Test: 3-unit alternating layout yields 1.8 deg/m with
  slotted stator and 14.8 deg/m without stator.
- Reverse Thrust Validation: 100% reverse throttle produces:
    - Slotted stator: -2.82 N ± 5%
    - Solid stator:   -2.48 N ± 5%

ACCEPTANCE:
- Switching handedness presets updates net torque and roll prediction instantly.
- Toggling stator drops roll rate from ~14.8 deg/m to ~1.8 deg/m.
- User can configure thrusters and stators purely via direct manipulation.
```

---

### Phase 6 — Visualization Overlays

**Goal:** Provide clean, GPU-accelerated diagnostics without cluttering the 3D stage.

```text
Build src/render/overlays.ts. GPU-driven and independently toggleable.

Fluid Overlays:
- Velocity Vector Field: instanced 3D arrows on coarse grid stride;
  length and color mapped to velocity magnitude.
- Streamlines: GPU numerical integration, rendered as fading ribbons.
- Pressure Heatmap: diverging colormap overlay in cutaway view.
- Vorticity Magnitude: scalar field rendering highlighting tip vortices.
- Particle Tracers: GPU-advected particles seeded at inflow with motion blur.

Vehicle & Force Overlays:
- Force Arrows: thrust, drag, resultant arrows at thruster hub.
- Torque Indicators: Q_prop (red), Q_stator (blue), Q_net (magenta) at CG.
- Roll Horizon: artificial horizon bar indicating predicted roll rate.
- Thermal Emissive: motor housing color-coded by temperature.
- Current Flow: optional animated pulses along tether ∝ current.
- Variant Diff: temporary ghost overlay comparing old vs new thrust curves.

UI & Visual Design Rules:
- Overlays live exclusively in a vertical icon strip on the stage's
  right edge. Hover displays title; click toggles.
- Maximum 2 overlays active at rest: thrust arrows and velocity vectors.
- No chrome added to stage: no legend boxes, no floating coordinate panels.
- Numeric values appear on hover only.
- Color discipline:
    - Thrust: Thrust accent
    - Torque: Torque accent
    - Stator counter-torque: Desaturated torque accent
    - Heat: Thermal accent
    - Current: Current accent

ACCEPTANCE:
- Overlays clearly depict flow direction, vortex shedding, and force vectors.
- Framerate remains solid 60fps with default overlays active.
- Overlays toggle cleanly without layout shifts or memory leaks.
- With all overlays on, visual elements remain distinguishable by color
  and shape alone without requiring legends.
```

---

### Phase 6b — Vehicle Rigid Body + Buoyancy

**Goal:** Implement 6-DOF underwater rigid body dynamics, added mass, and hydrostatics.

```text
In src/vehicle/.

body.ts (6-DOF Rigid Body):
- Dry mass, motor mass, prop mass from candidateA.json.
- Inertia tensor computed from frame truss point-mass distribution.
- Underwater added mass: +0.5 * rho * V_displaced for translational DOFs,
  coupled diagonal rotational added inertia.

buoyancy.ts (Hydrostatics & Restoring Moments):
- Displaced volume 200 cm^3 in rho = 1000 kg/m^3 fluid.
- Net buoyancy: F_net = +0.197 N upward (positive buoyancy).
- Center of Buoyancy (CoB) located 12.5 mm directly above Center of
  Gravity (CoG).
- Restoring moment: M_restoring = F_buoyancy × (r_CoB - r_CoG).
  Passively rights vehicle roll and pitch.

drag.ts (Hydrodynamic Damping):
- Quadratic translational drag: F_drag = -0.5 * rho * Cd * A * |v| * v.
- Rotational damping: M_drag = -c_rot * omega * |omega|.

integrator.ts:
- Semi-implicit Euler integration at 60 Hz fixed timestep.
- Marine Axis Convention:
    Surge = +X, Sway = +Y, Heave = +Z
    Roll = X, Pitch = Y, Yaw = Z
- Kinematics: quaternion integration for orientation, velocity vector updates.
- Forces: Gravity + Buoyancy + Thruster forces + Frame drag + Tether tension.

UI & Direct Manipulation:
- Vehicle direct manipulation in stage:
    - Drag moves vehicle horizontally.
    - Shift-drag moves vehicle vertically.
    - Yaw rotation handle.
    - Pitch and roll remain constrained by physics restoring moment.
- "Reset Pose" located in Palette.
- No new HUD clutter: vehicle coordinates and velocities reside in Inspector.

Vitest:
- Hover Terminal Velocity Test: with 0 thrust, vehicle rises at terminal
  rate predicted by +0.197 N net buoyancy balanced by vertical drag.
- Static Stability Test: 30 deg roll perturbation oscillates and rights
  to vertical with theoretical time constant.
- Pure Surge Impulse Test: impulse along +X produces zero sway (+Y) or
  heave (+Z) velocity.

ACCEPTANCE:
- Vehicle hovers when thrust counterbalances buoyancy/weight.
- Net uncompensated torque induces vehicle roll.
- Vehicle rights itself when displaced by external disturbances.
- Dynamic vehicle motion correctly feeds back into BEMT inflow velocity.
```

---

### Phase 7 — UI, Telemetry, Presets

**Goal:** Deliver the complete user interface: one-button operation, preset switching, and live telemetry.

```text
RUN Button (The Primary Action):
- Single prominent RUN button in header:
    - State 1 (Idle): initiates inflow, spools propellers to preset RPM,
      starts thermal burst timers and data recording.
    - State 2 (Running): pauses simulation.
    - State 3 (Paused): resumes simulation.
    - State 4 (Error): displays recovery state.
- Transition to active state within 2 seconds.

Candidate A Presets (Header Dropdown):
- "Breakout Burst":        100% throttle, +4.73 N, 1.41 A, 18s timer
- "Nominal Heavy Lift":     88% throttle, +3.99 N, 1.25 A, 50s timer
- "Continuous Cruise":      67% throttle, +2.49 N, 0.85 A, unlimited
- "Controlled Full Dive":  -84% throttle, -2.82 N, 1.18 A, 65s timer
- "Reverse Station":       -48% throttle, -0.93 N, 0.51 A, unlimited

Selecting a preset configures:
- Throttle vector, tether params (15 ft, 24 AWG, 12 V), candidateA prop,
  rigid10k material, slotted stator (-5.2 deg).

HUD Strip (Fixed Bottom):
- Left: Thrust, Torque, RPM, Bus V, Total Current, Max Motor Temp
  (plus Roll Rate when active).
- Right: FPS, Frame ms, GPU ms, Active Preset.
- Monospace, unit-suffixed, color-accented.

Telemetry & Stripcharts:
- Click any HUD value to open a 30s popover stripchart canvas.
- Popovers can be pinned in the stage corner. No persistent panel clutter.
- Header CSV Export button: records full time-series (t, dt, per-motor
  RPM/I/T/V, vehicle pose/rates, fluid metrics, GPU timings).

Validation Route (/validation):
- Standalone route linked from footer.
- Interactive plots:
    - BEMT vs UIUC empirical polar datasets.
    - Thrust vs RPM curve against candidate A operating points.
    - Reverse thrust: slotted vs solid vs no stator.
    - Roll deviation comparison: 1.8 deg/m vs 14.8 deg/m.

ACCEPTANCE:
- Select "Breakout Burst", press RUN: within 2s, fluid flows, prop spools,
  vectors appear, 18s thermal countdown begins.
- First-time user can run full demo without opening inspector or palette.
- CSV export generates complete, clean data log matching spec points.
```

---

### Phase 8 — Performance and Robustness

**Goal:** Ensure 60fps performance, memory stability, and failure recovery under heavy stress.

```text
Threading:
- Transfer physics integration and WebGPU rendering to an OffscreenCanvas
  in a dedicated Web Worker.
- Main thread handles DOM, user input events, and Tweakpane/inspector.
- Zero jank during window resize, tab switching, or heavy interaction.

Adaptive Resolution:
- Dynamically scale fluid grid resolution (1024x512 <-> 512x256) based
  on frame time budget.
- Visual continuity: cross-fade heightfield surface displacement over
  250ms during scale transitions (no visual popping).
- Resolution multiplier displayed unobtrusively in HUD strip next to FPS.

Multigrid Pressure Solver:
- Implement geometric multigrid Poisson solver:
  Restrict -> Coarse solve -> Prolongate -> Correction (V-cycle).
- Target solve duration < 4ms at 1024x512.

Temporal Upsampling:
- Optional 0.5x resolution fluid compute pass with full-resolution
  velocity-guided temporal reprojection.

Fault Tolerance & Recovery:
- WebGPU Device Loss: catch device lost event, recreate buffers,
  or automatically fall back to WebGL2 without crashing.
- Context Loss & Tab Inactive: detect document visibility change;
  pause RAF loop cleanly; resume on focus without numerical spikes.
- Zero per-frame object allocation in hot physics/render loop.

Stress Preset:
- 2048x1024 fluid grid, 6 thrusters, all overlays active.
- Document minimum fps floor.

ACCEPTANCE:
- 60fps sustained at 1920x1080 default on integrated graphics.
- Zero memory leakage over 10 minutes continuous run.
- Seamless recovery from WebGPU device loss and background tab state.
- Screen recording shows zero layout shifts and zero visible resolution pops.
```

---

### Phase 9 — Ship

**Goal:** Final packaging, public deployment, offline PWA, and comprehensive documentation.

```text
First-Run Experience:
- Fresh visit: 3D stage renders immediately with candidate A preloaded,
  resting water surface, overlays off, RUN button pulsing gently once.
- Subtitle under RUN: "Press RUN to start."
- Return visit: stage ready, RUN idle. No modal dialogs or intro tours.

State Sharing & Serialization:
- Header Share button encodes full application state into URL parameters:
  vehicle geometry, thrusters, stators, electrical tether, operating points.
- Opening shared URL reproduces exact simulation setup ready to RUN.

Recording:
- In-browser WebM video capture via canvas MediaRecorder API.

PWA & Offline:
- Progressive Web App manifest with icons, name, theme color.
- Complete offline capability via Service Worker (no external CDN calls
  at runtime; oracles executed in Vitest offline).

README.md:
- Hero screenshot of stage at rest.
- Architectural summary (Eulerian fluid, BEMT actuator disk, lumped motor).
- Physical validation tables against UIUC and candidate A specs.
- UI Design Language summary and contributor rules.
- Local execution instructions (`npm run dev`, `npm run test`).

Validation Page:
- Interactive validation plots at `/validation` matching ITTC open-water
  test guidelines.

ACCEPTANCE:
- Public GitHub Pages deployment is live, green, and installable as PWA.
- Stranger lands on page and successfully runs simulation within 5 seconds.
- Shared URL round-trips custom vehicle configuration reliably.
- All Vitest test suites pass with reported error within tolerances.
```
