import * as THREE from 'three';
import type { FluidGrid } from '../fluid/grid';

export interface FlowVizOptions {
  pipeLengthM?: number;
  pipeRadiusM?: number;
  particleCount?: number;
}

export class FlowVisualization {
  public group: THREE.Group;
  public showFlow = true;
  public showForceVector = true;

  private points: THREE.Points;
  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private arrow: THREE.ArrowHelper;

  private readonly pipeLengthM: number;
  private readonly pipeRadiusM: number;
  private readonly particleCount: number;

  constructor(options?: FlowVizOptions) {
    this.pipeLengthM = options?.pipeLengthM ?? 1.0;
    this.pipeRadiusM = options?.pipeRadiusM ?? 0.06;
    this.particleCount = options?.particleCount ?? 1200;

    this.group = new THREE.Group();

    this.particlePositions = new Float32Array(this.particleCount * 3);
    this.particleVelocities = new Float32Array(this.particleCount);

    const halfL = this.pipeLengthM / 2;
    for (let i = 0; i < this.particleCount; i++) {
      const x = -halfL + Math.random() * this.pipeLengthM;
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.sqrt(Math.random()) * (this.pipeRadiusM * 0.88);
      const y = r * Math.cos(angle);
      const z = r * Math.sin(angle);

      this.particlePositions[i * 3 + 0] = x;
      this.particlePositions[i * 3 + 1] = y;
      this.particlePositions[i * 3 + 2] = z;
      this.particleVelocities[i] = 1.5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.particlePositions, 3)
    );

    const material = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.005,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.points = new THREE.Points(geometry, material);
    this.group.add(this.points);

    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      0.08,
      0xff7700,
      0.03,
      0.015
    );
    this.group.add(this.arrow);
  }

  public update(
    dt: number,
    thrustN: number,
    hubPos: THREE.Vector3,
    grid?: FluidGrid
  ): void {
    this.points.visible = this.showFlow;
    this.arrow.visible = this.showForceVector;

    if (this.showFlow) {
      const halfL = this.pipeLengthM / 2;
      const posAttr = this.points.geometry.attributes.position as THREE.BufferAttribute;
      const posArray = posAttr.array as Float32Array;

      const baseSpeed = 1.2;
      const hasGrid = grid && grid.width > 0 && grid.height > 0;
      const midY = hasGrid ? Math.floor(grid.height / 2) : 0;

      for (let i = 0; i < this.particleCount; i++) {
        const idx = i * 3;
        let x = posArray[idx + 0];

        let vx = baseSpeed;
        if (hasGrid) {
          const uFraction = Math.max(0, Math.min(1, (x + halfL) / this.pipeLengthM));
          const gx = Math.min(grid.width - 1, Math.floor(uFraction * grid.width));
          const cell = midY * grid.width + gx;
          const uSample = grid.u[cell] ?? baseSpeed;
          vx = Math.max(0.2, uSample);
        }

        x += vx * dt;

        if (x > halfL) {
          x = -halfL;
          const angle = Math.random() * 2 * Math.PI;
          const r = Math.sqrt(Math.random()) * (this.pipeRadiusM * 0.88);
          posArray[idx + 1] = r * Math.cos(angle);
          posArray[idx + 2] = r * Math.sin(angle);
        }

        posArray[idx + 0] = x;
      }
      posAttr.needsUpdate = true;
    }

    if (this.showForceVector) {
      this.arrow.position.copy(hubPos);
      const dir = thrustN >= 0 ? 1 : -1;
      this.arrow.setDirection(new THREE.Vector3(dir, 0, 0));
      const len = Math.max(0.02, Math.min(0.35, Math.abs(thrustN) * 0.04));
      this.arrow.setLength(len, len * 0.25, len * 0.15);
    }
  }

  public dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
