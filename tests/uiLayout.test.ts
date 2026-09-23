import { describe, it, expect, beforeEach, vi } from 'vitest';

class MockNode {
  public id: string = '';
  public className: string = '';
  public innerHTMLValue: string = '';
  public textContentValue: string = '';
  public value: string = '';
  public dataset: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockNode[] = [];
  public parentNode: MockNode | null = null;
  public options: Array<{ value: string; label: string }> = [];
  public open: boolean = false;
  private listeners: Map<string, Function[]> = new Map();

  constructor(public tagName: string = 'div') {}

  get textContent(): string {
    if (this.textContentValue) return this.textContentValue;
    if (this.children.length === 0) return this.innerHTMLValue.replace(/<[^>]*>/g, '').trim();
    return this.children.map(c => c.textContent).join(' ').trim();
  }

  set textContent(v: string) {
    this.textContentValue = v;
    this.innerHTMLValue = v;
    this.children = [];
  }

  get innerHTML(): string {
    return this.innerHTMLValue;
  }

  set innerHTML(html: string) {
    this.innerHTMLValue = html;
    this.children = parseHtml(html, this);
    if (this.tagName === 'select') {
      const optRegex = /<option value=["']([^"']+)["']>([^<]*)<\/option>/g;
      let opt;
      this.options = [];
      while ((opt = optRegex.exec(html)) !== null) {
        this.options.push({ value: opt[1], label: opt[2] });
      }
    }
  }

  get classList() {
    return {
      contains: (c: string) => this.className.split(/\s+/).includes(c),
      add: (c: string) => {
        if (!this.classList.contains(c)) {
          this.className = (this.className + ' ' + c).trim();
        }
      },
      remove: (c: string) => {
        this.className = this.className.split(/\s+/).filter(x => x !== c).join(' ');
      }
    };
  }

  querySelector(sel: string): MockNode | null {
    if (sel.startsWith('#')) {
      const targetId = sel.slice(1);
      return this.find(node => node.id === targetId);
    }
    if (sel.startsWith('.')) {
      const targetClass = sel.slice(1);
      return this.find(node => node.classList.contains(targetClass));
    }
    if (sel.includes('[')) {
      const match = sel.match(/\[([a-zA-Z0-9-]+)(?:=["']([^"']+)["'])?\]/);
      if (match) {
        const attr = match[1];
        const val = match[2];
        return this.find(node => {
          if (attr.startsWith('data-')) {
            const k = attr.replace('data-', '');
            return val !== undefined ? node.dataset[k] === val : k in node.dataset;
          }
          return false;
        });
      }
    }
    return this.find(node => node.tagName.toLowerCase() === sel.toLowerCase());
  }

  querySelectorAll(sel: string): MockNode[] {
    const results: MockNode[] = [];
    this.findAll(sel, results);
    return results;
  }

  private find(predicate: (n: MockNode) => boolean): MockNode | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const res = child.find(predicate);
      if (res) return res;
    }
    return null;
  }

  private findAll(sel: string, results: MockNode[]): void {
    for (const child of this.children) {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        if (child.classList.contains(cls)) results.push(child);
      } else if (sel.startsWith('#')) {
        if (child.id === sel.slice(1)) results.push(child);
      } else if (sel.includes('[')) {
        const match = sel.match(/\[([a-zA-Z0-9-]+)(?:=["']([^"']+)["'])?\]/);
        if (match) {
          const k = match[1].replace('data-', '');
          const val = match[2];
          if (val !== undefined ? child.dataset[k] === val : k in child.dataset) {
            results.push(child);
          }
        }
      } else if (child.tagName.toLowerCase() === sel.toLowerCase()) {
        results.push(child);
      }
      child.findAll(sel, results);
    }
  }

  appendChild(child: MockNode): void {
    child.parentNode = this;
    this.children.push(child);
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      this.parentNode = null;
    }
  }

  addEventListener(event: string, fn: Function): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(fn);
  }

  dispatchEvent(evt: { type: string }): void {
    const list = this.listeners.get(evt.type) || [];
    list.forEach(fn => fn({ currentTarget: this }));
  }

  click(): void {
    this.dispatchEvent({ type: 'click' });
  }

  getContext(): any {
    return {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn()
    };
  }
}

