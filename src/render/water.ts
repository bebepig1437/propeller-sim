/**
 * Water Material & Optical Physics Module (Phase 3)
 *
 * Citations:
 * 1. Beer, A. (1852). "Bestimmung der Absorption des rothen Lichts in farbigen Flüssigkeiten".
 *    Annalen der Physik und Chemie, 86(5), 78–88.
 * 2. Harris, M. J. (2004). "Fast Fluid Dynamics on the GPU". In GPU Gems 1, Chapter 38.
 * 3. Tessendorf, J. (2001). "Simulating Ocean Water". SIGGRAPH Course Notes.
 */

import * as THREE from 'three';

export interface OpticalExtinctionResult {
  redTransmittance: number;
  greenTransmittance: number;
  blueTransmittance: number;
}

/**
 * Beer-Lambert law optical transmittance in clean water:
 * T(lambda, d) = exp(-alpha(lambda) * d)
 */
export function calculateBeerLambertExtinction(depthMeters: number): OpticalExtinctionResult {
  // Absorption coefficients for clear water (1/m)
  const alphaRed = 0.35;   // Red absorbs rapidly
  const alphaGreen = 0.06; // Green penetrates moderately
  const alphaBlue = 0.018; // Blue penetrates deepest

  return {
    redTransmittance: Math.exp(-alphaRed * depthMeters),
    greenTransmittance: Math.exp(-alphaGreen * depthMeters),
    blueTransmittance: Math.exp(-alphaBlue * depthMeters)
  };
}

/**
 * Procedural dual-layer animated normal map generator for micro-facet specular highlights.
 */
export class DualScrollingNormalMapGenerator {
  public texture: THREE.DataTexture;
  private width: number;
  private height: number;
  private data: Uint8Array;

  constructor(resolution = 128) {
    this.width = resolution;
    this.height = resolution;
    const size = resolution * resolution * 4;
    this.data = new Uint8Array(size);

    this.texture = new THREE.DataTexture(this.data, resolution, resolution, THREE.RGBAFormat);
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.repeat.set(4, 4);

    this.update(0);
  }

  public update(time: number): void {
    const W = this.width;
    const H = this.height;
    const data = this.data;
    const t1 = time * 0.9;
    const t2 = time * 1.4;

    for (let y = 0; y < H; y++) {
      const v = (y / H) * Math.PI * 4;
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        const u = (x / W) * Math.PI * 4;

        // Wave layer 1 (primary swell moving +X, +Z)
        const dhx1 = Math.cos(u * 2.0 - t1) * 0.6;
        const dhz1 = Math.sin(v * 2.0 - t1 * 0.8) * 0.6;

        // Wave layer 2 (secondary capillary ripples moving -X, +Z)
        const dhx2 = Math.cos(-u * 3.2 + t2 * 1.2) * 0.4;
        const dhz2 = Math.sin(v * 3.5 - t2) * 0.4;

        const nx = -(dhx1 + dhx2);
        const nz = -(dhz1 + dhz2);
        const ny = 1.0;

        const len = Math.hypot(nx, ny, nz);
        const normX = nx / len;
        const normY = ny / len;
        const normZ = nz / len;

        const idx = row + x * 4;
        // Pack into RGB [0, 255]
        data[idx] = Math.floor((normX * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.floor((normZ * 0.5 + 0.5) * 255);
        data[idx + 2] = Math.floor((normY * 0.5 + 0.5) * 255);
        data[idx + 3] = 255;
      }
    }

    this.texture.needsUpdate = true;
  }

  public dispose(): void {
    this.texture.dispose();
  }
}

export interface WaterMaterialOptions {
  transmission?: number;
  roughness?: number;
  ior?: number;
  attenuationDistance?: number;
  attenuationColor?: THREE.ColorRepresentation;
}

/**
 * Creates high-fidelity water MeshPhysicalMaterial with screen-space refraction,
 * Fresnel reflection, Beer-Lambert attenuation, and vertex color foam support.
 */
export function createWaterPhysicalMaterial(
  normalMap: THREE.Texture,
  options?: WaterMaterialOptions
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x0284c7,             // Clean oceanic azure base
    emissive: 0x011e2f,
    emissiveIntensity: 0.12,
    roughness: options?.roughness ?? 0.04,
    metalness: 0.05,
    transmission: options?.transmission ?? 0.88, // Screen-space refraction
    ior: options?.ior ?? 1.333,                  // Snell's law Fresnel index for water
    attenuationColor: new THREE.Color(options?.attenuationColor ?? 0x0369a1), // Beer-Lambert cyan depth tint
    attenuationDistance: options?.attenuationDistance ?? 0.65,                // Absorption scale in meters
    normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    vertexColors: true,                         // Dynamic foam mask modulation
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  return material;
}

/**
 * Animated dynamic caustics generator for submersible test tank.
 */
export class CausticTextureGenerator {
  public canvas: HTMLCanvasElement;
  public texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private imageData: ImageData;
  private pixelBuffer: Uint32Array;

  constructor(resolution = 128, canvas?: HTMLCanvasElement) {
    this.width = resolution;
    this.height = resolution;

    if (canvas) {
      this.canvas = canvas;
    } else if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
    } else {
      // Headless / Node environment mock canvas
      this.canvas = {
        width: this.width,
        height: this.height,
        getContext: () => ({
          createImageData: (w: number, h: number) => ({
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4)
          }),
          putImageData: () => {}
        })
      } as any;
    }

    this.canvas.width = this.width;
    this.canvas.height = this.height;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot create 2D canvas context for caustics');
    this.ctx = ctx;

    this.imageData = this.ctx.createImageData(this.width, this.height);
    this.pixelBuffer = new Uint32Array(this.imageData.data.buffer);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.repeat.set(3, 3);
  }

  public update(time: number, intensity = 1.0): void {
    const W = this.width;
    const H = this.height;
    const pixels = this.pixelBuffer;
    const t = time * 1.5;

    for (let y = 0; y < H; y++) {
      const v = (y / H) * Math.PI * 4;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const u = (x / W) * Math.PI * 4;

        // Wave interference network generating sharp caustic filaments
        const c1 = Math.sin(u * 1.5 + t) * Math.cos(v * 1.2 - t * 0.8);
        const c2 = Math.sin(u * 2.2 - t * 1.1 + v * 0.8) * Math.cos(v * 2.0 + t * 0.9);
        const c3 = Math.sin((u + v) * 3.1 + t * 1.3);

        const rawVal = (c1 + c2 + c3) / 3.0; // [-1, 1]
        // Sharp non-linear peak concentrating brightness into filaments
        const filament = Math.pow(Math.max(0, rawVal * 0.5 + 0.5), 4.5) * intensity;
        const brightness = Math.min(255, Math.floor(filament * 255));

        // Marine cyan caustic tint
        const r = Math.min(255, Math.floor(brightness * 0.4));
        const g = Math.min(255, Math.floor(brightness * 0.85));
        const b = brightness;
        const a = Math.min(240, Math.floor(brightness * 1.2));

        pixels[row + x] = (a << 24) | (b << 16) | (g << 8) | r;
      }
    }

    this.ctx.putImageData(this.imageData, 0, 0);
    this.texture.needsUpdate = true;
  }

  public dispose(): void {
    this.texture.dispose();
  }
}

/**
 * Configures realistic underwater absorption and volumetric fog on the scene.
 */
export function applyUnderwaterOpticalProperties(scene: THREE.Scene): void {
  scene.fog = new THREE.FogExp2(0x05131f, 0.08);
}
