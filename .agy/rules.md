# Master Context Block — [REVISED]

CURRENT PHASE: Phase 3 — Water Rendering

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

---

## Reference Oracles and What Each Phase Validates Against

Phase 1  Fluid CPU        -> Stam 1999, Harris GPU Gems 1 Ch. 38.
                             PhiFlow 2D Eulerian for a fixed IC.
Phase 2  Fluid GPU        -> CPU reference (Phase 1) is the oracle.
                             Readback round-trip is the acceptance gate.
Phase 3  Water rendering  -> visual only. Pavel Dobryakov WebGL fluid
                             sim as a plausibility reference, not an oracle.
Phase 4  BEMT             -> XROTOR / OpenProp for the same geometry and
                             J sweep. UIUC polars for section lift/drag.
                             NACA TR-594 for end-to-end Kt/Kq/eta.
Phase 4b Motor + tether   -> QPROP for motor-prop equilibrium. Mabuchi
                             RS-280 datasheet for Ra, Io, kt, ke. Spec
                             anchor points (3800 RPM / 10.82 V / 1.25 A).
Phase 5  Coupling         -> internal: BEMT thrust vs grid momentum flux
                             must converge within 15%. No public oracle.
Phase 5b Stator / ledger  -> spec IMU numbers (1.8 vs 14.8 deg/m).
                             No public oracle for the slotted vane; label
                             empirical constants as empirical.
Phase 6  Overlays         -> visual only.
Phase 6b 6-DOF            -> Fossen MSS / UUV Simulator for step-response
                             trajectory comparison. BlueROV2 for
                             added-mass and drag coefficient ranges.
Phase 7  UI / presets     -> spec operating_points table.
Phase 8  Perf             -> internal budget. No oracle.
Phase 9  Ship             -> ITTC open-water procedures for the
                             validation plot format.

---

## Design Language

The app is a physics instrument, not a dashboard. It should read the way
IBM Quantum Composer reads: a small stage, a small palette, a Run button,
and everything else behind a tab or a fold. The default view must be
comprehensible to someone who has never seen the simulator. Depth is
opt-in.

PRINCIPLES

1. One primary action.
   RUN is the only prominent button. Everything else is either a
   discrete control in the left palette or a toggle in the right
   inspector. There is never a second button competing with RUN for
   the eye.

2. Stage first, chrome second.
   The 3D viewport occupies the majority of the window at rest. The
   palette and inspector are narrow and collapse to icons below a
   breakpoint. The user's first impression is water, a vehicle, and a
   propeller, not a control panel.

3. Physical primitives, not parameters.
   The user drags a thruster, not a "position vector". The user
   rotates a stator, not a "vane incidence angle". Every numeric
   field is a fallback for the direct manipulation, not the primary
   interface. IBM's composer does this with gates; you do it with
   thrusters, vanes, and the vehicle.

4. Orthogonal controls.
   Each control changes exactly one physical thing. No control
   changes "performance mode" and silently alters three unrelated
   parameters. If a preset needs to change several things, it is a
   preset, not a slider.

5. Closed by default.
   Advanced physics (added mass, drag coefficients, thermal
   constants, solver tolerances) is behind an "Advanced" fold. It is
   never on screen at rest. The user who needs it knows to look; the
   user who does not is not intimidated.

6. Numbers in the HUD, prose in the panel.
   The HUD shows live values with units. The panel shows what each
   control does in one short sentence, and nothing else. No physics
   lectures in the UI.

7. One accent color per meaning.
   Thrust is one color. Torque is another. Heat is a third. Current
   is a fourth. These are used consistently across the 3D overlays,
   the HUD, and the stripcharts. The user learns the mapping once.

LAYOUT

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

PALETTE (left, top to bottom):
  - Vehicle: load candidateA, load custom, reset pose
  - Thrusters: add, remove, select. Selected thruster highlights in
    the stage.
  - Stator: attach / detach to selected thruster, slot on/off
  - Prop design: candidateA / kaplan / wageningen
  - Material: rigid10k / pa12cf15 / petg
  - Presets: the five operating points