function parseHtml(html: string, parent: MockNode | null = null): MockNode[] {
  const nodes: MockNode[] = [];
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, '');

  let i = 0;
  while (i < cleanHtml.length) {
    const openTagStart = cleanHtml.indexOf('<', i);
    if (openTagStart === -1) break;

    if (cleanHtml[openTagStart + 1] === '/') {
      i = cleanHtml.indexOf('>', openTagStart) + 1;
      continue;
    }

    const openTagEnd = cleanHtml.indexOf('>', openTagStart);
    if (openTagEnd === -1) break;

    const tagContent = cleanHtml.substring(openTagStart + 1, openTagEnd).trim();
    const spaceIdx = tagContent.search(/\s/);
    const tagName = (spaceIdx === -1 ? tagContent : tagContent.substring(0, spaceIdx)).replace('/', '').toLowerCase();
    const attrString = spaceIdx === -1 ? '' : tagContent.substring(spaceIdx);

    const isVoidTag = ['input', 'canvas', 'img', 'br', 'hr'].includes(tagName) || tagContent.endsWith('/');

    const node = new MockNode(tagName);
    node.parentNode = parent;

    const attrRegex = /([a-zA-Z0-9-]+)(?:=["']([^"']*)["'])?/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      const attrName = attrMatch[1];
      const attrVal = attrMatch[2] ?? '';
      if (attrName === 'id') node.id = attrVal;
      else if (attrName === 'class') node.className = attrVal;
      else if (attrName.startsWith('data-')) node.dataset[attrName.slice(5)] = attrVal;
      else if (attrName === 'value') node.value = attrVal;
    }

    if (isVoidTag) {
      nodes.push(node);
      i = openTagEnd + 1;
      continue;
    }

    const closeTag = `</${tagName}>`;
    let depth = 1;
    let searchPos = openTagEnd + 1;
    let innerEnd = -1;

    while (depth > 0) {
      const nextOpen = cleanHtml.indexOf(`<${tagName}`, searchPos);
      const nextClose = cleanHtml.indexOf(closeTag, searchPos);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        searchPos = cleanHtml.indexOf('>', nextOpen) + 1;
      } else {
        depth--;
        if (depth === 0) {
          innerEnd = nextClose;
          break;
        }
        searchPos = nextClose + closeTag.length;
      }
    }

    if (innerEnd !== -1) {
      const inner = cleanHtml.substring(openTagEnd + 1, innerEnd);
      node.innerHTMLValue = inner;
      node.children = parseHtml(inner, node);
      if (tagName === 'select') {
        const optRegex = /<option value=["']([^"']*)["']>([^<]*)<\/option>/g;
        let opt;
        node.options = [];
        while ((opt = optRegex.exec(inner)) !== null) {
          node.options.push({ value: opt[1], label: opt[2] });
        }
      }
      if (node.children.length === 0) {
        node.textContentValue = inner.trim();
      }
      i = innerEnd + closeTag.length;
    } else {
      i = openTagEnd + 1;
    }

    nodes.push(node);
  }

  return nodes;
}

// Setup global mock document if running in node
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => new MockNode(tag),
    getElementById: (id: string) => null,
    body: new MockNode('body')
  };
  (globalThis as any).HTMLElement = MockNode;
  (globalThis as any).HTMLButtonElement = MockNode;
  (globalThis as any).HTMLSelectElement = MockNode;
  (globalThis as any).HTMLInputElement = MockNode;
  (globalThis as any).HTMLCanvasElement = MockNode;
  (globalThis as any).HTMLDetailsElement = MockNode;
  (globalThis as any).Event = class {
    constructor(public type: string) {}
  };
}

import { buildSimLayout } from '../src/ui/layout';
import { SimHeader, DEFAULT_PRESETS } from '../src/ui/header';
import { SimPalette } from '../src/ui/palette';
import { StageOverlays } from '../src/ui/stageOverlays';
import { SimInspector } from '../src/ui/inspector';
import { SimHudStrip } from '../src/ui/hud';

