import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gridToWorld, bodyPointToWorld as mapBodyPointToWorld, bodyDirToWorld as mapBodyDirToWorld } from './frameMap';
import type { VehiclePropulsionSummary } from '../prop/array';
import type { VehicleBody } from '../vehicle/body';
import type { FluidGrid } from '../fluid/grid';

export interface OverlayState {
  velocityVectors: boolean;
  streamlines: boolean;
  pressureHeatmap: boolean;
  vorticity: boolean;
  particles: boolean;
  thrustArrows: boolean;
  torqueArrows: boolean;
  thermal: boolean;
  currentFlow: boolean;
}

export const DEFAULT_OVERLAY_STATE: OverlayState = {
  velocityVectors: true,   // default-on #1
  thrustArrows: true,      // default-on #2
  streamlines: false,
  pressureHeatmap: false,
  vorticity: false,
  particles: false,
  torqueArrows: false,
  thermal: false,
  currentFlow: false
};

export const OVERLAY_KEYS = [
  'velocityVectors',
  'streamlines',
  'pressureHeatmap',
  'vorticity',
  'particles',
  'thrustArrows',
  'torqueArrows',
  'thermal',
  'currentFlow'
] as const;

/** Tunables exposed to Tweakpane. */
export interface OverlayTunables {
  vectorStride: number;      // grid cells between velocity arrows
  vectorScale: number;       // m/s → meters of arrow length
  streamlineCount: number;   // integrated tracers
  particleCount: number;     // advected tracers
  rollIndicatorGain: number; // deg/m → degrees of needle deflection
}

export const DEFAULT_OVERLAY_TUNABLES: OverlayTunables = {
  vectorStride: 32,
  vectorScale: 0.035,
  streamlineCount: 60,
  particleCount: 4000,
  rollIndicatorGain: 1.0
};

/** Hard caps (Directive 7): a user cannot stall the frame with CPU integration. */
export const MAX_STREAMLINES = 512;
export const MAX_PARTICLES_TUNABLE = 4096;
/** Roll needle display clamp in deg/m (Directive 6: clipping is VISIBLE). */
export const ROLL_NEEDLE_CLAMP_DEG = 45;

/** Reads a CSS accent custom property with a headless-safe fallback. */
function readAccentVar(varName: string, fallback: number): number {
  try {
    if (typeof document !== 'undefined') {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (raw.startsWith('#')) return parseInt(raw.slice(1), 16);
    }
  } catch {
    /* headless / jsdom: fall through */
  }
  return fallback;
}

function shiftColorHex(hex: number, satMul: number, lightAdd: number): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * satMul), Math.min(1, Math.max(0, hsl.l + lightAdd)));
  return c.getHex();
}

const ACCENT_THRUST = readAccentVar('--accent-thrust', 0x00f2ff);
const ACCENT_TORQUE = readAccentVar('--accent-torque', 0xf59e0b);
const ACCENT_HEAT = readAccentVar('--accent-heat', 0xef4444);
const ACCENT_CURRENT = readAccentVar('--accent-current', 0xa855f7);

/** The ONLY colors any overlay introduces. */
export const OVERLAY_COLORS = {
  thrust: ACCENT_THRUST,
  torque: ACCENT_TORQUE,
  heat: ACCENT_HEAT,
  current: ACCENT_CURRENT,
  torqueStator: shiftColorHex(ACCENT_TORQUE, 0.35, 0.0),  // desaturated torque accent
  torqueNet: shiftColorHex(ACCENT_TORQUE, 1.0, 0.15)      // brightened torque accent
} as const;

/** Per-frame input for OverlaySystem.update. Preallocate once and mutate. */
export interface OverlayUpdateContext {
  /** Render dt (clamped): used ONLY for animation — variant-diff fade, current
   *  pulse, roll-needle smoothing. Never for field advection (Directive 5). */
  dt: number;
  /** Fixed physics dt of the substeps that produced the current field (0 when
   *  paused). Streamline/particle integration uses this so advection stays
   *  time-consistent with the velocity field regardless of display refresh rate. */
  physicsDt: number;
  elapsed: number;         // total elapsed seconds (animations)
  grid: FluidGrid | null;
  gridCenter: THREE.Vector3; // world position of the grid plane center
  gridDxM: number;         // meters per grid cell; plane extent = dims × gridDxM (single source of truth)
  vehicle: VehicleBody | null;
  summary: VehiclePropulsionSummary;
  motorTempsC: number[];   // per-propulsor winding temperature
  motorCurrentsA: number[]; // per-propulsor bus current
}

export interface ThrustCurvePoint {
  J: number;
  thrustN: number;
}

export interface OverlaySystemOptions {
  /** Container for hover numeric labels (absolute-positioned over the stage). */
  hoverEl?: HTMLElement;
  /** Container for the variant diff mini-plot. */
  diffEl?: HTMLElement;
}

const MAX_VELOCITY_ARROWS = 2400;
const MAX_PARTICLES = 8192;
const RIBBON_LEN = 48;

interface TracerState {
  x: number;
  y: number;
  age: number;
  life: number;
}

/**
 * The Phase 6 overlay system. One THREE.Group with nine sub-groups, one per
 * toggle. All rendering is GPU-side (instanced meshes / points / lines); all
 * field integration happens on CPU from the authoritative readback grid so
 * behavior is identical on the WebGPU and WebGL2 backends.
 */
export class OverlaySystem {
  public group: THREE.Group = new THREE.Group();
  public state: OverlayState = { ...DEFAULT_OVERLAY_STATE };
  public tunables: OverlayTunables = { ...DEFAULT_OVERLAY_TUNABLES };

  // Sub-groups (order matches OVERLAY_KEYS minus pressureHeatmap, which is cutaway-only)
  private velocityGroup = new THREE.Group();
  private streamlineGroup = new THREE.Group();
  private vorticityGroup = new THREE.Group();
  private particleGroup = new THREE.Group();
  private thrustGroup = new THREE.Group();
  private torqueGroup = new THREE.Group();
  private thermalGroup = new THREE.Group();
  private currentGroup = new THREE.Group();

  // Hover & variant diff DOM (optional in headless)
  private hoverEl: HTMLElement | null;
  private diffEl: HTMLElement | null;
  private hoverLabel: HTMLDivElement | null = null;
  private diffCanvas: HTMLCanvasElement | null = null;
  private diffLife = 0; // remaining seconds; 0 = hidden

  // Camera for hover raycast
  private camera: THREE.Camera | null = null;
  private hoverDom: HTMLElement | null = null;
  private pointerNdc = new THREE.Vector2();
  private hasPointer = false;
  private raycaster = new THREE.Raycaster();

