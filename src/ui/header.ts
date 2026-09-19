/**
 * Simulation Header Component (IBM Quantum Composer inspired)
 * Contains: App Title, Operating Point Presets Dropdown, Single RUN Button, Share & Export.
 */

export type RunState = 'idle' | 'running' | 'paused' | 'error';

export interface HeaderCallbacks {
  onRunToggle: (nextState: RunState) => void;
  onPresetSelect: (presetKey: string) => void;
  onShare: () => void;
  onExportCsv: () => void;
  onValidationClick: () => void;
}

export interface OperatingPointPreset {
  key: string;
  label: string;
  throttle: number;
  rpm: number;
  thrust_N: number;
  current_A: number;
}

export const DEFAULT_PRESETS: OperatingPointPreset[] = [
  { key: 'breakout', label: 'Breakout Burst (4.73 N / 4140 RPM)', throttle: 1.0, rpm: 4140, thrust_N: 4.73, current_A: 1.41 },
  { key: 'heavy_lift', label: 'Heavy Lift (3.99 N / 3800 RPM)', throttle: 0.881, rpm: 3800, thrust_N: 3.99, current_A: 1.25 },
  { key: 'cruise', label: 'Cruise (2.49 N / 3000 RPM)', throttle: 0.670, rpm: 3000, thrust_N: 2.49, current_A: 0.85 },
  { key: 'full_dive', label: 'Full Dive (-2.82 N / 3650 RPM)', throttle: -0.840, rpm: 3650, thrust_N: -2.82, current_A: 1.18 },
  { key: 'reverse_station', label: 'Reverse Station (-0.93 N / 2100 RPM)', throttle: -0.480, rpm: 2100, thrust_N: -0.93, current_A: 0.51 }
];

export class SimHeader {
  private container: HTMLElement;
  private callbacks: HeaderCallbacks;
  private runState: RunState = 'idle';
  private runBtn!: HTMLButtonElement;
  private presetSelect!: HTMLSelectElement;

  constructor(container: HTMLElement, callbacks: HeaderCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="header-left">
        <span class="brand-icon">🌊</span>
        <span class="app-title">SeaPerch Propeller & Vehicle Simulator</span>
        <span class="app-subtitle">Candidate A</span>
      </div>

      <div class="header-center">
        <select id="preset-selector" class="preset-dropdown" title="Load operating point preset">
          ${DEFAULT_PRESETS.map(p => `<option value="${p.key}">${p.label}</option>`).join('')}
        </select>

        <button id="btn-run" class="btn-run state-idle" title="Start simulation">
          <span class="run-icon">▶</span>
          <span class="run-text">RUN</span>
        </button>
      </div>

      <div class="header-right">
        <button id="btn-export-csv" class="btn-icon" title="Export CSV Telemetry">⭳</button>
        <button id="btn-share" class="btn-icon" title="Copy shareable URL state">🔗</button>
        <button id="btn-validation" class="btn-icon" title="View ITTC / Oracle Validation Suite">📊</button>
      </div>
    `;

    this.runBtn = this.container.querySelector('#btn-run') as HTMLButtonElement;
    this.presetSelect = this.container.querySelector('#preset-selector') as HTMLSelectElement;

    this.runBtn.addEventListener('click', () => {
      let nextState: RunState;
      if (this.runState === 'idle') {
        nextState = 'running';
      } else if (this.runState === 'running') {
        nextState = 'paused';
      } else if (this.runState === 'paused') {
        nextState = 'running';
      } else {
        nextState = 'idle';
      }
      this.setRunState(nextState);
      this.callbacks.onRunToggle(nextState);
    });

    this.presetSelect.addEventListener('change', () => {
      this.callbacks.onPresetSelect(this.presetSelect.value);
    });

    const exportBtn = this.container.querySelector('#btn-export-csv');
    exportBtn?.addEventListener('click', () => this.callbacks.onExportCsv());

    const shareBtn = this.container.querySelector('#btn-share');
    shareBtn?.addEventListener('click', () => this.callbacks.onShare());

    const validBtn = this.container.querySelector('#btn-validation');
    validBtn?.addEventListener('click', () => this.callbacks.onValidationClick());
  }

  public setRunState(state: RunState): void {
    this.runState = state;
    this.runBtn.className = `btn-run state-${state}`;

    const iconEl = this.runBtn.querySelector('.run-icon') as HTMLElement;
    const textEl = this.runBtn.querySelector('.run-text') as HTMLElement;

    if (state === 'idle') {
      iconEl.textContent = '▶';
      textEl.textContent = 'RUN';
    } else if (state === 'running') {
      iconEl.textContent = '⏸';
      textEl.textContent = 'PAUSE';
    } else if (state === 'paused') {
      iconEl.textContent = '▶';
      textEl.textContent = 'RESUME';
    } else {
      iconEl.textContent = '⚠';
      textEl.textContent = 'ERROR';
    }
  }

  public getRunState(): RunState {
    return this.runState;
  }

  public setPreset(key: string): void {
    if (this.presetSelect) {
      this.presetSelect.value = key;
    }
  }
}
