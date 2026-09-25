import type { PropMaterialId } from '../prop/materials';
import type { SimulationMedium } from '../core/config';

export const SPEED_PRESETS = [0.01, 0.1, 0.25, 0.5, 1.0, 2.0] as const;

export interface HeaderCallbacks {
  onRunToggle: (running: boolean) => void;
  onThrottleChange: (throttle: number) => void;
  onRecordToggle: () => void;
  onMaterialChange: (materialId: PropMaterialId) => void;
  onSpeedChange: (speed: number) => void;
  onMediumChange: (medium: SimulationMedium) => void;
  onCompareToggle: (compareActive: boolean) => void;
  onDesignAChange?: (designId: string) => void;
  onMaterialAChange?: (materialId: PropMaterialId) => void;
  onDesignBChange?: (designId: string) => void;
  onMaterialBChange?: (materialId: PropMaterialId) => void;
}

export class SimHeader {
  private titleEl: HTMLElement;
  private materialSelect: HTMLSelectElement;
  private speedSelect: HTMLSelectElement;
  private runBtn: HTMLButtonElement;
  private recBtn: HTMLButtonElement;
  private compareBtn: HTMLButtonElement;
  private throttleInput: HTMLInputElement;
  private throttleValEl: HTMLElement;

  private mediumAirBtn: HTMLButtonElement;
  private mediumWaterBtn: HTMLButtonElement;

  private compareControlsGroup: HTMLElement;
  private singleControlsGroup: HTMLElement;
  private designSelectA: HTMLSelectElement;
  private materialSelectA: HTMLSelectElement;
  private designSelectB: HTMLSelectElement;
  private materialSelectB: HTMLSelectElement;

  private isRunning = true;
  private isCompare = false;
  private currentMedium: SimulationMedium = 'water';
  private currentMaterial: PropMaterialId = 'rigid10k';
  private currentSpeed = 1.0;
  private callbacks?: HeaderCallbacks;

