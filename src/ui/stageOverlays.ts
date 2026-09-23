import type { OverlayState } from '../render/overlays';

export type { OverlayState } from '../render/overlays';

export interface StageOverlayCallbacks {
  onToggleCutaway: (active: boolean) => void;
  onToggleOverlay: (overlayKey: keyof OverlayState, active: boolean) => void;
  onSelectViewPreset?: (preset: 'full' | 'testSection' | 'cutaway') => void;
  onToggleVisualSpin?: (enabled: boolean) => void;
}

export interface StageOverlaysOptions {
  sharedState?: OverlayState;
}

interface OverlayDef {
  key: keyof OverlayState;
  icon: string;
  label: string;
  accent?: 'thrust' | 'torque' | 'heat' | 'current' | 'velocity' | 'dye' | 'pressure';
}

const OVERLAY_DEFS: OverlayDef[] = [
  { key: 'velocityVectors', icon: '⇶', label: 'Velocity vectors', accent: 'velocity' },
  { key: 'streamlines', icon: '〰', label: 'Streamlines', accent: 'velocity' },
  { key: 'dye', icon: '💧', label: 'Dye / smoke', accent: 'dye' },
  { key: 'vorticity', icon: '🌀', label: 'Vorticity', accent: 'velocity' },
  { key: 'pressureHeatmap', icon: '▦', label: 'Pressure', accent: 'pressure' },
  { key: 'particles', icon: '⁖', label: 'Particles', accent: 'velocity' },
  { key: 'thrustArrows', icon: '↑', label: 'Thrust arrows', accent: 'thrust' },
  { key: 'torqueArrows', icon: '↻', label: 'Torque arcs', accent: 'torque' },
  { key: 'thermal', icon: '🔥', label: 'Thermal', accent: 'heat' },
  { key: 'currentFlow', icon: '⚡', label: 'Current flow', accent: 'current' }
];

export class StageOverlays {
  private cornerContainer: HTMLElement;
  private stripContainer: HTMLElement;
  private cutawayContainer: HTMLElement;
  private callbacks: StageOverlayCallbacks;

  private cutawayActive = false;
  private activePreset: 'full' | 'testSection' | 'cutaway' = 'testSection';
  public state: OverlayState;

  constructor(
    cornerContainer: HTMLElement,
    stripContainer: HTMLElement,
    cutawayContainer: HTMLElement,
    callbacks: StageOverlayCallbacks,
    options?: StageOverlaysOptions
  ) {
    this.cornerContainer = cornerContainer;
    this.stripContainer = stripContainer;
    this.cutawayContainer = cutawayContainer;
    this.callbacks = callbacks;
    this.state = options?.sharedState ?? {
      velocityVectors: true,
      thrustArrows: true,
      streamlines: false,
      dye: false,
      vorticity: false,
      pressureHeatmap: false,
      particles: false,
      torqueArrows: false,
      thermal: false,
      currentFlow: false
    };
    this.render();
  }

  public render(): void {
    this.cornerContainer.innerHTML = `
      <button id="btn-view-full" class="btn-stage-tool ${this.activePreset === 'full' ? 'active' : ''}" title="Full tunnel" aria-label="Full tunnel">
        <span>⚏</span>
      </button>
      <button id="btn-view-section" class="btn-stage-tool ${this.activePreset === 'testSection' ? 'active' : ''}" title="Test section close-up" aria-label="Test section close-up">
        <span>⊕</span>
      </button>
      <button id="btn-toggle-cutaway" class="btn-stage-tool ${this.cutawayActive ? 'active' : ''}" title="Side cutaway" aria-label="Side cutaway" aria-pressed="${this.cutawayActive}">
        <span>◫</span>
      </button>
    `;

    const fullBtn = this.cornerContainer.querySelector('#btn-view-full');
    fullBtn?.addEventListener('click', () => {
      this.activePreset = 'full';
      if (this.cutawayActive) {
        this.cutawayActive = false;
        this.updateCutawayVisibility();
        this.callbacks.onToggleCutaway(false);
      }
      this.render();
      this.callbacks.onSelectViewPreset?.('full');
    });

    const sectionBtn = this.cornerContainer.querySelector('#btn-view-section');
    sectionBtn?.addEventListener('click', () => {
      this.activePreset = 'testSection';
      if (this.cutawayActive) {
        this.cutawayActive = false;
        this.updateCutawayVisibility();
        this.callbacks.onToggleCutaway(false);
      }
      this.render();
      this.callbacks.onSelectViewPreset?.('testSection');
    });

    const cutawayBtn = this.cornerContainer.querySelector('#btn-toggle-cutaway');
    cutawayBtn?.addEventListener('click', () => {
      this.cutawayActive = !this.cutawayActive;
      this.activePreset = this.cutawayActive ? 'cutaway' : 'testSection';
      this.updateCutawayVisibility();
      this.render();
      this.callbacks.onToggleCutaway(this.cutawayActive);
      if (this.cutawayActive) {
        this.callbacks.onSelectViewPreset?.('cutaway');
      }
    });

    this.stripContainer.innerHTML = OVERLAY_DEFS.map((def) => {
      const isActive = this.state[def.key];
      const accentAttr = def.accent ? `data-accent="${def.accent}"` : '';
      const isQueued = (def.key === 'vorticity' || def.key === 'pressureHeatmap') && isActive && !this.cutawayActive;
      const queuedAttr = isQueued ? 'data-queued="true"' : '';
      return `
        <button class="btn-overlay-toggle ${isActive ? 'active' : ''}"
                data-key="${def.key}"
                data-tooltip="${def.label}${isQueued ? ' (queued for cutaway)' : ''}"
                aria-label="${def.label}"
                aria-pressed="${isActive}"
                ${accentAttr}
                ${queuedAttr}>
          ${def.icon}
        </button>
      `;
    }).join('');

    const toggleButtons = this.stripContainer.querySelectorAll('.btn-overlay-toggle');
    toggleButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const key = (e.currentTarget as HTMLElement).dataset.key as keyof OverlayState;
        this.state[key] = !this.state[key];
        this.render();
        this.callbacks.onToggleOverlay(key, this.state[key]);
      });
    });
  }

  public updateCouplingBadge(_agreementPct: number, _bemtN: number, _gridN: number): void {
  }

  private updateCutawayVisibility(): void {
    if (this.cutawayActive) {
      this.cutawayContainer.classList.remove('hidden');
    } else {
      this.cutawayContainer.classList.add('hidden');
    }
  }

  public setCutawayActive(active: boolean): void {
    this.cutawayActive = active;
    this.updateCutawayVisibility();
    this.render();
  }
}
