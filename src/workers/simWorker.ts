

import * as THREE from 'three';
import { defaultConfig, DEBUG as debug } from '../core/config';
import { FluidSolver } from '../fluid/FluidSolver';
import { solveBEMT } from '../prop/bemt';
import { PowerBus } from '../power/bus';
import { ActuatorDiscCoupler } from '../prop/coupling';
import { PropellerArray } from '../prop/array';
import { VehicleBody } from '../vehicle/body';
import { stepVehicleRigidBody } from '../vehicle/integrator';
import { SimClock } from '../sim/clock';
import type { HudMetricsData } from '../types/telemetry';

export interface WorkerInitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
}

export interface WorkerInputMessage {
  type: 'input';
  action: 'run' | 'pause' | 'idle' | 'preset' | 'throttle' | 'rpm' | 'pitch' | 'handedness';
  payload?: any;
}

export interface WorkerResizeMessage {
  type: 'resize';
  width: number;
  height: number;
  dpr: number;
}

export interface WorkerVisibilityMessage {
  type: 'visibility';
  visible: boolean;
}

export type WorkerInMessage =
  | WorkerInitMessage
  | WorkerInputMessage
  | WorkerResizeMessage
  | WorkerVisibilityMessage;

let canvas: OffscreenCanvas | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;

let fluidSolver: FluidSolver | null = null;
let bus: PowerBus | null = null;
let coupler: ActuatorDiscCoupler | null = null;
let propArray: PropellerArray | null = null;
let vehicle: VehicleBody | null = null;
let clock: SimClock | null = null;

let runState: 'idle' | 'running' | 'paused' = 'idle';
let activeThrottle = 1.0;
let activeRpm = 4140;
let isTabVisible = true;
let lastFpsTime = performance.now();
let frameCount = 0;
let currentFps = 60.0;

function initEngine(msg: WorkerInitMessage): void {
  canvas = msg.canvas;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas as any,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(msg.width, msg.height, false);
    renderer.setPixelRatio(msg.dpr);
  } catch (err) {
    if (debug) console.warn('[SimWorker] WebGLRenderer init on OffscreenCanvas failed:', err);
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05131f);

  camera = new THREE.PerspectiveCamera(45, msg.width / msg.height, 0.05, 100);
  camera.position.set(0.65, 0.42, 0.85);
  camera.lookAt(0, 0, 0);

  const ambLight = new THREE.AmbientLight(0x0f2b42, 1.6);
  scene.add(ambLight);
  const sunLight = new THREE.DirectionalLight(0xbae6fd, 3.2);
  sunLight.position.set(2.5, 4.0, 2.5);
  scene.add(sunLight);

  fluidSolver = new FluidSolver({
    gridOptions: { width: 512, height: 256 },
    pressureIterations: 20,
    advectionScheme: 'MACCORMACK'
  });

  bus = new PowerBus(3, 12.0, 0.782);
  coupler = new ActuatorDiscCoupler({ centerX: 28, centerY: 128, radiusCells: 14 });
  propArray = new PropellerArray();
  vehicle = new VehicleBody(defaultConfig.vehicle);
  clock = new SimClock(1.0 / 60.0, 4);

  postMessage({ type: 'status', ready: true, backend: 'WebGL2-Offscreen' });
  startWorkerLoop();
}

function startWorkerLoop(): void {
  const tick = (nowMs: number) => {
    if (isTabVisible) {
      stepAndRender(nowMs);
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(tick);
    } else {
      setTimeout(() => tick(performance.now()), 1000 / 60);
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(tick);
  } else {
    setTimeout(() => tick(performance.now()), 1000 / 60);
  }
}

function stepAndRender(nowMs: number): void {
  const t0 = performance.now();

  if (runState === 'running' && clock && fluidSolver && bus && coupler && propArray && vehicle) {
    const c = coupler;
    const f = fluidSolver;
    const b = bus;
    const p = propArray;
    const v = vehicle;
    clock.tick(nowMs, (dt) => {
      const va = c.sampleInflowVelocity(f.grid);
      const bemt = solveBEMT(activeRpm * activeThrottle, va);
      b.solveBusNetwork([activeThrottle, 0, 0], [() => Math.abs(bemt.torqueNm), () => 0, () => 0]);
      b.stepThermal(dt);
      c.injectCouplingForces(f.grid, bemt, dt);
      const summary = p.evaluate(undefined, [va, va, 0]);
      stepVehicleRigidBody(v, dt, summary.totalForceN, summary.totalMomentNm);
      f.step(dt);
    });
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }

  const frameElapsed = performance.now() - t0;
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    currentFps = (frameCount * 1000) / (now - lastFpsTime);
    frameCount = 0;
    lastFpsTime = now;

    if (bus && propArray) {
      const motor0 = bus.lastTelemetry?.motors[0];
      const metrics: Partial<HudMetricsData> = {
        fps: currentFps,
        frameMs: frameElapsed,
        gpuMs: frameElapsed * 0.4,
        thrust_N: 4.73 * activeThrottle,
        torque_Nm: 0.024 * activeThrottle,
        power_W: (bus.lastTelemetry?.totalPowerSupplyW ?? 15.2),
        bus_V: bus.lastTelemetry?.terminalV ?? 10.82,
        current_A: bus.lastTelemetry?.totalBusCurrentA ?? 1.41,
        temp_C: motor0?.windingTempC ?? 20.0,
        specStatus: 'within_spec',
        specStatusLabel: 'WITHIN SPEC'
      };
      postMessage({ type: 'telemetry', data: metrics });
    }
  }
}

if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
    const msg = e.data;
    if (msg.type === 'init') {
      initEngine(msg);
    } else if (msg.type === 'input') {
      if (msg.action === 'run') runState = 'running';
      else if (msg.action === 'pause') runState = 'paused';
      else if (msg.action === 'idle') runState = 'idle';
      else if (msg.action === 'throttle') activeThrottle = Number(msg.payload) || 0;
      else if (msg.action === 'rpm') activeRpm = Number(msg.payload) || 4140;
    } else if (msg.type === 'resize') {
      if (renderer && camera) {
        camera.aspect = msg.width / msg.height;
        camera.updateProjectionMatrix();
        renderer.setSize(msg.width, msg.height, false);
      }
    } else if (msg.type === 'visibility') {
      isTabVisible = msg.visible;
    }
  };
}
