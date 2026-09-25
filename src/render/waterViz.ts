import * as THREE from 'three';
import type { TestStandPipe } from './pipe';
import { FluidGrid, worldToGridX } from '../fluid/grid';
import type { PropellerShaft } from '../prop/rigidbody';
import { defaultConfig } from '../core/config';

export type WaterVizMode = 'dye_velocity' | 'dye_vorticity' | 'off';

export interface WaterVizOptions {
  sliceCount?: number;
  particleCount?: number;
  streamerPoolSize?: number;
}

interface ParticleState {
  x: number;
  r: number;
  theta: number;
  vx: number;
  vr: number;
  vTheta: number;
  age: number;
  maxAge: number;
  history: [number, number, number][];
}

interface TipStreamer {
  active: boolean;
  age: number;
  maxAge: number;
  vorticity: number;
  points: [number, number, number][];
}

export class WaterVisualization {
  public group: THREE.Group;
  public mode: WaterVizMode = 'dye_velocity';
  public particlesVisible = true;

  private pipe: TestStandPipe;
  private sliceCount: number;
  private particleCount: number;

  private sliceMesh: THREE.InstancedMesh;
  private sliceGeo: THREE.PlaneGeometry;
  private sliceMat: THREE.ShaderMaterial;
  private fluidTexture: THREE.DataTexture;
  private fluidTexData: Float32Array;

  private particles: ParticleState[] = [];
  private particleLinesMesh: THREE.LineSegments;
  private particleGeo: THREE.BufferGeometry;
  private particlePosAttr: THREE.BufferAttribute;
  private particleColAttr: THREE.BufferAttribute;
  private particlePositions: Float32Array;
  private particleColors: Float32Array;

  private streamers: TipStreamer[] = [];
  private streamerPoolSize: number;
  private streamerLinesMesh: THREE.LineSegments;
  private streamerGeo: THREE.BufferGeometry;
  private streamerPosAttr: THREE.BufferAttribute;
  private streamerColAttr: THREE.BufferAttribute;
  private streamerPositions: Float32Array;
  private streamerColors: Float32Array;
  private lastStreamerSeedSimTime = 0;
  private simTime = 0;

  constructor(pipe: TestStandPipe, grid: FluidGrid, options?: WaterVizOptions) {
    this.pipe = pipe;
    this.sliceCount = options?.sliceCount ?? 48;
    this.particleCount = options?.particleCount ?? 600;
    this.streamerPoolSize = options?.streamerPoolSize ?? 12;

    this.group = new THREE.Group();

    const sliceSpan = 0.24;
    this.sliceGeo = new THREE.PlaneGeometry(sliceSpan, sliceSpan);

    const W = grid.width;
    const H = grid.height;
    this.fluidTexData = new Float32Array(W * H * 4);
    this.fluidTexture = new THREE.DataTexture(
      this.fluidTexData,
      W,
      H,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.fluidTexture.minFilter = THREE.LinearFilter;
    this.fluidTexture.magFilter = THREE.LinearFilter;
    this.fluidTexture.needsUpdate = true;

    this.sliceMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      uniforms: {
        tFluid: { value: this.fluidTexture },
        pipeRadius: { value: pipe.radiusM },
        pipeLength: { value: pipe.lengthM },
        vMax: { value: 1.8 * defaultConfig.fluid.inflowVelocity },
        omegaMax: { value: 60.0 },
        vizMode: { value: 0 },
        sliceIndex: { value: 0 }
      },
      vertexShader: `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 worldPos = instanceMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D tFluid;
        uniform float pipeRadius;
        uniform float pipeLength;
        uniform float vMax;
        uniform float omegaMax;
        uniform int vizMode;
        varying vec3 vWorldPos;
        varying vec2 vUv;

        vec3 colormapVelocity(float s) {
          s = clamp(s, 0.0, 1.0);
          vec3 c0 = vec3(0.039, 0.102, 0.227);
          vec3 c1 = vec3(0.118, 0.369, 0.620);
          vec3 c2 = vec3(0.369, 0.784, 1.000);
          vec3 c3 = vec3(0.659, 0.894, 1.000);
          vec3 c4 = vec3(0.992, 0.902, 0.541);

          if (s < 0.4) return mix(c0, c1, s / 0.4);
          if (s < 0.7) return mix(c1, c2, (s - 0.4) / 0.3);
          if (s < 0.9) return mix(c2, c3, (s - 0.7) / 0.2);
          return mix(c3, c4, (s - 0.9) / 0.1);
        }

        vec3 colormapVorticity(float w) {
          float norm = clamp(w / omegaMax, -1.0, 1.0);
          vec3 neg = vec3(0.118, 0.251, 0.686);
          vec3 mid = vec3(0.580, 0.639, 0.722);
          vec3 pos = vec3(0.957, 0.447, 0.714);
          if (norm < 0.0) return mix(mid, neg, -norm);
          return mix(mid, pos, norm);
        }

        void main() {
          if (vizMode == 2) discard;

          if (abs(vWorldPos.x) > pipeLength * 0.5) discard;

          float r = length(vWorldPos.yz);
          if (r > pipeRadius) discard;

          float uTex = clamp((vWorldPos.x + pipeLength * 0.5) / pipeLength, 0.0, 1.0);
          float vTex = clamp((vWorldPos.y + pipeRadius) / (2.0 * pipeRadius), 0.0, 1.0);

          vec4 fluidSample = texture2D(tFluid, vec2(uTex, vTex));
          float uVel = fluidSample.r;
          float vVel = fluidSample.g;
          float dye = fluidSample.b;
          float curl = fluidSample.a;

          if (dye < 0.005) discard;

          float falloff = 1.0 - 0.6 * (r / pipeRadius);

          vec3 rgb = vec3(0.0);
          if (vizMode == 0) {
            float speed = length(vec2(uVel, vVel));
            rgb = colormapVelocity(speed / vMax);
          } else {
            rgb = colormapVorticity(curl);
          }

          float alpha = clamp(dye * falloff * 0.08, 0.0, 0.40);
          gl_FragColor = vec4(rgb, alpha);
        }
      `
    });

