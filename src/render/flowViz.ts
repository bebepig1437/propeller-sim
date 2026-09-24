import * as THREE from 'three';
import type { FluidGrid } from '../fluid/grid';

export type FlowVizMode =
  | 'dye_velocity'
  | 'dye_vorticity'
  | 'dye-velocity'
  | 'dye-vorticity'
  | 'pressure'
  | 'none';

export interface FlowVizOptions {
  pipeLengthM?: number;
  pipeRadiusM?: number;
  particleCount?: number;
}

export class FlowVisualization {
  public group: THREE.Group;
  public mode: FlowVizMode = 'dye_velocity';
  public showWakeEnvelope = false;
  public showVelocityVectors = false;
  public showTipVortices = true;
  public showParticleTracers = true;
  public showForceVector = true;

  public setMode(mode: FlowVizMode): void {
    this.mode = mode;
  }

  public setWakeEnvelopeVisible(visible: boolean): void {
    this.showWakeEnvelope = visible;
  }

  public setVelocityVectorsVisible(visible: boolean): void {
    this.showVelocityVectors = visible;
  }

  public setTipVorticesVisible(visible: boolean): void {
    this.showTipVortices = visible;
  }

  public setParticleTracersVisible(visible: boolean): void {
    this.showParticleTracers = visible;
  }


  private pipeLengthM: number;
  private pipeRadiusM: number;
  private propRadiusM: number;
  private propMountX: number;

  private arrow: THREE.ArrowHelper;

  private streakCount = 600;
  private streakPositions: Float32Array;
  private streakColors: Float32Array;
  private streakVelocities: Float32Array;
  private streakMesh: THREE.LineSegments;

  private particleCount: number;
  private particlePositions: Float32Array;
  private pointsMesh: THREE.Points;

  private dyePlaneMesh: THREE.Mesh;
  private dyePlaneColors: Float32Array;
  private dyePlaneCols = 48;
  private dyePlaneRows = 16;

  private vectorLines: THREE.LineSegments;
  private vectorPositions: Float32Array;
  private vectorColors: Float32Array;
  private vectorCols = 64;
  private vectorRows = 16;
  private vectorCount = 1024;

  private tipVorticesMesh: THREE.LineSegments;
  private tipVorticesPositions: Float32Array;
  private tipVorticesColors: Float32Array;
  private tipPoolSize = 180;
  private tipPool: Array<{
    x: number;
    y: number;
    z: number;
    prevX: number;
    prevY: number;
    prevZ: number;
    vx: number;
    vy: number;
    vz: number;
    ageSec: number;
    maxAgeSec: number;
    active: boolean;
  }> = [];
  private tipSpawnTimer = 0;

  private wakeRings: THREE.LineLoop[] = [];
  private wakeStations = [0.06, 0.14, 0.24, 0.36, 0.50];

  constructor(options?: FlowVizOptions) {
    this.pipeLengthM = options?.pipeLengthM ?? 1.0;
    this.pipeRadiusM = options?.pipeRadiusM ?? 0.06;
    this.propRadiusM = this.pipeRadiusM * 0.72;
    this.propMountX = -this.pipeLengthM / 2 + this.pipeLengthM * 0.25;

    this.group = new THREE.Group();

    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(this.propMountX, 0, 0),
      0.08,
      0xff7700,
      0.03,
      0.015
    );
    this.group.add(this.arrow);

    const halfL = this.pipeLengthM / 2;
    this.particleCount = options?.particleCount ?? 600;
    this.streakCount = Math.min(this.particleCount, 600);

    this.streakPositions = new Float32Array(this.streakCount * 2 * 3);
    this.streakColors = new Float32Array(this.streakCount * 2 * 3);
    this.streakVelocities = new Float32Array(this.streakCount);

    this.particlePositions = new Float32Array(this.particleCount * 3);

