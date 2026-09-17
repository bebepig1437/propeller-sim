import type { VehicleConfig, PropellerMaterial, OperatingPoint } from '../types/vehicle';
import { computeVehicleDryMass, computeNetBuoyancyGrams } from '../config/vehicleLoader';
import { TelemetryPlots } from './plots';

export interface HudCallbacks {
  onPresetSelect: (preset: OperatingPoint) => void;
  onMaterialSelect: (material: PropellerMaterial) => void;
  onThrottleChange: (throttle: number) => void;
}

export class TelemetryHud {
  private container: HTMLElement;
  private config: VehicleConfig;
  private callbacks: HudCallbacks;
  public plots!: TelemetryPlots;

  private activeMaterial: PropellerMaterial = 'rigid10k';
  private activePreset: string = 'breakout';

  // DOM element references for fast dynamic updates
  private fluidMsEl!: HTMLElement;
  private throttleValEl!: HTMLElement;
  private throttleInputEl!: HTMLInputElement;
  private rpmValEl!: HTMLElement;
  private thrustValEl!: HTMLElement;
  private currentValEl!: HTMLElement;
  private vTerminalValEl!: HTMLElement;
  private vSagValEl!: HTMLElement;
  private burstValEl!: HTMLElement;
  private netBuoyancyValEl!: HTMLElement;
  private dryMassValEl!: HTMLElement;
  private attitudeValEl!: HTMLElement;
  private depthValEl!: HTMLElement;
  private speedValEl!: HTMLElement;

  constructor(container: HTMLElement, config: VehicleConfig, callbacks: HudCallbacks) {
    this.container = container;
    this.config = config;
    this.callbacks = callbacks;
    this.render();
  }

