

import type { HudMetricsData } from '../types/telemetry';

export interface SimulationWorkerBridgeOptions {
  canvas: HTMLCanvasElement;
  onTelemetry?: (data: Partial<HudMetricsData>) => void;
  onStatus?: (status: { ready: boolean; backend: string }) => void;
}

export class SimulationWorkerBridge {
  public isWorkerActive = false;
  private worker: Worker | null = null;
  private canvas: HTMLCanvasElement;
  private onTelemetry?: (data: Partial<HudMetricsData>) => void;
  private onStatus?: (status: { ready: boolean; backend: string }) => void;

  constructor(options: SimulationWorkerBridgeOptions) {
    this.canvas = options.canvas;
    this.onTelemetry = options.onTelemetry;
    this.onStatus = options.onStatus;
  }

  public init(): boolean {
    const hasWorker = typeof window !== 'undefined' && typeof window.Worker !== 'undefined';
    const hasOffscreen = typeof this.canvas !== 'undefined' && typeof (this.canvas as any).transferControlToOffscreen === 'function';

    if (!hasWorker || !hasOffscreen) {
      console.log('[WorkerBridge] OffscreenCanvas or Worker not supported; running in-thread');
      this.isWorkerActive = false;
      return false;
    }

    try {
      const offscreen = this.canvas.transferControlToOffscreen();
      this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'telemetry') {
          this.onTelemetry?.(msg.data);
        } else if (msg.type === 'status') {
          this.onStatus?.(msg);
        }
      };

      const rect = this.canvas.getBoundingClientRect();
      const width = rect.width || 800;
      const height = rect.height || 600;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      this.worker.postMessage(
        {
          type: 'init',
          canvas: offscreen,
          width,
          height,
          dpr
        },
        [offscreen]
      );

      this.isWorkerActive = true;
      console.log('[WorkerBridge] Successfully transferred OffscreenCanvas to Web Worker');
      return true;
    } catch (err) {
      console.warn('[WorkerBridge] Failed to transfer canvas to Worker, falling back to in-thread:', err);
      this.isWorkerActive = false;
      return false;
    }
  }

  public sendInput(action: string, payload?: any): void {
    if (!this.isWorkerActive || !this.worker) return;
    this.worker.postMessage({ type: 'input', action, payload });
  }

  public sendResize(width: number, height: number, dpr: number): void {
    if (!this.isWorkerActive || !this.worker) return;
    this.worker.postMessage({ type: 'resize', width, height, dpr });
  }

  public sendVisibility(visible: boolean): void {
    if (!this.isWorkerActive || !this.worker) return;
    this.worker.postMessage({ type: 'visibility', visible });
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isWorkerActive = false;
  }
}