describe('IBM Quantum Composer Design Language & UI Skeleton', () => {
  let root: any;

  beforeEach(() => {
    root = new MockNode('div');
    root.id = 'app';
  });

  describe('3-Region Layout Scaffolding', () => {
    it('creates header, left palette, center stage, right inspector, and bottom HUD strip', () => {
      const layout = buildSimLayout(root as any);

      expect(layout.headerEl).toBeDefined();
      expect(layout.paletteEl).toBeDefined();
      expect(layout.stageEl).toBeDefined();
      expect(layout.viewportEl).toBeDefined();
      expect(layout.inspectorEl).toBeDefined();
      expect(layout.hudEl).toBeDefined();

      expect(root.querySelector('#sim-header')).not.toBeNull();
      expect(root.querySelector('#sim-palette')).not.toBeNull();
      expect(root.querySelector('#sim-stage')).not.toBeNull();
      expect(root.querySelector('#sim-inspector')).not.toBeNull();
      expect(root.querySelector('#sim-hud')).not.toBeNull();
    });

    it('stage holds corner tools, right overlay strip, popovers container, and cutaway container', () => {
      const layout = buildSimLayout(root as any);

      expect(layout.stageCornerToolsEl).not.toBeNull();
      expect(layout.stageOverlayStripEl).not.toBeNull();
      expect(layout.stagePopoversEl).not.toBeNull();
      expect(layout.fluidCutawayEl).not.toBeNull();
      expect(layout.fluidCanvasEl).not.toBeNull();
      expect(layout.fluidCutawayEl.classList.contains('hidden')).toBe(true);
    });
  });

  describe('SimHeader Component', () => {
    it('renders single prominent RUN button with state transitions (idle -> running -> paused -> running)', () => {
      const layout = buildSimLayout(root as any);
      const onRunToggle = vi.fn();
      const header = new SimHeader(layout.headerEl as any, {
        onRunToggle,
        onPresetSelect: vi.fn(),
        onShare: vi.fn(),
        onExportCsv: vi.fn(),
        onValidationClick: vi.fn()
      });

      const runBtn = layout.headerEl.querySelector('#btn-run') as any;
      expect(runBtn).not.toBeNull();
      expect(runBtn.classList.contains('state-idle')).toBe(true);

      // Click 1: idle -> running
      runBtn.click();
      expect(onRunToggle).toHaveBeenCalledWith('running');
      expect(header.getRunState()).toBe('running');
      expect(runBtn.classList.contains('state-running')).toBe(true);

      // Click 2: running -> paused
      runBtn.click();
      expect(onRunToggle).toHaveBeenCalledWith('paused');
      expect(header.getRunState()).toBe('paused');
      expect(runBtn.classList.contains('state-paused')).toBe(true);

      // Click 3: paused -> running
      runBtn.click();
      expect(onRunToggle).toHaveBeenCalledWith('running');
      expect(header.getRunState()).toBe('running');
    });

    it('renders preset dropdown with 5 operating points', () => {
      const layout = buildSimLayout(root as any);
      const onPresetSelect = vi.fn();
      new SimHeader(layout.headerEl as any, {
        onRunToggle: vi.fn(),
        onPresetSelect,
        onShare: vi.fn(),
        onExportCsv: vi.fn(),
        onValidationClick: vi.fn()
      });

      const select = layout.headerEl.querySelector('#preset-selector') as any;
      expect(select).not.toBeNull();
      expect(select.options.length).toBe(5);
      expect(select.options[0].value).toBe('breakout');
      expect(select.options[1].value).toBe('heavy_lift');
      expect(select.options[2].value).toBe('cruise');

      select.value = 'heavy_lift';
      select.dispatchEvent(new Event('change'));
      expect(onPresetSelect).toHaveBeenCalledWith('heavy_lift');
    });
  });

  describe('SimPalette Component', () => {
    it('exposes direct physical primitives: vehicle, thrusters, stator, prop profile, material', () => {
      const layout = buildSimLayout(root as any);
      const onSelectThruster = vi.fn();
      const onToggleStator = vi.fn();
      const onSelectPropDesign = vi.fn();

      new SimPalette(layout.paletteEl as any, {
        onLoadVehicle: vi.fn(),
        onResetPose: vi.fn(),
        onSelectThruster,
        onAddThruster: vi.fn(),
        onRemoveThruster: vi.fn(),
        onToggleStator,
        onToggleSlottedVane: vi.fn(),
        onSelectPropDesign,
        onSelectMaterial: vi.fn(),
        onSelectOperatingPoint: vi.fn()
      });

      const titles = layout.paletteEl.querySelectorAll('.palette-section-title').map((el: any) => el.textContent);
      expect(titles).toContain('Vehicle');
      expect(titles).toContain('Thrusters');
      expect(titles).toContain('Torque Stator');
      expect(titles).toContain('Blade Geometry');
      expect(titles).toContain('Blade Material');

      // Stator toggle
      const statorBtn = layout.paletteEl.querySelector('#btn-toggle-stator') as any;
      statorBtn.click();
      expect(onToggleStator).toHaveBeenCalledWith(false);

      // Prop design select
      const kaplanBtn = layout.paletteEl.querySelector('[data-design="kaplan"]') as any;
      kaplanBtn.click();
      expect(onSelectPropDesign).toHaveBeenCalledWith('kaplan');
    });
  });

  describe('SimInspector Component', () => {
    it('defaults to run settings when nothing is selected, with advanced fold closed by default', () => {
      const layout = buildSimLayout(root as any);
      const onSupplyVoltageChange = vi.fn();

      new SimInspector(layout.inspectorEl as any, {
        onSupplyVoltageChange,
        onTetherLengthChange: vi.fn(),
        onThermalToggle: vi.fn()
      });

      const title = layout.inspectorEl.querySelector('.inspector-title');
      expect(title?.textContent).toBe('Run Settings');

      // Advanced fold is closed by default
      const advFold = layout.inspectorEl.querySelector('.inspector-advanced') as any;
      expect(advFold).not.toBeNull();
      expect(advFold.open).toBe(false);

      // Slider changes supply voltage
      const slider = layout.inspectorEl.querySelector('#slider-supply-v') as any;
      slider.value = '14.0';
      slider.dispatchEvent(new Event('input'));
      expect(onSupplyVoltageChange).toHaveBeenCalledWith(14.0);
    });

    it('switches to thruster controls when thruster is selected', () => {
      const layout = buildSimLayout(root as any);
      const onThrottleChange = vi.fn();

      const inspector = new SimInspector(layout.inspectorEl as any, {
        onThrottleChange
      });

      inspector.setSelection({ type: 'thruster', index: 0 });
      const title = layout.inspectorEl.querySelector('.inspector-title');
      expect(title?.textContent).toBe('Thruster 1');

      const throttleSlider = layout.inspectorEl.querySelector('#slider-throttle') as any;
      expect(throttleSlider).not.toBeNull();
      throttleSlider.value = '0.9';
      throttleSlider.dispatchEvent(new Event('input'));
      expect(onThrottleChange).toHaveBeenCalledWith(0, 0.9);
    });
  });

  describe('SimHudStrip Component', () => {
    it('renders exactly 6 physical metrics at rest with unit labels and accent channels', () => {
      const layout = buildSimLayout(root as any);
      const hud = new SimHudStrip(layout.hudEl as any, layout.stagePopoversEl as any);

      hud.update({
        thrust_N: 4.73,
        torque_Nm: 0.024,
        rpm: 4140,
        bus_V: 10.82,
        current_A: 1.41,
        temp_C: 32.5,
        fps: 60.0,
        frameMs: 16.6,
        gpuMs: 1.8,
        presetName: 'Breakout'
      });

      expect(layout.hudEl.querySelector('#hud-thrust-val')?.textContent).toBe('4.73 N');
      expect(layout.hudEl.querySelector('#hud-torque-val')?.textContent).toBe('0.024 Nm');
      expect(layout.hudEl.querySelector('#hud-rpm-val')?.textContent).toBe('4140 rpm');
      expect(layout.hudEl.querySelector('#hud-busv-val')?.textContent).toBe('10.82 V');
      expect(layout.hudEl.querySelector('#hud-current-val')?.textContent).toBe('1.41 A');
      expect(layout.hudEl.querySelector('#hud-temp-val')?.textContent).toBe('32.5 °C');

      expect(layout.hudEl.querySelector('#hud-fps-val')?.textContent).toBe('60.0');
      expect(layout.hudEl.querySelector('#hud-preset-val')?.textContent).toBe('Breakout');
    });

    it('clicking a HUD metric spawns an on-demand 30s plot popover stripchart in stage', () => {
      const layout = buildSimLayout(root as any);
      const hud = new SimHudStrip(layout.hudEl as any, layout.stagePopoversEl as any);

      expect(layout.stagePopoversEl.children.length).toBe(0);

      // Click Thrust metric
      const thrustMetric = layout.hudEl.querySelector('[data-channel="thrust"]') as any;
      thrustMetric.click();

      // Popover stripchart added
      expect(layout.stagePopoversEl.children.length).toBe(1);
      const popover = layout.stagePopoversEl.querySelector('.stripchart-popover') as any;
      expect(popover).not.toBeNull();

      // Clicking close button removes the popover
      const closeBtn = popover.querySelector('.stripchart-close') as any;
      closeBtn.click();
      expect(layout.stagePopoversEl.children.length).toBe(0);
    });
  });

  describe('StageOverlays Component', () => {
    it('toggles cutaway view and manages right-edge overlay icon strip', () => {
      const layout = buildSimLayout(root as any);
      const onToggleCutaway = vi.fn();
      const onToggleOverlay = vi.fn();

      const overlays = new StageOverlays(
        layout.stageCornerToolsEl as any,
        layout.stageOverlayStripEl as any,
        layout.fluidCutawayEl as any,
        {
          onToggleCutaway,
          onToggleOverlay
        }
      );

      const cutawayBtn = layout.stageCornerToolsEl.querySelector('#btn-toggle-cutaway') as any;
      expect(cutawayBtn).not.toBeNull();
      cutawayBtn.click();
      expect(onToggleCutaway).toHaveBeenCalledWith(true);
      expect(layout.fluidCutawayEl.classList.contains('hidden')).toBe(false);

      const activeToggles = layout.stageOverlayStripEl.querySelectorAll('.active');
      expect(activeToggles.length).toBeLessThanOrEqual(2);

      const thermalBtn = layout.stageOverlayStripEl.querySelector('[data-key="thermal"]') as any;
      thermalBtn.click();
      expect(onToggleOverlay).toHaveBeenCalledWith('thermal', true);
      expect(overlays.state.thermal).toBe(true);
    });
  });
});
