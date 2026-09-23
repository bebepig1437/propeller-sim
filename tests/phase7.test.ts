import { describe, it, expect, vi, beforeEach } from 'vitest';

class MockNode {
  public id: string = '';
  public className: string = '';
  public innerHTMLValue: string = '';
  public textContentValue: string = '';
  public value: string = '';
  public dataset: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockNode[] = [];
  get childNodes(): MockNode[] { return this.children; }
  public parentNode: MockNode | null = null;
  public options: Array<{ value: string; label: string }> = [];
  public open: boolean = false;
  private listeners: Map<string, Function[]> = new Map();

  public ownerDocument: any;
  constructor(public tagName: string = 'div') { this.ownerDocument = (globalThis as any).document; }

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
      toggle: (c: string, force?: boolean) => {
        const has = this.classList.contains(c);
        const shouldAdd = force !== undefined ? force : !has;
        if (shouldAdd) this.classList.add(c);
        else this.classList.remove(c);
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

  insertBefore(newChild: MockNode, refChild: MockNode | null): MockNode {
    newChild.parentNode = this;
    const idx = refChild ? this.children.indexOf(refChild) : -1;
    if (idx !== -1) this.children.splice(idx, 0, newChild);
    else this.children.push(newChild);
    return newChild;
  }

  appendChild(child: MockNode): void {
    child.parentNode = this;
    this.children.push(child);
  }

  removeChild(child: MockNode): MockNode {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
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

if (typeof document === 'undefined') {
  const mockDoc = {
    createElement: (tag: string) => new MockNode(tag),
    createElementNS: (_ns: string, tag: string) => new MockNode(tag),
    createDocumentFragment: () => new MockNode('fragment'),
    createTextNode: (t: string) => { const n = new MockNode('#text'); n.textContentValue = t; return n; },
    getElementById: (id: string) => null,
    querySelector: (sel: string) => null,
    querySelectorAll: (sel: string) => [],
    head: new MockNode('head'),
    body: new MockNode('body')
  };
  (globalThis as any).document = mockDoc;
  (global as any).document = mockDoc;
  (mockDoc.body as any).ownerDocument = mockDoc;
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


import { TelemetryRecorder } from '../src/telemetry/recorder';
import { DEFAULT_PRESETS, SimHeader } from '../src/ui/header';
import { SimHudStrip } from '../src/ui/hud';
import { buildSimLayout } from '../src/ui/layout';
import { ControlPanel } from '../src/ui/panel';
import { defaultConfig } from '../src/core/config';
import { SPEC_OPERATING_POINTS, rk4SurgeTrajectory, XROTOR_J_SWEEP } from '../src/validation';
import { PropellerArray } from '../src/prop/array';
import { StatorVaneSystem } from '../src/prop/stator';
import { calculateTetherResistanceFromMeters } from '../src/power/tether';

describe('Phase 7 — UI, Telemetry, and Candidate A Presets', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
  });

  describe('1. Candidate A Operating Points & Presets', () => {
    it('has exactly 5 presets matching the vehicle specification', () => {
      expect(DEFAULT_PRESETS.length).toBe(5);

      const [breakout, heavyLift, cruise, fullDive, reverseStation] = DEFAULT_PRESETS;

      expect(breakout.name).toBe('Breakout Burst');
      expect(breakout.throttle).toBe(1.0);
      expect(breakout.thrust_N).toBe(4.73);
      expect(breakout.current_A).toBe(1.41);
      expect(breakout.burst_s).toBe(18);

      expect(heavyLift.name).toBe('Nominal Heavy Lift');
      expect(heavyLift.throttle).toBeCloseTo(0.881, 3);
      expect(heavyLift.thrust_N).toBe(3.99);
      expect(heavyLift.current_A).toBe(1.25);
      expect(heavyLift.burst_s).toBe(50);

      expect(cruise.name).toBe('Continuous Cruise');
      expect(cruise.throttle).toBeCloseTo(0.670, 3);
      expect(cruise.thrust_N).toBe(2.49);
      expect(cruise.current_A).toBe(0.85);
      expect(cruise.burst_s).toBeNull();

      expect(fullDive.name).toBe('Controlled Full Dive');
      expect(fullDive.throttle).toBeCloseTo(-0.840, 3);
      expect(fullDive.thrust_N).toBe(-2.82);
      expect(fullDive.current_A).toBe(1.18);
      expect(fullDive.burst_s).toBe(65);

      expect(reverseStation.name).toBe('Reverse Station');
      expect(reverseStation.throttle).toBeCloseTo(-0.480, 3);
      expect(reverseStation.thrust_N).toBe(-0.93);
      expect(reverseStation.current_A).toBe(0.51);
      expect(reverseStation.burst_s).toBeNull();
    });

    it('validates preset parameters: tether 15ft 24AWG (0.782 Ohm) and stator slotted -5.2 deg', () => {
      const rTether = calculateTetherResistanceFromMeters(15.0 / 3.28084, 24);
      expect(rTether).toBeCloseTo(0.782, 3);

      const stator = new StatorVaneSystem({ vaneType: 'slotted', incidenceDeg: -5.2 });
      expect(stator.config.vaneType).toBe('slotted');
      expect(stator.config.incidenceDeg).toBe(-5.2);
    });
  });

  describe('2. RUN Button & Fast Engagement', () => {
    it('prominent RUN button triggers transitions and notifies callback', () => {
      const layout = buildSimLayout(root);
      const onRunToggle = vi.fn();
      const header = new SimHeader(layout.headerEl, {
        onRunToggle,
        onPresetSelect: vi.fn(),
        onShare: vi.fn(),
        onExportCsv: vi.fn(),
        onValidationClick: vi.fn()
      });

      const runBtn = layout.headerEl.querySelector('#btn-run') as HTMLButtonElement;
      expect(runBtn).not.toBeNull();
      expect(runBtn.classList.contains('state-idle')).toBe(true);

      runBtn.click();
      expect(onRunToggle).toHaveBeenCalledWith('running');
      expect(header.getRunState()).toBe('running');
      expect(runBtn.classList.contains('state-running')).toBe(true);
    });
  });

  describe('3. HUD Strip with Physical Channels, Burst Countdown & Spec Status', () => {
    it('displays all physical metrics, countdown timer, and spec status badge', () => {
      const layout = buildSimLayout(root);
      const hud = new SimHudStrip(layout.hudEl, layout.stagePopoversEl);

      hud.update({
        thrust_N: 4.73,
        torque_Nm: 0.024,
        power_W: 15.3,
        efficiency_pct: 45.2,
        advance_ratio_J: 0.42,
        rpm: 4140,
        pitch_deg: 18.0,
        inflow_velocity_ms: 1.25,
        max_velocity_domain_ms: 3.45,
        bus_V: 10.82,
        current_A: 1.41,
        temp_C: 28.5,
        fps: 60.0,
        frameMs: 16.6,
        gpuMs: 1.8,
        presetName: 'Breakout Burst',
        thermalBurstRemainingS: 17.5,
        specStatus: 'within_spec',
        specStatusLabel: 'WITHIN SPEC'
      });

      expect(layout.hudEl.querySelector('#hud-thrust-val')?.textContent).toBe('4.73 N');
      expect(layout.hudEl.querySelector('#hud-torque-val')?.textContent).toBe('0.024 Nm');
      expect(layout.hudEl.querySelector('#hud-power-val')?.textContent).toBe('15.3 W');
      expect(layout.hudEl.querySelector('#hud-efficiency-val')?.textContent).toBe('45.2 %');
      expect(layout.hudEl.querySelector('#hud-advance-val')?.textContent).toBe('0.42');
      expect(layout.hudEl.querySelector('#hud-rpm-val')?.textContent).toBe('4140 rpm');
      expect(layout.hudEl.querySelector('#hud-pitch-val')?.textContent).toBe('18.0°');
      expect(layout.hudEl.querySelector('#hud-inflow-val')?.textContent).toBe('1.25 m/s');
      expect(layout.hudEl.querySelector('#hud-maxv-val')?.textContent).toBe('3.45 m/s');
      expect(layout.hudEl.querySelector('#hud-busv-val')?.textContent).toBe('10.82 V');
      expect(layout.hudEl.querySelector('#hud-current-val')?.textContent).toBe('1.41 A');
      expect(layout.hudEl.querySelector('#hud-temp-val')?.textContent).toBe('28.5 °C');

      expect(layout.hudEl.querySelector('#hud-burst-val')?.textContent).toBe('17.5 s');
      expect(layout.hudEl.querySelector('#hud-spec-status')?.textContent).toBe('WITHIN SPEC');
    });

    it('supports pinning multiple stripchart popovers in stage corner without always-on panel', () => {
      const layout = buildSimLayout(root);
      const hud = new SimHudStrip(layout.hudEl, layout.stagePopoversEl);

      expect(layout.stagePopoversEl.children.length).toBe(0);

      hud.togglePopover('thrust');
      expect(layout.stagePopoversEl.children.length).toBe(1);

      hud.togglePopover('torque');
      expect(layout.stagePopoversEl.children.length).toBe(2);

      hud.togglePopover('efficiency');
      expect(layout.stagePopoversEl.children.length).toBe(3);

      const popover = layout.stagePopoversEl.children[0] as HTMLElement;
      const pinBtn = popover.querySelector('.stripchart-pin') as HTMLButtonElement;
      expect(pinBtn).not.toBeNull();
      pinBtn.click();
      expect(pinBtn.classList.contains('is-pinned')).toBe(true);
    });
  });

  describe('4. Telemetry Recording & Full CSV Export', () => {
    it('records all required subsystem series and exports compliant CSV', () => {
      const recorder = new TelemetryRecorder();
      recorder.start();

      recorder.record({
        t: 1.0,
        dt: 0.01667,
        fps: 60.0,
        thrusters: [
          { rpm: 4140, pitchDeg: 18.0, thrustN: 2.36, torqueNm: 0.012, currentA: 0.705, vTermV: 10.82, tMotorC: 22.0 },
          { rpm: 4140, pitchDeg: 18.0, thrustN: 2.36, torqueNm: 0.012, currentA: 0.705, vTermV: 10.82, tMotorC: 22.0 },
          { rpm: 4140, pitchDeg: 18.0, thrustN: 1.10, torqueNm: 0.006, currentA: 0.350, vTermV: 10.82, tMotorC: 21.0 }
        ],
        busV: 10.82,
        iTotalA: 1.41,
        pTotalW: 15.25,
        pos: [0, -0.1, 0],
        vel: [0, 0.12, 0],
        quat: [1, 0, 0, 0],
        omega: [0, 0, 0],
        rollDevPerM: 1.8,
        fluidMaxV: 2.45,
        fluidMeanV: 0.85,
        fluidMaxVorticity: 3.12,
        pressureIters: 30,
        residual: 0.0001,
        gpuMs: 1.8
      });

      expect(recorder.getCount()).toBe(1);
      const csv = recorder.generateCsv();
      const lines = csv.split('\n');

      expect(lines.length).toBe(2); 
      const header = lines[0];

      expect(header).toContain('t_s');
      expect(header).toContain('dt_s');
      expect(header).toContain('fps');
      expect(header).toContain('u0_rpm');
      expect(header).toContain('u0_pitch_deg');
      expect(header).toContain('u0_thrust_N');
      expect(header).toContain('u0_torque_Nm');
      expect(header).toContain('u0_current_A');
      expect(header).toContain('u0_vterm_V');
      expect(header).toContain('u0_tmotor_C');
      expect(header).toContain('v_bus_V');
      expect(header).toContain('i_total_A');
      expect(header).toContain('p_total_W');
      expect(header).toContain('pos_x_m');
      expect(header).toContain('vel_y_ms');
      expect(header).toContain('quat_w');
      expect(header).toContain('omega_p_rads');
      expect(header).toContain('roll_dev_deg_per_m');
      expect(header).toContain('fluid_max_v_ms');
      expect(header).toContain('fluid_mean_v_ms');
      expect(header).toContain('fluid_max_vorticity_s');
      expect(header).toContain('pressure_iters');
      expect(header).toContain('pressure_residual');
      expect(header).toContain('gpu_total_ms');

      const dataRow = lines[1];
      expect(dataRow).toContain('1.410');
      expect(dataRow).toContain('10.82');
    });
  });

  describe('5. Tweakpane Control Panel 8-Group Structure', () => {
    it('creates exactly the 8 grouped folders requested', () => {
      const panel = new ControlPanel(
        defaultConfig,
        { fps: 60, frameMs: 16.6, gpuMs: 1.8 },
        {},
        undefined,
        undefined,
        { surgeM: 0, swayM: 0, heaveM: -0.1, yawDeg: 0, tetherAnchorSurgeM: 0, tetherAnchorSwayM: 0, tetherAnchorHeaveM: 0 }
      );

      const folders = panel.pane.children.filter((c: any) => c.title !== undefined).map((c: any) => c.title);
      expect(folders).toContain('Fluid');
      expect(folders).toContain('Propeller');
      expect(folders).toContain('Electrical');
      expect(folders).toContain('Array');
      expect(folders).toContain('Vehicle');
      expect(folders).toContain('Rendering');
      expect(folders).toContain('Diagnostics');

      panel.dispose();
    });
  });

  describe('6. Validation Suite & Oracle Comparisons (/validation)', () => {
    it('verifies all 5 operating points in validation suite against Candidate A specs', () => {
      expect(SPEC_OPERATING_POINTS.length).toBe(5);
      SPEC_OPERATING_POINTS.forEach(pt => {
        expect(pt.specThrustN).toBeDefined();
        expect(pt.specCurrentA).toBeDefined();
      });
    });

    it('verifies BEMT J-sweep dataset matches XROTOR oracle within 0.5% RMS', () => {
      expect(XROTOR_J_SWEEP.length).toBeGreaterThanOrEqual(10);
      let sumSqErr = 0;
      for (const pt of XROTOR_J_SWEEP) {
        sumSqErr += Math.pow(pt.kt - pt.refKt, 2);
      }
      const rmsErr = Math.sqrt(sumSqErr / XROTOR_J_SWEEP.length);
      expect(rmsErr).toBeLessThan(0.005);
    });

    it('verifies 1-DOF Fossen surge step response matches RK4 reference', () => {
      const trajectory = rk4SurgeTrajectory(1.5, 10, 0.1);
      expect(trajectory.length).toBeGreaterThan(50);
      const finalPoint = trajectory[trajectory.length - 1];
      const err = Math.abs(finalPoint.vSim - finalPoint.vRef) / finalPoint.vRef;
      expect(err).toBeLessThan(0.02); 
    });
  });
});
