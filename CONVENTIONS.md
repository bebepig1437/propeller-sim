# Physical & Architectural Conventions

This document establishes the official reference conventions for coordinates, orientations, signs, and units across all simulation, hydrodynamic, electrical, and rendering modules in the SeaPerch Propeller & Vehicle Simulator (**Candidate A**).

---

## 1. Coordinate Systems

### 1.1 World Frame (Three.js 3D Coordinate Frame)
The global simulation space follows a right-handed Cartesian coordinate system:
- **$+X$**: Starboard / East
- **$+Y$**: Up (anti-gravity, towards water surface)
- **$+Z$**: Aft (towards observer / viewer in default camera)
- **$-Z$**: Fore / Forward surge direction in world space

### 1.2 Vehicle Body Frame (Marine SNAME Standard)
The local vehicle body frame is centered at the **Center of Gravity (CoG)** following standard marine dynamics (Fossen / SNAME):
- **$+X_{b}$**: Longitudinal axis pointing Forward / Bow (**Surge**, $u$)
- **$+Y_{b}$**: Transverse axis pointing Starboard (**Sway**, $v$)
- **$+Z_{b}$**: Vertical axis pointing Down / Keel (**Heave**, $w$)

> **Note on Buoyancy Offset**:
> Center of Buoyancy (CoB) is located at:
> $$\vec{r}_{CoB} = (0,\, 0,\, -0.0125\,\text{m})$$
> relative to CoG ($12.5\,\text{mm}$ dorsal/upward, anti-heave).

### 1.3 Fluid Grid Frame (2D Eulerian Reference)
- Origin $(0, 0)$ is at the lower-left corner of the grid.
- Horizontal axis: $x \in [0, N_x - 1]$ (streamwise direction, left-to-right).
- Vertical axis: $y \in [0, N_y - 1]$ (spanwise / depth direction).
- Inflow jet enters at $x=0$ boundary with positive $u$ velocity ($+X$).

---

## 2. Sign Conventions

### 2.1 Rotations and Angular Rates (Marine SNAME Standard)
- **Roll ($\phi$, $p$)**: Rotation around the longitudinal axis ($+X_b$, Surge). Positive is starboard roll (starboard down).
- **Pitch ($\theta$, $q$)**: Rotation around transverse axis ($+Y_b$, Sway). Positive is pitch up (bow up).
- **Yaw ($\psi$, $r$)**: Rotation around vertical axis ($+Z_b$, Heave). Positive is bow swinging to starboard (clockwise from above).

### 2.2 Propeller Handedness & Torque Reaction
- **CW (Clockwise)**: As viewed from behind the propeller looking forward into the slipstream.
  - Generates forward thrust along $+Z_b$.
  - Exerts counter-clockwise ($-$) reaction torque on the vehicle body.
- **CCW (Counter-Clockwise)**: Opposite rotation.
  - Exerts clockwise ($+$) reaction torque on the vehicle body.
- **Candidate A Motor Pairing**:
  - Motor 1 (Port): CW
  - Motor 2 (Starboard): CCW
  - Motor 3 (Vertical / Aft): CW
  - Net roll torque balance is compensated by stator vane swirl recovery.

### 2.3 Stator Vane Swirl Recovery
- **Incidence**: $-5.2^\circ$ (cambered counter-rotation relative to incoming slipstream swirl).
- **Slotted chord**: Slotted at $40\%$ chord length.
- **Forward Thrust Gain**: $+0.04\,\text{N}$ at breakout.
- **Reverse Penalty**: $-0.09\,\text{N}$ when operating in reverse flow.

### 2.4 BEMT Sign Conventions & Hydrodynamic Bounds
- **Forward Thrust**: Positive along $+X_b$ (longitudinal forward surge) when advance velocity $V_a \ge 0$ and pitch $> 0$.
- **Reverse Thrust**: Produced by negative blade pitch angle or reverse rotational RPM ($n < 0$).
- **Tangential Inflow Velocity**:
  $$V_\theta = \omega r \mp v_{i\theta}$$
  CW handedness flips the tangential swirl term to oppose rotation, generating negative reaction torque; CCW produces positive reaction torque. Flipping CW to CCW produces $|T|$ and $|Q|$ equal within $10^{-6}$ and opposite torque signs.
