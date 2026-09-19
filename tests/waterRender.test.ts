import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WaterSurface } from '../src/render/surface';
import {
  calculateBeerLambertExtinction,
  DualScrollingNormalMapGenerator,
  CausticTextureGenerator,
  applyUnderwaterOpticalProperties
} from '../src/render/water';
import { AppRenderer } from '../src/render/renderer';
import { FluidGrid } from '../src/fluid/grid';
import { FluidRenderer2D } from '../src/fluid/FluidRenderer2D';

describe('Phase 3 — Water Rendering', () => {
  describe('WaterSurface', () => {
    it('initializes geometry, physical material, and default parameters correctly', () => {
      const water = new WaterSurface({
        size: 2.0,
        segments: 32,
        elevation: 0.22,
        amplitude: 0.005,
        speed: 1.2
      });

      expect(water.mesh).toBeInstanceOf(THREE.Mesh);
      expect(water.geometry).toBeInstanceOf(THREE.PlaneGeometry);
      expect(water.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);

      // Verify physical material settings (water IOR = 1.333)
      expect(water.material.ior).toBeCloseTo(1.333, 3);
      expect(water.material.transparent).toBe(true);
      expect(water.elevation).toBeCloseTo(0.22, 3);
      expect(water.amplitude).toBeCloseTo(0.005, 4);

      // Verify vertex count for 32x32 segments = 33x33 = 1089 vertices
      const posAttr = water.geometry.attributes.position;
      expect(posAttr.count).toBe((32 + 1) * (32 + 1));

      water.dispose();
    });

    it('creates 512x512 vertices by default (262,144 vertices)', () => {
      const defaultWater = new WaterSurface();
      const posAttr = defaultWater.geometry.attributes.position;
      expect(posAttr.count).toBe(512 * 512); // 262,144
      defaultWater.dispose();
    });

    it('evaluates getElevationAt with Gerstner wave superposition bounded by amplitude', () => {
      const amplitude = 0.008;
      const elevation = 0.25;
      const water = new WaterSurface({
        elevation,
        amplitude,
        speed: 1.0
      });

      // Check elevation across spatial and temporal domain
      const coords = [
        [0, 0, 0],
        [0.5, 0.5, 1.2],
        [-0.8, 0.3, 2.5],
        [1.0, -1.0, 5.0]
      ];

      for (const [x, z, t] of coords) {
        const h = water.getElevationAt(x, z, t);
        // Elevation must stay strictly within [elevation - amplitude, elevation + amplitude]
        expect(h).toBeGreaterThanOrEqual(elevation - amplitude * 1.01);
        expect(h).toBeLessThanOrEqual(elevation + amplitude * 1.01);
      }

      water.dispose();
    });

    it('integrates vertical velocity from 2D fluid grid to elevate water surface', () => {
      const water = new WaterSurface({ size: 2.4, segments: 16, amplitude: 0.0 });
      const grid = new FluidGrid({ width: 32, height: 16 });

      // Inject upward vertical velocity at the surface row (row = 14 * 32)
      const surfRow = 14 * 32;
      for (let x = 0; x < 32; x++) {
        grid.v[surfRow + x] = 2.0; // 2.0 m/s upward jet
      }

      // Step surface update
      water.update(0.1, 0.05, grid);

      // Verify positive surface elevation profile integration
      let elevatedCount = 0;
      for (let x = 0; x < water.fluidSurfaceElevation.length; x++) {
        if (water.fluidSurfaceElevation[x] > 0.001) elevatedCount++;
      }
      expect(elevatedCount).toBeGreaterThan(0);

      water.dispose();
    });

    it('generates foam vertex color mask where vorticity shear exceeds threshold', () => {
      const water = new WaterSurface({ size: 2.4, segments: 16, amplitude: 0.0, foamThreshold: 1.0 });
      const grid = new FluidGrid({ width: 32, height: 16 });

      // Inject high vorticity curl and velocity at the surface
      const surfRow = 14 * 32;
      for (let x = 0; x < 32; x++) {
        grid.curl[surfRow + x] = 8.0; // High shear vorticity
        grid.u[surfRow + x] = 2.5;
        grid.v[surfRow + x] = 1.5;
      }

      water.update(0.1, 0.05, grid);

      // Vertex color attribute should have foam white (R > 0.5) instead of baseline azure (R ~ 0.05)
      const colorAttr = water.geometry.attributes.color as THREE.BufferAttribute;
      expect(colorAttr).toBeDefined();

      let hasFoamColor = false;
      for (let i = 0; i < colorAttr.count; i++) {
        const r = colorAttr.getX(i);
        if (r > 0.5) {
          hasFoamColor = true;
          break;
        }
      }
      expect(hasFoamColor).toBe(true);

      water.dispose();
    });

    it('updates vertex positions and computes vertex normals over time', () => {
      const water = new WaterSurface({ size: 1.0, segments: 8 });
      const posAttr = water.geometry.attributes.position;

      // Update at t = 1.5s
      water.update(1.5);

      // Normal attribute must be present and updated
      const normalAttr = water.geometry.attributes.normal;
      expect(normalAttr).toBeDefined();
      expect(normalAttr.count).toBe(posAttr.count);

      // Dynamic toggle
      water.setVisible(false);
      expect(water.mesh.visible).toBe(false);
      water.setVisible(true);
      expect(water.mesh.visible).toBe(true);

      water.dispose();
    });
  });

  describe('DualScrollingNormalMapGenerator', () => {
    it('generates scrolling normal maps packed into RGBA DataTexture', () => {
      const normGen = new DualScrollingNormalMapGenerator(64);
      expect(normGen.texture).toBeInstanceOf(THREE.DataTexture);
      expect(normGen.texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(normGen.texture.wrapT).toBe(THREE.RepeatWrapping);

      // Update across time steps
      normGen.update(1.0);
      expect(normGen.texture.version).toBeGreaterThan(0);

      normGen.dispose();
    });
  });

  describe('Beer-Lambert Optical Extinction', () => {
    it('calculates unit transmittance at zero depth', () => {
      const t0 = calculateBeerLambertExtinction(0);
      expect(t0.redTransmittance).toBeCloseTo(1.0, 5);
      expect(t0.greenTransmittance).toBeCloseTo(1.0, 5);
      expect(t0.blueTransmittance).toBeCloseTo(1.0, 5);
    });

    it('exhibits differential absorption: Red attenuates much faster than Green and Blue', () => {
      const depth = 2.0; // 2 meters underwater
      const t = calculateBeerLambertExtinction(depth);

      // Red (0.35/m) attenuates faster than Green (0.06/m) and Blue (0.018/m)
      expect(t.redTransmittance).toBeLessThan(t.greenTransmittance);
      expect(t.greenTransmittance).toBeLessThan(t.blueTransmittance);

      // Red at 2m: exp(-0.35 * 2) = exp(-0.7) ~ 0.496
      expect(t.redTransmittance).toBeCloseTo(Math.exp(-0.7), 3);
      // Blue at 2m: exp(-0.018 * 2) = exp(-0.036) ~ 0.965
      expect(t.blueTransmittance).toBeCloseTo(Math.exp(-0.036), 3);
    });

    it('satisfies exponential decay property T(2d) == T(d)^2', () => {
      const d1 = calculateBeerLambertExtinction(1.5);
      const d2 = calculateBeerLambertExtinction(3.0);

      expect(d2.redTransmittance).toBeCloseTo(Math.pow(d1.redTransmittance, 2), 4);
      expect(d2.greenTransmittance).toBeCloseTo(Math.pow(d1.greenTransmittance, 2), 4);
      expect(d2.blueTransmittance).toBeCloseTo(Math.pow(d1.blueTransmittance, 2), 4);
    });
  });

  describe('CausticTextureGenerator & Environment', () => {
    it('creates canvas and texture with repeating wrap modes', () => {
      const caustics = new CausticTextureGenerator(64);

      expect(caustics.canvas).toBeDefined();
      expect(caustics.canvas.width).toBe(64);
      expect(caustics.canvas.height).toBe(64);
      expect(caustics.texture).toBeInstanceOf(THREE.CanvasTexture);
      expect(caustics.texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(caustics.texture.wrapT).toBe(THREE.RepeatWrapping);

      // Runs update loop with multi-wave interference
      expect(() => caustics.update(0.5, 1.2)).not.toThrow();
      expect(caustics.texture.version).toBeGreaterThan(0);

      caustics.dispose();
    });

    it('configures underwater fog on Three.js scene', () => {
      const scene = new THREE.Scene();
      applyUnderwaterOpticalProperties(scene);

      expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
      expect((scene.fog as THREE.FogExp2).density).toBeGreaterThan(0.01);
    });
  });

  describe('AppRenderer Tank, Sun & Camera Presets', () => {
    it('initializes AppRenderer with transparent walls, sky dome, sun light, and camera presets', () => {
      const mockContainer = {
        clientWidth: 800,
        clientHeight: 600,
        appendChild: () => {}
      } as unknown as HTMLElement;

      const renderer = new AppRenderer(mockContainer);

      // Verify procedural sky and environment
      expect(renderer.skyDome).toBeDefined();
      expect(renderer.scene.environment).toBe(renderer.skyTexture);

      // Verify tunable sun light
      expect(renderer.sunLight).toBeDefined();
      renderer.setSunDirection(30, 90);
      expect(renderer.sunLight.position.y).toBeGreaterThan(0);

      // Verify side cutaway view preset
      renderer.setSideCutawayView();
      expect(renderer.camera.position.z).toBeCloseTo(1.85, 2);
      expect(renderer.controls.target.x).toBeCloseTo(0.0, 2);
      expect(renderer.controls.target.z).toBeCloseTo(0.0, 2);

      // Verify orbit view reset
      renderer.resetOrbitView();
      expect(renderer.camera.position.x).toBeCloseTo(0.65, 2);
      expect(renderer.camera.position.y).toBeCloseTo(0.42, 2);
      expect(renderer.camera.position.z).toBeCloseTo(0.85, 2);

      renderer.dispose();
    });

    it('Camera and environment toggling does not modify simulation physics state', () => {
      const mockContainer = { clientWidth: 800, clientHeight: 600, appendChild: () => {} } as unknown as HTMLElement;
      const renderer = new AppRenderer(mockContainer);
      const grid = new FluidGrid({ width: 32, height: 32 });

      // Seed grid velocity
      grid.u[grid.idx(10, 10)] = 1.234;
      grid.v[grid.idx(10, 10)] = -0.567;
      const uBefore = new Float32Array(grid.u);
      const vBefore = new Float32Array(grid.v);

      // Toggle views
      renderer.setSideCutawayView();
      renderer.setSunDirection(45, 120);
      renderer.resetOrbitView();

      // Verify grid state was not modified
      for (let i = 0; i < grid.size; i++) {
        expect(grid.u[i]).toBe(uBefore[i]);
        expect(grid.v[i]).toBe(vBefore[i]);
      }

      renderer.dispose();
    });
  });

  describe('Phase 3 Revised Validation Gates', () => {
    it('Still-water test: inflow off, vehicle at rest for 10s maintains flat heightfield energy without phantom energy injection', () => {
      const water = new WaterSurface({ size: 2.4, segments: 16, amplitude: 0.0 });
      const grid = new FluidGrid({ width: 32, height: 16 }); // Still water, all velocities zero

      // Initial energy in still water
      const initialEnergy = water.getHeightfieldEnergy();
      expect(initialEnergy).toBe(0);

      // Advance for 10s (600 steps of dt = 1/60s)
      for (let step = 0; step < 600; step++) {
        water.update(step * (1.0 / 60.0), 1.0 / 60.0, grid);
      }

      const finalEnergy = water.getHeightfieldEnergy();
      // Must remain strictly flat (0 energy injected)
      expect(finalEnergy).toBeCloseTo(0, 5);

      // If initial disturbance is present, verify restoring term dampens energy monotonically
      water.fluidSurfaceElevation[16] = 0.04;
      const disturbedEnergy = water.getHeightfieldEnergy();
      for (let step = 0; step < 60; step++) {
        water.update((600 + step) * (1.0 / 60.0), 1.0 / 60.0, grid);
      }
      const dampedEnergy = water.getHeightfieldEnergy();
      expect(dampedEnergy).toBeLessThan(disturbedEnergy);

      water.dispose();
    });

    it('Injection response test: heightfield rises monotonically for the first second in the region above the source', () => {
      const water = new WaterSurface({ size: 2.4, segments: 16, amplitude: 0.0 });
      const grid = new FluidGrid({ width: 32, height: 16 });

      // Inflow source jet active: upward vertical velocity at column 4
      const surfRow = 14 * 32;
      grid.v[surfRow + 4] = 0.4;

      const elevations: number[] = [];
      // Advance for 1 second (60 steps)
      for (let step = 0; step < 60; step++) {
        water.update(step * (1.0 / 60.0), 1.0 / 60.0, grid);
        elevations.push(water.fluidSurfaceElevation[4]);
      }

      // Height must rise monotonically for the initial onset
      expect(elevations[10]).toBeGreaterThan(elevations[0]);
      expect(elevations[30]).toBeGreaterThan(elevations[10]);
      expect(elevations[59]).toBeGreaterThan(elevations[30]);

      water.dispose();
    });

    it('Foam decay test: injects a burst, turns inflow off, and verifies foam clears within 5s', () => {
      const water = new WaterSurface({ size: 2.4, segments: 16, amplitude: 0.0, foamThreshold: 0.5, foamLifetime: 2.0 });
      const grid = new FluidGrid({ width: 32, height: 16 });

      // 1. Inject high shear to generate foam
      const surfRow = 14 * 32;
      for (let x = 0; x < 32; x++) {
        grid.curl[surfRow + x] = 10.0;
        grid.u[surfRow + x] = 3.0;
      }
      water.update(0.1, 0.05, grid);

      // Verify foam was generated
      const colorAttr = water.geometry.attributes.color as THREE.BufferAttribute;
      let hasFoam = false;
      for (let i = 0; i < colorAttr.count; i++) {
        if (colorAttr.getX(i) > 0.4) {
          hasFoam = true;
          break;
        }
      }
      expect(hasFoam).toBe(true);

      // 2. Turn inflow/shear off (still water)
      grid.curl.fill(0);
      grid.u.fill(0);
      grid.v.fill(0);

      // Step for 2.5s (exceeding 2.0s lifetime)
      for (let step = 0; step < 150; step++) {
        water.update(0.1 + step * (1.0 / 60.0), 1.0 / 60.0, grid);
      }

      // Verify foam cleared back to base water color (R ~ 0.05)
      let residualFoamCount = 0;
      for (let i = 0; i < colorAttr.count; i++) {
        if (colorAttr.getX(i) > 0.15) {
          residualFoamCount++;
        }
      }
      expect(residualFoamCount).toBe(0);

      water.dispose();
    });

    it('Cutaway consistency test: samples 10 random cells from cutaway and physics read path and verifies exact match', () => {
      const grid = new FluidGrid({ width: 32, height: 32 });
      for (let i = 0; i < grid.size; i++) {
        grid.dye[i] = Math.sin(i * 0.2);
        grid.u[i] = Math.cos(i * 0.1);
        grid.v[i] = Math.sin(i * 0.3);
        grid.curl[i] = grid.u[i] - grid.v[i];
      }

      // Mock canvas for FluidRenderer2D
      const mockCanvas = {
        width: 32,
        height: 32,
        getContext: () => ({
          createImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4) }),
          putImageData: () => {},
          strokeRect: () => {},
          fillText: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          save: () => {},
          restore: () => {},
          createLinearGradient: () => ({ addColorStop: () => {} }),
          fillRect: () => {}
        })
      } as unknown as HTMLCanvasElement;

      const renderer2D = new FluidRenderer2D(mockCanvas, 32, 32);

      // Sample 10 random cells
      const sampleCoords = [
        [2, 3], [5, 12], [8, 8], [15, 20], [22, 5],
        [30, 30], [1, 1], [16, 16], [10, 25], [28, 14]
      ];

      for (const [x, y] of sampleCoords) {
        const cutawayDye = renderer2D.sampleField(grid, x, y, 'DYE');
        const physicsDye = grid.dye[grid.idx(x, y)];
        expect(cutawayDye).toBe(physicsDye);

        const cutawayVort = renderer2D.sampleField(grid, x, y, 'VORTICITY');
        const physicsVort = grid.curl[grid.idx(x, y)];
        expect(cutawayVort).toBe(physicsVort);
      }
    });

    it('supports independent heightfield resolution scaling without affecting fluid grid', () => {
      const water = new WaterSurface({ size: 2.4, segments: 64 });
      expect(water.geometry.attributes.position.count).toBe(65 * 65);

      // Scale up to 128
      water.setMeshResolution(128);
      expect(water.geometry.attributes.position.count).toBe(129 * 129);

      // Scale down to 32
      water.setMeshResolution(32);
      expect(water.geometry.attributes.position.count).toBe(33 * 33);

      water.dispose();
    });
  });
});
