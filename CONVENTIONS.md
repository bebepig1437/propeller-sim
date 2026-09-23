# Physical & Architectural Conventions

This document establishes the official reference conventions for coordinates, orientations, signs, and units across all simulation, hydrodynamic, electrical, and rendering modules in the SeaPerch Propeller & Vehicle Simulator (**Candidate A**).

---

## 1. Coordinate Systems

### 1.1 World Frame (Three.js 3D Coordinate Frame)
The global simulation space follows a right-handed Cartesian coordinate system:
- **$+X$**: Starboard / East (= the fluid grid's downstream / streamwise axis)
- **$+Y$**: Up (anti-gravity, towards water surface)
- **$+Z$**: Aft (towards observer / viewer in default camera). An upright mounted body's bow points along **$+Z$** — see §1.2 for the authoritative body remap.
- **$-Z$**: Fore of the *world* datum (opposite the mounted body's bow). The 2D fluid cut plane is the world X–Y plane at $z = 0$, so $\pm Z$ is the out-of-plane direction.

### 1.2 Vehicle Body Frame (Marine SNAME, as implemented)

The local vehicle body frame is centered at the **Center of Gravity (CoG)** and is the
**single source of truth** for every force, moment, velocity and rate under `src/vehicle/`:

| DOF | Axis | Positive sense | Symbol |
| :--- | :--- | :--- | :--- |
| Surge | $+X_{b}$ | Forward / bow | $u$ |
| Sway | $+Y_{b}$ | Starboard | $v$ |
| Heave | $+Z_{b}$ | **Up** (towards the free surface) | $w$ |
| Roll | about $X_{b}$ | Right-hand rule about $+X_{b}$ (raises the starboard side) | $p$ |
| Pitch | about $Y_{b}$ | Right-hand rule about $+Y_{b}$ (bow up) | $q$ |
| Yaw | about $Z_{b}$ | Right-hand rule about $+Z_{b}$ (bow to starboard) | $r$ |

Every tuple in the vehicle modules is **MARINE-ORDERED**: force/inertia
`[surge, sway, heave]`, moment/inertia `[roll, pitch, yaw]`, velocity
`[u, v, w]`, rates `[p, q, r]`. Object thruster inputs use the marine names
(`surgeN`, `swayN`, `heaveN`, `rollNm`, `pitchNm`, `yawNm`); the legacy
`[Fx, Fy, Fz]` array path is three.js body order and is converted through the
*same* mapping (`src/vehicle/integrator.ts → thrusterInputToMarine`), so the two
paths cannot disagree.

> **Documented deviation — heave is positive UP.** Strict SNAME defines heave
> positive DOWN. This codebase defines it positive UP so the body frame agrees in
> sign with the three.js world frame ($+Y$ up). Every heave-signed quantity
> (heave velocity, heave thrust, CoB height, net buoyancy $\approx +0.197\,\text{N}$)
> is positive upward.
>
> **Center of Buoyancy** ($12.5\,\text{mm}$ above the CoG):
> $$\vec{r}_{CoB} = (0,\, 0,\, +0.0125)\,\text{m} \quad \text{(marine order)}$$
> The resulting righting moment is the true cross product
> $\vec{\tau} = \vec{r}_{CoB} \times \vec{F}_{buoy}$ (see §10.5).
>
> **Upright world remap** — the *only* place this remap is written is
> `src/render/frameMap.ts` (`bodyPointToWorld` / `bodyDirToWorld`) and the
> matching helpers in `src/vehicle/body.ts`:
> $$(u,\, v,\, w)_{marine} \;\rightarrow\; (x,\, y,\, z)_{three} = (sway,\, heave,\, surge)$$
> An upright body's bow ($+X_b$) therefore points along world $+Z$ and its heave
> axis ($+Z_b$) along world $+Y$ up. A pure surge impulse produces motion in
> world $Z$ **only** — asserted by the axis-purity matrix in
> `tests/vehiclePhase6b.test.ts`.
>
> The rotation signs above are the right-hand rule about the marine axes, so
> they are exact in the y-up frame. The prose in §2.1 ("positive roll is
> starboard down") belongs to the strict y-down SNAME frame; where the two
> disagree, the right-hand rule in this table — and the Vitest axis matrix — win.

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
4. **Vehicle state is authoritative in `src/vehicle/body.ts`**: the 3D stage (`src/render/vehicle3d.ts`) mirrors that pose and reports direct-manipulation edits *back* through callbacks. The stage never owns physics state; the physics body never reads from the scene graph. Stage direct manipulation writes position and yaw only — pitch and roll are owned by the buoyancy model.

5. **Canonical Module Layout (Zero Dual-Path Shims or Aliases).**
   Every functional module lives at a single authoritative path without re-export shims or dual-path aliases:
   - **`src/prop/motor.ts`** — the canonical electromechanical DC motor model (`DCMotorModel`, `MABUCHI_RC280A_SPECS`). `src/motor/` has been pruned.
   - **`src/core/clock.ts`** — the single canonical simulation clock (`SimulationClock`). `src/sim/clock.ts` has been pruned.
   - **`src/prop/bemt.ts`** — exports single canonical `solveBemt`. Dual-path `solveBEMT` alias is eliminated.
   - **`src/fluid/pressure.ts`** — exports canonical `solvePressure`, `solvePressurePoisson`, `solvePressureMultigrid`. Dual-path aliases are eliminated.
   - **`src/fluid/grid.ts`** — `FluidGrid` directly embeds `solid: Uint8Array`. Intersection workarounds are eliminated.
   - **`src/prop/coupling.ts`** — `ActuatorDiscCoupler`: single-prop actuator-disc momentum/velocity injection.
   - **`src/vehicle/coupling.ts`** — `VehicleFluidCoupler`: 6-DOF vehicle↔fluid loop.
   - **`src/fluid/sources.ts`** — inflow/plume sources (`InflowJet`).
   - `src/sim/` contains interpolation, adaptive resolution, and recovery modules.

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

## 10. Vehicle Rigid Body, Buoyancy & Fluid Coupling (Phase 6b)

### 10.1 Axis-purity contract
The axis-purity matrix in `tests/vehiclePhase6b.test.ts` is a hard invariant: a pure
surge impulse moves the body along world $Z$ only; sway along world $X$; heave along
world $Y$; and pure roll / pitch / yaw moments excite exactly one marine rate each
($p$, $q$, $r$) with zero cross-axis leakage.

### 10.2 Mass & inertia provenance (`src/vehicle/body.ts`)
- **Dry mass** $= 39.5\,\text{g}$ frame $+ 9.0\,\text{g}$ hardware $+ 3 \times 42.0\,\text{g}$ motors $+ 3 \times 1.80\,\text{g}$ props $= 179.9\,\text{g}$.
- **Inertia tensor** is built honestly from lumped point masses, not a solid box:
  8 frame-truss corner nodes ($60\%$ of frame mass) plus the 12 rail midpoints ($40\%$),
  each evaluated with $I_{xx} \mathrel{+}= m(y^2+z^2)$, $I_{yy} \mathrel{+}= m(x^2+z^2)$,
  $I_{zz} \mathrel{+}= m(x^2+y^2)$; the 3 motor masses at their array mounts;
  and each rotor's spin-axis $I_{zz}$ from the material table
  ($3.92\times10^{-7}\,\text{kg\,m}^2$ for the $1.80\,\text{g}$ Rigid 10K rotor, scaled linearly
  with rotor mass for PA12-CF15 / PETG) plus the offset-mass term $m a^2$ with
  $a = 75\,\text{mm}$. The CoG→node offset is
  `geometry.frame_truss.corner_half_gap_m = 0.088\,\text{m}`; it deliberately
exceeds the hull half-extents because the vector-skewed lattice mounts its nodes
off the hull envelope — the spec value is used as-is rather than silently re-clamped.

### 10.3 Added mass (documented simplification)
Added mass is **diagonal only — no off-diagonal coupling**. Translational added
mass is $\text{factor} \times (0.5\,\rho\,V_{displaced}) = \text{factor} \times 0.1\,\text{kg}$:
surge $0.85$ ($0.085\,\text{kg}$, slender ends), sway $1.00$ ($0.100\,\text{kg}$), heave $1.20$
($0.120\,\text{kg}$, the flat top/bottom plates entrain more). Rotational added mass is an
absolute diagonal on the same $0.5\rho V r_g^2$ base with $r_g = 0.088\,\text{m}$:
roll $7.5\times10^{-4}$, pitch $1.25\times10^{-3}$, yaw $1.1\times10^{-3}\,\text{kg\,m}^2$.
Because the missing rotational coupling can inject energy at high rates, the
integrator also clamps $|\vec{\omega}|$ at `vehicle.angularRateClampRadS` (10 rad/s); the
60 s free-decay Vitest asserts total rotational kinetic energy is monotonically
non-increasing.

### 10.4 Drag provenance (`src/vehicle/drag.ts`)
Quadratic terms use frame-face areas with an estimated blockage factor
($C_d \approx 1.0$ flat plates): surge sees $0.16 \times 0.14\,\text{m}^2$ at $\sim35\%$ blockage
($C_dA \approx 0.0079\,\text{m}^2$); sway $0.20 \times 0.14$ at $\sim46\%$ ($0.0129\,\text{m}^2$);
heave $0.20 \times 0.16$ at $\sim71\%$ ($0.0227\,\text{m}^2$). Linear viscous terms
($0.15 / 0.35 / 0.45\,\text{N\,s/m}$) and quadratic rotational terms
($4.5/9.5/8.5 \times 10^{-4}\,\text{N\,m\,s}^2/\text{rad}^2$) with linear rotational terms
dominate station-keeping. Damping always acts on the velocity **relative to the
ambient flow** and is strictly dissipative w.r.t. it ($\vec{F}_{drag} \cdot \vec{v}_{rel} \le 0$,
$\vec{\tau}_{drag} \cdot \vec{\omega} \le 0$), which is what lets the body feel a thruster
slipstream. All values are tunables under `vehicle.*` in `src/core/config.ts`.

### 10.5 Hydrostatics & passive self-righting (`src/vehicle/buoyancy.ts`)
Net buoyancy is $F_{net} = (\rho V_{displaced} - m_{dry}) g \approx +0.197\,\text{N}$ upward. The
restoring moment is the genuine cross product
$$\vec{\tau}_{right} = \vec{r}_{CoB}^{\,world} \times \vec{F}_{buoy}^{\,world}, \qquad
\vec{r}_{CoB}^{\,world} = R(q)\,(0,0,+0.0125)$$
so a $30^\circ$ roll swings the CoB sideways and yields a restoring moment about world
$Z$ ($-\sin\theta \cdot 0.0125 \cdot F_{buoy}$), while a pitch yields a moment about world $X$.
A vertical buoyant force can never produce a moment about the vertical axis, and
the Vitest suite asserts exactly that. This is the mechanism behind the spec's
"low roll without control" IMU observation. The earlier axis bug — sway mapped to
$X$ and heave to $Y$, with pitch/yaw swapped — is fixed and regression-guarded.

### 10.6 Integrator (`src/vehicle/integrator.ts`)
Semi-implicit (symplectic) Euler, angular-first: (1) accumulate marine body forces
and moments, (2) $\omega \mathrel{+}= I_{eff}^{-1}\tau\,dt$, (3)
$q \leftarrow q \otimes \Delta q(\omega\,dt)$, (4) $v \mathrel{+}= R(q_{new})\,F_{body}/m_{eff}\,dt$,
(5) $x \mathrel{+}= v\,dt$, (6) rate clamp, then tank constraints. Linear
velocity is stored in the **world** frame, so a wall collision imparts its impulse
to stored state: the radial clamp removes the outward normal velocity component
and it **persists** to the next step (the pre-Phase-6b bug lost it by recomputing
from body state, letting the body tunnel out). Substepping defaults to
`vehicle.vehicleSubstepDivider = 2` (1/120 s) with thrust held constant across
substeps, which damps the fluid ↔ vehicle ↔ BEMT feedback loop.

### 10.7 Vehicle ↔ fluid coupling (`src/vehicle/coupling.ts`)
Loop topology per fluid step: sample each rotor disk's advance speed and the
ambient in-plane flow at the CoG → BEMT/array evaluation with per-thruster inflow
→ re-inject BEMT thrust as grid momentum + dye → step the fluid → step the rigid
body with that thrust and the ambient flow. **Advance-speed convention**:
$$V_a = (\vec{v}_{disk} - \vec{v}_{fluid}) \cdot \hat{a}$$
follows the standard open-water sign (a vehicle advancing along its thrust axis
sees $V_a > 0$ and thrust falls off with $J = V_a / nD$). This is deliberately
**different** from the legacy single-prop path in `src/prop/coupling.ts` and the two
must not be mixed. **2D-plane simplification (documented)**: the cutaway resolves
only world X–Y flow, so at upright attitude the heave rotor couples strongly while
the two out-of-plane surge rotors contribute $\approx 0$ to the fluid (their thrust
still drives the body). Momentum injection is conservative to machine precision:
$\sum_{cells} (m_{cell} \Delta v_{cell}) = T_{in\text{-}plane}\,dt$, renormalized over the
clipped disc so the total is exact.

**Self-wash guards (both required; the closed-loop Vitest fails without them).**
A body that samples its own freshly injected efflux creates a positive feedback
loop — a rotor sees a self-tailwind (lower $J$ → more thrust) and the frame drag
term carries the body along with the wash it just made. Measured against the CPU
reference solver, a hovering-magnitude configuration rose $0.49\,\text{m}$ in $2\,\text{s}$
instead of the correct thrust-and-buoyancy response, driven by its own CoG seeing
$0.47\,\text{m/s}$ of its own exhaust. Two guards, both in
`VehicleCouplerConfig`:
1. `injectionOffsetCells` (default $14$ ≈ one rotor radius): the slipstream is laid
down as a **plume downstream of the disc** (the vena contracta), never on the disc
itself — so a rotor does not sample its own exhaust as an advance-speed tailwind.
2. `ambientSampleOffsetCells` (default $28$ ≈ two rotor radii): the ambient flow fed
to the frame **drag** term is sampled **upstream of the net in-plane thrust
direction**, where the free stream is unperturbed by the body's own plume. External
flows — including a thruster's slipstream from elsewhere, which is the acceptance
scenario — still appear in that sample.
With both guards the sampled `|v_ambient|` at the sample point stays a small
fraction of the body's own speed (asserted), and the heave response becomes
sign-correct and monotone in commanded thrust.

### 10.8 Validation oracles (Phase 6b suite)
- **Axis purity matrix**, **hover / terminal rise velocity** ($0.1134\,\text{m/s}$ from
  $F_{net} = 0.197\,\text{N}$ with the real drag law), **30° roll self-righting envelope**
  ($\tau = 2I_{eff}/c_{lin} = 0.710\,\text{s}$, $\omega_n = 3.72\,\text{rad/s}$, fitted time constant
  within $\pm20\%$), **collision persistence / no tunneling**, **60 s free-decay energy**,
  **ledger $Q_{net}$ == applied roll torque within $10^{-6}$**, **coaxial contra-rotating pair
  nets $\approx 0$ roll**, and the **coupling** invariants above.
- **Surge step response** compared against an *independently implemented* RK4
  integration of Fossen's 1-DOF forward-speed model at a $10^{-4}\,\text{s}$ step
  (5% on final velocity, 10% on rise time, 2% max trajectory error). This measures the
  simulator's discretisation error against a trusted solution of the same physics;
  it is **not** a runtime UUV-Simulator rung, which would require that simulator.
- **Propeller-law sanity check**: array thrust follows the published quadratic
  $n^2$ scaling and the bollard $K_T = T/(\rho n^2 D^4)$ lands in the
  $[0.05, 0.5]$ band expected of a small low-aspect propeller. Absolute thrust
  magnitudes are **not** comparable to a BlueROV2/T200 ($\varnothing 76\,\text{mm}$), so the
  published curve is used for *shape* and $K_T$ plausibility only.

## 11. Validation Asset Provenance & Isolation (Directive 5)

1. Static datasets in `public/validation/` (`j_sweep_validation.json`, `j_sweep_validation.svg`) are reserved solely as static assets for the Phase 9 offline `/validation` report page.
2. Per master architecture rules, runtime modules under `src/` must NEVER import from `public/validation/`. Dynamic runtime comparisons against oracles occur exclusively offline or within Vitest test fixtures under `tests/`. in `public/validation/` (`j_sweep_validation.json`, `j_sweep_validation.svg`) are reserved solely as static assets for the Phase 9 offline `/validation` report page.
2. Per master architecture rules, runtime modules under `src/` must NEVER import from `public/validation/`. Dynamic runtime comparisons against oracles occur exclusively offline or within Vitest test fixtures under `tests/`.

## 12. Module Registry & Architecture

1. **ServiceRegistry (`src/core/registry.ts`)**: Implements central decoupled cross-module access without circular imports per Phase 0 Master Context.
2. **Propeller Design Registry (`src/prop/designs/index.ts`)**: Canonical repository of propeller design definitions (Candidate A, Kaplan, Wageningen B-Series) and spanwise blade geometry interpolation functions.
3. **Vehicle Config Loader (`src/config/vehicleLoader.ts`)**: Loads and validates authoritative vehicle configuration schemas from `public/vehicles/*.json`.
4. **Telemetry Logger (`src/telemetry/logger.ts`)**: Ring-buffered high-frequency telemetry sink for CSV export and performance analysis.