- **Efficiency Clamping**: Hydrodynamic open-water efficiency is clamped strictly to $\eta \in [0, 1]$.
- **Zero-RPM Locked-Rotor Drag**: When $|RPM| < 1$, the propeller operates in locked-rotor drag mode, returning non-empty radial elements and producing quadratic drag $F_{\text{drag}} = -0.5 \rho V_a^2 C_d A$.

---

## 3. Physical Units (Strict SI)

All internal computation engines must compute strictly in standard SI units. Conversion from human-friendly units (such as grams, millimeters, RPM, or AWG) must occur at ingestion time (e.g. in loader modules):

| Quantity | Internal Unit | Ingestion / Display Unit | Conversion |
| :--- | :--- | :--- | :--- |
| Length | Meters ($\text{m}$) | Millimeters ($\text{mm}$) | $1\,\text{mm} = 10^{-3}\,\text{m}$ |
| Mass | Kilograms ($\text{kg}$) | Grams ($\text{g}$) | $1\,\text{g} = 10^{-3}\,\text{kg}$ |
| Time | Seconds ($\text{s}$) | Seconds / Milliseconds | $1\,\text{ms} = 10^{-3}\,\text{s}$ |
| Force / Thrust | Newtons ($\text{N}$) | Newtons ($\text{N}$) | $1\,\text{N} = 1\,\text{kg}\cdot\text{m/s}^2$ |
| Torque | Newton-meters ($\text{N}\cdot\text{m}$) | $\text{N}\cdot\text{m}$ | SI |
| Angular Velocity | Radians / sec ($\text{rad/s}$) | RPM | $\omega = \text{RPM} \times \frac{2\pi}{60}$ |
| Voltage | Volts ($\text{V}$) | Volts ($\text{V}$) | SI |
| Current | Amperes ($\text{A}$) | Amperes ($\text{A}$) | SI |
| Resistance | Ohms ($\Omega$) | Ohms ($\Omega$) | SI |
| Fluid Density | $\text{kg/m}^3$ | $\text{g/cm}^3$ | $\rho_{\text{water}} = 1000.0\,\text{kg/m}^3$ |
| Kinematic Viscosity | $\text{m}^2/\text{s}$ | $\text{m}^2/\text{s}$ | $\nu_{\text{water}} \approx 10^{-6}\,\text{m}^2/\text{s}$ |

---

## 4. Electrical Model Conventions

- **Supply Voltage ($V_s$)**: $12.0\,\text{V}$ nominal.
- **Tether Roundtrip Resistance ($R_t$)**: $0.782\,\Omega$ ($15\,\text{ft}$ 24 AWG roundtrip).
- **Terminal Voltage ($V_t$)**:
  $$V_t = V_s - (I_{total} \cdot R_t)$$
- **Motor Armature Current ($I$)**:
  $$I = \frac{V_t - k_e \cdot \omega}{R_a}$$
- **Shaft Torque ($\tau$)**:
  $$\tau = k_t \cdot (I - I_0)$$

---

## 5. Architectural Invariants

1. **Config Immutability**: Values from `public/vehicles/candidateA.json` must be loaded dynamically into `src/core/config.ts`. Hardcoded physical specs in engine logic are forbidden.
2. **Fixed-Timestep Accumulator**: Simulation physics always steps at $60\,\text{Hz}$ ($\Delta t = 1/60\,\text{s}$). Render interpolation ($\alpha \in [0, 1)$) smoothly bridges visual frames.
3. **Renderer Fallback**: `WebGPURenderer` is the primary target with automated fallback to `WebGLRenderer` on unsupported clients.

---

## 6. Visual & Rendering Separation

