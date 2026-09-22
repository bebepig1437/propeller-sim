

import * as THREE from 'three';
import type { FluidGrid } from '../fluid/grid';
import {
  DualScrollingNormalMapGenerator,
  createWaterPhysicalMaterial,
  type WaterMaterialOptions
} from './water';

export interface GerstnerWaveOctave {
  direction: [number, number];
  amplitude: number;
  frequency: number;
  speed: number;
  steepness: number;
}

export interface WaterSurfaceParams extends WaterMaterialOptions {
  size?: number;
  segments?: number;
  elevation?: number;
  amplitude?: number;
  frequency?: number;
  speed?: number;
  foamThreshold?: number;
  foamLifetime?: number;
  cutoffWavelength?: number;
}

export class WaterSurface {
  public mesh: THREE.Mesh;
  public geometry: THREE.PlaneGeometry;
  public material: THREE.MeshPhysicalMaterial;
  public normalGenerator: DualScrollingNormalMapGenerator;


  public elevation: number;
  public amplitude: number;
  public frequency: number;
  public speed: number;
  public foamThreshold: number;
  public foamLifetime: number;
  public cutoffWavelength: number;
  public size: number;
  public segments: number;


  private originalPositions: Float32Array;
  private colors: Float32Array;
  private foamIntensity: Float32Array;
  private octaves: GerstnerWaveOctave[];


  public fluidSurfaceElevation: Float32Array;
  public prevFluidSurfaceElevation: Float32Array | null = null;
  public prevFluidGridWidth = 0;
  public crossfadeDurationSec = 0.250;
  public crossfadeRemainingSec = 0;
  private fluidGridWidth = 256;

  constructor(params?: WaterSurfaceParams) {
    this.size = params?.size ?? 2.4;

    this.segments = params?.segments !== undefined ? params.segments : 511;
    this.elevation = params?.elevation ?? 0.22;
    this.amplitude = params?.amplitude ?? 0.005;
    this.frequency = params?.frequency ?? 2.5;
    this.speed = params?.speed ?? 1.1;
    this.foamThreshold = params?.foamThreshold ?? 1.8;
    this.foamLifetime = params?.foamLifetime ?? 5.0;
    this.cutoffWavelength = params?.cutoffWavelength ?? 0.05;

    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI / 2);

    const vertexCount = this.geometry.attributes.position.count;
    this.originalPositions = new Float32Array(this.geometry.attributes.position.array);