  // ── Velocity vectors ──
  private arrowInstanced!: THREE.InstancedMesh;
  private arrowUp = new THREE.Vector3(0, 1, 0);

  // ── Streamlines ──
  private streamlineLines: THREE.Line[] = [];
  private tracerStates: TracerState[] = [];
  private divergencePoints!: THREE.Points;
  private lastMarkerCount = 0;
  private streamlineCountActive = 0;

  // ── Vorticity ──
  private vorticitySheet!: THREE.Mesh;

  // ── Particles ──
  private particlePoints!: THREE.Points;
  private particleStreaks!: THREE.LineSegments;
  private particlePos!: Float32Array;   // xyz per particle (world)
  private particleVel!: Float32Array;   // uv per particle (grid m/s)
  private particleAge!: Float32Array;
  private particleLife!: Float32Array;
  private particleCountActive = 0;

  // ── Vehicle-anchored overlays ──
  private thrustArrows: THREE.Group[] = [];
  private torquePropArcs: THREE.Line[] = [];
  private torqueStatorArcs: THREE.Line[] = [];
  private netTorqueArrow!: THREE.ArrowHelper;
  private rollIndicator = new THREE.Group();
  private rollNeedle!: THREE.Line;
  private rollSmoothed = 0;
  /** Raw (unclamped) predicted roll rate from the last update, deg/m. NaN = no valid prediction. */
  public rollRateRaw = NaN;
  /** True when |roll rate| hit the needle clamp (Directive 6: visible clip state). */
  public rollNeedleClipped = false;
  private rollNeedleClippedLast = false;
  private heatSpheres: THREE.Mesh[] = [];
  private currentLines: THREE.Line[] = [];
  private currentPulses: THREE.Mesh[] = [];
  private currentPulseT: number[] = [];
  private hoverProxies: THREE.Mesh[] = [];
  private vehicleCapacity = 0;

  // Shared assets
  private thrustMaterial!: THREE.MeshBasicMaterial;
  private arrowShaftGeo!: THREE.BufferGeometry;
  private arrowHeadGeo!: THREE.BufferGeometry;
  private arrowInstGeo!: THREE.BufferGeometry;
  private hubSphereGeo!: THREE.BufferGeometry;
  private arcGeo!: THREE.BufferGeometry;

  // Scratch (zero-alloc)
  private scratchV1 = new THREE.Vector3();
  private scratchV2 = new THREE.Vector3();
  private scratchV3 = new THREE.Vector3();
  private scratchQ = new THREE.Quaternion();
  private scratchM = new THREE.Matrix4();
  private scratchS = new THREE.Vector3();
  private scratchColor = new THREE.Color();
  private colorAccent = new THREE.Color(ACCENT_THRUST);
  private colorDark = new THREE.Color(0x083344);
  private colorWhite = new THREE.Color(0xffffff);
  private colorNeutral = new THREE.Color(0x223044);
  private colorHeat = new THREE.Color(ACCENT_HEAT);
  private colorTorqueStator = new THREE.Color(OVERLAY_COLORS.torqueStator);
  private sampleScratch = { u: 0, v: 0 };
  private activeCtx: OverlayUpdateContext | null = null;

  constructor(options?: OverlaySystemOptions) {
    this.hoverEl = options?.hoverEl ?? null;
    this.diffEl = options?.diffEl ?? null;

    this.group.add(this.velocityGroup);
    this.group.add(this.streamlineGroup);
    this.group.add(this.vorticityGroup);
    this.group.add(this.particleGroup);
    this.group.add(this.thrustGroup);
    this.group.add(this.torqueGroup);
    this.group.add(this.thermalGroup);
    this.group.add(this.currentGroup);

    this.buildSharedAssets();
    this.buildVorticitySheet();
    this.buildRollIndicator();
    this.buildNetTorqueArrow();
    this.buildDivergencePoints();
    this.buildHoverLabel();
    this.buildDiffCanvas();

    this.syncVisibility();
  }

  // ────────────────────────────── public API ──────────────────────────────

  public setVisible(key: keyof OverlayState, active: boolean): void {
    this.state[key] = active;
    this.syncVisibility();
  }

  public setCamera(camera: THREE.Camera, dom: HTMLElement): void {
    this.camera = camera;
    this.hoverDom = dom;
  }

  public setPointerNDC(x: number, y: number): void {
    this.pointerNdc.set(x, y);
    this.hasPointer = true;
  }

  public clearPointer(): void {
    this.hasPointer = false;
  }

  /**
   * Variant diff: old vs new open-water thrust curve on a stage-corner mini
   * plot. Shows for 5 s then fades. Not an icon — fires on design swap.
   */
  public showVariantDiff(oldCurve: ThrustCurvePoint[], newCurve: ThrustCurvePoint[]): void {
    if (!this.diffCanvas) return;
    this.drawThrustCurve(oldCurve, '#64748b', 'OLD');
    this.drawThrustCurve(newCurve, `#${ACCENT_THRUST.toString(16).padStart(6, '0')}`, 'NEW');
    this.diffLife = 5.0;
    this.diffCanvas.style.display = 'block';
    this.diffCanvas.style.opacity = '1';
  }

  public update(frameDt: number, ctx: OverlayUpdateContext): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.activeCtx = ctx;
    this.syncVisibility();

    // Directive 5: field advection runs on ctx.physicsDt (fixed step, 0 when
    // paused) so streamline/particle motion stays consistent with the velocity
    // field at any display refresh rate; ctx.dt (render) drives pure animation.
    const advectionDt = Math.max(0, Math.min(0.05, ctx.physicsDt));

    if (this.state.velocityVectors && ctx.grid) this.updateVelocityVectors(ctx);
    if (this.state.streamlines && ctx.grid) this.updateStreamlines(advectionDt, ctx);
    if (this.state.vorticity && ctx.grid) this.updateVorticitySheet(ctx);
    if (this.state.particles && ctx.grid) this.updateParticles(advectionDt, ctx);
    if (this.state.thrustArrows) this.updateThrustArrows(ctx);
    if (this.state.torqueArrows) this.updateTorqueArrows(frameDt, ctx);
    if (this.state.thermal) this.updateThermal(ctx);
    if (this.state.currentFlow) this.updateCurrentFlow(frameDt, ctx);

    this.updateHover();
    this.updateVariantDiff(frameDt);
    this.activeCtx = null;

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.overlayMs = this.overlayMs * 0.9 + (t1 - t0) * 0.1; // EMA smoothing

