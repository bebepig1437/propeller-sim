import { defaultConfig } from '../core/config';
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
  accent?: 'thrust' | 'torque' | 'heat' | 'current';
}

const OVERLAY_DEFS: OverlayDef[] = [
  { key: 'velocityVectors', icon: '⇶', label: 'Velocity Vectors (Fluid)', accent: 'thrust' },
  { key: 'thrustArrows', icon: '↑', label: 'Thrust Force Vectors', accent: 'thrust' },
  { key: 'torqueArrows', icon: '↻', label: 'Motor & Stator Torque', accent: 'torque' },
  { key: 'thermal', icon: '🔥', label: 'Thermal Dissipation Heatmap', accent: 'heat' },
  { key: 'currentFlow', icon: '⚡', label: 'Electrical Current Sag', accent: 'current' },
  { key: 'vorticity', icon: '🌀', label: 'Vorticity Confinement Field' },
  { key: 'streamlines', icon: '〰', label: 'Eulerian Streamlines' },
  { key: 'pressureHeatmap', icon: '▦', label: 'Pressure Field (Jacobi)' },
  { key: 'particles', icon: '⁖', label: 'Passive Tracer Particles' }
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
      torqueArrows: false,
      thermal: false,
      currentFlow: false,
      vorticity: false,
      streamlines: false,
      pressureHeatmap: false,
      particles: false
    };
    this.render();
  }

  public render(): void {
    const spinActive = defaultConfig.propellerVisualSpinEnabled;
    this.cornerContainer.innerHTML = `
      <button id="btn-view-full" class="btn-stage-tool ${this.activePreset === 'full' ? 'active' : ''}" title="View Full Water Tunnel" aria-label="View Full Water Tunnel">
        <span>⚏</span>
        <span>Full Tunnel</span>
      </button>
      <button id="btn-view-section" class="btn-stage-tool ${this.activePreset === 'testSection' ? 'active' : ''}" title="Close-up View of Propulsor Test Section" aria-label="Close-up View of Propulsor Test Section">
        <span>⊕</span>
        <span>Test Section</span>
      </button>
      <button id="btn-toggle-cutaway" class="btn-stage-tool ${this.cutawayActive ? 'active' : ''}" title="Toggle 2D Side Cutaway Cross-Section" aria-label="Toggle 2D Side Cutaway Cross-Section" aria-pressed="${this.cutawayActive}">
        <span>◫</span>
        <span>Cutaway</span>
      </button>
      <button id="btn-toggle-spin" class="btn-stage-tool ${spinActive ? 'active' : ''}" title="Toggle Propeller Visual Spin" aria-label="Toggle Propeller Visual Spin" aria-pressed="${spinActive}">
        <span>↻</span>
        <span>Spin: ${spinActive ? 'ON' : 'OFF'}</span>
      </button>
      <div id="thrust-coupling-badge" class="stage-coupling-badge hidden">
        <span>⇄ COUPLING</span>
        <span id="thrust-coupling-text">--</span>
      </div>
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

    const spinBtn = this.cornerContainer.querySelector('#btn-toggle-spin');
    spinBtn?.addEventListener('click', () => {
      defaultConfig.propellerVisualSpinEnabled = !defaultConfig.propellerVisualSpinEnabled;
      this.render();
      this.callbacks.onToggleVisualSpin?.(defaultConfig.propellerVisualSpinEnabled);
    });

    this.stripContainer.innerHTML = OVERLAY_DEFS.map((def) => {
      const isActive = this.state[def.key];
      const accentAttr = def.accent ? `data-accent="${def.accent}"` : '';
      return `
        <button class="btn-overlay-toggle ${isActive ? 'active' : ''}"
                data-key="${def.key}"
                data-tooltip="${def.label}"
                aria-label="${def.label}"
                aria-pressed="${isActive}"
                ${accentAttr}>
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

  public updateCouplingBadge(agreementPct: number, bemtN: number, gridN: number): void {
    const badgeEl = this.cornerContainer.querySelector('#thrust-coupling-badge');
    const textEl = this.cornerContainer.querySelector('#thrust-coupling-text');
    if (!badgeEl || !textEl) return;

    const overlayOn = this.state.thrustArrows || this.state.velocityVectors;
    if (!overlayOn || Math.abs(bemtN) < 0.05) {
      badgeEl.classList.add('hidden');
      return;
    }

    badgeEl.classList.remove('hidden');
    if (agreementPct >= 85) {
      badgeEl.classList.add('converged');
    } else {
      badgeEl.classList.remove('converged');
    }
    textEl.textContent = `${agreementPct.toFixed(1)}% (BEMT: ${bemtN.toFixed(2)}N | Grid: ${gridN.toFixed(2)}N)`;
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