1. **HDRI / Procedural Sky**: Purely visual environment illumination. It must **never** contribute to or be queried by any physics, hydrodynamic, or dynamic equations.
2. **Beer-Lambert Optical Absorption**: Attenuation coefficients ($\alpha_{\text{red}} = 0.35/\text{m}$, $\alpha_{\text{green}} = 0.06/\text{m}$, $\alpha_{\text{blue}} = 0.018/\text{m}$) are strictly visual optical shading constants. They must never leak into fluid drag or vehicle buoyancy physics.
3. **Camera & Diagnostic Presets**: Orbit controls, side cutaway view, and lighting tunables are pure observation transformations. Toggling or modifying camera presets must never alter physics telemetry or state.

---

## 7. Numerical Stability & Validation Oracles

1. **Vorticity Confinement Epsilon**: Documented threshold `VORTICITY_GRADIENT_EPSILON = 1e-7` below which confinement force is exactly zero, preventing division-by-zero or `NaN` in irrotational flows.
2. **CFL Guard & Substepping**: Velocity magnitude is inspected every step: $CFL = (|u|_{\max} \cdot \Delta t) / \Delta x$. If $CFL > 2.0$, the solver substeps up to 8 times and clamps excessive velocities, preventing numerical explosion.
3. **Incompressible Divergence Oracle**: After pressure projection, steady inflow field maintains max interior $|\text{div}| < 10^{-3}$. GPU readback matches CPU reference within $10\%$.
4. **Conservative Surface Heightfield**: Surface elevation integrates $\frac{d\eta}{dt} = v_{\text{surf}} \cdot 0.15 - g_{\text{restoring}} \cdot \eta$. The restoring term $-g_{\text{restoring}} \cdot \eta$ ensures total heightfield energy is flat (within 1%) in still water and does not inject phantom energy.
5. **Gerstner Spectral Cutoff & Advection**: Gerstner octaves operate below the grid Nyquist cutoff ($\sim 2 \cdot dx$). Gerstner amplitude scales with local fluid velocity, and propagation direction is advected by the local flow.
6. **Seafoam Decay**: Foam is driven by vorticity and velocity readback, with a finite lifetime ($5\,\text{s}$ default) preventing unnatural accumulation in recirculation zones. Foam is advected solely by the fluid field, not Gerstner waves.
7. **Reverse-Flow Transition Blend Band**: To eliminate force discontinuity and non-physical pressure feedback spikes when local axial inflow $v_{\text{net}} = V_a + v_i$ crosses zero, BEMT employs a Hermite polynomial smoothstep blend across transition band $w = 0.05\,\text{m/s}$ (`REVERSE_FLOW_BLEND_BAND_MS`):
   $$t = \text{clamp}\left(\frac{v_{\text{net}} + w}{2w},\, 0,\, 1\right),\quad s(t) = 3t^2 - 2t^3$$
   Forward ($C_n, C_t, W$) and reverse polars are evaluated and blended smoothly with $s(t)$, guaranteeing $C^1$ continuity ($< 1\%$ change per $0.001\,\text{m/s}$ step across the boundary).
8. **Prandtl Tip and Hub Loss Formulations**:
   - Tip loss: $f_{\text{tip}} = \frac{B}{2} \frac{R - r}{r \sin \phi}$, $F_{\text{tip}} = \frac{2}{\pi} \arccos(\exp(-f_{\text{tip}}))$.
   - Hub loss: $f_{\text{hub}} = \frac{B}{2} \frac{r - R_{\text{hub}}}{r \sin \phi}$, $F_{\text{hub}} = \frac{2}{\pi} \arccos(\exp(-f_{\text{hub}}))$ (Drela XROTOR / OpenProp).
   - Combined factor $F = \max(0.05, F_{\text{tip}} \cdot F_{\text{hub}})$ guarantees circulation smoothly vanishes at both the blade tip and hub root.
9. **Fluid Coupling Swirl Sign Propagation**:
   - Propeller handedness derives `swirlSign: +1 | -1` (`CW = -1`, `CCW = +1`), matching hull reaction torque conventions.
   - Actuator disk body force injection imparts signed tangential swirl velocity $v_\theta(r)$ across the disk and tip vortex shear, ensuring counter-rotating units coaxially produce opposite-sign tangential momentum at the disk centroid within $10^{-6}$.
