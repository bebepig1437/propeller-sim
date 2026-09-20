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

  private renderVehicleSettings(): void {
    this.container.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">Vehicle Properties</span>
        <button class="palette-segment" id="btn-deselect-v" style="font-size:10px; padding:2px 6px;">✕ Close</button>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Dry Mass</span>
          <span class="inspector-field-value">178.5 g</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Buoyancy Volume</span>
          <span class="inspector-field-value">200.0 cm³</span>
        </div>
      </div>

      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Metacentric Height (COB-COG)</span>
          <span class="inspector-field-value">12.5 mm</span>
        </div>
      </div>

      <details class="inspector-advanced">
        <summary>Advanced Hydrodynamics</summary>
        <div class="advanced-content">
          <div class="inspector-field">
            <span class="inspector-field-header">Surge Drag X_uu: 0.12 kg/m</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Sway Drag Y_vv: 0.38 kg/m</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Heave Drag Z_ww: 0.45 kg/m</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Added Mass Diagonal: [0.08, 0.22, 0.28] kg</span>
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
