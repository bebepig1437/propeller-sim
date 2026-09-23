export type RunState = "idle" | "running" | "paused" | "error";

export interface HeaderCallbacks {
  onRunToggle: (nextState: RunState) => void;
  onPresetSelect: (presetKey: string) => void;
  onShare: () => void;
  onExportCsv: () => void;
  onValidationClick: () => void;
  onRecordToggle?: () => void;
  onImportSpecClick?: () => void;
}

export interface OperatingPointPreset {
  key: string;
  name: string;
  label: string;
  throttle: number;
  rpm: number;
  thrust_N: number;
  current_A: number;
  burst_s: number | null;
  throttleVector: [number, number, number];
}

export const DEFAULT_PRESETS: OperatingPointPreset[] = [
  {
    key: "breakout",
    name: "Breakout Burst",
    label: "Breakout Burst (100% / +4.73 N / 1.41 A / 18s)",
    throttle: 1.0,
    rpm: 4140,
    thrust_N: 4.73,
    current_A: 1.41,
    burst_s: 18,
    throttleVector: [1.0, 1.0, 1.0]
  },
  {
    key: "heavy_lift",
    name: "Nominal Heavy Lift",
    label: "Nominal Heavy Lift (88% / +3.99 N / 1.25 A / 50s)",
    throttle: 0.881,
    rpm: 3800,
    thrust_N: 3.99,
    current_A: 1.25,
    burst_s: 50,
    throttleVector: [0.881, 0.881, 0.881]
  },
  {
    key: "cruise",
    name: "Continuous Cruise",
    label: "Continuous Cruise (67% / +2.49 N / 0.85 A / unlimited)",
    throttle: 0.670,
    rpm: 3000,
    thrust_N: 2.49,
    current_A: 0.85,
    burst_s: null,
    throttleVector: [0.670, 0.670, 0.0]
  },
  {
    key: "full_dive",
    name: "Controlled Full Dive",
    label: "Controlled Full Dive (-84% / -2.82 N / 1.18 A / 65s)",
    throttle: -0.840,
    rpm: 3650,
    thrust_N: -2.82,
    current_A: 1.18,
    burst_s: 65,
    throttleVector: [-0.840, -0.840, -0.840]
  },
  {
    key: "reverse_station",
    name: "Reverse Station",
    label: "Reverse Station (-48% / -0.93 N / 0.51 A / unlimited)",
    throttle: -0.480,
    rpm: 2100,
    thrust_N: -0.93,
    current_A: 0.51,
    burst_s: null,
    throttleVector: [-0.480, -0.480, 0.0]
  }
];

export const STRESS_PRESET: OperatingPointPreset = {
  key: "stress",
  name: "Stress Benchmark (2048×1024)",
  label: "Stress Benchmark (2048×1024 / Everything On)",
  throttle: 1.0,
  rpm: 4140,
  thrust_N: 4.73,
  current_A: 1.41,
  burst_s: null,
  throttleVector: [1.0, 1.0, 1.0]
};

export const ALL_PRESETS: OperatingPointPreset[] = [...DEFAULT_PRESETS, STRESS_PRESET];

export class SimHeader {
  private container: HTMLElement;
  private callbacks: HeaderCallbacks;
  private runState: RunState = "idle";
  private runBtn!: HTMLButtonElement;
  private presetSelect!: HTMLSelectElement;
  private recordBtn!: HTMLButtonElement;
  private isRecording: boolean = false;