    this.sliceMesh = new THREE.InstancedMesh(this.sliceGeo, this.sliceMat, this.sliceCount);
    this.sliceMesh.frustumCulled = false;
    this.sliceMesh.castShadow = false;
    this.sliceMesh.receiveShadow = false;
    this.group.add(this.sliceMesh);

    this.initParticles(pipe);
    const trailSegments = 3;
    const totalLines = this.particleCount * trailSegments;
    this.particlePositions = new Float32Array(totalLines * 2 * 3);
    this.particleColors = new Float32Array(totalLines * 2 * 4);

    this.particleGeo = new THREE.BufferGeometry();
    this.particlePosAttr = new THREE.BufferAttribute(this.particlePositions, 3);
    this.particleColAttr = new THREE.BufferAttribute(this.particleColors, 4);
    this.particleGeo.setAttribute('position', this.particlePosAttr);
    this.particleGeo.setAttribute('color', this.particleColAttr);

    const particleMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.particleLinesMesh = new THREE.LineSegments(this.particleGeo, particleMat);
    this.particleLinesMesh.frustumCulled = false;
    this.group.add(this.particleLinesMesh);

    const maxStreamerSegments = 20;
    const totalStreamerLines = this.streamerPoolSize * maxStreamerSegments;
    this.streamerPositions = new Float32Array(totalStreamerLines * 2 * 3);
    this.streamerColors = new Float32Array(totalStreamerLines * 2 * 4);

    this.streamerGeo = new THREE.BufferGeometry();
    this.streamerPosAttr = new THREE.BufferAttribute(this.streamerPositions, 3);
    this.streamerColAttr = new THREE.BufferAttribute(this.streamerColors, 4);
    this.streamerGeo.setAttribute('position', this.streamerPosAttr);
    this.streamerGeo.setAttribute('color', this.streamerColAttr);

    const streamerMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.streamerLinesMesh = new THREE.LineSegments(this.streamerGeo, streamerMat);
    this.streamerLinesMesh.frustumCulled = false;
    this.group.add(this.streamerLinesMesh);