INSPECTOR (right, only the selected object's controls):
  - If nothing selected: run settings (supply V, tether length,
    ambient temp, thermal on/off)
  - If a thruster selected: throttle, RPM, pitch, handedness, stator
  - If the vehicle selected: mass props (read-only), tether anchor,
    drag coefficients under Advanced
  - If the fluid selected (via stage click): viscosity, vorticity,
    inflow, resolution scale

STAGE:
  - Orbit camera. Scroll zoom. Right-drag pan.
  - Click a thruster to select. Selected object gets a subtle outline.
  - Cutaway toggle is a small icon in the stage corner, not a panel
    item.
  - Overlay toggles are a vertical strip of icons on the stage's
    right edge, each with a hover tooltip. Not in the panel.

HUD STRIP (bottom, always visible):
  - Left: thrust, torque, RPM, bus V, total current, max motor temp
  - Right: fps, frame ms, GPU ms, current preset name
  - Each value is monospace, right-aligned, unit-suffixed.
  - Clicking any value opens a small plot popover with that channel
    over the last 30s. This is the stripchart, on demand, not always
    on screen.

VISUAL LANGUAGE
  - Dark neutral background (#0e1116 class), not pure black.
  - Water is the only saturated large surface. Everything else is
    grayscale plus the four accent colors.
  - Typography: one sans for labels, one monospace for numbers.
  - No drop shadows except on floating sheets. No gradients except
    the water and the colormaps.
  - Buttons: flat, single accent on hover, no rounded-3xl pills.
  - Iconography: single-weight line icons, consistent stroke.

RUN BEHAVIOR
  - Press RUN. Within 2 seconds: water flows, prop spins, slipstream
    forms, HUD numbers populate, thermal timer starts.
  - Press RUN again: pause. Press again: resume. Never a separate
    stop button.
  - The Run button shows state: idle, running, paused, or error. It
    is the same button.

FIRST-RUN EXPERIENCE
  - On first visit: a single overlay on the stage, three sentences
    long, with a "Load candidateA" button. Dismissed forever after.
  - No tour. No tooltips on first load. The default state must be
    legible without explanation.

---

## Vehicle JSON Schema

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

---

## Critical Rules — [REVISED]

1. **Config Immutability**: Values from `public/vehicles/candidateA.json` must be loaded dynamically into `src/core/config.ts`. Hardcoded physical specs in engine logic are forbidden.
2. **Fixed-Timestep Accumulator**: Simulation physics always steps at 60 Hz ($\Delta t = 1/60\,\text{s}$). Render interpolation ($\alpha \in [0, 1)$) smoothly bridges visual frames. Max 5 substeps per frame to prevent spiral of death.
3. **Renderer Fallback**: `WebGPURenderer` is the primary target with automated fallback to `WebGLRenderer` on unsupported clients.
4. **Zero-Allocation Hot Paths**: Inner loops, physics integrators, and fluid iterations must avoid garbage collection churn.
5. **Physical Units**: Strict standard SI units internally (meters, kg, seconds, N, Nm, rad/s, V, A, Ohm, $\text{kg/m}^3$).
6. **Coordinate Frame Fidelity**: Three.js world frame is right-handed (+X East, +Y Up, +Z Aft).
7. **Phase Progression Gate**: Never skip CPU reference validation before GPU acceleration.
8. **Fix the GPU readback before trusting any GPU number**:
   A `StorageBufferAttribute` in three.js TSL is a GPU-side buffer. The CPU Float32Arrays used to construct it are NOT updated by compute dispatches. Until you explicitly read back, every consumer (rendering, telemetry, coupling, CPU fallback, compare mode) reads stale data. Phase 2 acceptance must include a readback round-trip test that proves `grid.u/v/dye` reflect GPU output.
9. **Compare mode must compare, not self-compare**:
   In `GpuFluidSolver.runCompareValidation`, running `cpuSolver.step()` advances the same grid arrays that the GPU path also mutates. Any compare that backs up the CPU grid, steps the CPU solver, and then diffs against the backup is diffing the CPU against itself. The correct pattern: read back GPU buffers into a separate pair of arrays, copy the CPU grid, step the CPU copy, diff, restore.
10. **BEMT must recompute aero coefficients after convergence**:
    After the induction loop exits, `phi`, `cl`, `cd`, and `W` still hold the values from the previous iteration. Recompute `vAxial`, `vTangential`, `W`, `phi`, `alpha`, `cl`, `cd` from the converged `vi/viTheta` before computing `dL`, `dD`, `dT`, `dQ`. Also correct the Prandtl tip loss denominator: $f_{\text{Tip}} = (B/2) \cdot (R - r) / (r \cdot \sin(\phi))$, not $/(R \cdot \sin(\phi))$.
11. **Axis conventions are marine, not three.js**:
    Surge = X, sway = Y, heave = Z. Roll = X, pitch = Y, yaw = Z. If the integrator maps sway to X or heave to Y, every force and moment is applied to the wrong DOF. Test this in Phase 6b with a pure-surge impulse that must not produce sway or heave motion.

## Phase 0 — [REVISED]

UI skeleton:
- Build the three-region layout (palette / stage / inspector) and
  the HUD strip as static shells. No functionality yet, just the
  regions, the dividers, and the responsive breakpoints.
- Add the RUN button in the header, wired to a no-op that logs.
- Confirm the stage is the largest region at every breakpoint.
- Ship the color tokens and typography as CSS variables in
  src/index.css. Every later phase uses these tokens, never raw
  hex.

ACCEPTANCE (added):
- Resizing from 1920 to 375 does not break the layout.
- The stage is always the largest region.
- No control is visible at rest that is not in the palette,
  inspector, header, or HUD strip.

---

## Phase 1 — Fluid Core (CPU Reference) [REVISED]

Vitest additions:
- CFL guard test: inject a velocity spike that would violate CFL at dt=1/60 and verify the solver substeps or clamps rather than producing NaN.
- Vorticity confinement epsilon test: in an irrotational field, verify the confinement force is exactly zero (no NaN from dividing by |grad|omega|| ~ 0). Epsilon threshold must be documented (`VORTICITY_GRADIENT_EPSILON = 1e-7`).

ACCEPTANCE (added):
- Report max |divergence| after projection in the HUD. Must be < 1e-3 for a steady inflow. This number is the Phase 2 oracle.

---

## Phase 2 — GPU Port [REVISED]

Readback:
- After every dispatch chain, explicitly copy GPU storage buffers back into the CPU Float32Arrays that the rest of the app reads. Use renderer.readRenderTargetPixels or the TSL equivalent for storage buffers. This is mandatory until all consumers are rewritten to read from GPU textures directly.
- Add a Vitest that runs one step on GPU, reads back, and asserts that grid.u has changed from its initial value. If it has not, readback is broken and every downstream number is stale.

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
- Remove hardcoded maxDivergence: 0.005, pressureResidual: 0.001, totalDyeMass: 0. Either compute them from readback, or mark them as "unavailable on GPU" and have the HUD show "--".

Timing:
- performance.now() around renderer.compute measures CPU submission, not GPU execution. Use telemetry/gpuTimer.ts timestamp queries for real per-pass GPU ms. Keep the CPU-side timer as "submitMs" and label it distinctly.

Lifecycle:
- Add dispose(): release every StorageBufferAttribute and compute node.
- Add a resize path: if grid.width/height change, recreate buffers and nodes. Do not reuse buffers sized for the old grid.

CFL:
- Before dispatching advect, compute max |u|, |v| on the GPU (or read back a reduction) and choose the substep count. Do not pass raw dt into the advect node at high injection.

ACCEPTANCE (revised):
- 1024x512 fluid at 60fps on the target machine.
- Readback Vitest passes: grid.u changes after a GPU step.
- Compare mode shows GPU vs CPU diff within tolerance at 256x128, and does not corrupt the live CPU grid.
- Per-pass GPU ms visible in Tweakpane from timestamp queries, not from CPU timers.
- dispose() releases all GPU resources; resizing the grid recreates them without leaking.
- max |divergence| reported from readback matches Phase 1's CPU value within 10%.

---

## Phase 3 — Water Rendering [REVISED]

Heightfield correctness:
- The heightfield reads from the 2D fluid grid. Until Phase 2's readback is fixed, that grid is stale on the CPU side and the surface will not respond to prop injection. Phase 3 must not be declared done until the readback Vitest from Phase 2 passes and the surface visibly rises when a source is injected on the GPU path. If readback is deferred, Phase 3 must read the dye/velocity field through whatever path Phase 2 exposes as authoritative, not through the raw CPU Float32Array.
- Bilinear sampling must clamp at grid edges and return zero contribution outside the domain, not extrapolate. Edge extrapolation produces phantom waves at the tank walls that look like physics and are not.
- Height integration must be conservative: sum of |h| over the mesh must not grow without an input. Add a diagnostic that prints total heightfield energy. If it grows while inflow is off, the integration scheme is injecting energy. The usual cause is integrating vertical velocity without a restoring term; the Gerstner component does not count as restoring.

Gerstner + fluid blend:
- The 2D field cannot resolve wavelengths below ~2*dx. The Gerstner component is there to fill that gap. Do not let the two overlap in the same band. Add a configurable cutoff: fluid-driven displacement for wavelengths above the cutoff, Gerstner for below. Summing both across the full spectrum double-counts energy and makes the surface look "busy" in a way that hides real flow features.
- Gerstner amplitude must scale with the local fluid velocity magnitude, not be a global constant. Otherwise the surface ripples uniformly in still water and looks wrong.
- Gerstner wave direction must be advected by the local fluid velocity. A fixed-direction Gerstner on top of a moving field produces a visual shear artifact that a viewer will read as turbulence and that is not in the field.

Foam:
- Foam threshold must be driven by vorticity magnitude and velocity magnitude from the field, both of which require readback. If readback is unavailable, foam must be disabled, not faked with a noise texture. Fake foam will be mistaken for a validated visual.
- Foam must decay. Add a foam lifetime; without it, foam accumulates in recirculation zones and never clears, which makes the slipstream unreadable after ~30s.
- Foam must not be advected by the Gerstner component, only by the fluid field. Otherwise foam drifts with the visual detail waves, not with the actual flow.

Refraction and absorption:
- Beer-Lambert absorption depth must use the same water temperature and salinity assumptions as the rest of the sim, or be documented as a visual-only constant. Do not let a visual tuning constant leak into anything the physics reads.
- Screen-space refraction must not sample the water surface itself (feedback loop). Verify with a still-water test: with inflow off and the vehicle at rest, the refracted image must be stable, not shimmering.

Cutaway view:
- The side cutaway is the primary diagnostic surface for Phases 4-6. It must render the raw 2D field with a known colormap and known scale, not a stylized version. Add axis labels in grid units and a colorbar with numeric ticks. If the cutaway is stylized, every downstream visual judgment about the coupling is unreliable.
- The cutaway must show the same field the physics reads. If the 3D surface reads from GPU and the cutaway reads from CPU, they will disagree after Phase 2 and the disagreement will be mistaken for a rendering bug.

Environment and camera:
- HDRI / procedural sky is visual only. It must not contribute to any physics quantity. Document this in CONVENTIONS.md so a later phase does not accidentally read sun direction from the renderer.
- Orbit camera and cutaway preset must not modify simulation state. Add a Vitest or manual check: toggling cutaway mid-run does not change any value in the telemetry CSV.

Performance:
- Heightfield vertex count and normal detail maps are the two largest costs in Phase 3. Add a resolution scaler for the heightfield mesh that is independent of the fluid grid scaler. They have different bottlenecks.
- Normal map scrolling must be driven by the sim clock, not by wall-clock time, or the water animation will desync from the physics under frame drops.

Vitest / manual gates:
- Still-water test: inflow off, vehicle at rest for 10s. Heightfield energy must be flat within 1%. Refracted image must be stable.
- Injection response test: turn inflow on. Heightfield must rise monotonically for the first second in the region above the source. If it does not, the field-to-surface path is broken.
- Cutaway consistency test: with readback active, sample 10 random grid cells from the cutaway render path and from the physics read path. They must match within float precision.
- Foam decay test: inject a burst, turn inflow off, verify foam clears within a configurable time (default 5s).

ACCEPTANCE (revised):
- Press Inject, water visibly rises and flows in 3D with foam at high shear, and the heightfield energy diagnostic is consistent with the injected momentum.
- Side cutaway view shows the 2D field cleanly, with axis labels, colorbar, and a guarantee that it reads the same field the physics reads.
- Still-water test passes: no phantom waves, no shimmering refraction, flat heightfield energy.
- 60fps maintained, with separate scalers for heightfield mesh and fluid grid.
- Toggling cutaway, orbit, or environment does not modify any simulation state.

Stage as the primary surface:
- The stage must be legible with zero overlays on. Water, vehicle,
  propeller, tank. That is the resting composition.
- The cutaway icon lives in the stage corner, not the palette.
- Overlay toggles are a vertical icon strip on the stage's right
  edge. Each toggle is a single icon; the label appears on hover.
- The stage must not have any persistent panel chrome over the 3D
  view except the overlay strip and the cutaway icon. No floating
  text boxes, no legend boxes, no coordinate readouts pinned to the
  corner. Those belong in the HUD strip or the inspector.

ACCEPTANCE (added):
- A screenshot of the app at rest, with no interaction, is
  comprehensible to someone who has not seen it before.

---

## Phase 4 — [REVISED, second pass]

Direct manipulation:
- The propeller is selectable in the stage. Selecting it opens the
  thruster inspector. Dragging the propeller along its mount axis
  moves it; the panel updates.
- RPM and pitch are both driven by a slider in the inspector AND by
  dragging the propeller's tip. A small arc handle appears when the
  propeller is selected. Dragging the handle changes pitch; the
  slider follows.
- Handedness is a two-state toggle on the propeller itself, not a
  dropdown in the panel. The blade mesh flips chirality in place.

Palette changes:
- Design and material are palette entries, not inspector entries.
  They are global to the selected thruster's slot. Changing design
  swaps the mesh and the BEMT geometry in place.

ACCEPTANCE (added):
- A user can change prop design, material, RPM, pitch, and
  handedness without opening the inspector.

---

## Phase 4b — [REVISED, second pass]

Electrical controls live in the inspector, not the palette:
- Supply V, tether length, AWG, ambient temp, thermal on/off. These
  are run settings, not object settings. They appear when nothing is
  selected.

HUD strip additions:
- Bus V, total current, max motor temp. These are the three numbers
  a user needs at a glance. Everything else is a click away.

Thermal visualization:
- The selected thruster's motor glows with a temperature-mapped
  emissive in the stage. No numeric label on the mesh. The number
  is in the inspector.

ACCEPTANCE (added):
- At rest, the HUD strip shows exactly six values. Not eight, not
  ten. The rest are in popovers.

---

## Phase 5 — [REVISED, second pass]

Coupling visualization is an overlay, not a panel:
- The BEMT-vs-grid thrust agreement number is a single small badge
  in the stage corner when the coupling overlay is on. Not in the
  HUD strip at rest.
- Slipstream is visible with zero overlays on. If you need the
  velocity overlay to see the slipstream, the water rendering is
  not doing its job.

No new controls in Phase 5:
- Coupling is a behavior, not a knob. The damping coefficient is
  under Advanced. The user does not tune it.

ACCEPTANCE (added):
- With all overlays off, turning the propeller on produces a visible
  slipstream in the water.

---

## Phase 5b — [REVISED, second pass]

Thruster array is direct-manipulation in the stage:
- Each thruster is a selectable, draggable object. Position and
  orientation are edited by dragging, not by typing numbers.
- Adding a thruster is a palette action. The new thruster appears
  at the vehicle's stern and is immediately selected.
- Removing a thruster is a delete key or a small x on the selected
  thruster's outline.
- Handedness preset is a palette dropdown, but it only changes the
  signs of existing thrusters; it does not reposition them.

Stator is attached to the selected thruster:
- Attach / detach is a palette action on the selected thruster.
- Slot on/off is a two-state toggle on the stator itself.
- Incidence is a drag handle on the stator, same pattern as pitch.

Torque ledger HUD:
- The net roll rate prediction is the seventh value in the HUD
  strip, in the accent color for torque. It is the only number in
  the strip that is a prediction, not a measurement, and it is
  labeled as such on hover.

ACCEPTANCE (added):
- A user can build a 3-thruster alternating layout, attach stators,
  and see the net roll rate change, without opening the inspector.

---

## Phase 6 — [REVISED, second pass]

Overlays are a vertical icon strip on the stage's right edge:
- Velocity vectors
- Streamlines
- Pressure heatmap (cutaway only)
- Vorticity
- Particles
- Thrust arrows
- Torque arrows
- Thermal
- Current flow
Each is a single icon. Hover shows the name. Click toggles. At most
two are on by default: thrust arrows and velocity vectors. All
others are off at rest.

No overlay may add chrome to the stage:
- No legends, no colorbars, no axis labels except in the cutaway
  view, where the cutaway owns them.
- Numeric labels on force arrows are on hover only.

Color discipline:
- Thrust arrows use the thrust accent. Torque arrows use the torque
  accent. Stator counter-torque uses a desaturated version of the
  torque accent. Heat uses the thermal accent. Current uses the
  current accent. These are the only colors any overlay introduces.

ACCEPTANCE (added):
- With all overlays off, the stage is still comprehensible.
- With all overlays on, the stage is busy but each overlay is still
  distinguishable by color and shape alone, without a legend.

---

## Phase 6b — [REVISED, second pass]

Vehicle is direct-manipulation in the stage:
- Drag to move the vehicle in the horizontal plane.
- Shift-drag to move vertically.
- Rotate handle for yaw. Pitch and roll are constrained by the
  buoyancy model and are not user-set.
- Reset pose is a palette action.

No new HUD values:
- Position and velocity are in the inspector, not the HUD strip.
- The HUD strip already has the numbers a user needs at a glance.

ACCEPTANCE (added):
- The user can move the vehicle into the slipstream of a thruster
  and see the drag response, without typing coordinates.

---

## Phase 7 — [REVISED, second pass]

Presets are a dropdown in the header, next to RUN. Not in the
palette. Loading a preset does not open the inspector.

Stripcharts are popovers, not a panel:
- Clicking a HUD value opens a small 30s plot of that channel.
- Multiple popovers can be pinned. They stack in the stage corner.
- There is no always-on stripchart panel.

CSV export is a single icon in the header. Not a panel item.

Validation page is a separate route (/validation), not a tab in the
main app. A link in the footer.

ACCEPTANCE (added):
- A first-time user can select "Breakout Burst", press RUN, and see
  the demo without opening any panel.

---

## Phase 8 — [REVISED, second pass]

Adaptive resolution must not change the visual composition:
- When the fluid grid drops from 1024x512 to 512x256, the stage
  must not visibly pop. Cross-fade the heightfield detail over 250ms.
- The resolution scale indicator lives in the HUD strip, right side,
  next to fps. It is a small multiplier, not a warning.

No layout shift under load:
- The palette, inspector, and HUD strip must not reflow when frame
  time spikes or when overlays toggle.
- The RUN button never changes size or position.

ACCEPTANCE (added):
- Screen recording at 60fps of a 10-minute run shows zero layout
  shifts and zero visible resolution pops.

---

## Phase 9 — [REVISED, second pass]

Load-time experience (revised):
- First visit: stage renders with candidateA preloaded, all
  overlays off, RUN pulsing once. A single line of text under RUN:
  "Press RUN to start." No modal, no tour.
- Return visit: no intro. Stage is ready. RUN is idle.

PWA:
- Installable. Manifest with the app icon, name, and theme color.
- Offline: the full app works offline after first load. No network
  requests at runtime except optional oracle comparisons in the
  validation route.

Share:
- The header share icon copies a URL that encodes the full state:
  vehicle, thruster layout, stator config, presets, supply V,
  tether. Opening the URL restores the state and shows the stage
  ready to RUN.

README (revised):
- Lead with a screenshot of the stage at rest.
- Then the physics summary.
- Then the validation numbers.
- Then the design language, briefly, so a contributor knows the
  rules before touching the UI.

ACCEPTANCE (added):
- The public URL loads, shows the stage, and a stranger presses RUN
  within 5 seconds of landing.
- The share URL round-trips a 3-thruster alternating layout with
  stators and a non-default supply voltage.