  constructor(container: HTMLElement, callbacks: HeaderCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  private isFirstVisit(): boolean {
    try {
      if (typeof localStorage === "undefined") return false;
      return localStorage.getItem("seaperch_first_run_seen") !== "true";
    } catch {
      return false;
    }
  }

  private render(): void {
    const firstVisit = this.isFirstVisit();
    this.container.innerHTML = `
      <div class="header-left">
        <span class="brand-icon">🌊</span>
        <div class="header-titles">
          <span class="app-title">SeaPerch Propeller & Vehicle Simulator</span>
          <span class="app-subtitle">Candidate A High-Burst Vector-Skewed Propulsor</span>
        </div>
      </div>

      <div class="header-center">
        <label for="preset-selector" class="sr-only">Operating Point Preset</label>
        <select id="preset-selector" class="preset-dropdown" title="Select operating point preset">
          ${DEFAULT_PRESETS.map(p => `<option value="${p.key}">${p.label}</option>`).join("")}
        </select>

        <div class="run-control-wrapper">
          <button id="btn-run" class="btn-run state-idle ${firstVisit ? "pulse-once" : ""}" title="Click RUN to start inflow, spool propeller, and record telemetry">
            <span class="run-icon">▶</span>
            <span class="run-text">RUN</span>
          </button>
          <div id="run-callout-text" class="run-callout-text ${firstVisit ? "" : "hidden"}">Press RUN to start.</div>
        </div>
      </div>

      <div class="header-right">
        <button id="btn-import-spec" class="btn-import-spec" title="Paste and auto-import raw engineering specification">
          <span>📋</span>
          <span class="btn-label">Import Spec</span>
        </button>

        <button id="btn-record" class="btn-icon btn-record" title="Record stage viewport to WebM video">
          <span class="record-dot">⏺</span>
          <span class="btn-label" id="record-label">REC</span>
        </button>

        <button id="btn-export-csv" class="btn-icon" title="Export Full Telemetry Time Series (.CSV)">
          <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span class="btn-label">CSV</span>
        </button>

        <button id="btn-share" class="btn-icon" title="Copy shareable configuration URL">
          <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
        </button>

        <button id="btn-validation" class="btn-icon btn-val-nav" title="Open /validation route (NACA/XROTOR/Fossen Oracles & Spec Validation)">
          <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          <span class="btn-label">Validation</span>
        </button>
      </div>
    `;

    this.runBtn = this.container.querySelector("#btn-run") as HTMLButtonElement;
    this.presetSelect = this.container.querySelector("#preset-selector") as HTMLSelectElement;
    this.recordBtn = this.container.querySelector("#btn-record") as HTMLButtonElement;

    const importBtn = this.container.querySelector("#btn-import-spec");
    importBtn?.addEventListener("click", () => {
      this.callbacks.onImportSpecClick?.();
    });

    this.runBtn.addEventListener("click", () => {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("seaperch_first_run_seen", "true");
        }
      } catch {}
      this.runBtn.classList.remove("pulse-once");
      const callout = this.container.querySelector("#run-callout-text");
      callout?.classList.add("hidden");
      if (typeof document !== "undefined" && typeof document.querySelector === "function") {
        document.querySelector("#first-run-callout")?.classList.add("hidden");
      }

      let nextState: RunState;
      if (this.runState === "idle") {
        nextState = "running";
      } else if (this.runState === "running") {
        nextState = "paused";
      } else if (this.runState === "paused") {
        nextState = "running";
      } else {
        nextState = "idle";
      }
      this.setRunState(nextState);
      this.callbacks.onRunToggle(nextState);
    });

    this.presetSelect.addEventListener("change", () => {
      this.callbacks.onPresetSelect(this.presetSelect.value);
    });

    this.recordBtn.addEventListener("click", () => {
      this.callbacks.onRecordToggle?.();
    });

    const exportBtn = this.container.querySelector("#btn-export-csv");
    exportBtn?.addEventListener("click", () => this.callbacks.onExportCsv());

    const shareBtn = this.container.querySelector("#btn-share");
    shareBtn?.addEventListener("click", () => this.callbacks.onShare());

    const validBtn = this.container.querySelector("#btn-validation");
    validBtn?.addEventListener("click", () => this.callbacks.onValidationClick());
  }

  public isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  public setRecordingState(recording: boolean): void {
    this.isRecording = recording;
    const label = this.recordBtn.querySelector("#record-label");
    if (recording) {
      this.recordBtn.classList.add("recording");
      if (label) label.textContent = "STOP";
    } else {
      this.recordBtn.classList.remove("recording");
      if (label) label.textContent = "REC";
    }
  }

  public setRunState(state: RunState): void {
    this.runState = state;
    this.runBtn.className = `btn-run state-${state}`;

    const iconEl = this.runBtn.querySelector(".run-icon") as HTMLElement;
    const textEl = this.runBtn.querySelector(".run-text") as HTMLElement;

    if (state === "idle") {
      iconEl.textContent = "▶";
      textEl.textContent = "RUN";
    } else if (state === "running") {
      iconEl.textContent = "⏸";
      textEl.textContent = "PAUSE";
    } else if (state === "paused") {
      iconEl.textContent = "▶";
      textEl.textContent = "RESUME";
    } else {
      iconEl.textContent = "⚠";
      textEl.textContent = "ERROR";
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

  public updatePresets(newPresets: OperatingPointPreset[]): void {
    if (this.presetSelect) {
      this.presetSelect.innerHTML = newPresets.map(p => `<option value="${p.key}">${p.label}</option>`).join("");
    }
  }
}
