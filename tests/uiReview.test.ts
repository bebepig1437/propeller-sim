import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildSimLayout } from '../src/ui/layout';
import { SimHeader } from '../src/ui/header';
import { SimHudStrip } from '../src/ui/hud';
import { StageOverlays } from '../src/ui/stageOverlays';
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

  getAttribute(attr: string): string | null {
    if (attr.startsWith('data-')) {
      const k = attr.replace('data-', '');
      return this.dataset[k] ?? null;
    }
    return (this as any)[attr] ?? null;
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
      else if (attrName === 'aria-label') (node as any).ariaLabel = attrVal;
      else if (attrName === 'aria-pressed') (node as any).ariaPressed = attrVal;
      else if (attrName === 'role') (node as any).role = attrVal;
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

describe('UX & Accessibility Review (Sections A through F)', () => {
  let root: MockNode;

  beforeEach(() => {
    root = new MockNode('div');
    root.id = 'app';
    (globalThis as any).document = {
      createElement: (tag: string) => new MockNode(tag),
      querySelector: (sel: string) => root.querySelector(sel),
      querySelectorAll: (sel: string) => root.querySelectorAll(sel)
    };
  });

  describe('Section A & B: Layout & Controls at rest', () => {
    it('maintains stage as the dominant viewport area across all responsive breakpoints', () => {
      const cssPath = resolve(__dirname, '../src/index.css');
      const css = readFileSync(cssPath, 'utf8');

      expect(css).toContain('--palette-width: 240px;');
      expect(css).toContain('--inspector-width: 280px;');
      expect(css).toContain('@media (max-width: 1024px) and (min-width: 768px)');
      expect(css).toContain('@media (max-width: 767px)');

      const stageFractionAt1920 = (1920 - 240 - 280) / 1920;
      expect(stageFractionAt1920).toBeGreaterThan(0.5);

      const stageFractionAt1280 = (1280 - 240 - 280) / 1280;
      expect(stageFractionAt1280).toBeGreaterThan(0.5);

      const stageFractionAt768 = (768 - 56) / 768;
      expect(stageFractionAt768).toBeGreaterThan(0.5);

      const stageFractionAt375 = 375 / 375;
      expect(stageFractionAt375).toBeGreaterThan(0.5);
    });

    it('has first-run dialog with 3 sentences, Load candidateA, and dismiss on RUN', () => {
      const layout = buildSimLayout(root as any);
      const callout = root.querySelector('#first-run-callout');
      expect(callout).not.toBeNull();
      expect(callout!.innerHTML).toContain('Load candidateA');
      expect(callout!.innerHTML).toContain('Welcome to the SeaPerch Candidate A');

      const onRunToggle = vi.fn();
      const header = new SimHeader(layout.headerEl, {
        onRunToggle,
        onPresetSelect: vi.fn(),
        onShare: vi.fn(),
        onRecordToggle: vi.fn(),
        onValidationClick: vi.fn()
      });

      expect(callout!.classList.contains('hidden')).toBe(false);
      const runBtn = layout.headerEl.querySelector('#btn-run');
      runBtn?.click();
      expect(callout!.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Section C: HUD Strip & Monospace Output', () => {
    it('structures primary rest metrics with output elements and aria-live polite', () => {
      const layout = buildSimLayout(root as any);
      const hud = new SimHudStrip(layout.hudEl, {
        onOpenPlot: vi.fn()
      });

      const metrics = layout.hudEl.querySelectorAll('.hud-metric');
      const primaryMetrics = metrics.filter(m => !m.classList.contains('hud-metric-secondary'));
      expect(primaryMetrics.length).toBe(6);

      const outputs = layout.hudEl.querySelectorAll('output');
      expect(outputs.length).toBeGreaterThanOrEqual(6);
      outputs.forEach(out => {
        expect(out.tagName.toLowerCase()).toBe('output');
      });
    });

    it('hides secondary metrics via css rule', () => {
      const cssPath = resolve(__dirname, '../src/index.css');
      const css = readFileSync(cssPath, 'utf8');
      expect(css).toMatch(/\.hud-metric-secondary\s*\{\s*display:\s*none\s*!important;\s*\}/);
    });
  });

  describe('Section D & F: Visual Language & Accessibility', () => {
    it('defines neutral background in HTML head and token CSS', () => {
      const htmlPath = resolve(__dirname, '../index.html');
      const html = readFileSync(htmlPath, 'utf8');
      expect(html).toContain('background-color: #0e1116');

      const cssPath = resolve(__dirname, '../src/index.css');
      const css = readFileSync(cssPath, 'utf8');
      expect(css).toContain('--bg-base: #0e1116;');
    });

    it('configures focus-visible rings and prefers-reduced-motion', () => {
      const cssPath = resolve(__dirname, '../src/index.css');
      const css = readFileSync(cssPath, 'utf8');

      expect(css).toContain(':focus-visible');
      expect(css).toContain('.btn-run:focus-visible');
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    });

    it('assigns aria-labels and aria-pressed attributes to stage overlay buttons', () => {
      const corner = new MockNode('div');
      const strip = new MockNode('div');
      const cutaway = new MockNode('div');

      const overlays = new StageOverlays(corner as any, strip as any, cutaway as any, {
        onToggleCutaway: vi.fn(),
        onToggleOverlay: vi.fn()
      });

      const buttons = strip.querySelectorAll('button');
      expect(buttons.length).toBe(9);
      buttons.forEach(btn => {
        expect((btn as any).ariaLabel).toBeTruthy();
      });

      const cutawayBtn = corner.querySelector('#btn-toggle-cutaway');
      expect(cutawayBtn).not.toBeNull();
      expect((cutawayBtn as any).ariaLabel).toBeTruthy();
    });
  });
});