    for (let i = 0; i < this.streakCount; i++) {
      const x = -halfL + Math.random() * this.pipeLengthM;
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.sqrt(Math.random()) * (this.pipeRadiusM * 0.88);
      const y = r * Math.cos(angle);
      const z = r * Math.sin(angle);

      const baseIdx = i * 6;
      this.streakPositions[baseIdx + 0] = x;
      this.streakPositions[baseIdx + 1] = y;
      this.streakPositions[baseIdx + 2] = z;

      this.streakPositions[baseIdx + 3] = x - 0.015;
      this.streakPositions[baseIdx + 4] = y;
      this.streakPositions[baseIdx + 5] = z;

      this.streakVelocities[i] = 1.5;

      this.streakColors[baseIdx + 0] = 0.22;
      this.streakColors[baseIdx + 1] = 0.74;
      this.streakColors[baseIdx + 2] = 0.97;

      this.streakColors[baseIdx + 3] = 0.08;
      this.streakColors[baseIdx + 4] = 0.25;
      this.streakColors[baseIdx + 5] = 0.45;

      this.particlePositions[i * 3 + 0] = x;
      this.particlePositions[i * 3 + 1] = y;
      this.particlePositions[i * 3 + 2] = z;
    }

    for (let i = this.streakCount; i < this.particleCount; i++) {
      const x = -halfL + Math.random() * this.pipeLengthM;
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.sqrt(Math.random()) * (this.pipeRadiusM * 0.88);
      this.particlePositions[i * 3 + 0] = x;
      this.particlePositions[i * 3 + 1] = r * Math.cos(angle);
      this.particlePositions[i * 3 + 2] = r * Math.sin(angle);
    }

    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3));
    streakGeo.setAttribute('color', new THREE.BufferAttribute(this.streakColors, 3));
    const streakMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.streakMesh = new THREE.LineSegments(streakGeo, streakMat);
    this.group.add(this.streakMesh);

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const pointsMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.003,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    this.pointsMesh = new THREE.Points(pointsGeo, pointsMat);
    this.group.add(this.pointsMesh);

    const dyeGeo = new THREE.PlaneGeometry(
      this.pipeLengthM,
      this.pipeRadiusM * 1.8,
      this.dyePlaneCols - 1,
      this.dyePlaneRows - 1
    );
    const numDyeVerts = this.dyePlaneCols * this.dyePlaneRows;
    this.dyePlaneColors = new Float32Array(numDyeVerts * 3);
    for (let i = 0; i < numDyeVerts; i++) {
      this.dyePlaneColors[i * 3 + 0] = 0.12;
      this.dyePlaneColors[i * 3 + 1] = 0.23;
      this.dyePlaneColors[i * 3 + 2] = 0.54;
    }
    dyeGeo.setAttribute('color', new THREE.BufferAttribute(this.dyePlaneColors, 3));
    const dyeMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.dyePlaneMesh = new THREE.Mesh(dyeGeo, dyeMat);
    this.group.add(this.dyePlaneMesh);

    this.vectorPositions = new Float32Array(this.vectorCount * 2 * 3);
    this.vectorColors = new Float32Array(this.vectorCount * 2 * 3);
    const vectorGeo = new THREE.BufferGeometry();
    vectorGeo.setAttribute('position', new THREE.BufferAttribute(this.vectorPositions, 3));
    vectorGeo.setAttribute('color', new THREE.BufferAttribute(this.vectorColors, 3));
    const vectorMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75
    });
    this.vectorLines = new THREE.LineSegments(vectorGeo, vectorMat);
    this.vectorLines.visible = false;
    this.group.add(this.vectorLines);

    this.tipVorticesPositions = new Float32Array(this.tipPoolSize * 2 * 3);
    this.tipVorticesColors = new Float32Array(this.tipPoolSize * 2 * 3);
    for (let i = 0; i < this.tipPoolSize; i++) {
      this.tipPool.push({
        x: 0,
        y: 0,
        z: 0,
        prevX: 0,
        prevY: 0,
        prevZ: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        ageSec: 0,
        maxAgeSec: 0.5,
        active: false
      });
    }

    const tipGeo = new THREE.BufferGeometry();
    tipGeo.setAttribute('position', new THREE.BufferAttribute(this.tipVorticesPositions, 3));
    tipGeo.setAttribute('color', new THREE.BufferAttribute(this.tipVorticesColors, 3));
    const tipMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    this.tipVorticesMesh = new THREE.LineSegments(tipGeo, tipMat);
    this.group.add(this.tipVorticesMesh);
    this.group.add(this.tipVorticesMesh);

    for (let s = 0; s < this.wakeStations.length; s++) {
      const ringGeo = new THREE.BufferGeometry();
      const ringPts = 32;
      const ringPos = new Float32Array((ringPts + 1) * 3);
      ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
      const ringMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.4
      });
      const loop = new THREE.LineLoop(ringGeo, ringMat);
      loop.visible = false;
      this.wakeRings.push(loop);
      this.group.add(loop);
    }
  }

  public update(
    dt: number,
    thrustN: number,
    hubPos: THREE.Vector3,
    fluidGrid?: FluidGrid,
    bladePhaseRad = 0,
    rpm = 0
  ): void {
    const halfL = this.pipeLengthM / 2;

    if (this.showForceVector) {
      this.arrow.position.copy(hubPos);
      const dir = thrustN >= 0 ? 1 : -1;
      this.arrow.setDirection(new THREE.Vector3(dir, 0, 0));
      const len = Math.max(0.02, Math.min(0.35, Math.abs(thrustN) * 0.04));
      this.arrow.setLength(len, len * 0.25, len * 0.15);
      this.arrow.visible = true;
    } else {
      this.arrow.visible = false;
    }

    this.streakMesh.visible = this.showParticleTracers;
    if (this.showParticleTracers) {
      const posAttr = this.streakMesh.geometry.attributes.position as THREE.BufferAttribute;
      const posArray = posAttr.array as Float32Array;

      const baseSpeed = 1.2;
      const hasGrid = fluidGrid && fluidGrid.width > 0 && fluidGrid.height > 0;
      const midY = hasGrid ? Math.floor(fluidGrid.height / 2) : 0;

      for (let i = 0; i < this.streakCount; i++) {
        const headIdx = i * 6;
        const tailIdx = headIdx + 3;

        posArray[tailIdx + 0] = posArray[headIdx + 0];
        posArray[tailIdx + 1] = posArray[headIdx + 1];
        posArray[tailIdx + 2] = posArray[headIdx + 2];

        let x = posArray[headIdx + 0];
        let vx = baseSpeed;
        if (hasGrid) {
          const uFraction = Math.max(0, Math.min(1, (x + halfL) / this.pipeLengthM));
          const gx = Math.min(fluidGrid.width - 1, Math.floor(uFraction * fluidGrid.width));
          const cell = midY * fluidGrid.width + gx;
          const uSample = fluidGrid.u[cell] ?? baseSpeed;
          vx = Math.max(0.2, uSample);
        }

        x += vx * dt;

        if (x > halfL) {
          x = -halfL;
          const angle = Math.random() * 2 * Math.PI;
          const r = Math.sqrt(Math.random()) * (this.pipeRadiusM * 0.88);
          const y = r * Math.cos(angle);
          const z = r * Math.sin(angle);
          posArray[headIdx + 1] = y;
          posArray[headIdx + 2] = z;
          posArray[tailIdx + 0] = x - 0.01;
          posArray[tailIdx + 1] = y;
          posArray[tailIdx + 2] = z;
        }

        posArray[headIdx + 0] = x;
        if (i < this.particleCount) {
          this.particlePositions[i * 3 + 0] = x;
          this.particlePositions[i * 3 + 1] = posArray[headIdx + 1];
          this.particlePositions[i * 3 + 2] = posArray[headIdx + 2];
        }
      }
      posAttr.needsUpdate = true;
      (this.pointsMesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    const showDye = this.mode === 'dye-velocity' || this.mode === 'dye-vorticity' || this.mode === 'pressure';
    this.dyePlaneMesh.visible = showDye;
    if (showDye) {
      const colorAttr = this.dyePlaneMesh.geometry.attributes.color as THREE.BufferAttribute;
      const colArray = colorAttr.array as Float32Array;
      const hasGrid = fluidGrid && fluidGrid.width > 0 && fluidGrid.height > 0;

      for (let r = 0; r < this.dyePlaneRows; r++) {
        const yNorm = r / (this.dyePlaneRows - 1);
        const gy = hasGrid ? Math.min(fluidGrid.height - 1, Math.floor(yNorm * fluidGrid.height)) : 0;

        for (let c = 0; c < this.dyePlaneCols; c++) {
          const xNorm = c / (this.dyePlaneCols - 1);
          const gx = hasGrid ? Math.min(fluidGrid.width - 1, Math.floor(xNorm * fluidGrid.width)) : 0;
          const vIdx = (r * this.dyePlaneCols + c) * 3;

          if (!hasGrid) {
            colArray[vIdx + 0] = 0.2;
            colArray[vIdx + 1] = 0.6;
            colArray[vIdx + 2] = 0.9;
            continue;
          }

          const cell = gy * fluidGrid.width + gx;

          if (this.mode === 'dye_velocity' || this.mode === 'dye-velocity') {
            const u = fluidGrid.u[cell] ?? 1.5;
            const v = fluidGrid.v[cell] ?? 0.0;
            const speed = Math.sqrt(u * u + v * v);
            const t = Math.max(0, Math.min(1, (speed - 0.5) / 3.0));

            colArray[vIdx + 0] = 0.12 + t * 0.87;
            colArray[vIdx + 1] = 0.23 + t * 0.67;
            colArray[vIdx + 2] = 0.54 - t * 0.20;
          } else if (this.mode === 'dye_vorticity' || this.mode === 'dye-vorticity') {
            const curl = Math.abs(fluidGrid.curl?.[cell] ?? 0.0);
            const t = Math.max(0, Math.min(1, curl * 0.05));
            colArray[vIdx + 0] = 0.12 + t * 0.73;
            colArray[vIdx + 1] = 0.11 + t * 0.16;
            colArray[vIdx + 2] = 0.29 + t * 0.65;
          } else if (this.mode === 'pressure') {
            const p = fluidGrid.pressure?.[cell] ?? 0.0;
            const normP = Math.max(-1, Math.min(1, p * 0.002));
            if (normP < 0) {
              const t = -normP;
              colArray[vIdx + 0] = 0.58 * (1 - t) + 0.13 * t;
              colArray[vIdx + 1] = 0.64 * (1 - t) + 0.83 * t;
              colArray[vIdx + 2] = 0.72 * (1 - t) + 0.93 * t;
            } else {
              const t = normP;
              colArray[vIdx + 0] = 0.58 * (1 - t) + 0.98 * t;
              colArray[vIdx + 1] = 0.64 * (1 - t) + 0.45 * t;
              colArray[vIdx + 2] = 0.72 * (1 - t) + 0.09 * t;
            }
          }
        }
      }
      colorAttr.needsUpdate = true;
    }

    this.vectorLines.visible = this.showVelocityVectors;
    if (this.showVelocityVectors) {
      const posAttr = this.vectorLines.geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = this.vectorLines.geometry.attributes.color as THREE.BufferAttribute;
      const posArr = posAttr.array as Float32Array;
      const colArr = colAttr.array as Float32Array;
      const hasGrid = fluidGrid && fluidGrid.width > 0 && fluidGrid.height > 0;

      for (let i = 0; i < this.vectorCount; i++) {
        const c = i % this.vectorCols;
        const r = Math.floor(i / this.vectorCols);

        const xFrac = (c + 0.5) / this.vectorCols;
        const yFrac = (r + 0.5) / this.vectorRows;
        const x = -halfL + xFrac * this.pipeLengthM;
        const y = -this.pipeRadiusM * 0.85 + yFrac * (this.pipeRadiusM * 1.7);

        const gx = hasGrid ? Math.min(fluidGrid.width - 1, Math.floor(xFrac * fluidGrid.width)) : 0;
        const gy = hasGrid ? Math.min(fluidGrid.height - 1, Math.floor(yFrac * fluidGrid.height)) : 0;
        const cell = gy * (fluidGrid?.width ?? 1) + gx;

        const u = hasGrid ? (fluidGrid?.u[cell] ?? 1.5) : 1.5;
        const v = hasGrid ? (fluidGrid?.v[cell] ?? 0.0) : 0.0;
        const speed = Math.sqrt(u * u + v * v);
        const scale = 0.018;

        const baseIdx = i * 6;
        posArr[baseIdx + 0] = x;
        posArr[baseIdx + 1] = y;
        posArr[baseIdx + 2] = 0;

        posArr[baseIdx + 3] = x + u * scale;
        posArr[baseIdx + 4] = y + v * scale;
        posArr[baseIdx + 5] = 0;

        const distFromDisc = Math.abs(x - this.propMountX);
        const proximity = Math.max(0.15, Math.min(1.0, 1.0 - distFromDisc / 0.55));
        const bright = Math.min(1.0, (speed / 3.0)) * proximity;

        colArr[baseIdx + 0] = 0.23 * bright;
        colArr[baseIdx + 1] = 0.51 * bright;
        colArr[baseIdx + 2] = 0.96 * bright;
        colArr[baseIdx + 3] = 0.23 * proximity;
        colArr[baseIdx + 4] = 0.51 * proximity;
        colArr[baseIdx + 5] = 0.96 * proximity;
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

    this.tipVorticesMesh.visible = this.showTipVortices;
    if (this.showTipVortices) {
      const posAttr = this.tipVorticesMesh.geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = this.tipVorticesMesh.geometry.attributes.color as THREE.BufferAttribute;
      const posArr = posAttr.array as Float32Array;
      const colArr = colAttr.array as Float32Array;
      const hasGrid = fluidGrid && fluidGrid.width > 0 && fluidGrid.height > 0;

      this.tipSpawnTimer += dt;
      if (this.tipSpawnTimer >= 0.02 && Math.abs(rpm) > 20) {
        this.tipSpawnTimer = 0;

        const numBlades = 3;
        const tipSpeed = (rpm * 2 * Math.PI * this.propRadiusM) / 60.0;

        for (let b = 0; b < numBlades; b++) {
          const bladeAng = bladePhaseRad + (b * 2 * Math.PI) / numBlades;
          const tipX = this.propMountX;
          const tipR = this.propRadiusM;
          const tipY = tipR * Math.cos(bladeAng);
          const tipZ = tipR * Math.sin(bladeAng);

          for (let p = 0; p < 2; p++) {
            let candidate = this.tipPool.find((pt) => !pt.active);
            if (!candidate) {
              candidate = this.tipPool.reduce((oldest, pt) => (pt.ageSec > oldest.ageSec ? pt : oldest));
            }
            if (candidate) {
              candidate.active = true;
              candidate.x = tipX + (p - 0.5) * 0.003;
              candidate.y = tipY;
              candidate.z = tipZ;
              candidate.prevX = candidate.x;
              candidate.prevY = candidate.y;
              candidate.prevZ = candidate.z;
              candidate.vx = 1.5;
              candidate.vy = -tipSpeed * Math.sin(bladeAng) * 0.35;
              candidate.vz = tipSpeed * Math.cos(bladeAng) * 0.35;
              candidate.ageSec = 0;
              candidate.maxAgeSec = 0.5;
            }
          }
        }
      }

      for (let i = 0; i < this.tipPool.length; i++) {
        const pt = this.tipPool[i];
        const baseIdx = i * 6;

        if (!pt.active) {
          posArr[baseIdx + 0] = 0;
          posArr[baseIdx + 1] = 0;
          posArr[baseIdx + 2] = -100;
          posArr[baseIdx + 3] = 0;
          posArr[baseIdx + 4] = 0;
          posArr[baseIdx + 5] = -100;
          continue;
        }

        pt.prevX = pt.x;
        pt.prevY = pt.y;
        pt.prevZ = pt.z;

        const xFrac = Math.max(0, Math.min(1, (pt.x + halfL) / this.pipeLengthM));
        const rCurrent = Math.sqrt(pt.y * pt.y + pt.z * pt.z);
        const yFrac = Math.max(0, Math.min(1, (rCurrent / this.pipeRadiusM) * 0.5 + 0.5));

        const gx = hasGrid ? Math.min(fluidGrid.width - 1, Math.floor(xFrac * fluidGrid.width)) : 0;
        const gy = hasGrid ? Math.min(fluidGrid.height - 1, Math.floor(yFrac * fluidGrid.height)) : 0;
        const cell = gy * (fluidGrid?.width ?? 1) + gx;

        const uAxial = hasGrid ? (fluidGrid?.u[cell] ?? 1.5) : 1.5;
        const vRadial = hasGrid ? (fluidGrid?.v[cell] ?? 0.0) : 0.0;

        const distPastMount = Math.max(0, pt.x - this.propMountX);
        const swirlDecay = Math.exp(-2.2 * distPastMount);
        const tangentialSpeed = Math.sqrt(pt.vy * pt.vy + pt.vz * pt.vz) * swirlDecay;
        const currentAngle = Math.atan2(pt.z, pt.y);
        const omegaSwirl = tangentialSpeed / Math.max(0.005, rCurrent);

        const nextAngle = currentAngle + omegaSwirl * dt;
        const nextR = Math.max(0.008, Math.min(this.pipeRadiusM * 0.95, rCurrent + vRadial * dt));

        pt.x += uAxial * dt;
        pt.y = nextR * Math.cos(nextAngle);
        pt.z = nextR * Math.sin(nextAngle);
        pt.ageSec += dt;

        if (pt.ageSec >= pt.maxAgeSec || pt.x > halfL) {
          pt.active = false;
        }

        posArr[baseIdx + 0] = pt.prevX;
        posArr[baseIdx + 1] = pt.prevY;
        posArr[baseIdx + 2] = pt.prevZ;
        posArr[baseIdx + 3] = pt.x;
        posArr[baseIdx + 4] = pt.y;
        posArr[baseIdx + 5] = pt.z;

        const alpha = Math.max(0, 1.0 - pt.ageSec / pt.maxAgeSec);
        colArr[baseIdx + 0] = 0.99 * alpha;
        colArr[baseIdx + 1] = 0.90 * alpha;
        colArr[baseIdx + 2] = 0.54 * alpha;
        colArr[baseIdx + 3] = 0.99 * alpha;
        colArr[baseIdx + 4] = 0.90 * alpha;
        colArr[baseIdx + 5] = 0.54 * alpha;
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

    for (let s = 0; s < this.wakeStations.length; s++) {
      const loop = this.wakeRings[s];
      loop.visible = this.showWakeEnvelope;
      if (this.showWakeEnvelope) {
        const distFromProp = this.wakeStations[s];
        const ringX = this.propMountX + distFromProp;

        const hasGrid = fluidGrid && fluidGrid.width > 0 && fluidGrid.height > 0;
        let ringR = this.propRadiusM * 0.88;
        let wakeAlpha = 0.4;

        if (hasGrid) {
          const xFrac = Math.max(0, Math.min(1, (ringX + halfL) / this.pipeLengthM));
          const gx = Math.min(fluidGrid.width - 1, Math.floor(xFrac * fluidGrid.width));
          const midY = Math.floor(fluidGrid.height / 2);
          const vFreestream = Math.max(0.2, fluidGrid.u[0] || 1.5);
          const threshold = 1.05 * vFreestream;
          const uCenter = fluidGrid.u[midY * fluidGrid.width + gx] ?? vFreestream;

          let rCells = 0;
          for (let gy = midY; gy < fluidGrid.height - 1; gy++) {
            const uVal = fluidGrid.u[gy * fluidGrid.width + gx];
            if (uVal <= threshold) {
              const prevU = fluidGrid.u[(gy - 1) * fluidGrid.width + gx];
              const frac = (prevU - threshold) / Math.max(1e-4, prevU - uVal);
              rCells = (gy - 1 - midY) + frac;
              break;
            }
          }

          if (rCells > 0) {
            ringR = Math.max(0.01, Math.min(this.pipeRadiusM * 0.95, (rCells / (fluidGrid.height / 2)) * this.pipeRadiusM));
          } else {
            ringR = this.propRadiusM * 0.85;
          }

          wakeAlpha = Math.max(0.0, Math.min(0.65, (uCenter - threshold) / Math.max(1e-4, uCenter)));
        }

        (loop.material as THREE.LineBasicMaterial).opacity = wakeAlpha;

        const posAttr = loop.geometry.attributes.position as THREE.BufferAttribute;
        const posArr = posAttr.array as Float32Array;
        const pts = 32;
        for (let p = 0; p <= pts; p++) {
          const ang = (p / pts) * 2 * Math.PI;
          posArr[p * 3 + 0] = ringX;
          posArr[p * 3 + 1] = ringR * Math.cos(ang);
          posArr[p * 3 + 2] = ringR * Math.sin(ang);
        }
        posAttr.needsUpdate = true;
      }
    }
  }

  public dispose(): void {
    this.pointsMesh.geometry.dispose();
    (this.pointsMesh.material as THREE.Material).dispose();

    this.streakMesh.geometry.dispose();
    (this.streakMesh.material as THREE.Material).dispose();

    this.dyePlaneMesh.geometry.dispose();
    (this.dyePlaneMesh.material as THREE.Material).dispose();

    this.vectorLines.geometry.dispose();
    (this.vectorLines.material as THREE.Material).dispose();

    this.tipVorticesMesh.geometry.dispose();
    (this.tipVorticesMesh.material as THREE.Material).dispose();

    for (const loop of this.wakeRings) {
      loop.geometry.dispose();
      (loop.material as THREE.Material).dispose();
    }
  }
}
