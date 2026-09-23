export interface SimLayoutElements {
  headerEl: HTMLElement;
  paletteEl: HTMLElement;
  stageEl: HTMLElement;
  viewportEl: HTMLElement;
  stageCornerToolsEl: HTMLElement;
  stageOverlayStripEl: HTMLElement;
  stagePopoversEl: HTMLElement;
  fluidCutawayEl: HTMLElement;
  fluidCanvasEl: HTMLCanvasElement;
  firstRunCalloutEl: HTMLElement;
  inspectorEl: HTMLElement;
  hudEl: HTMLElement;
  footerValidationLink: HTMLAnchorElement;
}

export function buildSimLayout(root: HTMLElement): SimLayoutElements {
  root.innerHTML = `
    <!-- 1. Header (Title, Presets Dropdown, RUN Button, Share/Export) -->
    <header id="sim-header" class="sim-header"></header>

    <!-- 2. Main 3-Region Body (Palette | Stage | Inspector) -->
    <div class="sim-body">
      <!-- Left Palette -->
      <aside id="sim-palette" class="sim-palette"></aside>

      <!-- Center Stage (3D Viewport is Primary) -->
      <main id="sim-stage" class="sim-stage">
        <div id="viewport-container" aria-label="3D Vehicle and Fluid Viewport"></div>

        <!-- Stage Corner Tools (Cutaway Toggle) -->
        <div id="stage-corner-tools" class="stage-corner-tools"></div>

        <!-- Stage Right-Edge Vertical Overlay Strip -->
        <div id="stage-overlay-strip" class="stage-overlay-strip"></div>

        <!-- On-Demand 30s Popover Stripcharts (Stacked in Stage Corner) -->
        <div id="stage-popovers" class="stage-popovers"></div>

        <!-- First-Run Experience Callout -->
        <div id="first-run-callout" class="first-run-callout hidden"></div>

        <!-- 2D Cutaway Surface (Hidden unless Cutaway View is active) -->
        <div id="fluid-cutaway-container" class="fluid-cutaway-container hidden">
          <div class="cutaway-header">
            <span class="cutaway-title">2D EULERIAN CUTAWAY</span>
            <span class="cutaway-dim" id="cutaway-dim">256×128</span>
          </div>
          <canvas id="fluid-debug-canvas" width="256" height="128"></canvas>
          <div class="cutaway-scale">
            <span>0.0 m/s</span>
            <span>U/V Scalar Field</span>
            <span>Max</span>
          </div>
        </div>
      </main>

      <!-- Right Inspector -->
      <aside id="sim-inspector" class="sim-inspector"></aside>
    </div>

    <!-- 3. Bottom HUD Strip & App Footer (with /validation route link) -->
    <footer id="sim-footer-container" class="sim-footer-container">
      <div id="sim-hud" class="sim-hud"></div>
      <div class="footer-sub-bar">
        <span class="footer-meta">Candidate A SeaPerch Simulator &bull; 60 Hz BEMT &bull; 2D Eulerian Coupling</span>
        <span class="footer-sep">&bull;</span>
        <a href="/validation" id="footer-validation-link" class="footer-nav-link" title="Open standalone /validation report with public oracles and spec comparisons">
          🔬 Open Validation Suite (/validation)
        </a>
      </div>
    </footer>
  `;

  const headerEl = root.querySelector('#sim-header') as HTMLElement;
  const paletteEl = root.querySelector('#sim-palette') as HTMLElement;
  const stageEl = root.querySelector('#sim-stage') as HTMLElement;
  const viewportEl = root.querySelector('#viewport-container') as HTMLElement;
  const stageCornerToolsEl = root.querySelector('#stage-corner-tools') as HTMLElement;
  const stageOverlayStripEl = root.querySelector('#stage-overlay-strip') as HTMLElement;
  const stagePopoversEl = root.querySelector('#stage-popovers') as HTMLElement;
  const fluidCutawayEl = root.querySelector('#fluid-cutaway-container') as HTMLElement;
  const fluidCanvasEl = root.querySelector('#fluid-debug-canvas') as HTMLCanvasElement;
  const firstRunCalloutEl = root.querySelector('#first-run-callout') as HTMLElement;
  const inspectorEl = root.querySelector('#sim-inspector') as HTMLElement;
  const hudEl = root.querySelector('#sim-hud') as HTMLElement;
  const footerValidationLink = root.querySelector('#footer-validation-link') as HTMLAnchorElement;

  const dismissBtn = root.querySelector('#btn-first-run-dismiss');
  dismissBtn?.addEventListener('click', () => {
    firstRunCalloutEl.classList.add('hidden');
    try {
      localStorage.setItem('seaperch_first_run_seen', 'true');
    } catch {}
  });

  try {
    if (localStorage.getItem('seaperch_first_run_seen') === 'true') {
      firstRunCalloutEl.classList.add('hidden');
    }
  } catch {}

  return {
    headerEl,
    paletteEl,
    stageEl,
    viewportEl,
    stageCornerToolsEl,
    stageOverlayStripEl,
    stagePopoversEl,
    fluidCutawayEl,
    fluidCanvasEl,
    firstRunCalloutEl,
    inspectorEl,
    hudEl,
    footerValidationLink
  };
}