    for (let s = 0; s < this.streamerPoolSize; s++) {
      this.streamers.push({
        active: false,
        age: 0,
        maxAge: 0.4,
        vorticity: 0,
        points: []
      });
    }
  }

  private initParticles(pipe: TestStandPipe): void {
    const halfL = pipe.lengthM / 2.0;
    const R = pipe.radiusM;

    for (let p = 0; p < this.particleCount; p++) {
      const x = -halfL + Math.random() * pipe.lengthM;
      const r = 0.0035 + Math.sqrt(Math.random()) * (R * 0.90 - 0.0035);
      const theta = Math.random() * Math.PI * 2.0;
      const y3d = r * Math.sin(theta);
      const z3d = r * Math.cos(theta);

      this.particles.push({
        x,
        r,
        theta,
        vx: defaultConfig.fluid.inflowVelocity,
        vr: 0,
        vTheta: 0,
        age: Math.random() * 2.5,
        maxAge: 2.0 + Math.random() * 1.5,
        history: [
          [x, y3d, z3d],
          [x, y3d, z3d],
          [x, y3d, z3d],
          [x, y3d, z3d]
        ]
      });
    }
  }

  public setMode(mode: WaterVizMode): void {
    this.mode = mode;
    const modeInt = mode === 'dye_velocity' ? 0 : mode === 'dye_vorticity' ? 1 : 2;
    this.sliceMat.uniforms.vizMode.value = modeInt;
  }

  public setParticlesVisible(visible: boolean): void {
    this.particlesVisible = visible;
    this.particleLinesMesh.visible = visible;
    this.streamerLinesMesh.visible = visible;
  }

  public stepParticles(dt: number, fluidGrid: FluidGrid, shaft: PropellerShaft): void {
    this.simTime += dt;
    const halfL = this.pipe.lengthM / 2.0;
    const R = this.pipe.radiusM;
    const propX = this.pipe.propMountX;
    const rpm = shaft.currentRpm;

    for (let p = 0; p < this.particleCount; p++) {
      const part = this.particles[p];
      part.age += dt;

      if (part.x > halfL || part.age >= part.maxAge) {
        part.x = -halfL + Math.random() * 0.005;
        part.r = 0.0035 + Math.sqrt(Math.random()) * (R * 0.90 - 0.0035);
        part.theta = Math.random() * Math.PI * 2.0;
        part.age = 0;
        part.maxAge = 2.0 + Math.random() * 1.5;
        const y3d = part.r * Math.sin(part.theta);
        const z3d = part.r * Math.cos(part.theta);
        part.history = [
          [part.x, y3d, z3d],
          [part.x, y3d, z3d],
          [part.x, y3d, z3d],
          [part.x, y3d, z3d]
        ];
        continue;
      }

      const gx = worldToGridX(part.x, fluidGrid.width, this.pipe.lengthM);
      const gy = (part.r / R) * (fluidGrid.height - 1);
      const uSample = fluidGrid.sampleBilinear(fluidGrid.u, gx, gy);
      const vSample = fluidGrid.sampleBilinear(fluidGrid.v, gx, gy);

      part.vx = uSample > 0.01 ? uSample : defaultConfig.fluid.inflowVelocity;
      part.vr = vSample;

      if (part.x > propX && part.x < propX + 0.08 && Math.abs(rpm) > 50) {
        const swirlFactor = Math.max(0, 1.0 - (part.x - propX) / 0.08);
        const swirlOmega = (rpm / 60.0) * 2.0 * Math.PI * 0.06 * swirlFactor;
        part.theta += swirlOmega * dt;
      }

      part.x += part.vx * dt;
      part.r = Math.max(0.003, Math.min(R * 0.94, part.r + part.vr * dt));

      const curY = part.r * Math.sin(part.theta);
      const curZ = part.r * Math.cos(part.theta);

      part.history.shift();
      part.history.push([part.x, curY, curZ]);
    }

    if (Math.abs(rpm) > 100 && this.simTime - this.lastStreamerSeedSimTime >= 0.05) {
      this.lastStreamerSeedSimTime = this.simTime;
      const numBlades = 3;
      const tipRadius = 0.021;

      for (let b = 0; b < numBlades; b++) {
        const bladeAngle = shaft.bladePhaseRad + (b * 2.0 * Math.PI) / numBlades;
        const tipY = tipRadius * Math.sin(bladeAngle);
        const tipZ = tipRadius * Math.cos(bladeAngle);

        let slot = this.streamers.find((s) => !s.active);
        if (!slot) {
          slot = this.streamers.reduce((oldest, s) => (s.age > oldest.age ? s : oldest), this.streamers[0]);
        }

        if (slot) {
          slot.active = true;
          slot.age = 0;
          slot.maxAge = 0.4;
          const gx = worldToGridX(propX, fluidGrid.width, this.pipe.lengthM);
          const gy = (tipRadius / R) * (fluidGrid.height - 1);
          slot.vorticity = fluidGrid.sampleBilinear(fluidGrid.curl, gx, gy);
          slot.points = [[propX, tipY, tipZ]];
        }
      }
    }

    for (let s = 0; s < this.streamerPoolSize; s++) {
      const st = this.streamers[s];
      if (!st.active) continue;
      st.age += dt;
      if (st.age >= st.maxAge) {
        st.active = false;
        st.points = [];
        continue;
      }

      for (let i = 0; i < st.points.length; i++) {
        const pt = st.points[i];
        const gx = worldToGridX(pt[0], fluidGrid.width, this.pipe.lengthM);
        const rPt = Math.sqrt(pt[1] * pt[1] + pt[2] * pt[2]);
        const gy = (rPt / R) * (fluidGrid.height - 1);

        const uVal = fluidGrid.sampleBilinear(fluidGrid.u, gx, gy);
        const vVal = fluidGrid.sampleBilinear(fluidGrid.v, gx, gy);
        pt[0] += (uVal > 0 ? uVal : defaultConfig.fluid.inflowVelocity) * dt;

        let theta = Math.atan2(pt[1], pt[2]);
        const swirlOmega = (rpm / 60.0) * 2.0 * Math.PI * 0.05;
        theta += swirlOmega * dt;
        const rNew = Math.max(0.003, Math.min(R * 0.95, rPt + vVal * dt));
        pt[1] = rNew * Math.sin(theta);
        pt[2] = rNew * Math.cos(theta);
      }

      if (st.points.length > 20) st.points.shift();
    }
  }

  public update(dt: number, fluidGrid: FluidGrid, shaft: PropellerShaft, camera?: THREE.Camera): void {
    void dt;
    void shaft;

    const W = fluidGrid.width;
    const H = fluidGrid.height;
    const u = fluidGrid.u;
    const v = fluidGrid.v;
    const dye = fluidGrid.dye;
    const curl = fluidGrid.curl;
    const texData = this.fluidTexData;

    for (let j = 0; j < H; j++) {
      const row = j * W;
      for (let i = 0; i < W; i++) {
        const idx = row + i;
        const tIdx = idx * 4;
        texData[tIdx + 0] = u[idx];
        texData[tIdx + 1] = v[idx];
        texData[tIdx + 2] = dye[idx];
        texData[tIdx + 3] = curl[idx];
      }
    }
    this.fluidTexture.needsUpdate = true;

    const depthSpan = this.pipe.radiusM * 2.0;
    const pipeCenter = new THREE.Vector3(0, 0, 0);
    const toCamera = camera
      ? new THREE.Vector3().subVectors(camera.position, pipeCenter).normalize()
      : new THREE.Vector3(0, 0, 1);

    const dummy = new THREE.Object3D();
    for (let k = 0; k < this.sliceCount; k++) {
      const t = (k + 0.5) / this.sliceCount;
      const offset = (t - 0.5) * depthSpan;

      dummy.position.copy(pipeCenter).addScaledVector(toCamera, offset);
      if (camera) {
        dummy.quaternion.copy(camera.quaternion);
      } else {
        dummy.rotation.set(0, 0, 0);
      }
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.sliceMesh.setMatrixAt(k, dummy.matrix);
    }
    this.sliceMesh.instanceMatrix.needsUpdate = true;

    if (this.particlesVisible) {
      let lineVertexIdx = 0;
      const vMax = 1.8 * defaultConfig.fluid.inflowVelocity;

      for (let p = 0; p < this.particleCount; p++) {
        const part = this.particles[p];
        const hist = part.history;

        for (let seg = 0; seg < hist.length - 1; seg++) {
          const p0 = hist[seg];
          const p1 = hist[seg + 1];

          const vIdx0 = lineVertexIdx * 3;
          this.particlePositions[vIdx0 + 0] = p0[0];
          this.particlePositions[vIdx0 + 1] = p0[1];
          this.particlePositions[vIdx0 + 2] = p0[2];

          const vIdx1 = (lineVertexIdx + 1) * 3;
          this.particlePositions[vIdx1 + 0] = p1[0];
          this.particlePositions[vIdx1 + 1] = p1[1];
          this.particlePositions[vIdx1 + 2] = p1[2];

          const speed = Math.sqrt(part.vx * part.vx + part.vr * part.vr);
          const sNorm = Math.min(1.0, speed / vMax);
          const c0Alpha = (seg / (hist.length - 1)) * 0.75 * 1.4;
          const c1Alpha = ((seg + 1) / (hist.length - 1)) * 0.90 * 1.4;

          const colIdx0 = lineVertexIdx * 4;
          this.particleColors[colIdx0 + 0] = 0.35 + 0.65 * sNorm;
          this.particleColors[colIdx0 + 1] = 0.75 + 0.25 * sNorm;
          this.particleColors[colIdx0 + 2] = 1.0;
          this.particleColors[colIdx0 + 3] = c0Alpha;

          const colIdx1 = (lineVertexIdx + 1) * 4;
          this.particleColors[colIdx1 + 0] = 0.35 + 0.65 * sNorm;
          this.particleColors[colIdx1 + 1] = 0.75 + 0.25 * sNorm;
          this.particleColors[colIdx1 + 2] = 1.0;
          this.particleColors[colIdx1 + 3] = c1Alpha;

          lineVertexIdx += 2;
        }
      }
      this.particlePosAttr.needsUpdate = true;
      this.particleColAttr.needsUpdate = true;

      let streamerVertexIdx = 0;
      for (let s = 0; s < this.streamerPoolSize; s++) {
        const st = this.streamers[s];
        if (!st.active || st.points.length < 2) continue;

        const life = 1.0 - st.age / st.maxAge;
        for (let seg = 0; seg < st.points.length - 1; seg++) {
          const pt0 = st.points[seg];
          const pt1 = st.points[seg + 1];

          const v0 = streamerVertexIdx * 3;
          this.streamerPositions[v0 + 0] = pt0[0];
          this.streamerPositions[v0 + 1] = pt0[1];
          this.streamerPositions[v0 + 2] = pt0[2];

          const v1 = (streamerVertexIdx + 1) * 3;
          this.streamerPositions[v1 + 0] = pt1[0];
          this.streamerPositions[v1 + 1] = pt1[1];
          this.streamerPositions[v1 + 2] = pt1[2];

          const c0 = streamerVertexIdx * 4;
          this.streamerColors[c0 + 0] = 0.95;
          this.streamerColors[c0 + 1] = 0.45;
          this.streamerColors[c0 + 2] = 0.75;
          this.streamerColors[c0 + 3] = life * 0.8;

          const c1 = (streamerVertexIdx + 1) * 4;
          this.streamerColors[c1 + 0] = 0.95;
          this.streamerColors[c1 + 1] = 0.45;
          this.streamerColors[c1 + 2] = 0.75;
          this.streamerColors[c1 + 3] = life * 0.8;

          streamerVertexIdx += 2;
        }
      }

      for (let i = streamerVertexIdx * 3; i < this.streamerPositions.length; i++) {
        this.streamerPositions[i] = 0;
      }
      for (let i = streamerVertexIdx * 4; i < this.streamerColors.length; i++) {
        this.streamerColors[i] = 0;
      }
      this.streamerPosAttr.needsUpdate = true;
      this.streamerColAttr.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.sliceGeo.dispose();
    this.sliceMat.dispose();
    this.fluidTexture.dispose();
    this.particleGeo.dispose();
    (this.particleLinesMesh.material as THREE.Material).dispose();
    this.streamerGeo.dispose();
    (this.streamerLinesMesh.material as THREE.Material).dispose();
  }
}
