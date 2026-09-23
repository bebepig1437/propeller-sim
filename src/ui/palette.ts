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
      <!-- 1. Stator Vane Recovery -->
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

    const designButtons = this.container.querySelectorAll('[data-design]');
    designButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const d = (e.currentTarget as HTMLElement).dataset.design as 'candidateA' | 'kaplan' | 'wageningen';
        this.activeDesign = d;
        this.render();
        this.callbacks.onSelectPropDesign(d);
      });
    });

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