    this.colors = new Float32Array(vertexCount * 3);
    this.foamIntensity = new Float32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      this.colors[i * 3 + 0] = 0.05;
      this.colors[i * 3 + 1] = 0.52;
      this.colors[i * 3 + 2] = 0.78;
    }
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));


    this.normalGenerator = new DualScrollingNormalMapGenerator(128);


    this.material = createWaterPhysicalMaterial(this.normalGenerator.texture, {
      transmission: params?.transmission ?? 0.88,
      roughness: params?.roughness ?? 0.04
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = this.elevation;
    this.mesh.receiveShadow = true;


    this.octaves = [
      { direction: [1.0, 0.25], amplitude: 0.45, frequency: 1.0, speed: 1.0, steepness: 0.35 },
      { direction: [-0.7, 0.7], amplitude: 0.30, frequency: 2.1, speed: 1.3, steepness: 0.40 },
      { direction: [0.35, -0.9], amplitude: 0.15, frequency: 3.8, speed: 1.7, steepness: 0.45 },
      { direction: [-0.9, -0.4], amplitude: 0.10, frequency: 5.4, speed: 2.2, steepness: 0.50 }
    ];

    this.fluidSurfaceElevation = new Float32Array(this.fluidGridWidth);
  }

  
  public setMeshResolution(segments: number): void {
    if (this.segments === segments) return;
    this.segments = segments;
    this.geometry.dispose();

    this.geometry = new THREE.PlaneGeometry(this.size, this.size, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);

    const vertexCount = this.geometry.attributes.position.count;
    this.originalPositions = new Float32Array(this.geometry.attributes.position.array);
    this.colors = new Float32Array(vertexCount * 3);
    this.foamIntensity = new Float32Array(vertexCount);

    for (let i = 0; i < vertexCount; i++) {
      this.colors[i * 3 + 0] = 0.05;
      this.colors[i * 3 + 1] = 0.52;
      this.colors[i * 3 + 2] = 0.78;
    }
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.mesh.geometry = this.geometry;
  }

  
  public getHeightfieldEnergy(): number {
    let total = 0;
    for (let i = 0; i < this.fluidSurfaceElevation.length; i++) {
      total += Math.abs(this.fluidSurfaceElevation[i]);
    }
    return total;
  }

  
  public getGerstnerDisplacement(
    x: number,
    z: number,
    time: number,
    localSpeed = 0.0,
    flowDirX = 0.0,
    flowDirZ = 0.0
  ): { dy: number; dx: number; dz: number } {
    let dy = 0;
    let dx = 0;
    let dz = 0;
    const t = time * this.speed;


    const speedScale = localSpeed > 0 ? Math.min(1.0, localSpeed / 0.4) : 0.0;
    if (speedScale <= 0.0001 && this.amplitude <= 0) {
      return { dy: 0, dx: 0, dz: 0 };
    }

    const effectiveAmplitude = this.amplitude * speedScale;

    for (let i = 0; i < this.octaves.length; i++) {
      const oct = this.octaves[i];
      const k = oct.frequency * this.frequency;
      const wavelength = (2.0 * Math.PI) / (k + 1e-5);


      if (wavelength > this.cutoffWavelength * 4.0) {
        continue;
      }

      const a = oct.amplitude * effectiveAmplitude;
      const omega = Math.sqrt(9.81 * k) * oct.speed;


      let dirX = oct.direction[0];
      let dirZ = oct.direction[1];
      if (flowDirX !== 0 || flowDirZ !== 0) {
        const blX = dirX + flowDirX * 0.7;
        const blZ = dirZ + flowDirZ * 0.7;
        const blLen = Math.hypot(blX, blZ);
        if (blLen > 1e-4) {
          dirX = blX / blLen;
          dirZ = blZ / blLen;
        }
      }

      const phase = k * (dirX * x + dirZ * z) - omega * t;
      const cosP = Math.cos(phase);
      const sinP = Math.sin(phase);

      dy += a * cosP;
      const qk = (oct.steepness * a) / (k + 1e-5);
      dx -= qk * dirX * sinP;
      dz -= qk * dirZ * sinP;
    }

    return { dy, dx, dz };
  }

  
  public getElevationAt(x: number, z: number, time: number): number {
    return this.elevation + this.getGerstnerDisplacement(x, z, time, 0.5).dy;
  }

  
  public update(time: number, dt = 1.0 / 60.0, fluidGrid?: FluidGrid): void {

    this.normalGenerator.update(time);
    if (this.crossfadeRemainingSec > 0) {
      this.crossfadeRemainingSec = Math.max(0, this.crossfadeRemainingSec - dt);
    }


    if (fluidGrid) {
      if (this.fluidSurfaceElevation.length !== fluidGrid.width) {
        if (this.fluidSurfaceElevation.length > 0) {
          this.prevFluidSurfaceElevation = new Float32Array(this.fluidSurfaceElevation);
          this.prevFluidGridWidth = this.fluidGridWidth;
          this.crossfadeRemainingSec = this.crossfadeDurationSec;
        }
        this.fluidGridWidth = fluidGrid.width;
        this.fluidSurfaceElevation = new Float32Array(fluidGrid.width);
      }

      const W = fluidGrid.width;
      const H = fluidGrid.height;
      const surfY = Math.max(1, H - 2);
      const row = surfY * W;
      const elev = this.fluidSurfaceElevation;
      const v = fluidGrid.v;

      const gRestoring = 4.0;
      const damping = 0.985;

      for (let x = 0; x < W; x++) {
        const vSurf = v[row + x];

        elev[x] += dt * (vSurf * 0.15 - gRestoring * elev[x]);
        elev[x] *= damping;

        if (elev[x] > 0.05) elev[x] = 0.05;
        if (elev[x] < -0.05) elev[x] = -0.05;
      }
    }


    const posAttr = this.geometry.attributes.position;
    const posArray = posAttr.array as Float32Array;
    const orig = this.originalPositions;
    const colors = this.colors;
    const foam = this.foamIntensity;
    const vertexCount = posAttr.count;

    const tankSize = this.size;
    const halfSize = tankSize * 0.5;


    const foamColorR = 0.95;
    const foamColorG = 0.99;
    const foamColorB = 1.00;


    const waterBaseR = 0.05;
    const waterBaseG = 0.52;
    const waterBaseB = 0.78;

    const foamDecayRate = dt / Math.max(0.1, this.foamLifetime);

    for (let i = 0; i < vertexCount; i++) {
      const i3 = i * 3;
      const xOrig = orig[i3];
      const zOrig = orig[i3 + 2];


      let fluidH = 0.0;
      let newFoam = 0.0;
      let localSpeed = 0.0;
      let flowDirX = 0.0;
      let flowDirZ = 0.0;


      if (fluidGrid && xOrig >= -halfSize && xOrig <= halfSize) {
        const normX = Math.max(0.0, Math.min(1.0, (xOrig + halfSize) / tankSize));
        const gx = normX * (fluidGrid.width - 1);


        const gx0 = Math.floor(gx);
        const gx1 = Math.min(fluidGrid.width - 1, gx0 + 1);
        const frac = gx - gx0;
        const newFluidH = (1.0 - frac) * this.fluidSurfaceElevation[gx0] + frac * this.fluidSurfaceElevation[gx1];

        if (this.crossfadeRemainingSec > 0 && this.prevFluidSurfaceElevation && this.prevFluidGridWidth > 0) {
          const oldGx = normX * (this.prevFluidGridWidth - 1);
          const ogx0 = Math.floor(oldGx);
          const ogx1 = Math.min(this.prevFluidGridWidth - 1, ogx0 + 1);
          const ofrac = oldGx - ogx0;
          const oldFluidH = (1.0 - ofrac) * this.prevFluidSurfaceElevation[ogx0] + ofrac * this.prevFluidSurfaceElevation[ogx1];
          const progress = 1.0 - (this.crossfadeRemainingSec / this.crossfadeDurationSec);
          const alpha = progress * progress * (3.0 - 2.0 * progress);
          fluidH = (1.0 - alpha) * oldFluidH + alpha * newFluidH;
        } else {
          fluidH = newFluidH;
        }


        const surfY = Math.max(1, fluidGrid.height - 2);
        const curlVal = Math.abs(fluidGrid.sampleBilinear(fluidGrid.curl, gx, surfY));
        const uVal = fluidGrid.sampleBilinear(fluidGrid.u, gx, surfY);
        const vVal = fluidGrid.sampleBilinear(fluidGrid.v, gx, surfY);
        localSpeed = Math.hypot(uVal, vVal);

        if (localSpeed > 1e-4) {
          flowDirX = uVal / localSpeed;
          flowDirZ = 0.0;
        }


        const shear = curlVal * 1.2 + localSpeed * 0.5;


        if (shear > this.foamThreshold) {
          const t = Math.min(1.0, (shear - this.foamThreshold) / (this.foamThreshold * 1.5));
          newFoam = t * t * (3.0 - 2.0 * t);
        }
      }


      foam[i] = Math.max(newFoam, Math.max(0.0, foam[i] - foamDecayRate));
      const foamAmount = foam[i];


      const gerstner = this.getGerstnerDisplacement(xOrig, zOrig, time, localSpeed, flowDirX, flowDirZ);


      posArray[i3 + 0] = xOrig + gerstner.dx;
      posArray[i3 + 1] = fluidH + gerstner.dy;
      posArray[i3 + 2] = zOrig + gerstner.dz;


      colors[i3 + 0] = waterBaseR + (foamColorR - waterBaseR) * foamAmount;
      colors[i3 + 1] = waterBaseG + (foamColorG - waterBaseG) * foamAmount;
      colors[i3 + 2] = waterBaseB + (foamColorB - waterBaseB) * foamAmount;
    }

    posAttr.needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  public setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  public dispose(): void {
    this.normalGenerator.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
