import { PROP_DESIGNS } from '../prop/designs/index';

export const SPEED_PRESETS = [0.01, 0.1, 0.25, 0.5, 1.0, 2.0] as const;

export interface HeaderCallbacks {
  onRunToggle: (running: boolean) => void;
  onThrottleChange: (throttle: number) => void;
  onRecordToggle: () => void;
  onSpeedChange?: (scale: number) => void;
  onInflowChange?: (inflowMs: number) => void;
  onVoltageChange?: (voltageV: number) => void;
  onDesignChange?: (designId: string) => void;
  onVisualizationModeChange?: (mode: 'dye_velocity' | 'dye_vorticity' | 'pressure' | 'none') => void;
  onWakeEnvelopeToggle?: (enabled: boolean) => void;
  onVelocityVectorsToggle?: (enabled: boolean) => void;
  onTipVorticesToggle?: (enabled: boolean) => void;
  onParticleTracersToggle?: (enabled: boolean) => void;
}

export class SimHeader {
  private titleEl: HTMLElement;
  private runBtn: HTMLButtonElement;
  private recBtn: HTMLButtonElement;
  private throttleInput: HTMLInputElement;
  private throttleValEl: HTMLElement;

  private speedSelect: HTMLSelectElement;

  private inflowInput: HTMLInputElement | null = null;
  private inflowValEl: HTMLElement | null = null;
  private voltageInput: HTMLInputElement | null = null;
  private voltageValEl: HTMLElement | null = null;
  private designSelect: HTMLSelectElement | null = null;
  private timeScaleInput: HTMLInputElement | null = null;
  private timeScaleValEl: HTMLElement | null = null;
  private vizModeSelect: HTMLSelectElement | null = null;
  private wakeToggle: HTMLInputElement | null = null;
  private vectorToggle: HTMLInputElement | null = null;
  private tipToggle: HTMLInputElement | null = null;
  private tracerToggle: HTMLInputElement | null = null;

  private isRunning = true;
  private currentPresetIndex = 4;
  private callbacks?: HeaderCallbacks;

