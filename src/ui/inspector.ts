/**
 * Context-Sensitive Inspector Component (IBM Quantum Composer inspired)
 * Displays orthogonal controls for the currently selected object.
 * Advanced physics parameters live behind an "Advanced" fold closed by default.
 */

export type InspectorSelection =
  | { type: 'none' }
  | { type: 'thruster'; index: number }
  | { type: 'vehicle' }
  | { type: 'fluid' };

/**
 * Live Phase 6b vehicle telemetry for the inspector panel.
 * MARINE ORDER everywhere in the tuples (surge, sway, heave / roll, pitch, yaw)
 * — see CONVENTIONS.md §1.2. World tuples are the 3D stage frame.
 */
export interface VehicleTelemetryView {
  positionWorldM: [number, number, number];
  velocityWorldMs: [number, number, number];
  /** [u surge, v sway, w heave] m/s */
  velocityBodyMs: [number, number, number];
  eulerDeg: { rollDeg: number; pitchDeg: number; yawDeg: number };
  /** [p roll, q pitch, r yaw] rad/s */
  ratesRadS: [number, number, number];
  /** Net buoyancy (+0.197 N for Candidate A). */
  buoyancyForceN: number;
  /** Total applied body force along the heave axis (thrust + drag + hydrostatics). */
  netVerticalForceN: number;
  dragForceN: [number, number, number];
  restoringTorqueNm: [number, number, number];
  thrustForceMarineN: [number, number, number];
  thrustMomentMarineNm: [number, number, number];
  /** CoB−CoG lever (mm) — the passive static stability margin. */
  staticStabilityMm: number;
  dryMassG: number;
  displacedVolumeCm3: number;
  /** Solid-body inertia tensor (marine order) kg·m². */
  inertiaBody: [number, number, number];
  /** Translational added mass (marine order) kg. */
  addedMassBody: [number, number, number];
  /** Roll deviation per meter of forward travel (deg/m), live forward speed. */
  rollDeviationDegPerM: number;
  tetherAttached: boolean;
  grounded: boolean;
  broaching: boolean;
  angularRateClamped: boolean;
}

export interface InspectorCallbacks {
  onSupplyVoltageChange?: (volts: number) => void;
  onTetherLengthChange?: (feet: number) => void;
  onTetherLengthMChange?: (meters: number) => void;
  onTetherAwgChange?: (awg: number) => void;
  onAmbientTempChange?: (tempC: number) => void;
  onThermalToggle?: (enabled: boolean) => void;
  onThrottleChange?: (thrusterIdx: number, throttle: number) => void;
  onPitchChange?: (thrusterIdx: number, pitchDeg: number) => void;
  onHandednessToggle?: (thrusterIdx: number) => void;
  onStatorToggle?: (thrusterIdx: number, attached: boolean) => void;
  onStatorIncidenceChange?: (thrusterIdx: number, incidenceDeg: number) => void;
  onStatorSlotToggle?: (thrusterIdx: number, slotted: boolean) => void;
  onStatorSlotPctChange?: (thrusterIdx: number, slotPct: number) => void;
  onPropulsorCountChange?: (count: number) => void;
  onHandednessPresetChange?: (preset: string) => void;
  onViscosityChange?: (viscosity: number) => void;
  onVorticityChange?: (vorticity: number) => void;
  onInflowChange?: (inflowVx: number) => void;
  onInflowDampingChange?: (damping: number) => void;
  onResolutionChange?: (preset: '1024x512' | '512x256' | '256x128') => void;
}

export class SimInspector {
  private container: HTMLElement;
  private callbacks: InspectorCallbacks;
  private currentSelection: InspectorSelection = { type: 'none' };

  // Run settings state
  public supplyV = 12.0;
  public tetherM = 4.6;
  public tetherFt = 15;
  public tetherAwg = 24;
  public tetherResistance = 0.782;
  public ambientTempC = 20.0;
  public thermalActive = true;
  public inflowDamping = 0.5;

  // Array state
  public propulsorCount = 3;
  public handednessPreset = 'alternating';
  public perUnitThrottles: number[] = [1.0, 1.0, 0.0];

