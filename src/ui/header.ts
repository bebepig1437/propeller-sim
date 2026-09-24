import { PROP_DESIGNS } from '../prop/designs/index';

export interface HeaderCallbacks {
  onRunToggle: (running: boolean) => void;
  onThrottleChange: (throttle: number) => void;
  onRecordToggle: () => void;
  onInflowChange?: (inflowMs: number) => void;
  onVoltageChange?: (voltageV: number) => void;
  onDesignChange?: (designId: string) => void;
}

export class SimHeader {
  private titleEl: HTMLElement;
  private runBtn: HTMLButtonElement;
  private recBtn: HTMLButtonElement;
  private throttleInput: HTMLInputElement;
  private throttleValEl: HTMLElement;
  private inflowInput: HTMLInputElement | null = null;
  private inflowValEl: HTMLElement | null = null;
  private voltageInput: HTMLInputElement | null = null;
  private voltageValEl: HTMLElement | null = null;
  private designSelect: HTMLSelectElement | null = null;

  private isRunning = true;

  constructor(container: HTMLElement, callbacks?: HeaderCallbacks) {
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
          </div>
        </details>
      </div>
    `;

    this.titleEl = container.querySelector('#app-title') as HTMLElement;
    this.runBtn = container.querySelector('#btn-run') as HTMLButtonElement;
    this.recBtn = container.querySelector('#btn-rec') as HTMLButtonElement;
    this.throttleInput = container.querySelector('#throttle-slider') as HTMLInputElement;
    this.throttleValEl = container.querySelector('#throttle-value') as HTMLElement;

    this.inflowInput = container.querySelector('#inflow-slider') as HTMLInputElement | null;
    this.inflowValEl = container.querySelector('#inflow-val') as HTMLElement | null;
    this.voltageInput = container.querySelector('#voltage-slider') as HTMLInputElement | null;
    this.voltageValEl = container.querySelector('#voltage-val') as HTMLElement | null;
    this.designSelect = container.querySelector('#design-select') as HTMLSelectElement | null;

    this.runBtn.addEventListener('click', () => {
      this.isRunning = !this.isRunning;
      this.updateRunButton();
      callbacks?.onRunToggle(this.isRunning);
    });

    this.recBtn.addEventListener('click', () => {
      callbacks?.onRecordToggle();
    });

    this.throttleInput.addEventListener('input', () => {
      const val = parseFloat(this.throttleInput.value);
      const clamped = Math.max(0.0, Math.min(1.0, val));
      this.throttleValEl.textContent = `${Math.round(clamped * 100)}%`;
      callbacks?.onThrottleChange(clamped);
    });

    this.inflowInput?.addEventListener('input', () => {
      const val = parseFloat(this.inflowInput!.value);
      if (this.inflowValEl) this.inflowValEl.textContent = `${val.toFixed(2)} m/s`;
      callbacks?.onInflowChange?.(val);
    });

    this.voltageInput?.addEventListener('input', () => {
      const val = parseFloat(this.voltageInput!.value);
      if (this.voltageValEl) this.voltageValEl.textContent = `${val.toFixed(1)} V`;
      callbacks?.onVoltageChange?.(val);
    });

    this.designSelect?.addEventListener('change', () => {
      const val = this.designSelect!.value;
      callbacks?.onDesignChange?.(val);
    });
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