  constructor(container: HTMLElement, callbacks?: HeaderCallbacks) {
    this.callbacks = callbacks;

    container.innerHTML = `
      <div class="header-left">
        <span class="app-title" id="app-title" title="prop-sim | 60 FPS">prop-sim</span>
      </div>

      <div class="header-center">
        <div class="throttle-control">
          <label for="throttle-slider" class="throttle-label">Throttle</label>
          <input
            type="range"
            id="throttle-slider"
            class="throttle-slider"
            min="0"
            max="1"
            step="0.01"
            value="1.0"
            aria-label="Throttle Slider"
          />
          <span class="throttle-value" id="throttle-value">100%</span>
        </div>
      </div>

      <div class="header-right">
        <div class="speed-control">
          <label for="speed-select" class="speed-label">Speed</label>
          <select id="speed-select" class="speed-select" aria-label="Simulation Time Scale">
            <option value="0.01">0.01×</option>
            <option value="0.1">0.1×</option>
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1.0" selected>1.0×</option>
            <option value="2.0">2.0×</option>
          </select>
        </div>

        <button id="btn-run" class="btn-header btn-run state-running" aria-label="Toggle Simulation Run State">
          <span class="btn-dot"></span>
          <span class="btn-label">RUN</span>
        </button>
        <button id="btn-rec" class="btn-header btn-rec" aria-label="Toggle Canvas Video Recording">
          <span class="rec-dot"></span>
          <span class="btn-label">REC</span>
        </button>

        <details id="advanced-fold" class="advanced-fold">
          <summary class="advanced-summary">Advanced</summary>
          <div class="advanced-dropdown">
            <div class="advanced-field">
              <div class="field-header">
                <label for="inflow-slider">Inflow Speed</label>
                <span id="inflow-val" class="field-val">1.50 m/s</span>
              </div>
              <input type="range" id="inflow-slider" min="0" max="2" step="0.05" value="1.5" />
            </div>

            <div class="advanced-field">
              <div class="field-header">
                <label for="voltage-slider">Supply Voltage</label>
                <span id="voltage-val" class="field-val">12.0 V</span>
              </div>
              <input type="range" id="voltage-slider" min="0" max="14" step="0.5" value="12.0" />
            </div>

            <div class="advanced-field">
              <div class="field-header">
                <label for="design-select">Propeller Design</label>
              </div>
              <select id="design-select" class="design-select">
                ${Object.values(PROP_DESIGNS).map(
                  (d) => `<option value="${d.id}">${d.name}</option>`
                ).join('')}
              </select>
            </div>

            <div class="advanced-field">
              <div class="field-header">
                <label for="timescale-slider">Time Scale</label>
                <span id="timescale-val" class="field-val">1.00×</span>
              </div>
              <input type="range" id="timescale-slider" min="-2" max="0.301" step="0.01" value="0" />
            </div>

            <div class="advanced-field">
              <div class="field-header">
                <label for="vizmode-select">Visualization Mode</label>
              </div>
              <select id="vizmode-select" class="design-select">
                <option value="dye_velocity" selected>Dye (velocity)</option>
                <option value="dye_vorticity">Dye (vorticity)</option>
                <option value="pressure">Pressure</option>
                <option value="none">None</option>
              </select>
            </div>

            <div class="advanced-toggle-row">
              <label for="wake-toggle">Wake envelope</label>
              <input type="checkbox" id="wake-toggle" class="adv-checkbox" />
            </div>

            <div class="advanced-toggle-row">
              <label for="vector-toggle">Velocity vectors</label>
              <input type="checkbox" id="vector-toggle" class="adv-checkbox" />
            </div>

            <div class="advanced-toggle-row">
              <label for="tip-toggle">Tip vortices</label>
              <input type="checkbox" id="tip-toggle" class="adv-checkbox" checked />
            </div>

            <div class="advanced-toggle-row">
              <label for="tracer-toggle">Particle tracers</label>
              <input type="checkbox" id="tracer-toggle" class="adv-checkbox" checked />
            </div>

            <div class="keyboard-hints">
              Shortcuts: [ / ] speed · \\ reset 1.0x · Space run/pause
            </div>
          </div>
        </details>
      </div>
    `;

    this.titleEl = container.querySelector('#app-title') as HTMLElement;
    this.runBtn = container.querySelector('#btn-run') as HTMLButtonElement;
    this.recBtn = container.querySelector('#btn-rec') as HTMLButtonElement;
    this.throttleInput = container.querySelector('#throttle-slider') as HTMLInputElement;
    this.throttleValEl = container.querySelector('#throttle-value') as HTMLElement;
    this.speedSelect = container.querySelector('#speed-select') as HTMLSelectElement;

    this.inflowInput = container.querySelector('#inflow-slider') as HTMLInputElement | null;
    this.inflowValEl = container.querySelector('#inflow-val') as HTMLElement | null;
    this.voltageInput = container.querySelector('#voltage-slider') as HTMLInputElement | null;
    this.voltageValEl = container.querySelector('#voltage-val') as HTMLElement | null;
    this.designSelect = container.querySelector('#design-select') as HTMLSelectElement | null;
    this.timeScaleInput = container.querySelector('#timescale-slider') as HTMLInputElement | null;
    this.timeScaleValEl = container.querySelector('#timescale-val') as HTMLElement | null;
    this.vizModeSelect = container.querySelector('#vizmode-select') as HTMLSelectElement | null;
    this.wakeToggle = container.querySelector('#wake-toggle') as HTMLInputElement | null;
    this.vectorToggle = container.querySelector('#vector-toggle') as HTMLInputElement | null;
    this.tipToggle = container.querySelector('#tip-toggle') as HTMLInputElement | null;
    this.tracerToggle = container.querySelector('#tracer-toggle') as HTMLInputElement | null;

    this.initEvents();
  }