  private render(): void {
    const dryMass = computeVehicleDryMass(this.config, this.activeMaterial);
    const netBuoyancy = computeNetBuoyancyGrams(this.config, this.activeMaterial);

    this.container.innerHTML = `
      <header class="hud-header">
        <div class="header-brand">
          <div class="brand-badge">SEAPERCH SIMULATOR</div>
          <h1 class="vehicle-title">${this.config.name}</h1>
          <div class="vehicle-meta">
            <span class="meta-tag">ID: ${this.config.id}</span>
            <span class="meta-tag">MOTORS: ${this.config.mass.motor_count}x ${this.config.motor.model}</span>
            <span class="meta-tag">TETHER: ${this.config.tether.length_ft}ft ${this.config.tether.awg}AWG (${this.config.tether.R_roundtrip_ohm}Ω)</span>
            <span class="meta-tag status-live"><span class="pulse-dot"></span>SYSTEM ONLINE</span>
            <span class="meta-tag" id="hud-fluid-ms"><span class="pulse-dot" style="background:#38bdf8;"></span>FLUID: 0.00 ms (1024x512 GPU)</span>
          </div>
        </div>
      </header>

      <main class="hud-main">
        <!-- Left Column: Primary Telemetry & Operating Presets -->
        <section class="hud-card telemetry-card">
          <div class="card-header">
            <span class="card-label">OPERATING PRESETS</span>
            <span class="card-sub">CANDIDATE A PROFILE</span>
          </div>
          <div class="presets-grid" id="presets-container">
            ${this.config.operating_points.map(pt => `
              <button 
                class="preset-btn ${pt.label === this.activePreset ? 'active' : ''}" 
                data-label="${pt.label}"
                id="preset-${pt.label}"
              >
                <div class="preset-name">${pt.label.replace('_', ' ').toUpperCase()}</div>
                <div class="preset-specs">
                  <span>${(pt.throttle * 100).toFixed(0)}% THR</span>
                  <span>${pt.thrust_N >= 0 ? '+' : ''}${pt.thrust_N.toFixed(2)}N</span>
                  <span>${pt.burst_s ? pt.burst_s + 's' : '∞'}</span>
                </div>
              </button>
            `).join('')}
          </div>

          <div class="card-divider"></div>

          <div class="card-header">
            <span class="card-label">MANUAL THROTTLE CONTROL</span>
            <span class="throttle-readout" id="throttle-val">100%</span>
          </div>
          <div class="control-slider-wrap">
            <input 
              type="range" 
              id="throttle-slider" 
              class="styled-range" 
              min="-1" 
              max="1" 
              step="0.01" 
              value="1.0"
            />
            <div class="slider-ticks">
              <span>-100% (DIVE)</span>
              <span>0% (IDLE)</span>
              <span>+100% (SURGE)</span>
            </div>
          </div>

          <div class="card-divider"></div>

          <div class="card-header">
            <span class="card-label">REAL-TIME STRIPCHART</span>
            <span class="card-sub">THRUST / CURRENT / SPEED</span>
          </div>
          <div class="stripchart-container" style="margin-top: 8px;">
            <canvas id="telemetry-stripchart" width="280" height="75" style="width:100%; border-radius:8px; border:1px solid rgba(56,189,248,0.2);"></canvas>
          </div>
        </section>

        <!-- Right Column: Live Hydrodynamic & Electrical Readouts -->
        <section class="hud-card dynamics-card">
          <div class="card-header">
            <span class="card-label">ELECTRICAL & THERMAL TELEMETRY</span>
            <span class="card-sub">MODEL: TETHER SAG + BEMT</span>
          </div>

          <div class="telemetry-metrics-grid">
            <div class="metric-box">
              <span class="metric-title">TERMINAL VOLTAGE</span>
              <span class="metric-value highlight-cyan" id="val-vterm">10.90 V</span>
              <span class="metric-sub" id="val-vsag">Sag: -1.10 V</span>
            </div>

            <div class="metric-box">
              <span class="metric-title">TOTAL CURRENT</span>
              <span class="metric-value highlight-amber" id="val-current">1.41 A</span>
              <span class="metric-sub">Supply: 12.0 V</span>
            </div>

            <div class="metric-box">
              <span class="metric-title">MOTOR SPEED</span>
              <span class="metric-value highlight-blue" id="val-rpm">4140 RPM</span>
              <span class="metric-sub">No-load: 9800 RPM</span>
            </div>

            <div class="metric-box">
              <span class="metric-title">NET FORWARD THRUST</span>
              <span class="metric-value highlight-green" id="val-thrust">+4.73 N</span>
              <span class="metric-sub">Stator Gain: +0.04 N</span>
            </div>

            <div class="metric-box">
              <span class="metric-title">THERMAL BURST LIMIT</span>
              <span class="metric-value highlight-red" id="val-burst">18.0 s</span>
              <span class="metric-sub">Window Remaining</span>
            </div>

            <div class="metric-box">
              <span class="metric-title">NET BUOYANCY</span>
              <span class="metric-value highlight-emerald" id="val-net-buoyancy">+${netBuoyancy.toFixed(1)} g</span>
              <span class="metric-sub" id="val-dry-mass">Dry: ${dryMass.toFixed(1)} g</span>
            </div>

            <div class="metric-box">
              <span class="metric-title">ATTITUDE (R / P)</span>
              <span class="metric-value highlight-cyan" id="val-attitude">0.0° / 0.0°</span>
              <span class="metric-sub" id="val-yaw">Heading: 0.0°</span>
            </div>

            <div class="metric-box">
              <span class="metric-title">VEHICLE DEPTH</span>
              <span class="metric-value highlight-blue" id="val-depth">0.00 m</span>
              <span class="metric-sub" id="val-speed">Speed: 0.00 m/s</span>
            </div>
          </div>

          <div class="card-divider"></div>

          <!-- Material Selector -->
          <div class="card-header">
            <span class="card-label">PROPELLER MATERIAL (I_ZZ & SPOOL-UP)</span>
          </div>
          <div class="material-toggles">
            <button class="mat-btn active" data-mat="rigid10k" id="mat-rigid10k">
              <span class="mat-name">Rigid 10K</span>
              <span class="mat-mass">${this.config.mass.prop_g.rigid10k.toFixed(2)}g / prop</span>
            </button>
            <button class="mat-btn" data-mat="pa12cf15" id="mat-pa12cf15">
              <span class="mat-name">PA12-CF15</span>
              <span class="mat-mass">${this.config.mass.prop_g.pa12cf15.toFixed(2)}g / prop</span>
            </button>
            <button class="mat-btn" data-mat="petg" id="mat-petg">
              <span class="mat-name">PETG</span>
              <span class="mat-mass">${this.config.mass.prop_g.petg.toFixed(2)}g / prop</span>
            </button>
          </div>

          <!-- Stator & Stability Spec Badges -->
          <div class="spec-footer-badges">
            <div class="badge-item">
              <span class="badge-k">STATOR VANE</span>
              <span class="badge-v">-5.2° @ 40% chord</span>
            </div>
            <div class="badge-item">
              <span class="badge-k">CoB / CoG STABILITY</span>
              <span class="badge-v">+${this.config.buoyancy.cob_above_cog_mm}mm Arm</span>
            </div>
            <div class="badge-item">
              <span class="badge-k">PROPELLER LOAD</span>
              <span class="badge-v">KQ = ${this.config.propeller.KQ} (D=42mm)</span>
            </div>
          </div>
        </section>
      </main>

      <!-- Viewport Interaction Hints -->
      <footer class="hud-footer">
        <div class="viewport-hints">
          <span>MOUSE ORBIT: Left Click + Drag</span>
          <span>PAN: Right Click + Drag</span>
          <span>ZOOM: Scroll Wheel</span>
          <span>RESET VIEW: Double Click</span>
        </div>
        <div class="phase-indicator">
          PHASE 2: GPU PORT (TSL COMPUTE) &bull; 1024&times;512 RESOLUTION
        </div>
      </footer>
    `;

    this.cacheDomElements();
    this.attachEventListeners();
  }