    // Directive 7 adaptive budget: sustained > 4 ms → halve particle count.
    if (ctx.elapsed - this.lastAdaptiveCheck > 1.0) {
      this.lastAdaptiveCheck = ctx.elapsed;
      if (this.overlayMs > 4.0 && this.particleBudgetScale > 0.125 && this.state.particles) {
        this.particleBudgetScale *= 0.5;
      }
    }
  }

  /** Effective particle count after the adaptive budget (Directive 7). */
  private get effectiveParticleCount(): number {
    return Math.max(
      64,
      Math.min(MAX_PARTICLES_TUNABLE, Math.round(this.tunables.particleCount * this.particleBudgetScale))
    );
  }

  public dispose(): void {
    this.disposeCapacity();
    this.arrowInstGeo.dispose();
    this.arrowInstanced.geometry.dispose();
    (this.arrowInstanced.material as THREE.Material).dispose();
    this.vorticitySheet.geometry.dispose();
    (this.vorticitySheet.material as THREE.Material).dispose();
    this.disposeStreamlines();
    this.disposeParticles();
    this.divergencePoints.geometry.dispose();
    (this.divergencePoints.material as THREE.Material).dispose();
    this.arrowShaftGeo.dispose();
    this.arrowHeadGeo.dispose();
    this.thrustMaterial.dispose();
    this.hubSphereGeo.dispose();
    this.arcGeo.dispose();
    this.netTorqueArrow.dispose();
    const rollHorizon = this.rollIndicator.children[0] as THREE.Line | undefined;
    if (rollHorizon) {
      rollHorizon.geometry.dispose();
      (rollHorizon.material as THREE.Material).dispose();
    }
    this.rollNeedle.geometry.dispose();
    (this.rollNeedle.material as THREE.Material).dispose();
    this.hoverLabel?.remove();
    this.diffCanvas?.remove();
    this.group.removeFromParent();
  }

  // ─────────────────────────── construction ───────────────────────────────

  private buildSharedAssets(): void {
    // Instanced velocity arrow along +Y, total height 1.0 so scale.y = length
    const shaft = new THREE.CylinderGeometry(0.0045, 0.0045, 0.7, 5);
    shaft.translate(0, 0.35, 0);
    const head = new THREE.ConeGeometry(0.013, 0.3, 7);
    head.translate(0, 0.85, 0);
    this.arrowInstGeo = mergeGeometries([shaft, head])!;
    shaft.dispose();
    head.dispose();

    const instMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.arrowInstanced = new THREE.InstancedMesh(this.arrowInstGeo, instMat, MAX_VELOCITY_ARROWS);
    this.arrowInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrowInstanced.frustumCulled = false;
    this.arrowInstanced.count = 0;
    for (let i = 0; i < MAX_VELOCITY_ARROWS; i++) {
      this.arrowInstanced.setColorAt(i, this.colorAccent);
    }
    this.velocityGroup.add(this.arrowInstanced);

    // Vehicle thrust arrow parts (along +Z = three.js surge)
    this.arrowShaftGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1.0, 6);
    this.arrowShaftGeo.rotateX(Math.PI / 2);
    this.arrowShaftGeo.translate(0, 0, 0.5);
    this.arrowHeadGeo = new THREE.ConeGeometry(0.0065, 0.022, 8);
    this.arrowHeadGeo.rotateX(Math.PI / 2);
    this.arrowHeadGeo.translate(0, 0, 1.011);
    this.thrustMaterial = new THREE.MeshBasicMaterial({ color: OVERLAY_COLORS.thrust });

    this.hubSphereGeo = new THREE.SphereGeometry(0.0075, 10, 10);

    // 270° torque arc in XY plane (roll around three.js Z = surge axis)
    const arcPts: THREE.Vector3[] = [];
    const span = Math.PI * 1.5;
    for (let i = 0; i <= 40; i++) {
      const a = -span / 2 + (i / 40) * span;
      arcPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    }
    this.arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
  }

  private buildVorticitySheet(): void {
    const geo = new THREE.PlaneGeometry(1, 1, 96, 48);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.vorticitySheet = new THREE.Mesh(geo, mat);
    this.vorticitySheet.frustumCulled = false;
    this.vorticityGroup.add(this.vorticitySheet);
  }

  private buildRollIndicator(): void {
    const horizonGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.028, 0, 0),
      new THREE.Vector3(0.028, 0, 0)
    ]);
    const horizon = new THREE.Line(
      horizonGeo,
      new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.7 })
    );
    this.rollIndicator.add(horizon);

    const needleGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.024, 0, 0),
      new THREE.Vector3(0.024, 0, 0)
    ]);
    this.rollNeedle = new THREE.Line(needleGeo, new THREE.LineBasicMaterial({ color: OVERLAY_COLORS.torque }));
    this.rollIndicator.add(this.rollNeedle);
    this.torqueGroup.add(this.rollIndicator);
  }

  private buildNetTorqueArrow(): void {
    this.netTorqueArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0),
      0.05,
      OVERLAY_COLORS.torqueNet,
      0.012,
      0.006
    );
    this.torqueGroup.add(this.netTorqueArrow);
  }

  private buildDivergencePoints(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.014,
      vertexColors: true,
      transparent: true,
      depthWrite: false
    });
    this.divergencePoints = new THREE.Points(geo, mat);
    this.divergencePoints.frustumCulled = false;
    this.streamlineGroup.add(this.divergencePoints);
  }

  private buildHoverLabel(): void {
    if (!this.hoverEl) return;
    this.hoverLabel = document.createElement('div');
    this.hoverLabel.className = 'overlay-hover-label hidden';
    this.hoverEl.appendChild(this.hoverLabel);
  }

  private buildDiffCanvas(): void {
    if (!this.diffEl) return;
    this.diffCanvas = document.createElement('canvas');
    this.diffCanvas.className = 'overlay-variant-diff';
    this.diffCanvas.width = 240;
    this.diffCanvas.height = 150;
    this.diffCanvas.style.display = 'none';
    this.diffEl.appendChild(this.diffCanvas);
  }

  private syncVisibility(): void {
    this.velocityGroup.visible = this.state.velocityVectors;
    this.streamlineGroup.visible = this.state.streamlines;
    this.vorticityGroup.visible = this.state.vorticity;
    this.particleGroup.visible = this.state.particles;
    this.thrustGroup.visible = this.state.thrustArrows;
    this.torqueGroup.visible = this.state.torqueArrows;
    this.thermalGroup.visible = this.state.thermal;
    this.currentGroup.visible = this.state.currentFlow;
  }

  // ── Directive 7: per-frame cost meter + adaptive particle budget ──
  /** Milliseconds spent in the last update() call (measured, exposed to HUD). */
  public overlayMs = 0;
  private lastAdaptiveCheck = 0;
  private particleBudgetScale = 1.0;

  // ──────────────────────── grid ↔ world mapping ──────────────────────────

  private g2w(gx: number, gy: number, out: THREE.Vector3): THREE.Vector3 {
    // Directive 4: single source of truth for the grid→world mapping.
    const ctx = this.activeCtx!;
    const W = ctx.grid ? ctx.grid.width : 1;
    const H = ctx.grid ? ctx.grid.height : 1;
    return gridToWorld(gx, gy, W, H, ctx.gridDxM, ctx.gridCenter, out);
  }

  private bodyPointToWorld(v: VehicleBody | null, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    // Directive 4: single source of truth for the body→world mapping.
    return mapBodyPointToWorld(v, x, y, z, out);
  }

  private bodyDirToWorld(v: VehicleBody | null, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    // Directive 4: single source of truth for the body-direction mapping.
    return mapBodyDirToWorld(v, x, y, z, out);
  }

  // ───────────────────────── velocity vector field ────────────────────────

  private updateVelocityVectors(ctx: OverlayUpdateContext): void {
    const grid = ctx.grid!;
    const stride = Math.max(4, Math.round(this.tunables.vectorStride));
    const W = grid.width;
    const H = grid.height;

    let n = 0;
    for (let gy = Math.floor(stride / 2); gy < H && n < MAX_VELOCITY_ARROWS; gy += stride) {
      for (let gx = Math.floor(stride / 2); gx < W && n < MAX_VELOCITY_ARROWS; gx += stride) {
        const idx = gy * W + gx;
        const u = grid.u[idx];
        const v = grid.v[idx];
        const mag = Math.sqrt(u * u + v * v);
        if (mag < 0.02) continue;

        const len = Math.min(0.14, Math.max(0.015, mag * this.tunables.vectorScale));
        this.g2w(gx, gy, this.scratchV1);
        this.scratchV2.set(u / mag, v / mag, 0);
        this.scratchQ.setFromUnitVectors(this.arrowUp, this.scratchV2);
        this.scratchS.set(1, len, 1);
        this.scratchM.compose(this.scratchV1, this.scratchQ, this.scratchS);
        this.arrowInstanced.setMatrixAt(n, this.scratchM);

        // Luminance ramp of the thrust accent: dark → accent → near-white
        const t = Math.min(1, mag / 2.0);
        this.scratchColor.lerpColors(this.colorDark, this.colorAccent, t);
        if (t > 0.75) {
          this.scratchColor.lerp(this.colorWhite, (t - 0.75) * 2.0);
        }
        this.arrowInstanced.setColorAt(n, this.scratchColor);
        n++;
      }
    }

    this.arrowInstanced.count = n;
    // Directive 8: only the first n slots were written this frame — upload just
    // that slice of the matrix/color buffers instead of the full capacity.
    const matAttr = this.arrowInstanced.instanceMatrix;
    matAttr.clearUpdateRanges();
    if (n > 0) matAttr.addUpdateRange(0, n * 16);
    matAttr.needsUpdate = n > 0;
    const colAttr = this.arrowInstanced.instanceColor;
    if (colAttr) {
      colAttr.clearUpdateRanges();
      if (n > 0) colAttr.addUpdateRange(0, n * 3);
      colAttr.needsUpdate = n > 0;
    }
  }

  // ───────────────────────────── streamlines ──────────────────────────────

  private ensureStreamlines(count: number): void {
    if (this.streamlineCountActive === count) return;
    this.disposeStreamlines();
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(RIBBON_LEN * 3);
      const colors = new Float32Array(RIBBON_LEN * 3);
      // Static fade: tail dark → head accent
      for (let s = 0; s < RIBBON_LEN; s++) {
        const t = s / (RIBBON_LEN - 1);
        this.scratchColor.lerpColors(this.colorDark, this.colorAccent, t * t);
        colors[s * 3] = this.scratchColor.r;
        colors[s * 3 + 1] = this.scratchColor.g;
        colors[s * 3 + 2] = this.scratchColor.b;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
      line.frustumCulled = false;
      this.streamlineLines.push(line);
      this.streamlineGroup.add(line);
      this.tracerStates.push(this.seedTracer({ x: 0, y: 0, age: 0, life: 0 }));
    }
    this.streamlineCountActive = count;
  }

  private seedTracer(t: TracerState): TracerState {
    const grid = this.activeCtx!.grid!;
    t.x = 1 + Math.random() * 5;
    t.y = 1 + Math.random() * (grid.height - 2);
    t.age = 0;
    t.life = 6 + Math.random() * 8;
    return t;
  }

  private updateStreamlines(advectionDt: number, ctx: OverlayUpdateContext): void {
    const grid = ctx.grid!;
    this.ensureStreamlines(Math.max(1, Math.min(MAX_STREAMLINES, Math.round(this.tunables.streamlineCount))));

    const dx = Math.max(1e-6, ctx.gridDxM);
    const stepCells = advectionDt / dx; // grid cells advanced per physics step
    const W = grid.width;
    const H = grid.height;
    const posAttr = this.scratchV1;

    let markerCount = 0;
    const markerPos = this.divergencePoints.geometry.attributes.position as THREE.BufferAttribute;
    const markerCol = this.divergencePoints.geometry.attributes.color as THREE.BufferAttribute;
    const colorTorqueStator = this.colorTorqueStator;

    for (let i = 0; i < this.tracerStates.length; i++) {
      const t = this.tracerStates[i];

      if (advectionDt > 0) {
        // Bugfix (exposed by dt-invariance test): the field sample MUST go
        // through sampleVelocity — sampleBilinear returns a value but does
        // not populate sampleScratch, so reading it directly fed stale zeros
        // into the reseed condition and teleported tracers on every first step.
        this.sampleVelocity(grid, t.x, t.y);
        const u0 = this.sampleScratch.u;
        const v0 = this.sampleScratch.v;
        const su0 = u0;
        const sv0 = v0;

        // Predicted (Euler) vs actual (RK2 midpoint) — divergence shows where
        // the field is changing fast, e.g. behind the actuator disc.
        const predX = t.x + su0 * stepCells;
        const predY = t.y + sv0 * stepCells;

        this.sampleVelocity(grid, t.x + 0.5 * su0 * stepCells, t.y + 0.5 * sv0 * stepCells);
        const actX = t.x + this.sampleScratch.u * stepCells;
        const actY = t.y + this.sampleScratch.v * stepCells;

        const divergence = Math.hypot(predX - actX, predY - actY);
        if (divergence > 0.5 && markerCount < 64) {
          this.g2w(actX, actY, posAttr);
          markerPos.setXYZ(markerCount, posAttr.x, posAttr.y, posAttr.z);
          const intensity = Math.min(1, divergence / 4);
          markerCol.setXYZ(markerCount, colorTorqueStator.r * intensity, colorTorqueStator.g * intensity, colorTorqueStator.b * intensity);
          markerCount++;
        }

        t.x = actX;
        t.y = actY;
        t.age += advectionDt;

        if (t.x < 0.5 || t.x > W - 1.5 || t.y < 0.5 || t.y > H - 1.5 || t.age > t.life || (u0 === 0 && v0 === 0)) {
          this.seedTracer(t);
          this.resetRibbonToHead(i);
        }
      }

      // Shift ribbon and write new head (shift only when time advances,
      // otherwise a paused sim would collapse each ribbon to a point)
      const attr = this.streamlineLines[i].geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      if (advectionDt > 0) arr.copyWithin(0, 3);
      this.g2w(t.x, t.y, posAttr);
      const last = (RIBBON_LEN - 1) * 3;
      arr[last] = posAttr.x;
      arr[last + 1] = posAttr.y;
      arr[last + 2] = posAttr.z;
      attr.needsUpdate = true;
    }

    // Directive 8: only the markerCount slots written this frame are dirty;
    // skip the upload entirely when nothing appeared and nothing did last frame.
    if (markerCount > 0 || this.lastMarkerCount > 0) {
      markerPos.clearUpdateRanges();
      markerCol.clearUpdateRanges();
      if (markerCount > 0) {
        markerPos.addUpdateRange(0, markerCount * 3);
        markerCol.addUpdateRange(0, markerCount * 3);
      }
      markerPos.needsUpdate = true;
      markerCol.needsUpdate = true;
    }
    this.lastMarkerCount = markerCount;
    // Directive 3: draw exactly the live marker count, never the capacity.
    this.divergencePoints.geometry.setDrawRange(0, markerCount);
  }

  private sampleVelocity(grid: FluidGrid, x: number, y: number): void {
    this.sampleScratch.u = grid.sampleBilinear(grid.u, x, y);
    this.sampleScratch.v = grid.sampleBilinear(grid.v, x, y);
  }

  private resetRibbonToHead(lineIdx: number): void {
    const t = this.tracerStates[lineIdx];
    const attr = this.streamlineLines[lineIdx].geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    this.g2w(t.x, t.y, this.scratchV2);
    for (let s = 0; s < RIBBON_LEN; s++) {
      arr[s * 3] = this.scratchV2.x;
      arr[s * 3 + 1] = this.scratchV2.y;
      arr[s * 3 + 2] = this.scratchV2.z;
    }
    attr.needsUpdate = true;
  }

  private disposeStreamlines(): void {
    for (const line of this.streamlineLines) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      line.removeFromParent();
    }
    this.streamlineLines.length = 0;
    this.tracerStates.length = 0;
    this.streamlineCountActive = 0;
  }

  // ─────────────────────────── vorticity sheet ────────────────────────────

  private updateVorticitySheet(ctx: OverlayUpdateContext): void {
    const grid = ctx.grid!;
    this.vorticitySheet.position.copy(ctx.gridCenter);
    this.vorticitySheet.scale.set(
      grid.width * ctx.gridDxM,
      grid.height * ctx.gridDxM,
      1
    );

    const geo = this.vorticitySheet.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    const W = grid.width;
    const H = grid.height;

    for (let i = 0; i < pos.count; i++) {
      // Plane vertex uv (0..1) → grid coords
      const gx = pos.getX(i) * 0.5 * (W - 1) + (W - 1) * 0.5;
      const gy = pos.getY(i) * 0.5 * (H - 1) + (H - 1) * 0.5;
      const curl = grid.sampleBilinear(grid.curl, gx, gy);
      const mag = Math.min(1, Math.abs(curl) * 0.2);
      // Luminance ramp of the thrust accent (tip vortices = bright filaments)
      this.scratchColor.lerpColors(this.colorDark, this.colorAccent, mag);
      if (mag > 0.8) this.scratchColor.lerp(this.colorWhite, (mag - 0.8) * 3);
      col.setXYZ(i, this.scratchColor.r, this.scratchColor.g, this.scratchColor.b);
    }
    col.needsUpdate = true;
  }

  // ────────────────────────────── particles ───────────────────────────────

  private ensureParticles(count: number): void {
    count = Math.max(1, Math.min(MAX_PARTICLES, Math.round(count)));
    if (this.particleCountActive === count) return;
    this.disposeParticles();

    this.particlePos = new Float32Array(count * 3);
    this.particleVel = new Float32Array(count * 2);
    this.particleAge = new Float32Array(count);
    this.particleLife = new Float32Array(count);

    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    ptGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const ptMat = new THREE.PointsMaterial({
      size: 0.006,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    this.particlePoints = new THREE.Points(ptGeo, ptMat);
    this.particlePoints.frustumCulled = false;
    this.particleGroup.add(this.particlePoints);

    // Motion blur: per-particle velocity-stretched segment (no post-processing)
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
    streakGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
    const streakMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false
    });
    this.particleStreaks = new THREE.LineSegments(streakGeo, streakMat);
    this.particleStreaks.frustumCulled = false;
    this.particleGroup.add(this.particleStreaks);

    this.particleCountActive = count;
    for (let i = 0; i < count; i++) {
      this.seedParticle(i);
    }
  }

  private seedParticle(i: number): void {
    const grid = this.activeCtx!.grid!;
    this.particlePos[i * 3 + 2] = this.activeCtx!.gridCenter.z;
    // Seed at inflow edge (left) with jitter
    this.particlePos[i * 3] = 0; // will be set by g2w below
    this.particlePos[i * 3 + 1] = 0;
    const gx = 1 + Math.random() * 4;
    const gy = 1 + Math.random() * (grid.height - 2);
    this.g2w(gx, gy, this.scratchV1);
    this.particlePos[i * 3] = this.scratchV1.x;
    this.particlePos[i * 3 + 1] = this.scratchV1.y;
    // Store grid coords in vel slots temporarily via age/life init
    this.particleAge[i] = 0;
    this.particleLife[i] = 5 + Math.random() * 8;
    // Keep grid coordinates in a parallel encoding: store in vel until first advect
    this.particleVel[i * 2] = gx;
    this.particleVel[i * 2 + 1] = gy;
  }

  private updateParticles(_advectionDt: number, ctx: OverlayUpdateContext): void {
    // NOTE: the first parameter IS the advection dt (physics step provenance,
    // Directive 5); it is passed through unchanged from update().
    this.ensureParticles(this.effectiveParticleCount);
    const grid = ctx.grid!;
    const advectionDt = _advectionDt;
    const dx = Math.max(1e-6, ctx.gridDxM);
    const stepCells = advectionDt / dx;
    const W = grid.width;
    const H = grid.height;
    const n = this.particleCountActive;

    const ptPos = this.particlePoints.geometry.attributes.position as THREE.BufferAttribute;
    const ptCol = this.particlePoints.geometry.attributes.color as THREE.BufferAttribute;
    const stPos = this.particleStreaks.geometry.attributes.position as THREE.BufferAttribute;
    const stCol = this.particleStreaks.geometry.attributes.color as THREE.BufferAttribute;

    for (let i = 0; i < n; i++) {
      let gx = this.particleVel[i * 2];
      let gy = this.particleVel[i * 2 + 1];

      if (advectionDt > 0) {
        this.sampleVelocity(grid, gx, gy);
        const su = this.sampleScratch.u;
        const sv = this.sampleScratch.v;
        this.sampleVelocity(grid, gx + 0.5 * su * stepCells, gy + 0.5 * sv * stepCells);
        gx += this.sampleScratch.u * stepCells;
        gy += this.sampleScratch.v * stepCells;
        this.particleVel[i * 2] = gx;
        this.particleVel[i * 2 + 1] = gy;

        this.particleAge[i] += advectionDt;
        if (gx < 0.5 || gx > W - 1.5 || gy < 0.5 || gy > H - 1.5 || this.particleAge[i] > this.particleLife[i]) {
          this.seedParticle(i);
          gx = this.particleVel[i * 2];
          gy = this.particleVel[i * 2 + 1];
        }
      }

      this.g2w(gx, gy, this.scratchV1);
      this.particlePos[i * 3] = this.scratchV1.x;
      this.particlePos[i * 3 + 1] = this.scratchV1.y;

      const speed = Math.hypot(this.sampleScratch.u, this.sampleScratch.v);
      const t = Math.min(1, speed / 2.0);
      this.scratchColor.lerpColors(this.colorDark, this.colorAccent, t);
      if (t > 0.8) this.scratchColor.lerp(this.colorWhite, (t - 0.8) * 2.5);

      ptPos.setXYZ(i, this.scratchV1.x, this.scratchV1.y, this.scratchV1.z);
      ptCol.setXYZ(i, this.scratchColor.r, this.scratchColor.g, this.scratchColor.b);

      // Streak tail: head − velocityWorld * streakScale
      const streakScale = 0.05;
      this.scratchV2.set(this.sampleScratch.u, this.sampleScratch.v, 0).multiplyScalar(streakScale);
      stPos.setXYZ(i * 2, this.scratchV1.x, this.scratchV1.y, this.scratchV1.z);
      stPos.setXYZ(i * 2 + 1, this.scratchV1.x - this.scratchV2.x, this.scratchV1.y - this.scratchV2.y, this.scratchV1.z);
      stCol.setXYZ(i * 2, this.scratchColor.r, this.scratchColor.g, this.scratchColor.b);
      stCol.setXYZ(i * 2 + 1, 0, 0, 0);
    }

    // Directive 3: shrink the draw call count to the ACTIVE particle count —
    // never draw stale capacity slots (zero-scale fallback is not the path).
    this.particlePoints.geometry.setDrawRange(0, n);
    this.particleStreaks.geometry.setDrawRange(0, n * 2);

    // Directive 8: the particle buffers are regenerated WHOLLY every frame by
    // design (every particle moves), so a full-buffer upload is intentional —
    // no updateRange can reduce it.
    ptPos.needsUpdate = true;
    ptCol.needsUpdate = true;
    stPos.needsUpdate = true;
    stCol.needsUpdate = true;
  }

  private disposeParticles(): void {
    if (!this.particlePoints) return;
    this.particlePoints.geometry.dispose();
    (this.particlePoints.material as THREE.Material).dispose();
    this.particlePoints.removeFromParent();
    this.particleStreaks.geometry.dispose();
    (this.particleStreaks.material as THREE.Material).dispose();
    this.particleStreaks.removeFromParent();
    this.particleCountActive = 0;
  }

  // ─────────────────────── vehicle-anchored overlays ──────────────────────

  private ensureVehicleCapacity(count: number): void {
    if (this.vehicleCapacity >= count) return;
    this.disposeCapacity();

    for (let i = this.vehicleCapacity; i < count; i++) {
      // Thrust arrow: shaft + cone along local +Z, scaled by thrust magnitude
      const arrow = new THREE.Group();
      const shaft = new THREE.Mesh(this.arrowShaftGeo, this.thrustMaterial);
      const head = new THREE.Mesh(this.arrowHeadGeo, this.thrustMaterial);
      arrow.add(shaft, head);
      this.thrustGroup.add(arrow);
      this.thrustArrows.push(arrow);

      // Torque arcs (helical feel via two counter-chirality arcs)
      const propArc = new THREE.Line(this.arcGeo, new THREE.LineBasicMaterial({ color: OVERLAY_COLORS.torque, transparent: true, opacity: 0.85 }));
      const statorArc = new THREE.Line(this.arcGeo, new THREE.LineBasicMaterial({ color: OVERLAY_COLORS.torqueStator, transparent: true, opacity: 0.7 }));
      this.torqueGroup.add(propArc, statorArc);
      this.torquePropArcs.push(propArc);
      this.torqueStatorArcs.push(statorArc);

      // Thermal hub sphere (own material: per-motor color)
      const heat = new THREE.Mesh(
        this.hubSphereGeo,
        new THREE.MeshBasicMaterial({ color: this.colorNeutral.clone() })
      );
      this.thermalGroup.add(heat);
      this.heatSpheres.push(heat);

      // Current flow: supply→motor line + traveling pulse
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: OVERLAY_COLORS.current, transparent: true, opacity: 0.45 }));
      this.currentGroup.add(line);
      this.currentLines.push(line);

      const pulse = new THREE.Mesh(
        this.hubSphereGeo,
        new THREE.MeshBasicMaterial({ color: OVERLAY_COLORS.current })
      );
      pulse.scale.setScalar(0.6);
      this.currentGroup.add(pulse);
      this.currentPulses.push(pulse);
      this.currentPulseT.push(0);

      // Invisible hover proxy (shared by thrust & torque hover labels)
      const proxy = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 6, 6),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      proxy.userData.thrusterIndex = i;
      this.torqueGroup.add(proxy);
      this.hoverProxies.push(proxy);
    }
    this.vehicleCapacity = count;
  }

  private disposeCapacity(): void {
    for (const a of this.thrustArrows) a.removeFromParent();
    for (const l of this.torquePropArcs) { l.geometry !== this.arcGeo && l.geometry.dispose(); (l.material as THREE.Material).dispose(); l.removeFromParent(); }
    for (const l of this.torqueStatorArcs) { l.geometry !== this.arcGeo && l.geometry.dispose(); (l.material as THREE.Material).dispose(); l.removeFromParent(); }
    for (const s of this.heatSpheres) { s.geometry !== this.hubSphereGeo && s.geometry.dispose(); (s.material as THREE.Material).dispose(); s.removeFromParent(); }
    for (const l of this.currentLines) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); l.removeFromParent(); }
    for (const p of this.currentPulses) { p.geometry !== this.hubSphereGeo && p.geometry.dispose(); (p.material as THREE.Material).dispose(); p.removeFromParent(); }
    for (const p of this.hoverProxies) { p.geometry.dispose(); (p.material as THREE.Material).dispose(); p.removeFromParent(); }
    this.thrustArrows.length = 0;
    this.torquePropArcs.length = 0;
    this.torqueStatorArcs.length = 0;
    this.heatSpheres.length = 0;
    this.currentLines.length = 0;
    this.currentPulses.length = 0;
    this.currentPulseT.length = 0;
    this.hoverProxies.length = 0;
    this.vehicleCapacity = 0;
  }

  private updateThrustArrows(ctx: OverlayUpdateContext): void {
    const thrusters = ctx.summary.thrusters;
    this.ensureVehicleCapacity(thrusters.length);

    for (let i = 0; i < thrusters.length; i++) {
      const t = thrusters[i];
      const arrow = this.thrustArrows[i];
      const mag = Math.sqrt(
        t.forceVectorN[0] * t.forceVectorN[0] +
        t.forceVectorN[1] * t.forceVectorN[1] +
        t.forceVectorN[2] * t.forceVectorN[2]
      );

      const posWorld = this.bodyPointToWorld(ctx.vehicle, t.unit.positionM[0], t.unit.positionM[1], t.unit.positionM[2], this.scratchV1);
      const dirWorld = this.bodyDirToWorld(ctx.vehicle, t.forceVectorN[0], t.forceVectorN[1], t.forceVectorN[2], this.scratchV2);

      this.hoverProxies[i].position.copy(posWorld);
      this.heatSpheres[i].position.copy(posWorld);

      if (mag > 1e-4) {
        arrow.visible = true;
        arrow.position.copy(posWorld);
        arrow.quaternion.setFromUnitVectors(
          this.scratchV3.set(0, 0, 1),
          dirWorld.normalize()
        );
        const len = Math.min(0.35, Math.max(0.02, mag * 0.05));
        arrow.scale.set(1, 1, len);
      } else {
        arrow.visible = false;
      }
    }
    for (let i = thrusters.length; i < this.thrustArrows.length; i++) {
      this.thrustArrows[i].visible = false;
      this.hoverProxies[i].visible = false;
    }
  }

  private updateTorqueArrows(frameDt: number, ctx: OverlayUpdateContext): void {
    const thrusters = ctx.summary.thrusters;
    this.ensureVehicleCapacity(thrusters.length);

    for (let i = 0; i < thrusters.length; i++) {
      const t = thrusters[i];
      const posWorld = this.bodyPointToWorld(ctx.vehicle, t.unit.positionM[0], t.unit.positionM[1], t.unit.positionM[2], this.scratchV1);
      const rollAxisWorld = this.bodyDirToWorld(ctx.vehicle, t.unit.thrustDirection[0], t.unit.thrustDirection[1], t.unit.thrustDirection[2], this.scratchV2);

      // Q_prop: reaction torque along thrust axis (chirality = handedness)
      const qProp = t.bemt.torqueNm;
      const propArc = this.torquePropArcs[i];
      const qPropScale = Math.min(1.4, Math.max(0.12, Math.abs(qProp) * 2500));
      propArc.position.copy(posWorld);
      propArc.quaternion.setFromUnitVectors(this.scratchV3.set(0, 0, 1), rollAxisWorld);
      propArc.scale.set(qPropScale, t.unit.handedness === 'CW' ? -qPropScale : qPropScale, qPropScale);
      propArc.visible = Math.abs(qProp) > 1e-5;

      // Q_stator: counter-torque, desaturated accent, mirrored chirality
      const qStator = t.statorResult.antiTorqueNm;
      const statorArc = this.torqueStatorArcs[i];
      const qStatorScale = Math.min(1.4, Math.max(0.12, Math.abs(qStator) * 2500));
      statorArc.position.copy(posWorld);
      statorArc.quaternion.copy(propArc.quaternion);
      statorArc.scale.set(qStatorScale * 1.15, t.unit.handedness === 'CW' ? qStatorScale * 1.15 : -qStatorScale * 1.15, qStatorScale * 1.15);
      statorArc.visible = Math.abs(qStator) > 1e-5;
    }
    for (let i = thrusters.length; i < this.torquePropArcs.length; i++) {
      this.torquePropArcs[i].visible = false;
      this.torqueStatorArcs[i].visible = false;
    }

    // Q_net at the vehicle origin (brightened torque accent, along roll axis)
    const qNet = ctx.summary.totalMomentNm[0];
    const vPos = ctx.vehicle ? ctx.vehicle.position : this.scratchV1.set(0, 0, 0);
    const rollAxis = ctx.vehicle
      ? this.bodyDirToWorld(ctx.vehicle, 1, 0, 0, this.scratchV2)
      : this.scratchV2.set(0, 0, 1);
    if (Math.abs(qNet) > 1e-6) {
      this.netTorqueArrow.visible = true;
      this.netTorqueArrow.position.copy(vPos);
      this.netTorqueArrow.setDirection(rollAxis.normalize().multiplyScalar(Math.sign(qNet)));
      const len = Math.min(0.2, Math.max(0.03, Math.abs(qNet) * 2500));
      this.netTorqueArrow.setLength(len, len * 0.25, len * 0.12);
    } else {
      this.netTorqueArrow.visible = false;
    }

    // Roll rate indicator: smoothed needle above the vehicle.
    // Directive 6: never silently flatline — when the needle hits the ±45°
    // clamp it shifts to the heat accent and rollRateRaw exposes the raw value.
    const rawRate = ctx.summary.ledgerSummary.predictedRollRateDegPerM;
    const predicted = Number.isFinite(rawRate);
    const rollRate = predicted ? rawRate * this.tunables.rollIndicatorGain : 0;
    const clipped = predicted && Math.abs(rollRate) >= ROLL_NEEDLE_CLAMP_DEG;
    this.rollRateRaw = predicted ? rawRate : NaN;
    this.rollNeedleClipped = clipped;

    const targetDeg = Math.max(-ROLL_NEEDLE_CLAMP_DEG, Math.min(ROLL_NEEDLE_CLAMP_DEG, rollRate));
    const k = Math.min(1, frameDt * 3.3); // τ ≈ 0.3 s first-order lag
    this.rollSmoothed += (targetDeg - this.rollSmoothed) * k;
    this.rollIndicator.visible = Math.abs(qNet) > 1e-6 && predicted;
    this.rollIndicator.position.copy(vPos);
    this.rollIndicator.position.y += 0.06;
    this.rollIndicator.rotation.z = (this.rollSmoothed * Math.PI) / 180;

    // Clip visibility: needle color shifts to the heat accent when off-scale
    const needleMat = this.rollNeedle.material as THREE.LineBasicMaterial;
    if (clipped !== this.rollNeedleClippedLast) {
      needleMat.color.setHex(clipped ? OVERLAY_COLORS.heat : OVERLAY_COLORS.torque);
      this.rollNeedleClippedLast = clipped;
    }
  }

  private updateThermal(ctx: OverlayUpdateContext): void {
    const thrusters = ctx.summary.thrusters;
    this.ensureVehicleCapacity(thrusters.length);
    for (let i = 0; i < thrusters.length; i++) {
      const temp = ctx.motorTempsC[i] ?? 20;
      const t = Math.max(0, Math.min(1, (temp - 20) / 80));
      const mat = this.heatSpheres[i].material as THREE.MeshBasicMaterial;
      mat.color.lerpColors(this.colorNeutral, this.colorHeat, t);
    }
  }

  private updateCurrentFlow(frameDt: number, ctx: OverlayUpdateContext): void {
    const thrusters = ctx.summary.thrusters;
    this.ensureVehicleCapacity(thrusters.length);

    for (let i = 0; i < thrusters.length; i++) {
      const t = thrusters[i];
      const hub = this.bodyPointToWorld(ctx.vehicle, t.unit.positionM[0], t.unit.positionM[1], t.unit.positionM[2], this.scratchV1);
      const current = Math.abs(ctx.motorCurrentsA[i] ?? 0);

      // Surface supply anchor above the vehicle
      const surface = this.scratchV2.copy(hub);
      surface.y = ctx.gridCenter.y + (ctx.grid ? ctx.grid.height * ctx.gridDxM * 0.5 : 0.05) + 0.05;

      const attr = this.currentLines[i].geometry.attributes.position as THREE.BufferAttribute;
      attr.setXYZ(0, surface.x, surface.y, surface.z);
      attr.setXYZ(1, hub.x, hub.y, hub.z);
      attr.needsUpdate = true;

      const lineMat = this.currentLines[i].material as THREE.LineBasicMaterial;
      lineMat.opacity = 0.2 + Math.min(0.6, current * 0.3);

      // Pulse travels surface → motor; speed & size ∝ current (pedagogical)
      const speed = 0.25 + current * 0.35;
      this.currentPulseT[i] = (this.currentPulseT[i] + frameDt * speed) % 1;
      const pulse = this.currentPulses[i];
      pulse.position.lerpVectors(surface, hub, this.currentPulseT[i]);
      pulse.scale.setScalar(0.35 + Math.min(0.7, current * 0.25));
      pulse.visible = current > 0.05;
    }
  }

  // ───────────────────────── hover numeric labels ─────────────────────────

  private updateHover(): void {
    if (!this.hoverLabel || !this.camera || !this.hoverDom || !this.hasPointer) {
      if (this.hoverLabel) this.hoverLabel.classList.add('hidden');
      return;
    }

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.hoverProxies, false);
    if (hits.length === 0) {
      this.hoverLabel.classList.add('hidden');
      return;
    }

    const idx = hits[0].object.userData.thrusterIndex as number;
    const ctx = this.activeCtx;
    const t = ctx?.summary.thrusters[idx];
    if (!ctx || !t) {
      this.hoverLabel.classList.add('hidden');
      return;
    }

    const qProp = t.bemt.torqueNm * 1000; // mN·m
    const qStator = t.statorResult.antiTorqueNm * 1000;
    this.hoverLabel.innerHTML =
      `T = ${t.netThrustN.toFixed(2)} N<br>` +
      `<span class="q-prop">Q<sub>prop</sub> = ${qProp.toFixed(1)} mN·m</span><br>` +
      `<span class="q-stator">Q<sub>stator</sub> = ${qStator.toFixed(1)} mN·m</span>`;

    // Project hub to screen space within the stage viewport
    this.scratchV1.copy(hits[0].object.position).project(this.camera);
    const rect = this.hoverDom.getBoundingClientRect();
    const px = (this.scratchV1.x * 0.5 + 0.5) * rect.width;
    const py = (-this.scratchV1.y * 0.5 + 0.5) * rect.height;
    this.hoverLabel.style.left = `${Math.round(px + 14)}px`;
    this.hoverLabel.style.top = `${Math.round(py - 10)}px`;
    this.hoverLabel.classList.remove('hidden');
  }

  // ─────────────────────────── variant diff plot ──────────────────────────

  private drawThrustCurve(curve: ThrustCurvePoint[], color: string, label: string): void {
    const canvas = this.diffCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const padL = 34, padR = 10, padT = 22, padB = 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    let jMax = 0.1, tMax = 0.1, tMin = 0;
    for (const p of curve) {
      jMax = Math.max(jMax, p.J);
      tMax = Math.max(tMax, p.thrustN);
      tMin = Math.min(tMin, p.thrustN);
    }
    tMax = Math.max(tMax, 0.5);

    const toPx = (p: ThrustCurvePoint): [number, number] => [
      padL + (p.J / jMax) * plotW,
      padT + (1 - (p.thrustN - tMin) / (tMax - tMin)) * plotH
    ];

    // Axes
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, plotW, plotH);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px monospace';
    ctx.fillText('J →', padL + plotW - 22, H - 8);
    ctx.fillText('T (N)', 4, padT + 8);
    ctx.fillText(label, padL + plotW - (label === 'NEW' ? 28 : 60), padT - 8);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const [x, y] = toPx(curve[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private updateVariantDiff(frameDt: number): void {
    frameDt = Math.max(0, frameDt);
    if (this.diffLife <= 0 || !this.diffCanvas) return;
    this.diffLife -= frameDt;
    if (this.diffLife <= 0) {
      this.diffCanvas.style.display = 'none';
    } else if (this.diffLife < 1) {
      this.diffCanvas.style.opacity = this.diffLife.toFixed(2);
    }
  }
}