  private initEvents(): void {
    this.runBtn.addEventListener('click', () => {
      this.toggleRun();
    });

    this.recBtn.addEventListener('click', () => {
      this.callbacks?.onRecordToggle();
    });

    this.throttleInput.addEventListener('input', () => {
      const val = parseFloat(this.throttleInput.value);
      const clamped = Math.max(0.0, Math.min(1.0, val));
      this.throttleValEl.textContent = `${Math.round(clamped * 100)}%`;
      this.callbacks?.onThrottleChange(clamped);
    });

    this.speedSelect.addEventListener('change', () => {
      const val = parseFloat(this.speedSelect.value);
      this.applySpeedScale(val);
    });

    this.inflowInput?.addEventListener('input', () => {
      const val = parseFloat(this.inflowInput!.value);
      if (this.inflowValEl) this.inflowValEl.textContent = `${val.toFixed(2)} m/s`;
      this.callbacks?.onInflowChange?.(val);
    });

    this.voltageInput?.addEventListener('input', () => {
      const val = parseFloat(this.voltageInput!.value);
      if (this.voltageValEl) this.voltageValEl.textContent = `${val.toFixed(1)} V`;
      this.callbacks?.onVoltageChange?.(val);
    });

    this.designSelect?.addEventListener('change', () => {
      const val = this.designSelect!.value;
      this.callbacks?.onDesignChange?.(val);
    });

    this.timeScaleInput?.addEventListener('input', () => {
      const logVal = parseFloat(this.timeScaleInput!.value);
      const linearVal = Math.pow(10, logVal);
      const closest = this.snapToPreset(linearVal);
      this.applySpeedScale(closest);
    });

    this.vizModeSelect?.addEventListener('change', () => {
      const mode = this.vizModeSelect!.value as 'dye_velocity' | 'dye_vorticity' | 'pressure' | 'none';
      this.callbacks?.onVisualizationModeChange?.(mode);
    });

    this.wakeToggle?.addEventListener('change', () => {
      this.callbacks?.onWakeEnvelopeToggle?.(this.wakeToggle!.checked);
    });

    this.vectorToggle?.addEventListener('change', () => {
      this.callbacks?.onVelocityVectorsToggle?.(this.vectorToggle!.checked);
    });

    this.tipToggle?.addEventListener('change', () => {
      this.callbacks?.onTipVorticesToggle?.(this.tipToggle!.checked);
    });

    this.tracerToggle?.addEventListener('change', () => {
      this.callbacks?.onParticleTracersToggle?.(this.tracerToggle!.checked);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
          return;
        }
        if (e.key === '[') {
          this.stepPreset(-1);
        } else if (e.key === ']') {
          this.stepPreset(1);
        } else if (e.key === '\\') {
          this.applySpeedScale(1.0);
        } else if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          this.toggleRun();
        }
      });
    }
  }

  private toggleRun(): void {
    this.isRunning = !this.isRunning;
    this.updateRunButton();
    this.callbacks?.onRunToggle(this.isRunning);
  }

  private snapToPreset(val: number): number {
    let closest: number = SPEED_PRESETS[0];
    let minDiff = Math.abs(val - closest);
    for (let i = 1; i < SPEED_PRESETS.length; i++) {
      const diff = Math.abs(val - SPEED_PRESETS[i]);
      if (diff < minDiff) {
        minDiff = diff;
        closest = SPEED_PRESETS[i];
      }
    }
    return closest;
  }

  private stepPreset(delta: number): void {
    const nextIdx = Math.max(0, Math.min(SPEED_PRESETS.length - 1, this.currentPresetIndex + delta));
    this.applySpeedScale(SPEED_PRESETS[nextIdx]);
  }

  public applySpeedScale(scale: number): void {
    let idx = SPEED_PRESETS.indexOf(scale as any);
    if (idx === -1) {
      scale = this.snapToPreset(scale);
      idx = SPEED_PRESETS.indexOf(scale as any);
    }
    this.currentPresetIndex = idx >= 0 ? idx : 4;
    this.speedSelect.value = scale.toString();
    if (this.timeScaleValEl) {
      this.timeScaleValEl.textContent = `${scale.toString()}×`;
    }
    if (this.timeScaleInput) {
      this.timeScaleInput.value = Math.log10(scale).toFixed(3);
    }
    this.callbacks?.onSpeedChange?.(scale);
  }

  private updateRunButton(): void {
    const label = this.runBtn.querySelector('.btn-label') as HTMLElement;
    if (this.isRunning) {
      this.runBtn.className = 'btn-header btn-run state-running';
      if (label) label.textContent = 'RUN';
    } else {
      this.runBtn.className = 'btn-header btn-run state-paused';
      if (label) label.textContent = 'PAUSE';
    }
  }

  public setRunState(state: 'idle' | 'running' | 'paused'): void {
    this.isRunning = state === 'running';
    const label = this.runBtn.querySelector('.btn-label') as HTMLElement;
    if (state === 'running') {
      this.runBtn.className = 'btn-header btn-run state-running';
      if (label) label.textContent = 'RUN';
    } else if (state === 'paused') {
      this.runBtn.className = 'btn-header btn-run state-paused';
      if (label) label.textContent = 'PAUSED';
    } else {
      this.runBtn.className = 'btn-header btn-run state-idle';
      if (label) label.textContent = 'IDLE';
    }
  }

  public setRecordingState(recording: boolean): void {
    const label = this.recBtn.querySelector('.btn-label') as HTMLElement;
    if (recording) {
      this.recBtn.classList.add('recording');
      if (label) label.textContent = 'STOP';
    } else {
      this.recBtn.classList.remove('recording');
      if (label) label.textContent = 'REC';
    }
  }

  public setFpsTooltip(fps: number, frameMs: number): void {
    this.titleEl.title = `prop-sim | ${fps.toFixed(1)} FPS (${frameMs.toFixed(1)} ms)`;
  }
}
