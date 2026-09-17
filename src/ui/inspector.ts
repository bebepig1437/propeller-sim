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
  onThermalToggle?: (enabled: boolean) => void;
  onThrottleChange?: (thrusterIdx: number, throttle: number) => void;
  onPitchChange?: (thrusterIdx: number, pitchDeg: number) => void;
  onHandednessToggle?: (thrusterIdx: number) => void;
  onViscosityChange?: (viscosity: number) => void;
  onVorticityChange?: (vorticity: number) => void;
  onInflowChange?: (inflowVx: number) => void;
  onResolutionChange?: (preset: '1024x512' | '512x256' | '256x128') => void;
}

export class SimInspector {
  private container: HTMLElement;
  private callbacks: InspectorCallbacks;
  private currentSelection: InspectorSelection = { type: 'none' };

  // Run settings state
  public supplyV = 12.0;
  public tetherFt = 15;
  public thermalActive = true;

  // Thruster state
  public thrusterThrottle = 0.881;
  public thrusterRpm = 3800;
  public thrusterPitch = 18.0;
  public thrusterHandedness: 'CW' | 'CCW' = 'CW';

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
        <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-muted);">Global</span>
      </div>

      <!-- Supply Voltage -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Supply Voltage</span>
          <span class="inspector-field-value" id="val-supply-v">${this.supplyV.toFixed(1)} V</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-supply-v" min="6.0" max="16.0" step="0.5" value="${this.supplyV}">
      </div>

      <!-- Tether Length -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Tether Length</span>
          <span class="inspector-field-value" id="val-tether-ft">${this.tetherFt} ft</span>
        </div>
        <input type="range" class="inspector-slider" id="slider-tether-ft" min="5" max="50" step="5" value="${this.tetherFt}">
      </div>

      <!-- Tether AWG -->
      <div class="inspector-field">
        <div class="inspector-field-header">
          <span>Tether Wire Gauge</span>
          <span class="inspector-field-value">24 AWG (0.782 Ω)</span>
        </div>
      </div>

      <!-- Thermal Dissipation -->
      <div class="inspector-field" style="margin-top: 4px;">
        <div class="inspector-field-header">
          <span>Thermal Model</span>
          <span class="inspector-field-value" style="color:var(--accent-heat);">${this.thermalActive ? 'ACTIVE' : 'OFF'}</span>
        </div>
        <button class="palette-btn" id="btn-toggle-thermal" style="margin-top:4px;">
          <span>Motor Heat Buildup</span>
          <span>${this.thermalActive ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      <!-- Closed "Advanced" Fold -->
      <details class="inspector-advanced">
        <summary>Advanced Physics</summary>
        <div class="advanced-content">
          <div class="inspector-field">
            <span class="inspector-field-header">Water Density: 1000 kg/m³</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Ambient Temperature: 20.0 °C</span>
          </div>
          <div class="inspector-field">
            <span class="inspector-field-header">Solver Substep Limit: 5 per frame</span>
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

    const tSlider = this.container.querySelector('#slider-tether-ft') as HTMLInputElement;
    tSlider?.addEventListener('input', () => {
      this.tetherFt = parseInt(tSlider.value, 10);
      (this.container.querySelector('#val-tether-ft') as HTMLElement).textContent = `${this.tetherFt} ft`;
      this.callbacks.onTetherLengthChange?.(this.tetherFt);
    });

    this.container.querySelector('#btn-toggle-thermal')?.addEventListener('click', () => {
      this.thermalActive = !this.thermalActive;
      this.renderRunSettings();
      this.callbacks.onThermalToggle?.(this.thermalActive);
    });
  }

  private renderThrusterSettings(idx: number): void {
    this.container.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">Thruster ${idx + 1}</span>
        <button class="palette-segment" id="btn-deselect" style="font-size:10px; padding:2px 6px;">✕ Close</button>
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
        <input type="range" class="inspector-slider" id="slider-pitch" min="5.0" max="35.0" step="0.5" value="${this.thrusterPitch}">
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

      <!-- Motor Specs -->
      <div class="inspector-field">
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