  // Thruster state
  public thrusterThrottle = 0.881;
  public thrusterRpm = 3800;
  public thrusterPitch = 18.0;
  public thrusterHandedness: 'CW' | 'CCW' = 'CW';
  public thrusterVterm = 10.82;
  public thrusterCurrentA = 1.25;
  public thrusterTempC = 20.0;
  public thrusterThermalState: 'OK' | 'WARN' | 'CUTOUT' = 'OK';

  // Stator per selected unit
  public statorAttached = true;
  public statorIncidenceDeg = -5.2;
  public statorSlotted = true;
  public statorSlotChordPct = 40.0;

  // Phase 6b vehicle telemetry (pushed from main.ts every frame)
  private vehicleView: VehicleTelemetryView | null = null;

  // Fluid state
  public viscosity = 1e-6;
  public vorticityStrength = 0.15;
  public inflowVelocity = 1.2;
  public resolution: '1024x512' | '512x256' | '256x128' = '1024x512';

  constructor(container: HTMLElement, callbacks: InspectorCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  public setSelection(selection: InspectorSelection): void {
    this.currentSelection = selection;
    this.render();
  }

  public render(): void {
    switch (this.currentSelection.type) {
      case 'none':
        this.renderRunSettings();
        break;
      case 'thruster':
        this.renderThrusterSettings(this.currentSelection.index);
        break;
      case 'vehicle':
        this.renderVehicleSettings();
        break;
      case 'fluid':
        this.renderFluidSettings();
        break;
    }
  }

  private renderRunSettings(): void {
    this.container.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">Run Settings</span>
        <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-muted);">Electrical</span>
      </div>

      <!-- Supply Voltage (10–14 V) -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Supply Voltage</span>
          <span class="inspector-field-value" id="val-supply-v">${this.supplyV.toFixed(1)} V</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-supply-v" min="10.0" max="14.0" step="0.1" value="${this.supplyV}">
      </div>

      <!-- Tether Length (0–30 m) -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Tether Length</span>
          <span class="inspector-field-value" id="val-tether-m">${this.tetherM.toFixed(1)} m (${Math.round(this.tetherM * 3.28084)} ft)</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-tether-m" min="0" max="30" step="1" value="${this.tetherM}">
      </div>

      <!-- Tether AWG -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Tether Conductor</span>
          <span class="inspector-field-value" id="val-tether-r">${this.tetherResistance.toFixed(3)} Ω</span>
        </div>
        <select class="palette-select" id="select-tether-awg" style="width:100%; margin-top:4px;">
          <option value="18" ${this.tetherAwg === 18 ? 'selected' : ''}>18 AWG (Heavy Duty)</option>
          <option value="20" ${this.tetherAwg === 20 ? 'selected' : ''}>20 AWG (Standard ROV)</option>
          <option value="22" ${this.tetherAwg === 22 ? 'selected' : ''}>22 AWG (Lightweight)</option>
          <option value="24" ${this.tetherAwg === 24 ? 'selected' : ''}>24 AWG (Candidate A - 0.782 Ω)</option>
          <option value="26" ${this.tetherAwg === 26 ? 'selected' : ''}>26 AWG (Micro Tether)</option>
        </select>
      </div>

      <!-- Ambient Water Temperature (0–35 °C) -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Ambient Water Temp</span>
          <span class="inspector-field-value" id="val-ambient-temp">${this.ambientTempC.toFixed(1)} °C</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-ambient-temp" min="0" max="35" step="1" value="${this.ambientTempC}">
      </div>

      <!-- Thermal Dissipation Model -->
      <div class="inspector-field" style="margin-top: 6px;">
        <div class="inspector-field-header">
          <span>Thermal Model</span>
          <span class="inspector-field-value" style="color:${this.thermalActive ? 'var(--accent-heat)' : 'var(--text-muted)'};">
            ${this.thermalActive ? 'ACTIVE (85°C/100°C)' : 'DISABLED'}
          </span>
        </div>
        <button class="palette-btn" id="btn-toggle-thermal" style="margin-top:4px;">
          <span>Motor Heat Buildup</span>
          <span>${this.thermalActive ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      <!-- Array Configuration Group (Phase 5b) -->
      <div class="inspector-field" style="margin-top: 10px; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
        <div class="inspector-field-header">
          <span style="font-weight:600; color:var(--text-primary);">Propulsor Array</span>
          <span class="inspector-field-value" id="val-array-count">${this.propulsorCount} Units</span>
        </div>
        <div style="margin-top: 6px;">
          <span style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:2px;">Handedness Layout Preset</span>
          <select class="palette-select" id="select-inspector-preset" style="width:100%;">
            <option value="alternating" ${this.handednessPreset === 'alternating' ? 'selected' : ''}>Alternating (CW, CCW, CW)</option>
            <option value="all_cw" ${this.handednessPreset === 'all_cw' ? 'selected' : ''}>All CW</option>
            <option value="all_ccw" ${this.handednessPreset === 'all_ccw' ? 'selected' : ''}>All CCW</option>
            <option value="contra_rotating_coaxial" ${this.handednessPreset === 'contra_rotating_coaxial' ? 'selected' : ''}>Contra-Rotating Coaxial (CRP)</option>
            <option value="tandem" ${this.handednessPreset === 'tandem' ? 'selected' : ''}>Tandem Series</option>
          </select>
        </div>

        <details class="inspector-advanced" style="margin-top:8px;">
          <summary>Per-Unit Throttle Overrides</summary>
          <div class="advanced-content" style="padding-top:4px;">
            ${Array.from({ length: this.propulsorCount }).map((_, i) => `
              <div class="inspector-field" style="margin-bottom:6px;">
                <div class="inspector-field-header">
                  <span>T${i + 1} Throttle</span>
                  <span class="inspector-field-value" id="val-override-t${i}">${Math.round((this.perUnitThrottles[i] ?? 1.0) * 100)}%</span>
                </div>
                <input type="range" class="inspector-slider slider-override" data-th-idx="${i}" min="-1.0" max="1.0" step="0.05" value="${this.perUnitThrottles[i] ?? 1.0}">
              </div>
            `).join('')}
          </div>
        </details>
      </div>

      <!-- Closed "Advanced" Fold -->
      <details class="inspector-advanced">
        <summary>Advanced Physics</summary>
        <div class="advanced-content">
          <div class="inspector-field">
            <span class="inspector-field-header">Water Density: 1000 kg/m³</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Motor Resistance Ra: 4.50 Ω</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Thermal Cap C_th: 2.15 J/K</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Thermal Res R_th: 16.5 K/W</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Tether Inductance: 5.0 µH/m</span>
          </div>
          <div class="inspector-field" style="margin-top:6px;">
            <div class="inspector-field-header">
              <span>Inflow Damping (α)</span>
              <span class="inspector-field-value" id="val-inflow-damping">${this.inflowDamping.toFixed(2)}</span>
            </div>
            <input type="range" class="inspector-slider" id="slider-inflow-damping" min="0.1" max="1.0" step="0.05" value="${this.inflowDamping}">
          </div>
        </div>
      </details>
    `;

    const vSlider = this.container.querySelector('#slider-supply-v') as HTMLInputElement;
    vSlider?.addEventListener('input', () => {
      this.supplyV = parseFloat(vSlider.value);
      (this.container.querySelector('#val-supply-v') as HTMLElement).textContent = `${this.supplyV.toFixed(1)} V`;
      this.callbacks.onSupplyVoltageChange?.(this.supplyV);
    });

    const mSlider = this.container.querySelector('#slider-tether-m') as HTMLInputElement;
    mSlider?.addEventListener('input', () => {
      this.tetherM = parseFloat(mSlider.value);
      this.tetherFt = Math.round(this.tetherM * 3.28084);
      (this.container.querySelector('#val-tether-m') as HTMLElement).textContent = `${this.tetherM.toFixed(1)} m (${this.tetherFt} ft)`;
      this.callbacks.onTetherLengthMChange?.(this.tetherM);
      this.callbacks.onTetherLengthChange?.(this.tetherFt);
    });

    const awgSelect = this.container.querySelector('#select-tether-awg') as HTMLSelectElement;
    awgSelect?.addEventListener('change', () => {
      this.tetherAwg = parseInt(awgSelect.value, 10);
      this.callbacks.onTetherAwgChange?.(this.tetherAwg);
    });

    const tempSlider = this.container.querySelector('#slider-ambient-temp') as HTMLInputElement;
    tempSlider?.addEventListener('input', () => {
      this.ambientTempC = parseFloat(tempSlider.value);
      (this.container.querySelector('#val-ambient-temp') as HTMLElement).textContent = `${this.ambientTempC.toFixed(1)} °C`;
      this.callbacks.onAmbientTempChange?.(this.ambientTempC);
    });

    this.container.querySelector('#btn-toggle-thermal')?.addEventListener('click', () => {
      this.thermalActive = !this.thermalActive;
      this.renderRunSettings();
      this.callbacks.onThermalToggle?.(this.thermalActive);
    });

    const dampSlider = this.container.querySelector('#slider-inflow-damping') as HTMLInputElement;
    dampSlider?.addEventListener('input', () => {
      this.inflowDamping = parseFloat(dampSlider.value);
      (this.container.querySelector('#val-inflow-damping') as HTMLElement).textContent = this.inflowDamping.toFixed(2);
      this.callbacks.onInflowDampingChange?.(this.inflowDamping);
    });

    const presetSelect = this.container.querySelector('#select-inspector-preset') as HTMLSelectElement;
    presetSelect?.addEventListener('change', () => {
      this.handednessPreset = presetSelect.value;
      this.callbacks.onHandednessPresetChange?.(this.handednessPreset);
    });

    const overrideSliders = this.container.querySelectorAll('.slider-override');
    overrideSliders.forEach((slider) => {
      slider.addEventListener('input', (e) => {
        const input = e.currentTarget as HTMLInputElement;
        const thIdx = parseInt(input.dataset.thIdx || '0', 10);
        const val = parseFloat(input.value);
        this.perUnitThrottles[thIdx] = val;
        const readout = this.container.querySelector(`#val-override-t${thIdx}`);
        if (readout) readout.textContent = `${Math.round(val * 100)}%`;
        this.callbacks.onThrottleChange?.(thIdx, val);
      });
    });
  }

  private renderThrusterSettings(idx: number): void {
    const thermalColor = this.thrusterThermalState === 'CUTOUT'
      ? '#ef4444'
      : this.thrusterThermalState === 'WARN'
      ? '#f59e0b'
      : '#10b981';

    this.container.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">Thruster ${idx + 1}</span>
        <button class="palette-segment" id="btn-deselect" style="font-size:10px; padding:2px 6px;">✕ Close</button>
      </div>

      <!-- Electrical Telemetry Readout -->
      <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:6px; padding:8px; margin-bottom:10px; font-family:var(--font-mono); font-size:11px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="color:var(--text-muted);">V_term:</span>
          <span style="color:var(--text-primary); font-weight:600;" id="val-th-vterm">${this.thrusterVterm.toFixed(2)} V</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="color:var(--text-muted);">Current I:</span>
          <span style="color:var(--accent-current); font-weight:600;" id="val-th-current">${this.thrusterCurrentA.toFixed(2)} A</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="color:var(--text-muted);">Winding Temp:</span>
          <span style="color:${thermalColor}; font-weight:600;" id="val-th-temp">${this.thrusterTempC.toFixed(1)} °C</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
          <span style="color:var(--text-muted);">Thermal State:</span>
          <span style="color:${thermalColor}; font-weight:700;" id="val-th-state">${this.thrusterThermalState}</span>
        </div>
      </div>

      <!-- Throttle -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Throttle Command</span>
          <span class="inspector-field-value" id="val-thruster-throttle">${(this.thrusterThrottle * 100).toFixed(0)}%</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-throttle" min="-1.0" max="1.0" step="0.05" value="${this.thrusterThrottle}">
      </div>

      <!-- Pitch -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Blade Pitch</span>
          <span class="inspector-field-value" id="val-thruster-pitch">${this.thrusterPitch.toFixed(1)}°</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-pitch" min="-15" max="35" step="1" value="${this.thrusterPitch}">
      </div>

      <!-- Handedness -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Rotation Chirality</span>
          <span class="inspector-field-value">${this.thrusterHandedness}</span>
        </div>
        <button class="palette-btn" id="btn-toggle-handedness" style="margin-top:4px;">
          <span>Handedness (${this.thrusterHandedness})</span>
          <span>Flip ⇄</span>
        </button>
      </div>

      <!-- Stator Vane Configuration (Phase 5b) -->
      <div class="inspector-field" style="margin-top:8px; border-top:1px solid var(--border-subtle); padding-top:8px;">
        <div class="inspector-field-header">
          <span style="font-weight:600;">Stator Anti-Torque</span>
          <span class="inspector-field-value" style="color:${this.statorAttached ? 'var(--accent-torque)' : 'var(--text-muted)'};">
            ${this.statorAttached ? 'ATTACHED' : 'DETACHED'}
          </span>
        </div>
        <button class="palette-btn" id="btn-th-stator-toggle" style="margin-top:4px;">
          <span>Stator Cascade</span>
          <span>${this.statorAttached ? 'ON ✓' : 'OFF —'}</span>
        </button>

        ${this.statorAttached ? `
          <div style="margin-top:6px;">
            <div class="inspector-field-header">
              <span>Incidence Angle</span>
              <span class="inspector-field-value" id="val-th-stator-inc">${this.statorIncidenceDeg.toFixed(1)}°</span>
            </div>
            <input type="range" class="inspector-slider" id="slider-th-stator-inc" min="-15" max="15" step="0.1" value="${this.statorIncidenceDeg}">
          </div>

          <div style="margin-top:6px;">
            <div class="inspector-field-header">
              <span>Suction Slot</span>
              <span class="inspector-field-value">${this.statorSlotted ? 'SLOTTED' : 'SOLID'}</span>
            </div>
            <button class="palette-btn" id="btn-th-stator-slot" style="margin-top:4px;">
              <span>Slot Boundary Bleed</span>
              <span>${this.statorSlotted ? 'SLOTTED (40% c)' : 'SOLID (Stalls in Rev)'}</span>
            </button>
          </div>

          <div style="margin-top:6px;">
            <div class="inspector-field-header">
              <span>Slot Chord Position</span>
              <span class="inspector-field-value" id="val-th-slot-pct">${this.statorSlotChordPct.toFixed(0)}%</span>
            </div>
            <input type="range" class="inspector-slider" id="slider-th-slot-pct" min="20" max="60" step="1" value="${this.statorSlotChordPct}">
          </div>
        ` : ''}
      </div>

      <!-- Motor Specs -->
      <div class="inspector-field" style="margin-top:8px;">
        <div class="inspector-field-header">
          <span>Motor Unit</span>
          <span class="inspector-field-value">Mabuchi RS-280</span>
        </div>
      </div>

      <details class="inspector-advanced">
        <summary>Advanced Aerodynamics</summary>
        <div class="advanced-content">
          <div class="inspector-field">
            <span class="inspector-field-header">BEMT Element Strips: 10 radial</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Prandtl Tip Loss: Enabled</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Glauert High-Thrust: Enabled</span>
          </div>
        </div>
      </details>
    `;

    this.container.querySelector('#btn-deselect')?.addEventListener('click', () => {
      this.setSelection({ type: 'none' });
    });

    const throttleSlider = this.container.querySelector('#slider-throttle') as HTMLInputElement;
    throttleSlider?.addEventListener('input', () => {
      this.thrusterThrottle = parseFloat(throttleSlider.value);
      (this.container.querySelector('#val-thruster-throttle') as HTMLElement).textContent = `${(this.thrusterThrottle * 100).toFixed(0)}%`;
      this.callbacks.onThrottleChange?.(idx, this.thrusterThrottle);
    });

    const pitchSlider = this.container.querySelector('#slider-pitch') as HTMLInputElement;
    pitchSlider?.addEventListener('input', () => {
      this.thrusterPitch = parseFloat(pitchSlider.value);
      (this.container.querySelector('#val-thruster-pitch') as HTMLElement).textContent = `${this.thrusterPitch.toFixed(1)}°`;
      this.callbacks.onPitchChange?.(idx, this.thrusterPitch);
    });

    this.container.querySelector('#btn-toggle-handedness')?.addEventListener('click', () => {
      this.thrusterHandedness = this.thrusterHandedness === 'CW' ? 'CCW' : 'CW';
      this.renderThrusterSettings(idx);
      this.callbacks.onHandednessToggle?.(idx);
    });

    // Stator event handlers
    this.container.querySelector('#btn-th-stator-toggle')?.addEventListener('click', () => {
      this.statorAttached = !this.statorAttached;
      this.renderThrusterSettings(idx);
      this.callbacks.onStatorToggle?.(idx, this.statorAttached);
    });

    const incSlider = this.container.querySelector('#slider-th-stator-inc') as HTMLInputElement;
    incSlider?.addEventListener('input', () => {
      this.statorIncidenceDeg = parseFloat(incSlider.value);
      const valEl = this.container.querySelector('#val-th-stator-inc');
      if (valEl) valEl.textContent = `${this.statorIncidenceDeg.toFixed(1)}°`;
      this.callbacks.onStatorIncidenceChange?.(idx, this.statorIncidenceDeg);
    });

    this.container.querySelector('#btn-th-stator-slot')?.addEventListener('click', () => {
      this.statorSlotted = !this.statorSlotted;
      this.renderThrusterSettings(idx);
      this.callbacks.onStatorSlotToggle?.(idx, this.statorSlotted);
    });

    const slotPctSlider = this.container.querySelector('#slider-th-slot-pct') as HTMLInputElement;
    slotPctSlider?.addEventListener('input', () => {
      this.statorSlotChordPct = parseFloat(slotPctSlider.value);
      const valEl = this.container.querySelector('#val-th-slot-pct');
      if (valEl) valEl.textContent = `${this.statorSlotChordPct.toFixed(0)}%`;
      this.callbacks.onStatorSlotPctChange?.(idx, this.statorSlotChordPct);
    });
  }

  /**
   * Live Phase 6b vehicle telemetry. Called every frame from the app; a no-op
   * unless the vehicle panel is the active selection and the DOM is mounted.
   * Position / velocity / attitude / buoyancy live HERE (not in the HUD strip),
   * which stays focused on the at-a-glance propulsion numbers.
   */
  public setVehicleTelemetry(view: VehicleTelemetryView | null): void {
    this.vehicleView = view;
    if (!view || this.currentSelection.type !== 'vehicle') return;
    if (!this.container.querySelector('#veh-pos')) return;

    const f = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
    const tup = (t: [number, number, number], d = 3) => `[${t.map((x) => f(x, d)).join(', ')}]`;

    this.setText('veh-pos', tup(view.positionWorldM, 3));
    this.setText('veh-vel-w', tup(view.velocityWorldMs, 3));
    this.setText('veh-vel-b', `u ${f(view.velocityBodyMs[0], 3)}  v ${f(view.velocityBodyMs[1], 3)}  w ${f(view.velocityBodyMs[2], 3)}`);
    this.setText('veh-euler', `R ${f(view.eulerDeg.rollDeg, 1)}°  P ${f(view.eulerDeg.pitchDeg, 1)}°  Y ${f(view.eulerDeg.yawDeg, 1)}°`);
    this.setText('veh-rates', `p ${f(view.ratesRadS[0], 3)}  q ${f(view.ratesRadS[1], 3)}  r ${f(view.ratesRadS[2], 3)} rad/s`);
    this.setText('veh-speed', `${f(Math.hypot(...view.velocityWorldMs), 3)} m/s`);

    this.setText('veh-buoy', `${f(view.buoyancyForceN, 4)} N`);
    this.setText('veh-net-vert', `${f(view.netVerticalForceN, 4)} N`);
    this.setText('veh-drag', tup(view.dragForceN, 3));
    this.setText('veh-righting', tup(view.restoringTorqueNm, 5));
    this.setText('veh-margin', `${f(view.staticStabilityMm, 2)} mm`);
    this.setText('veh-mass', `${f(view.dryMassG, 1)} g`);
    this.setText('veh-volume', `${f(view.displacedVolumeCm3, 1)} cm³`);

    this.setText('veh-thrust', tup(view.thrustForceMarineN, 3));
    this.setText('veh-torque', tup(view.thrustMomentMarineNm, 6));
    this.setText('veh-roll-dev', Number.isFinite(view.rollDeviationDegPerM)
      ? `${f(view.rollDeviationDegPerM, 2)} °/m`
      : '— (at rest)');

    this.setText('veh-inertia', tup(view.inertiaBody, 7));
    this.setText('veh-added-mass', tup(view.addedMassBody, 4));
    this.setText('veh-tether', view.tetherAttached ? 'Attached' : 'Free swimming');
    this.setText('veh-contact', view.grounded ? 'Floor contact' : view.broaching ? 'At surface' : 'Free');
    this.setText('veh-clamp', view.angularRateClamped ? 'ENGAGED (rate clamp)' : 'Not engaged');
  }

  private setText(id: string, text: string): void {
    const el = this.container.querySelector(`#${id}`);
    if (el) el.textContent = text;
  }

  private renderVehicleSettings(): void {
    const v = this.vehicleView;
    const f = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
    const tup = (t: [number, number, number], d = 3) => `[${t.map((x) => f(x, d)).join(', ')}]`;

    this.container.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">Vehicle Properties</span>
        <button class="palette-segment" id="btn-deselect-v" style="font-size:10px; padding:2px 6px;">✕ Close</button>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Position (world, m)</span>
          <span class="inspector-field-value" id="veh-pos">${v ? tup(v.positionWorldM) : '—'}</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Velocity (world / body, m/s)</span>
          <span class="inspector-field-value" id="veh-vel-w">${v ? tup(v.velocityWorldMs) : '—'}</span>
        </div>
        <div class="inspector-field-header">
          <span style="font-size:9px; color:var(--text-muted);">\u03BC surge \u2192 +X_b, v sway \u2192 +Y_b, w heave \u2192 +Z_b</span>
          <span class="inspector-field-value" id="veh-vel-b">${v ? `u ${f(v.velocityBodyMs[0])}  v ${f(v.velocityBodyMs[1])}  w ${f(v.velocityBodyMs[2])}` : '—'}</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Attitude (roll / pitch / yaw)</span>
          <span class="inspector-field-value" id="veh-euler">${v ? `R ${f(v.eulerDeg.rollDeg, 1)}\u00B0  P ${f(v.eulerDeg.pitchDeg, 1)}\u00B0  Y ${f(v.eulerDeg.yawDeg, 1)}\u00B0` : '—'}</span>
        </div>
        <div class="inspector-field-header">
          <span style="font-size:9px; color:var(--text-muted);">Rates p / q / r (rad/s)</span>
          <span class="inspector-field-value" id="veh-rates">${v ? `p ${f(v.ratesRadS[0])}  q ${f(v.ratesRadS[1])}  r ${f(v.ratesRadS[2])}` : '—'}</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Speed</span>
          <span class="inspector-field-value" id="veh-speed">${v ? `${f(Math.hypot(...v.velocityWorldMs))} m/s` : '—'}</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Net Buoyancy</span>
          <span class="inspector-field-value" id="veh-buoy">${v ? `${f(v.buoyancyForceN, 4)} N` : '—'}</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Net Vertical Force</span>
          <span class="inspector-field-value" id="veh-net-vert">${v ? `${f(v.netVerticalForceN, 4)} N` : '—'}</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Static Stability Margin (CoB\u2212CoG)</span>
          <span class="inspector-field-value" id="veh-margin">${v ? `${f(v.staticStabilityMm, 2)} mm` : '—'}</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Roll Deviation per Meter</span>
          <span class="inspector-field-value" id="veh-roll-dev">${v && Number.isFinite(v.rollDeviationDegPerM) ? `${f(v.rollDeviationDegPerM, 2)}\u00B0/m` : '—'}</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Dry Mass / Displaced Volume</span>
          <span class="inspector-field-value">
            <span id="veh-mass">${v ? `${f(v.dryMassG, 1)} g` : '—'}</span> /
            <span id="veh-volume">${v ? `${f(v.displacedVolumeCm3, 1)} cm\u00B3` : '—'}</span>
          </span>
        </div>
      </div>

      <details class="inspector-advanced">
        <summary>Advanced Hydrodynamics</summary>
        <div class="advanced-content">
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Thrust (marine surge/sway/heave, N)</span>
              <span class="inspector-field-value" id="veh-thrust">${v ? tup(v.thrustForceMarineN) : '—'}</span>
            </div>
          </div>
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Applied Moment (roll/pitch/yaw, N\u00B7m)</span>
              <span class="inspector-field-value" id="veh-torque">${v ? tup(v.thrustMomentMarineNm, 6) : '—'}</span>
            </div>
          </div>
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Drag (marine, N)</span>
              <span class="inspector-field-value" id="veh-drag">${v ? tup(v.dragForceN) : '—'}</span>
            </div>
          </div>
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Righting Moment (roll/pitch/yaw, N\u00B7m)</span>
              <span class="inspector-field-value" id="veh-righting">${v ? tup(v.restoringTorqueNm, 5) : '—'}</span>
            </div>
          </div>
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Inertia Tensor (roll/pitch/yaw, kg\u00B7m\u00B2)</span>
              <span class="inspector-field-value" id="veh-inertia">${v ? tup(v.inertiaBody, 7) : '—'}</span>
            </div>
          </div>
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Added Mass Diagonal (kg)</span>
              <span class="inspector-field-value" id="veh-added-mass">${v ? tup(v.addedMassBody, 4) : '—'}</span>
            </div>
          </div>
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Tether</span>
              <span class="inspector-field-value" id="veh-tether">${v ? (v.tetherAttached ? 'Attached' : 'Free swimming') : '—'}</span>
            </div>
          </div>
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Tank Contact</span>
              <span class="inspector-field-value" id="veh-contact">${v ? (v.grounded ? 'Floor contact' : v.broaching ? 'At surface' : 'Free') : '—'}</span>
            </div>
          </div>
          <div class="inspector-field">
            <div class="inspector-field-header">
              <span>Angular-Rate Clamp</span>
              <span class="inspector-field-value" id="veh-clamp">${v ? (v.angularRateClamped ? 'ENGAGED (rate clamp)' : 'Not engaged') : '—'}</span>
            </div>
          </div>
        </div>
      </details>
    `;

    this.container.querySelector('#btn-deselect-v')?.addEventListener('click', () => {
      this.setSelection({ type: 'none' });
    });
  }

  private renderFluidSettings(): void {
    this.container.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">Fluid Domain</span>
        <button class="palette-segment" id="btn-deselect-f" style="font-size:10px; padding:2px 6px;">✕ Close</button>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Resolution Preset</span>
        </div>
        <div class="palette-segmented" id="fluid-res-group">
          <button class="palette-segment ${this.resolution === '1024x512' ? 'active' : ''}" data-res="1024x512">1024×512</button>
          <button class="palette-segment ${this.resolution === '512x256' ? 'active' : ''}" data-res="512x256">512×256</button>
          <button class="palette-segment ${this.resolution === '256x128' ? 'active' : ''}" data-res="256x128">256×128</button>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Vorticity Confinement</span>
          <span class="inspector-field-value" id="val-vorticity">${this.vorticityStrength.toFixed(2)}</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-vorticity" min="0.0" max="0.5" step="0.01" value="${this.vorticityStrength}">
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Inflow Velocity</span>
          <span class="inspector-field-value" id="val-inflow">${this.inflowVelocity.toFixed(1)} m/s</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-inflow" min="0.0" max="5.0" step="0.1" value="${this.inflowVelocity}">
      </div>

      <details class="inspector-advanced">
        <summary>Advanced Solver Parameters</summary>
        <div class="advanced-content">
          <div class="inspector-field">
            <span class="inspector-field-header">Poisson Iterations: 20</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Advection: MacCormack w/ Clamping</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">CFL Max Substep: 3</span>
          </div>
        </div>
      </details>
    `;

    this.container.querySelector('#btn-deselect-f')?.addEventListener('click', () => {
      this.setSelection({ type: 'none' });
    });

    const resButtons = this.container.querySelectorAll('#fluid-res-group button');
    resButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const r = (e.currentTarget as HTMLElement).dataset.res as '1024x512' | '512x256' | '256x128';
        this.resolution = r;
        this.renderFluidSettings();
        this.callbacks.onResolutionChange?.(r);
      });
    });

    const vortSlider = this.container.querySelector('#slider-vorticity') as HTMLInputElement;
    vortSlider?.addEventListener('input', () => {
      this.vorticityStrength = parseFloat(vortSlider.value);
      (this.container.querySelector('#val-vorticity') as HTMLElement).textContent = this.vorticityStrength.toFixed(2);
      this.callbacks.onVorticityChange?.(this.vorticityStrength);
    });

    const inflowSlider = this.container.querySelector('#slider-inflow') as HTMLInputElement;
    inflowSlider?.addEventListener('input', () => {
      this.inflowVelocity = parseFloat(inflowSlider.value);
      (this.container.querySelector('#val-inflow') as HTMLElement).textContent = `${this.inflowVelocity.toFixed(1)} m/s`;
      this.callbacks.onInflowChange?.(this.inflowVelocity);
    });
  }
}