  constructor(container: HTMLElement, callbacks?: HeaderCallbacks) {
    this.callbacks = callbacks;

    container.innerHTML = `
      <div class="header-left">
        <span class="app-title" id="app-title" title="Propeller Simulator">prop-sim</span>

        <div id="single-material-group" class="header-subgroup">
          <select id="material-select" class="material-select" aria-label="Propeller Material">
            <option value="rigid10k" selected>Rigid 10K (SLA)</option>
            <option value="pa12cf15">PA12-CF15 (FDM)</option>
            <option value="petg">PETG (FDM)</option>
          </select>
        </div>

        <div id="compare-controls-group" class="header-subgroup compare-selectors" style="display: none;">
          <div class="compare-selector-pair">
            <span class="selector-tag">A</span>
            <select id="design-select-a" class="material-select" aria-label="Design A">
              <option value="candidateA" selected>Candidate A</option>
              <option value="kaplan">Kaplan</option>
              <option value="wageningen">Wageningen</option>
            </select>
            <select id="material-select-a" class="material-select" aria-label="Material A">
              <option value="rigid10k" selected>Rigid 10K</option>
              <option value="pa12cf15">PA12-CF15</option>
              <option value="petg">PETG</option>
            </select>
          </div>
          <div class="compare-selector-pair">
            <span class="selector-tag">B</span>
            <select id="design-select-b" class="material-select" aria-label="Design B">
              <option value="candidateA">Candidate A</option>
              <option value="kaplan" selected>Kaplan</option>
              <option value="wageningen">Wageningen</option>
            </select>
            <select id="material-select-b" class="material-select" aria-label="Material B">
              <option value="rigid10k" selected>Rigid 10K</option>
              <option value="pa12cf15">PA12-CF15</option>
              <option value="petg">PETG</option>
            </select>
          </div>
        </div>

        <div class="medium-toggle-segmented" role="radiogroup" aria-label="Fluid Medium Toggle">
          <button id="btn-medium-water" class="medium-segment active" aria-label="Water Mode" title="Submerge in water">WATER</button>
          <button id="btn-medium-air" class="medium-segment" aria-label="Air Mode" title="Spin dry in air">AIR</button>
        </div>
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
            value="0.6"
            aria-label="Throttle Slider"
          />
          <span class="throttle-value" id="throttle-value">60%</span>
        </div>
      </div>

      <div class="header-right">
        <div class="speed-control">
          <label for="speed-select" class="speed-label">Speed</label>
          <select id="speed-select" class="speed-select" aria-label="Simulation Speed Preset">
            <option value="0.01">0.01×</option>
            <option value="0.1">0.1×</option>
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1" selected>1.0×</option>
            <option value="2">2.0×</option>
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
        <button id="btn-compare" class="btn-header btn-compare" aria-label="Toggle Side-by-Side Propeller Comparison">
          <span class="btn-label">COMPARE</span>
        </button>
      </div>
    `;

    this.titleEl = container.querySelector('#app-title') as HTMLElement;
    this.materialSelect = container.querySelector('#material-select') as HTMLSelectElement;
    this.speedSelect = container.querySelector('#speed-select') as HTMLSelectElement;
    this.runBtn = container.querySelector('#btn-run') as HTMLButtonElement;
    this.recBtn = container.querySelector('#btn-rec') as HTMLButtonElement;
    this.compareBtn = container.querySelector('#btn-compare') as HTMLButtonElement;
    this.throttleInput = container.querySelector('#throttle-slider') as HTMLInputElement;
    this.throttleValEl = container.querySelector('#throttle-value') as HTMLElement;

    this.mediumWaterBtn = container.querySelector('#btn-medium-water') as HTMLButtonElement;
    this.mediumAirBtn = container.querySelector('#btn-medium-air') as HTMLButtonElement;

    this.singleControlsGroup = container.querySelector('#single-material-group') as HTMLElement;
    this.compareControlsGroup = container.querySelector('#compare-controls-group') as HTMLElement;
    this.designSelectA = container.querySelector('#design-select-a') as HTMLSelectElement;
    this.materialSelectA = container.querySelector('#material-select-a') as HTMLSelectElement;
    this.designSelectB = container.querySelector('#design-select-b') as HTMLSelectElement;
    this.materialSelectB = container.querySelector('#material-select-b') as HTMLSelectElement;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.materialSelect.addEventListener('change', () => {
      const mat = this.materialSelect.value as PropMaterialId;
      this.currentMaterial = mat;
      this.callbacks?.onMaterialChange(mat);
    });

    this.designSelectA.addEventListener('change', () => {
      this.callbacks?.onDesignAChange?.(this.designSelectA.value);
    });

    this.materialSelectA.addEventListener('change', () => {
      this.callbacks?.onMaterialAChange?.(this.materialSelectA.value as PropMaterialId);
    });

    this.designSelectB.addEventListener('change', () => {
      this.callbacks?.onDesignBChange?.(this.designSelectB.value);
    });

    this.materialSelectB.addEventListener('change', () => {
      this.callbacks?.onMaterialBChange?.(this.materialSelectB.value as PropMaterialId);
    });

    this.speedSelect.addEventListener('change', () => {
      const spd = parseFloat(this.speedSelect.value);
      this.currentSpeed = spd;
      this.callbacks?.onSpeedChange(spd);
    });

    this.runBtn.addEventListener('click', () => {
      this.isRunning = !this.isRunning;
      this.updateRunButtonState();
      this.callbacks?.onRunToggle(this.isRunning);
    });

    this.throttleInput.addEventListener('input', () => {
      const val = parseFloat(this.throttleInput.value);
      this.throttleValEl.textContent = `${Math.round(val * 100)}%`;
      this.callbacks?.onThrottleChange(val);
    });

    this.recBtn.addEventListener('click', () => {
      this.callbacks?.onRecordToggle();
    });

    this.compareBtn.addEventListener('click', () => {
      this.isCompare = !this.isCompare;
      this.compareBtn.classList.toggle('active', this.isCompare);
      this.singleControlsGroup.style.display = this.isCompare ? 'none' : 'block';
      this.compareControlsGroup.style.display = this.isCompare ? 'flex' : 'none';
      this.callbacks?.onCompareToggle(this.isCompare);
    });

    this.mediumWaterBtn.addEventListener('click', () => {
      this.setMedium('water');
    });

    this.mediumAirBtn.addEventListener('click', () => {
      this.setMedium('air');
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
        if (e.key === 'm' || e.key === 'M') {
          this.cycleMaterial();
        } else if (e.key === '[') {
          this.stepSpeedPreset(-1);
        } else if (e.key === ']') {
          this.stepSpeedPreset(1);
        } else if (e.key === '\\') {
          this.setSpeed(1.0);
        } else if (e.key === 'c' || e.key === 'C') {
          this.compareBtn.click();
        }
      });
    }
  }

  public setMedium(medium: SimulationMedium): void {
    this.currentMedium = medium;
    this.mediumWaterBtn.classList.toggle('active', medium === 'water');
    this.mediumAirBtn.classList.toggle('active', medium === 'air');
    this.callbacks?.onMediumChange(medium);
  }

  public get activeMedium(): SimulationMedium {
    return this.currentMedium;
  }

  private updateRunButtonState(): void {
    if (this.isRunning) {
      this.runBtn.classList.remove('state-paused');
      this.runBtn.classList.add('state-running');
      this.runBtn.querySelector('.btn-label')!.textContent = 'RUN';
    } else {
      this.runBtn.classList.remove('state-running');
      this.runBtn.classList.add('state-paused');
      this.runBtn.querySelector('.btn-label')!.textContent = 'PAUSE';
    }
  }

  public setRecordingState(recording: boolean): void {
    if (recording) {
      this.recBtn.classList.add('recording');
      this.recBtn.querySelector('.btn-label')!.textContent = 'STOP';
    } else {
      this.recBtn.classList.remove('recording');
      this.recBtn.querySelector('.btn-label')!.textContent = 'REC';
    }
  }

  private cycleMaterial(): void {
    const mats: PropMaterialId[] = ['rigid10k', 'pa12cf15', 'petg'];
    const idx = mats.indexOf(this.currentMaterial);
    const nextMat = mats[(idx + 1) % mats.length];
    this.setMaterial(nextMat);
  }

  public setMaterial(materialId: PropMaterialId): void {
    this.currentMaterial = materialId;
    this.materialSelect.value = materialId;
    this.callbacks?.onMaterialChange(materialId);
  }

  public setSpeed(speed: number): void {
    this.currentSpeed = speed;
    this.speedSelect.value = speed.toString();
    this.callbacks?.onSpeedChange(speed);
  }

  private stepSpeedPreset(delta: number): void {
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < SPEED_PRESETS.length; i++) {
      const diff = Math.abs(SPEED_PRESETS[i] - this.currentSpeed);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    const nextIdx = Math.max(0, Math.min(SPEED_PRESETS.length - 1, closestIdx + delta));
    this.setSpeed(SPEED_PRESETS[nextIdx]);
  }

  public updateFps(fps: number): void {
    this.setFpsTooltip(fps);
  }

  public setFpsTooltip(fps: number, frameTimeMs?: number): void {
    const ft = frameTimeMs !== undefined ? ` | Frame: ${frameTimeMs.toFixed(1)}ms` : '';
    this.titleEl.title = `Propeller Simulator | Engine: WebGL2 | Display: ${fps.toFixed(1)} FPS${ft}`;
  }
}
