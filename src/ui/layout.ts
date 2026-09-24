export interface SimLayoutElements {
  headerEl: HTMLElement;
  stageEl: HTMLElement;
  viewportEl: HTMLElement;
  hudEl: HTMLElement;
}

export function buildSimLayout(root: HTMLElement): SimLayoutElements {
  root.innerHTML = `
    <header id="sim-header" class="sim-header">
      <!-- Prompt 2: Header controls (title, throttle, RUN, REC) -->
    </header>
    <main id="sim-stage" class="sim-stage">
      <div id="viewport-container" aria-label="Pipe Flow and Propeller Viewport"></div>
    </main>
    <footer id="sim-hud" class="sim-hud">
      <!-- Prompt 2: 4-value honest HUD strip -->
    </footer>
  `;

  return {
    headerEl: root.querySelector('#sim-header') as HTMLElement,
    stageEl: root.querySelector('#sim-stage') as HTMLElement,
    viewportEl: root.querySelector('#viewport-container') as HTMLElement,
    hudEl: root.querySelector('#sim-hud') as HTMLElement
  };
}