  private cacheDomElements(): void {
    this.fluidMsEl = this.container.querySelector('#hud-fluid-ms')!;
    this.throttleValEl = this.container.querySelector('#throttle-val')!;
    this.throttleInputEl = this.container.querySelector('#throttle-slider')!;
    this.rpmValEl = this.container.querySelector('#val-rpm')!;
    this.thrustValEl = this.container.querySelector('#val-thrust')!;
    this.currentValEl = this.container.querySelector('#val-current')!;
    this.vTerminalValEl = this.container.querySelector('#val-vterm')!;
    this.vSagValEl = this.container.querySelector('#val-vsag')!;
    this.burstValEl = this.container.querySelector('#val-burst')!;
    this.netBuoyancyValEl = this.container.querySelector('#val-net-buoyancy')!;
    this.dryMassValEl = this.container.querySelector('#val-dry-mass')!;
    this.attitudeValEl = this.container.querySelector('#val-attitude')!;
    this.depthValEl = this.container.querySelector('#val-depth')!;
    this.speedValEl = this.container.querySelector('#val-speed')!;

    const chartCanvas = this.container.querySelector('#telemetry-stripchart') as HTMLCanvasElement;
    if (chartCanvas) {
      this.plots = new TelemetryPlots(chartCanvas);
    }
  }

  private attachEventListeners(): void {
    // Preset buttons
    const presetButtons = this.container.querySelectorAll('.preset-btn');
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const label = btn.getAttribute('data-label');
        if (!label) return;
        const preset = this.config.operating_points.find(p => p.label === label);
        if (preset) {
          this.activePreset = label;
          this.throttleInputEl.value = preset.throttle.toString();
          this.throttleValEl.textContent = `${(preset.throttle * 100).toFixed(0)}%`;

          presetButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          this.callbacks.onPresetSelect(preset);
        }
      });
    });

    // Slider
    this.throttleInputEl.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.throttleValEl.textContent = `${(val * 100).toFixed(0)}%`;
      
      // Clear preset button highlight if manual slider moved
      presetButtons.forEach(b => b.classList.remove('active'));
      
      this.callbacks.onThrottleChange(val);
    });

    // Material buttons
    const matButtons = this.container.querySelectorAll('.mat-btn');
    matButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mat = btn.getAttribute('data-mat') as PropellerMaterial;
        if (!mat) return;
        this.activeMaterial = mat;
        matButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update dry mass & buoyancy
        const dryMass = computeVehicleDryMass(this.config, mat);
        const netBuoyancy = computeNetBuoyancyGrams(this.config, mat);
        this.netBuoyancyValEl.textContent = `+${netBuoyancy.toFixed(1)} g`;
        this.dryMassValEl.textContent = `Dry: ${dryMass.toFixed(1)} g`;

        this.callbacks.onMaterialSelect(mat);
      });
    });
  }

  public updateTelemetry(
    rpm: number,
    thrust: number,
    current: number,
    burstSec: number | null,
    depth = 0.0,
    speed = 0.0,
    rollDeg = 0.0,
    pitchDeg = 0.0,
    yawDeg = 0.0
  ): void {
    // Electrical tether voltage sag calculation
    // V_terminal = V_supply - (I * R_tether)
    const vSupply = this.config.tether.supply_V;
    const vDrop = current * this.config.tether.R_roundtrip_ohm;
    const vTerminal = Math.max(0, vSupply - vDrop);

    this.rpmValEl.textContent = `${Math.round(rpm)} RPM`;
    this.thrustValEl.textContent = `${thrust >= 0 ? '+' : ''}${thrust.toFixed(2)} N`;
    this.currentValEl.textContent = `${current.toFixed(2)} A`;
    this.vTerminalValEl.textContent = `${vTerminal.toFixed(2)} V`;
    this.vSagValEl.textContent = `Sag: -${vDrop.toFixed(2)} V`;
    this.burstValEl.textContent = burstSec !== null ? `${burstSec.toFixed(1)} s` : '∞ Continuous';

    if (this.attitudeValEl) {
      this.attitudeValEl.textContent = `${rollDeg.toFixed(1)}° / ${pitchDeg.toFixed(1)}°`;
      const yawEl = this.container.querySelector('#val-yaw');
      if (yawEl) yawEl.textContent = `Heading: ${yawDeg.toFixed(1)}°`;
    }
    if (this.depthValEl) {
      this.depthValEl.textContent = `${depth.toFixed(3)} m`;
    }
    if (this.speedValEl) {
      this.speedValEl.textContent = `Speed: ${speed.toFixed(2)} m/s`;
    }

    // Push sample and render real-time stripchart
    if (this.plots) {
      this.plots.pushSample({
        thrustN: thrust,
        currentA: current,
        rpm,
        surgeSpeedMs: speed
      });
      this.plots.render();
    }
  }

  public updateFluidMs(fluidMs: number, resolution = '1024x512', backend = 'GPU'): void {
    if (this.fluidMsEl) {
      this.fluidMsEl.innerHTML = `<span class="pulse-dot" style="background:#38bdf8;"></span>FLUID: ${fluidMs.toFixed(2)} ms (${resolution} ${backend})`;
    }
  }
}
