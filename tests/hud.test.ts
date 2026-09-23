import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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

const windowListeners: Map<string, Function[]> = new Map();
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => new MockNode(tag),
    getElementById: (id: string) => null,
    addEventListener: (event: string, fn: Function) => {},
    body: new MockNode('body')
  };
  (globalThis as any).window = {
    addEventListener: (event: string, fn: Function) => {
      if (!windowListeners.has(event)) windowListeners.set(event, []);
      windowListeners.get(event)!.push(fn);
    },
    dispatchEvent: (evt: { type: string; key?: string }) => {
      const list = windowListeners.get(evt.type) || [];
      list.forEach(fn => fn(evt));
    }
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
  (globalThis as any).KeyboardEvent = class {
    constructor(public type: string, public init?: { key?: string }) {
      this.key = init?.key ?? '';
    }
    public key: string = '';
  };
}

import { SimHudStrip } from '../src/ui/hud';
import { buildSimLayout } from '../src/ui/layout';

describe('Prompt 3 — Section 21 HUD Tests', () => {
  it('strip contains exactly seven values at rest', () => {
    const root = new MockNode('div');
    const layout = buildSimLayout(root as any);
    const hud = new SimHudStrip(layout.hudEl as any, layout.stagePopoversEl as any);

    hud.update({
      thrust_N: 4.73,
      torque_Nm: 0.024,
      rpm: 4140,
      bus_V: 10.82,
      current_A: 1.41,
      temp_C: 32.5,
      fps: 60.0
    });

    const items = layout.hudEl.querySelectorAll('.hud-item');
    expect(items.length).toBe(7);
  });

  it('each value has the correct accent class applied', () => {
    const root = new MockNode('div');
    const layout = buildSimLayout(root as any);
    new SimHudStrip(layout.hudEl as any, layout.stagePopoversEl as any);

    const thrust = layout.hudEl.querySelector('[data-channel="thrust"]');
    const torque = layout.hudEl.querySelector('[data-channel="torque"]');
    const rpm = layout.hudEl.querySelector('[data-channel="rpm"]');
    const busV = layout.hudEl.querySelector('[data-channel="bus_v"]');
    const current = layout.hudEl.querySelector('[data-channel="current"]');
    const temp = layout.hudEl.querySelector('[data-channel="temp"]');
    const fps = layout.hudEl.querySelector('[data-channel="fps"]');

    expect(thrust?.classList.contains('hud-accent-thrust')).toBe(true);
    expect(torque?.classList.contains('hud-accent-torque')).toBe(true);
    expect(rpm?.classList.contains('hud-accent-neutral')).toBe(true);
    expect(busV?.classList.contains('hud-accent-neutral')).toBe(true);
    expect(current?.classList.contains('hud-accent-current')).toBe(true);
    expect(temp?.classList.contains('hud-accent-heat')).toBe(true);
    expect(fps?.classList.contains('hud-accent-neutral')).toBe(true);
  });

  it('clicking a value opens exactly one popover', () => {
    const root = new MockNode('div');
    const layout = buildSimLayout(root as any);
    new SimHudStrip(layout.hudEl as any, layout.stagePopoversEl as any);

    const thrust = layout.hudEl.querySelector('[data-channel="thrust"]') as any;
    expect(layout.stagePopoversEl.children.length).toBe(0);

    thrust.click();
    expect(layout.stagePopoversEl.children.length).toBe(1);
  });

  it('clicking a second value closes the first popover', () => {
    const root = new MockNode('div');
    const layout = buildSimLayout(root as any);
    new SimHudStrip(layout.hudEl as any, layout.stagePopoversEl as any);

    const thrust = layout.hudEl.querySelector('[data-channel="thrust"]') as any;
    const torque = layout.hudEl.querySelector('[data-channel="torque"]') as any;

    thrust.click();
    expect(layout.stagePopoversEl.children.length).toBe(1);

    torque.click();
    expect(layout.stagePopoversEl.children.length).toBe(1);
    const title = layout.stagePopoversEl.querySelector('.stripchart-title')?.textContent;
    expect(title).toContain('Torque');
  });

  it('Escape closes the popover', () => {
    const root = new MockNode('div');
    const layout = buildSimLayout(root as any);
    new SimHudStrip(layout.hudEl as any, layout.stagePopoversEl as any);

    const thrust = layout.hudEl.querySelector('[data-channel="thrust"]') as any;
    thrust.click();
    expect(layout.stagePopoversEl.children.length).toBe(1);

    (globalThis as any).window.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(layout.stagePopoversEl.children.length).toBe(0);
  });

  it('the strip does not render when viewport is below phone breakpoint in css', () => {
    const cssPath = resolve(__dirname, '../src/index.css');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)/);
    expect(css).toMatch(/\.sim-hud,\s*\n\s*\.hud-strip/);
    expect(css).toMatch(/display:\s*none\s*!important;/);
  });
});
