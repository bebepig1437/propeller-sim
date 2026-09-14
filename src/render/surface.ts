/**
 * 3D Water Free Surface Heightfield Module (Phase 3)
 *
 * Citations:
 * 1. Gerstner, F. J. (1809). "Theorie der Wellen". Abhandlungen der königlichen böhmischen Gesellschaft der Wissenschaften.
 * 2. Tessendorf, J. (2001). "Simulating Ocean Water". SIGGRAPH Course Notes.
 * 3. Fedkiw, R., Stam, J., & Jensen, H. W. (2001). "Visual Simulation of Smoke". SIGGRAPH '01.
 */

import * as THREE from 'three';
import type { FluidGrid } from '../fluid/grid';
import {
  DualScrollingNormalMapGenerator,
  createWaterPhysicalMaterial,
  type WaterMaterialOptions
} from './water';

export interface GerstnerWaveOctave {
  direction: [number, number]; // Normalized propagation vector (dx, dz)
  amplitude: number;           // Wave amplitude weight
  frequency: number;           // Spatial frequency (rad/m)
  speed: number;               // Phase speed multiplier
  steepness: number;           // Trochoidal sharpness Q
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

  // Tunable parameters
  public elevation: number;
  public amplitude: number;
  public frequency: number;
  public speed: number;
  public foamThreshold: number;
  public foamLifetime: number;
  public cutoffWavelength: number;
  public size: number;
  public segments: number;

  // State arrays
  private originalPositions: Float32Array;
  private colors: Float32Array;
  private foamIntensity: Float32Array;
  private octaves: GerstnerWaveOctave[];

  // 1D longitudinal integrated fluid elevation profile along tank X
  public fluidSurfaceElevation: Float32Array;
  private fluidGridWidth = 256;

  constructor(params?: WaterSurfaceParams) {
    this.size = params?.size ?? 2.4;
    // Default 512x512 vertices (511 segments x 511 segments = 262,144 vertices)
    this.segments = params?.segments !== undefined ? params.segments : 511;
    this.elevation = params?.elevation ?? 0.22;
    this.amplitude = params?.amplitude ?? 0.005;
    this.frequency = params?.frequency ?? 2.5;
    this.speed = params?.speed ?? 1.1;
    this.foamThreshold = params?.foamThreshold ?? 1.8;
    this.foamLifetime = params?.foamLifetime ?? 5.0; // 5s decay default
    this.cutoffWavelength = params?.cutoffWavelength ?? 0.05; // Sub-grid cutoff ~2*dx

    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    this.geometry.rotateX(-Math.PI / 2);

    const vertexCount = this.geometry.attributes.position.count;
    this.originalPositions = new Float32Array(this.geometry.attributes.position.array);

    // Dynamic vertex colors for foam mask modulation and decaying foam state
    this.colors = new Float32Array(vertexCount * 3);
    this.foamIntensity = new Float32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      this.colors[i * 3 + 0] = 0.05; // R
      this.colors[i * 3 + 1] = 0.52; // G
      this.colors[i * 3 + 2] = 0.78; // B
    }
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    // Dual scrolling procedural normal map
    this.normalGenerator = new DualScrollingNormalMapGenerator(128);

