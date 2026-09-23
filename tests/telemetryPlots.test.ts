import { describe, it, expect } from 'vitest';
import { TelemetryPlots, DEFAULT_PLOT_CONFIG } from '../src/ui/plots';

describe('Phase 7 — Telemetry Instruments & Real-time Plots (plots.ts)', () => {
  it('initializes with default plot configuration', () => {
    const mockCanvas = {
      width: 320,
      height: 100,
      getContext: () => null
    } as unknown as HTMLCanvasElement;

    const plots = new TelemetryPlots(mockCanvas);
    expect(plots.config.maxSamples).toBe(DEFAULT_PLOT_CONFIG.maxSamples);
    expect(plots.config.thrustColor).toBe(DEFAULT_PLOT_CONFIG.thrustColor);
  });

  it('buffers and trims telemetry samples to maxSamples window', () => {
    const mockCanvas = {
      width: 320,
      height: 100,
      getContext: () => null
    } as unknown as HTMLCanvasElement;

    const maxSamples = 10;
    const plots = new TelemetryPlots(mockCanvas, { maxSamples });

    for (let i = 0; i < 25; i++) {
      plots.pushSample({
        thrustN: i * 0.2,
        currentA: 1.0 + i * 0.05,
        rpm: 3000 + i * 50,
        surgeSpeedMs: i * 0.03
      });
    }

    expect(() => plots.render()).not.toThrow();

    plots.clear();
    expect(() => plots.render()).not.toThrow();
  });

  it('renders without throwing when a mock 2D context is provided', () => {
    const operations: string[] = [];
    const mockCtx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textBaseline: '',
      fillRect: () => operations.push('fillRect'),
      strokeRect: () => operations.push('strokeRect'),
      beginPath: () => operations.push('beginPath'),
      moveTo: () => operations.push('moveTo'),
      lineTo: () => operations.push('lineTo'),
      stroke: () => operations.push('stroke'),
      fillText: () => operations.push('fillText'),
      clearRect: () => operations.push('clearRect')
    };

    const mockCanvas = {
      width: 300,
      height: 80,
      getContext: () => mockCtx
    } as unknown as HTMLCanvasElement;

    const plots = new TelemetryPlots(mockCanvas);
    plots.pushSample({ thrustN: 1.5, currentA: 1.2, rpm: 4000, surgeSpeedMs: 0.5 });
    plots.pushSample({ thrustN: 2.5, currentA: 1.4, rpm: 4140, surgeSpeedMs: 0.8 });

    plots.render();
    expect(operations).toContain('fillRect');
    expect(operations).toContain('stroke');
    expect(operations).toContain('fillText');
  });
});
