/**
 * Phase 8 — SimulationWorkerBridge fallback contract
 *
 * `SimulationWorkerBridge.init()` is the single gate between "run the sim on a
 * worker via OffscreenCanvas" and "run it in-thread on the main thread". Before
 * this suite the module had no callers and no coverage, so its failure mode —
 * the one every non-OffscreenCanvas browser takes — was the least-tested surface
 * of Phase 8.
 *
 * These tests pin the contract:
 *   - no OffscreenCanvas transfer support      -> false, no Worker constructed
 *   - no Worker constructor                    -> false, no throw
 *   - transferControlToOffscreen() throws      -> false, no throw, no leak
 *   - success                                  -> true, one init message with
 *                                                 the offscreen canvas transferred
 *   - telemetry/status routing                 -> forwarded to the callbacks
 *   - sendInput/sendResize/sendVisibility      -> silent no-ops while inactive
 *   - dispose()                                -> terminates and clears the flag
 *
 * The unit project runs in a Node environment, so every browser global the
 * bridge touches is stubbed explicitly (matching the MockElement pattern used
 * elsewhere in this suite).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SimulationWorkerBridge } from '../src/workers/workerBridge';

interface PostedMessage {
  message: any;
  transfer?: any[];
}

class FakeWorker {
  public static instances: FakeWorker[] = [];
  public posted: PostedMessage[] = [];
  public terminated = false;
  public onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(public url: any, public options?: any) {
    FakeWorker.instances.push(this);
  }

  public postMessage(message: any, transfer?: any[]): void {
    this.posted.push({ message, transfer });
  }

  public terminate(): void {
    this.terminated = true;
  }

  public static reset(): void {
    FakeWorker.instances = [];
  }
}

/** Install the minimal browser globals the bridge feature-detects. */
function installFakeWindow(options: { worker?: unknown; devicePixelRatio?: number; withWindow?: boolean } = {}): () => void {
  const g = globalThis as any;
  const hadWindow = 'window' in g;
  const prevWindow = g.window;
  const hadWorkerRef = 'Worker' in g;
  const prevWorkerRef = g.Worker;
  const { worker, devicePixelRatio = 2, withWindow = true } = options;

  if (withWindow) {
    g.window = {
      Worker: worker,
      devicePixelRatio,
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  } else {
    delete g.window;
  }
  if (worker) g.Worker = worker;

  return () => {
    if (hadWindow) g.window = prevWindow; else delete g.window;
    if (hadWorkerRef) g.Worker = prevWorkerRef; else delete g.Worker;
  };
}

function makeCanvas(transfer?: unknown): { canvas: HTMLCanvasElement; rectCalled: () => boolean } {
  let called = false;
  const canvas: any = {
    getBoundingClientRect: () => {
      called = true;
      return { width: 1920, height: 1080 };
    }
  };
  if (transfer !== undefined) canvas.transferControlToOffscreen = transfer as () => unknown;
  return { canvas: canvas as HTMLCanvasElement, rectCalled: () => called };
}

const OFFSET = { type: 'OffscreenCanvasStub' };

describe('Phase 8 — SimulationWorkerBridge fallback contract', () => {
  let restoreGlobals: (() => void) | undefined;

  beforeEach(() => {
    FakeWorker.reset();
  });

  afterEach(() => {
    restoreGlobals?.();
    restoreGlobals = undefined;
  });

  it('runs in-thread when there is no window at all', () => {
    restoreGlobals = installFakeWindow({ withWindow: false });
    const { canvas } = makeCanvas();
    const bridge = new SimulationWorkerBridge({ canvas });

    expect(bridge.init()).toBe(false);
    expect(bridge.isWorkerActive).toBe(false);
    expect(FakeWorker.instances.length).toBe(0);
  });

  it('runs in-thread when Worker is unavailable', () => {
    restoreGlobals = installFakeWindow({ worker: undefined, withWindow: true });
    const { canvas } = makeCanvas(() => OFFSET);
    const bridge = new SimulationWorkerBridge({ canvas });

    expect(bridge.init()).toBe(false);
    expect(bridge.isWorkerActive).toBe(false);
    expect(FakeWorker.instances.length).toBe(0);
  });

  it('runs in-thread when the canvas cannot transfer control to an OffscreenCanvas', () => {
    restoreGlobals = installFakeWindow({ worker: FakeWorker });
    const { canvas } = makeCanvas(undefined); // no transferControlToOffscreen
    const bridge = new SimulationWorkerBridge({ canvas });

    expect(bridge.init()).toBe(false);
    expect(bridge.isWorkerActive).toBe(false);
    expect(FakeWorker.instances.length).toBe(0);
  });

  it('runs in-thread and does not leak a Worker when transferControlToOffscreen throws', () => {
    restoreGlobals = installFakeWindow({ worker: FakeWorker });
    const { canvas } = makeCanvas(() => {
      throw new Error('OffscreenCanvas transfer rejected by the browser');
    });
    const bridge = new SimulationWorkerBridge({ canvas });

    expect(() => bridge.init()).not.toThrow();
    expect(bridge.init()).toBe(false);
    expect(bridge.isWorkerActive).toBe(false);
    expect(FakeWorker.instances.length).toBe(0);
  });

  it('transfers the canvas and posts a single init message on the success path', () => {
    restoreGlobals = installFakeWindow({ worker: FakeWorker, devicePixelRatio: 3 });
    const { canvas } = makeCanvas(() => OFFSET);
    const bridge = new SimulationWorkerBridge({ canvas });

    expect(bridge.init()).toBe(true);
    expect(bridge.isWorkerActive).toBe(true);
    expect(FakeWorker.instances.length).toBe(1);

    const worker = FakeWorker.instances[0];
    expect(worker.posted.length).toBe(1);

    const { message, transfer } = worker.posted[0];
    expect(message.type).toBe('init');
    expect(message.canvas).toBe(OFFSET);
    expect(message.width).toBe(1920);
    expect(message.height).toBe(1080);
    // devicePixelRatio is clamped to 2 to protect the frame budget.
    expect(message.dpr).toBe(2);
    // The OffscreenCanvas must move to the worker, not be copied.
    expect(transfer).toEqual([OFFSET]);
  });

  it('forwards telemetry and status messages to the callbacks', () => {
    restoreGlobals = installFakeWindow({ worker: FakeWorker });
    const { canvas } = makeCanvas(() => OFFSET);

    let telemetry: any = null;
    let status: any = null;
    const bridge = new SimulationWorkerBridge({
      canvas,
      onTelemetry: (data) => { telemetry = data; },
      onStatus: (s) => { status = s; }
    });
    bridge.init();

    const worker = FakeWorker.instances[0];
    worker.onmessage?.({ data: { type: 'telemetry', data: { fps: 59.4 } } } as MessageEvent);
    worker.onmessage?.({ data: { type: 'status', ready: true, backend: 'WebGL2-Offscreen' } } as MessageEvent);

    expect(telemetry).toEqual({ fps: 59.4 });
    expect(status).toEqual({ type: 'status', ready: true, backend: 'WebGL2-Offscreen' });
  });

  it('is a silent no-op for sendInput/sendResize/sendVisibility while inactive, and posts when active', () => {
    restoreGlobals = installFakeWindow({ worker: FakeWorker });
    const { canvas } = makeCanvas(() => OFFSET);
    const bridge = new SimulationWorkerBridge({ canvas });

    // Inactive: nothing posted, nothing thrown.
    expect(() => {
      bridge.sendInput('throttle', 0.5);
      bridge.sendResize(640, 480, 1);
      bridge.sendVisibility(false);
    }).not.toThrow();

    bridge.init();
    const worker = FakeWorker.instances[0];
    bridge.sendInput('throttle', 0.5);
    bridge.sendResize(640, 480, 1);
    bridge.sendVisibility(false);

    expect(worker.posted.map((p) => p.message.type)).toEqual(['init', 'input', 'resize', 'visibility']);
  });

  it('dispose() terminates the worker and clears the active flag', () => {
    restoreGlobals = installFakeWindow({ worker: FakeWorker });
    const { canvas } = makeCanvas(() => OFFSET);
    const bridge = new SimulationWorkerBridge({ canvas });
    bridge.init();

    const worker = FakeWorker.instances[0];
    bridge.dispose();

    expect(worker.terminated).toBe(true);
    expect(bridge.isWorkerActive).toBe(false);

    // Post-dispose sends must not reach the dead worker.
    const before = worker.posted.length;
    bridge.sendInput('run');
    expect(worker.posted.length).toBe(before);
  });
});