    // Create high-fidelity physical water material
    this.material = createWaterPhysicalMaterial(this.normalGenerator.texture, {
      transmission: params?.transmission ?? 0.88,
      roughness: params?.roughness ?? 0.04
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = this.elevation;
    this.mesh.receiveShadow = true;

    // Gerstner Wave Octaves (Tessendorf 2001 formulation)
    this.octaves = [
      { direction: [1.0, 0.25], amplitude: 0.45, frequency: 1.0, speed: 1.0, steepness: 0.35 },
      { direction: [-0.7, 0.7], amplitude: 0.30, frequency: 2.1, speed: 1.3, steepness: 0.40 },
      { direction: [0.35, -0.9], amplitude: 0.15, frequency: 3.8, speed: 1.7, steepness: 0.45 },
      { direction: [-0.9, -0.4], amplitude: 0.10, frequency: 5.4, speed: 2.2, steepness: 0.50 }
    ];

    this.fluidSurfaceElevation = new Float32Array(this.fluidGridWidth);
  }

  /**
   * Independent heightfield mesh resolution scaler (e.g. 64, 128, 256, 511).
   */
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

  /**
   * Diagnostic returning total heightfield energy: sum of |eta| along the longitudinal domain.
   */
  public getHeightfieldEnergy(): number {
    let total = 0;
    for (let i = 0; i < this.fluidSurfaceElevation.length; i++) {
      total += Math.abs(this.fluidSurfaceElevation[i]);
    }
    return total;
  }

  /**
   * Computes high-frequency Gerstner wave displacement and horizontal shift.
   * Supports spectral cutoff (below 2*dx), local flow speed scaling, and flow direction advection.
   */
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

    // Gerstner amplitude scales with local fluid velocity magnitude (still water has zero artificial ripples)
    const speedScale = localSpeed > 0 ? Math.min(1.0, localSpeed / 0.4) : 0.0;
    if (speedScale <= 0.0001 && this.amplitude <= 0) {
      return { dy: 0, dx: 0, dz: 0 };
    }

    const effectiveAmplitude = this.amplitude * speedScale;

    for (let i = 0; i < this.octaves.length; i++) {
      const oct = this.octaves[i];
      const k = oct.frequency * this.frequency;
      const wavelength = (2.0 * Math.PI) / (k + 1e-5);

      // Spectral cutoff: fluid grid handles wavelengths above cutoff, Gerstner handles below
      if (wavelength > this.cutoffWavelength * 4.0) {
        continue;
      }

      const a = oct.amplitude * effectiveAmplitude;
      const omega = Math.sqrt(9.81 * k) * oct.speed; // Deep water dispersion relation

      // Gerstner wave direction advected by local fluid velocity
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

  /**
   * Backward-compatible elevation query method.
   */
  public getElevationAt(x: number, z: number, time: number): number {
    return this.elevation + this.getGerstnerDisplacement(x, z, time, 0.5).dy;
  }

  /**
   * Updates water surface vertices by integrating vertical fluid velocity
   * and superimposing high-frequency Gerstner waves and vorticity foam.
   */
  public update(time: number, dt = 1.0 / 60.0, fluidGrid?: FluidGrid): void {
    // 1. Update scrolling normal map textures driven by sim clock
    this.normalGenerator.update(time);

    // 2. Conservative height integration of 2D fluid velocity field at the free surface
    if (fluidGrid) {
      if (this.fluidSurfaceElevation.length !== fluidGrid.width) {
        this.fluidGridWidth = fluidGrid.width;
        this.fluidSurfaceElevation = new Float32Array(fluidGrid.width);
      }

      const W = fluidGrid.width;
      const H = fluidGrid.height;
      const surfY = Math.max(1, H - 2);
      const row = surfY * W;
      const elev = this.fluidSurfaceElevation;
      const v = fluidGrid.v;

      const gRestoring = 4.0; // Restoring gravity acceleration on displacement: -g * eta
      const damping = 0.985;  // Viscous damping

      for (let x = 0; x < W; x++) {
        const vSurf = v[row + x];
        // Integrate: d(eta)/dt = v - g * eta (conservative restoring balance)
        elev[x] += dt * (vSurf * 0.15 - gRestoring * elev[x]);
        elev[x] *= damping;
        // Clamp to physical tank margin [-0.05m, +0.05m]
        if (elev[x] > 0.05) elev[x] = 0.05;
        if (elev[x] < -0.05) elev[x] = -0.05;
      }
    }

    // 3. Update 3D heightfield mesh vertices and decaying foam vertex colors
    const posAttr = this.geometry.attributes.position;
    const posArray = posAttr.array as Float32Array;
    const orig = this.originalPositions;
    const colors = this.colors;
    const foam = this.foamIntensity;
    const vertexCount = posAttr.count;

    const tankSize = this.size;
    const halfSize = tankSize * 0.5;

    // Seafoam target color: crisp aerated white/light turquoise
    const foamColorR = 0.95;
    const foamColorG = 0.99;
    const foamColorB = 1.00;

    // Deep water baseline color
    const waterBaseR = 0.05;
    const waterBaseG = 0.52;
    const waterBaseB = 0.78;

    const foamDecayRate = dt / Math.max(0.1, this.foamLifetime);

    for (let i = 0; i < vertexCount; i++) {
      const i3 = i * 3;
      const xOrig = orig[i3];
      const zOrig = orig[i3 + 2];

      // Fluid 2D grid contribution via clamped bilinear interpolation
      let fluidH = 0.0;
      let newFoam = 0.0;
      let localSpeed = 0.0;
      let flowDirX = 0.0;
      let flowDirZ = 0.0;

      // Clamping at grid edges: zero contribution outside domain
      if (fluidGrid && xOrig >= -halfSize && xOrig <= halfSize) {
        const normX = Math.max(0.0, Math.min(1.0, (xOrig + halfSize) / tankSize));
        const gx = normX * (fluidGrid.width - 1);

        // Linear interpolation of surface elevation profile
        const gx0 = Math.floor(gx);
        const gx1 = Math.min(fluidGrid.width - 1, gx0 + 1);
        const frac = gx - gx0;
        fluidH = (1.0 - frac) * this.fluidSurfaceElevation[gx0] + frac * this.fluidSurfaceElevation[gx1];

        // Bilinear sample of curl and velocity magnitude at the surface
        const surfY = Math.max(1, fluidGrid.height - 2);
        const curlVal = Math.abs(fluidGrid.sampleBilinear(fluidGrid.curl, gx, surfY));
        const uVal = fluidGrid.sampleBilinear(fluidGrid.u, gx, surfY);
        const vVal = fluidGrid.sampleBilinear(fluidGrid.v, gx, surfY);
        localSpeed = Math.hypot(uVal, vVal);

        if (localSpeed > 1e-4) {
          flowDirX = uVal / localSpeed;
          flowDirZ = 0.0; // 2D fluid grid lies in X-Y vertical longitudinal plane
        }

        // Shear intensity combining vorticity and velocity magnitude from authoritative field
        const shear = curlVal * 1.2 + localSpeed * 0.5;

        // Smooth Hermite foam mask above foamThreshold
        if (shear > this.foamThreshold) {
          const t = Math.min(1.0, (shear - this.foamThreshold) / (this.foamThreshold * 1.5));
          newFoam = t * t * (3.0 - 2.0 * t);
        }
      }

      // Foam decay: accumulate new foam, decay existing foam by foamLifetime
      foam[i] = Math.max(newFoam, Math.max(0.0, foam[i] - foamDecayRate));
      const foamAmount = foam[i];

      // Gerstner high-frequency displacement with local flow advection
      const gerstner = this.getGerstnerDisplacement(xOrig, zOrig, time, localSpeed, flowDirX, flowDirZ);

      // Displace vertex
      posArray[i3 + 0] = xOrig + gerstner.dx;
      posArray[i3 + 1] = fluidH + gerstner.dy;
      posArray[i3 + 2] = zOrig + gerstner.dz;

      // Modulate vertex foam color
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
