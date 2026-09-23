export type HandednessPresetType =
  | 'alternating'
  | 'all_cw'
  | 'all_ccw'
  | 'contra_rotating_coaxial'
  | 'tandem';

export interface PaletteCallbacks {
  onLoadVehicle: (vehicleId: 'candidateA' | 'custom') => void;
  onResetPose: () => void;
  onSelectThruster: (thrusterIndex: number) => void;
  onAddThruster: () => void;
  onRemoveThruster: (thrusterIndex: number) => void;
  onHandednessPresetChange?: (preset: HandednessPresetType) => void;
  onToggleStator: (attached: boolean) => void;
  onToggleSlottedVane: (slotted: boolean) => void;
  onSelectPropDesign: (design: 'candidateA' | 'kaplan' | 'wageningen') => void;
  onSelectMaterial: (material: 'rigid10k' | 'pa12cf15' | 'petg') => void;
  onSelectOperatingPoint: (key: string) => void;
}

export class SimPalette {
  private container: HTMLElement;
  private callbacks: PaletteCallbacks;

  public selectedThruster = 0;
  public thrusterCount = 3;
  public handednessPreset: HandednessPresetType = 'alternating';
  public statorAttached = true;
  public slottedVane = true;
  public activeDesign: 'candidateA' | 'kaplan' | 'wageningen' = 'candidateA';
  public activeMaterial: 'rigid10k' | 'pa12cf15' | 'petg' = 'rigid10k';