10. **Torque Ledger Lifecycle and Steady-State Terminal Roll Rate**:
   - Entries are indexed by `${sourceId}_${sourceType}` in a fixed-capacity Map. Thruster removal mid-run calls `removeSource(id)` which purges the slot, ensuring no ghost torques leak into $Q_{\text{prop\_total}}$.
   - Steady-state roll rate accounts for hydrodynamic rotational damping: $\omega_{\text{terminal}} = Q_{\text{net}} / B_{\text{roll}}$, with calibrated linear roll damping $B_{\text{roll}} = 0.0014276\,\text{N}\cdot\text{m}/(\text{rad/s})$ at $U = 1.0\,\text{m/s}$, reproducing Candidate A spec anchor points ($14.8^\circ/\text{m}$ uncompensated baseline, $1.8^\circ/\text{m}$ slotted stator).
   - **`getNetSummary(forwardSpeedMs)` takes a REQUIRED forward speed** (Phase 6 principal review, Directive 1). Callers pass `1.0` for the spec IMU anchor, the live sampled inflow $U$ when running, and `0` when genuinely at rest. `terminalRollRateDegPerM_at_1ms` is defined **only at $U = 1.0\,\text{m/s}$** and must NOT be interpreted as a speed-invariant material property: with crossflow damping scaling as $B_{\text{roll}}(U) = B_{\text{roll}} \cdot (U / U_{\text{ref}})$, the deg/m rate scales as $1/U^2$. Calling with `0` yields `valid: false` and `NaN` in every `*DegPerM` field — this is an explicit "at rest, undefined" signal, never silently substituted with $1\,\text{m/s}$.

## 8. Overlay Frame Mappings & Timestep Provenance (Phase 6)

1. **Centralized frame transforms**: every overlay maps grid↔world and body↔world through `src/render/frameMap.ts` (`gridToWorld`, `worldToGrid`, `bodyPointToWorld`, `bodyDirToWorld`). No overlay may inline its own axis remap — a future rotated/tilted fluid plane changes exactly one module.
2. **Grid plane extent is derived, never stored**: extent = `gridDims × gridDxM` computed at the use site. There is no separate extent field that can drift from the grid resolution.
3. **Overlay advection uses the FIXED physics dt** (`ctx.physicsDt`, the SUM of substeps executed this frame, 0 when paused), NOT the render dt. Streamline/particle integration therefore stays time-consistent with the velocity field at any display refresh rate (a 240 Hz frame with zero substeps advances no advection; a dropped frame with 3 substeps advances 3 steps' worth). Render dt (`ctx.dt`) drives pure animation only: variant-diff fade, current pulse, roll-needle smoothing. This is the documented split from the Phase 6 principal review, Directive 5.
4. **Roll-needle clipping is visible** (Directive 6): `|rate| ≥ ROLL_NEEDLE_CLAMP_DEG (45°)` shifts the needle to the heat accent and `OverlaySystem.rollRateRaw` always exposes the raw value. Overlays never silently flatline.
5. **Instanced draw counts track ACTIVE counts, not capacity** (Directive 3): `count`/`setDrawRange` are set to the live instance count every frame; buffer uploads are range-limited (`addUpdateRange`) to the dirty slice (Directive 8). Particle buffers are a documented exception: they are regenerated wholly each frame by design.

## 9. Documentation Layout (Directive 6)

1. `docs/` is the canonical repository home for comprehensive architectural, design, and phase specification documents (e.g. `docs/PHASE_DOCUMENT_FINAL.md`).
2. The repository root contains only high-level developer guidance (`README.md`), project conventions (`CONVENTIONS.md`), and the agent context rules symlink (`AGENTS.md -> .agy/rules.md`). Phase-by-phase design deep dives must not accumulate at root.

## 10. Validation Asset Provenance & Isolation (Directive 5)

1. Static datasets in `public/validation/` (`j_sweep_validation.json`, `j_sweep_validation.svg`) are reserved solely as static assets for the Phase 9 offline `/validation` report page.
2. Per master architecture rules, runtime modules under `src/` must NEVER import from `public/validation/`. Dynamic runtime comparisons against oracles occur exclusively offline or within Vitest test fixtures under `tests/`.
