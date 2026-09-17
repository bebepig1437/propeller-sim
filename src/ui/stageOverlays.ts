/**
 * Stage Overlays Component:
 * 1. Corner Cutaway Toggle button
 * 2. Vertical Overlay Icon Strip on stage's right edge (with hover tooltips & color discipline)
 */

export interface OverlayState {
  velocityVectors: boolean;
  streamlines: boolean;
  pressureHeatmap: boolean;
  vorticity: boolean;
  particles: boolean;
  thrustArrows: boolean;
  torqueArrows: boolean;
  thermal: boolean;
  currentFlow: boolean;
}

export interface StageOverlayCallbacks {
  onToggleCutaway: (active: boolean) => void;
  onToggleOverlay: (overlayKey: keyof OverlayState, active: boolean) => void;
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
  public state: OverlayState = {
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

  constructor(
    cornerContainer: HTMLElement,
    stripContainer: HTMLElement,
    cutawayContainer: HTMLElement,
    callbacks: StageOverlayCallbacks
  ) {
    this.cornerContainer = cornerContainer;
    this.stripContainer = stripContainer;
    this.cutawayContainer = cutawayContainer;
    this.callbacks = callbacks;
    this.render();
  }

  public render(): void {
    // 1. Stage Corner Cutaway Button
    this.cornerContainer.innerHTML = `
      <button id="btn-toggle-cutaway" class="btn-stage-tool ${this.cutawayActive ? 'active' : ''}" title="Toggle 2D Side Cutaway Cross-Section">
        <span>◫</span>
        <span>Cutaway View</span>
      </button>
    `;

    const cutawayBtn = this.cornerContainer.querySelector('#btn-toggle-cutaway');
    cutawayBtn?.addEventListener('click', () => {
      this.cutawayActive = !this.cutawayActive;
      this.updateCutawayVisibility();
      this.render();
      this.callbacks.onToggleCutaway(this.cutawayActive);
    });

    // 2. Stage Right-Edge Vertical Overlay Strip
    this.stripContainer.innerHTML = OVERLAY_DEFS.map((def) => {
      const isActive = this.state[def.key];
      const accentAttr = def.accent ? `data-accent="${def.accent}"` : '';
      return `
        <button class="btn-overlay-toggle ${isActive ? 'active' : ''}"
                data-key="${def.key}"
                data-tooltip="${def.label}"
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