  constructor(container: HTMLElement, callbacks: PaletteCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  public render(): void {
    this.container.innerHTML = `
      <!-- 1. Vehicle -->
      <div class="palette-section">
        <span class="palette-section-title">Vehicle</span>
        <div class="palette-btn-group">
          <button class="palette-btn active" id="btn-load-candidate-a">
            <span>Candidate A</span>
            <span class="badge">3-Motor</span>
          </button>
          <button class="palette-btn" id="btn-reset-pose">
            <span>Reset Pose</span>
            <span>↺</span>
          </button>
        </div>
      </div>

      <!-- 2. Thrusters Array & Presets -->
      <div class="palette-section">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="palette-section-title">Thrusters</span>
          <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-secondary);">${this.thrusterCount} Active</span>
        </div>
        <div class="palette-segmented" id="thruster-selector-group">
          ${Array.from({ length: this.thrusterCount }).map((_, i) => `
            <button class="palette-segment ${i === this.selectedThruster ? 'active' : ''}" data-idx="${i}">T${i + 1}</button>
          `).join('')}
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
          <button class="palette-btn" id="btn-add-thruster" style="justify-content:center;">+ Add</button>
          <button class="palette-btn" id="btn-remove-thruster" style="justify-content:center;" ${this.thrusterCount <= 1 ? 'disabled' : ''}>− Del</button>
        </div>

        <!-- Handedness Layout Preset Dropdown -->
        <div style="margin-top: 6px;">
          <span style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;">Handedness Preset</span>
          <select class="palette-select" id="select-handedness-preset" style="width: 100%;">
            <option value="alternating" ${this.handednessPreset === 'alternating' ? 'selected' : ''}>Alternating (CW, CCW, CW)</option>
            <option value="all_cw" ${this.handednessPreset === 'all_cw' ? 'selected' : ''}>All CW (Single-Shaft)</option>
            <option value="all_ccw" ${this.handednessPreset === 'all_ccw' ? 'selected' : ''}>All CCW</option>
            <option value="contra_rotating_coaxial" ${this.handednessPreset === 'contra_rotating_coaxial' ? 'selected' : ''}>Contra-Rotating Coaxial (CRP)</option>
            <option value="tandem" ${this.handednessPreset === 'tandem' ? 'selected' : ''}>Tandem Series (Additive)</option>
          </select>
        </div>
      </div>

      <!-- 3. Stator Vane Recovery -->
      <div class="palette-section">
        <span class="palette-section-title">Torque Stator</span>
        <div class="palette-btn-group">
          <button class="palette-btn ${this.statorAttached ? 'active' : ''}" id="btn-toggle-stator">
            <span>Attach Stator</span>
            <span>${this.statorAttached ? '✓' : '—'}</span>
          </button>
          <button class="palette-btn ${this.slottedVane ? 'active' : ''}" id="btn-toggle-slot" ${!this.statorAttached ? 'disabled' : ''}>
            <span>Slotted Vane (40% c)</span>
            <span>${this.slottedVane ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </div>

      <!-- 4. Propeller Profile Design -->
      <div class="palette-section">
        <span class="palette-section-title">Blade Geometry</span>
        <div class="palette-segmented">
          <button class="palette-segment ${this.activeDesign === 'candidateA' ? 'active' : ''}" data-design="candidateA">Cand A</button>
          <button class="palette-segment ${this.activeDesign === 'kaplan' ? 'active' : ''}" data-design="kaplan">Kaplan</button>
          <button class="palette-segment ${this.activeDesign === 'wageningen' ? 'active' : ''}" data-design="wageningen">Wagen B</button>
        </div>
      </div>

      <!-- 5. Material -->
      <div class="palette-section">
        <span class="palette-section-title">Blade Material</span>
        <div class="palette-segmented">
          <button class="palette-segment ${this.activeMaterial === 'rigid10k' ? 'active' : ''}" data-mat="rigid10k" title="Rigid 10K Resin (1.80g)">10K</button>
          <button class="palette-segment ${this.activeMaterial === 'pa12cf15' ? 'active' : ''}" data-mat="pa12cf15" title="PA12-CF15 Carbon (1.25g)">PA12</button>
          <button class="palette-segment ${this.activeMaterial === 'petg' ? 'active' : ''}" data-mat="petg" title="PETG Baseline (1.38g)">PETG</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Vehicle
    this.container.querySelector('#btn-load-candidate-a')?.addEventListener('click', () => {
      this.callbacks.onLoadVehicle('candidateA');
    });
    this.container.querySelector('#btn-reset-pose')?.addEventListener('click', () => {
      this.callbacks.onResetPose();
    });

    // Thruster Select
    const segButtons = this.container.querySelectorAll('#thruster-selector-group button');
    segButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt((e.currentTarget as HTMLElement).dataset.idx || '0', 10);
        this.selectedThruster = idx;
        this.render();
        this.callbacks.onSelectThruster(idx);
      });
    });

    // Add Thruster
    this.container.querySelector('#btn-add-thruster')?.addEventListener('click', () => {
      if (this.thrusterCount < 6) {
        this.thrusterCount++;
        this.selectedThruster = this.thrusterCount - 1;
        this.render();
        this.callbacks.onAddThruster();
      }
    });

    // Remove Thruster
    this.container.querySelector('#btn-remove-thruster')?.addEventListener('click', () => {
      if (this.thrusterCount > 1) {
        const idxToRemove = this.selectedThruster;
        this.thrusterCount--;
        this.selectedThruster = Math.max(0, this.thrusterCount - 1);
        this.render();
        this.callbacks.onRemoveThruster(idxToRemove);
      }
    });

    // Handedness Preset
    const presetSelect = this.container.querySelector('#select-handedness-preset') as HTMLSelectElement;
    presetSelect?.addEventListener('change', () => {
      const p = presetSelect.value as HandednessPresetType;
      this.handednessPreset = p;
      if (p === 'contra_rotating_coaxial' || p === 'tandem') {
        this.thrusterCount = 2;
        this.selectedThruster = 0;
        this.render();
      }
      this.callbacks.onHandednessPresetChange?.(p);
    });

    // Stator
    this.container.querySelector('#btn-toggle-stator')?.addEventListener('click', () => {
      this.statorAttached = !this.statorAttached;
      this.render();
      this.callbacks.onToggleStator(this.statorAttached);
    });

    this.container.querySelector('#btn-toggle-slot')?.addEventListener('click', () => {
      if (this.statorAttached) {
        this.slottedVane = !this.slottedVane;
        this.render();
        this.callbacks.onToggleSlottedVane(this.slottedVane);
      }
    });

    // Prop Design
    const designButtons = this.container.querySelectorAll('[data-design]');
    designButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const d = (e.currentTarget as HTMLElement).dataset.design as 'candidateA' | 'kaplan' | 'wageningen';
        this.activeDesign = d;
        this.render();
        this.callbacks.onSelectPropDesign(d);
      });
    });

    // Material
    const matButtons = this.container.querySelectorAll('[data-mat]');
    matButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const m = (e.currentTarget as HTMLElement).dataset.mat as 'rigid10k' | 'pa12cf15' | 'petg';
        this.activeMaterial = m;
        this.render();
        this.callbacks.onSelectMaterial(m);
      });
    });
  }

  public setSelectedThruster(idx: number): void {
    this.selectedThruster = idx;
    this.render();
  }

  public setThrusterCount(count: number, activeIdx?: number): void {
    this.thrusterCount = count;
    if (activeIdx !== undefined) {
      this.selectedThruster = activeIdx;
    } else if (this.selectedThruster >= count) {
      this.selectedThruster = count - 1;
    }
    this.render();
  }

  public loadVehicle(vehicleId: 'candidateA' | 'custom'): void {
    this.callbacks.onLoadVehicle(vehicleId);
  }
}
