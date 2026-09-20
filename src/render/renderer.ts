import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPURenderer } from 'three/webgpu';
import { WaterSurface } from './surface';
import { CausticTextureGenerator, applyUnderwaterOpticalProperties } from './water';
import { Propeller3D } from '../prop/geometry';
import { CANDIDATE_A_DESIGN } from '../prop/designs/index';
import type { FluidGrid } from '../fluid/grid';

export interface RendererInitResult {
  backend: 'WebGPU' | 'WebGL2';
  renderer: THREE.WebGLRenderer | WebGPURenderer;
}

/**
 * Creates an equirectangular procedural sky environment texture with horizon gradient and sun halo.
 */
function createProceduralSkyTexture(): THREE.CanvasTexture {
  let canvas: HTMLCanvasElement;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Sky atmospheric gradient
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0.0, '#0369a1'); // Zenith deep oceanic sky
      grad.addColorStop(0.45, '#38bdf8'); // Horizon sky blue
      grad.addColorStop(0.5, '#7dd3fc'); // Bright horizon glow
      grad.addColorStop(0.55, '#072b42'); // Sea level horizon
      grad.addColorStop(1.0, '#020b14'); // Nadir deep oceanic floor
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 256);

      // Sun glow halo
      const sunGrad = ctx.createRadialGradient(256, 110, 4, 256, 110, 60);
      sunGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      sunGrad.addColorStop(0.3, 'rgba(254, 240, 138, 0.45)');
      sunGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, 512, 256);
    }
  } else {
    canvas = {
      width: 512,
      height: 256,
      getContext: () => ({
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        fillRect: () => {}
      })
    } as any;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

export class AppRenderer {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer | WebGPURenderer;
  public controls: OrbitControls;
  public backend: 'WebGPU' | 'WebGL2';

  // Water & Environment components
  public waterSurface: WaterSurface;
  public caustics: CausticTextureGenerator;
  public prop3D?: Propeller3D;
  public sunLight!: THREE.DirectionalLight;
  public bounceLight!: THREE.DirectionalLight;
  public ambientLight!: THREE.AmbientLight;
  public skyTexture: THREE.CanvasTexture;
  public skyDome: THREE.Mesh;
  private floorMaterial: THREE.MeshStandardMaterial;
  private groundPlane: THREE.Mesh;
  private tankStructure: THREE.Group;
  private isDisposed = false;

  // Propeller Direct Manipulation Callbacks
  public onPropellerSelected?: () => void;
  public onPropellerPositionChanged?: (zM: number) => void;
  public onPitchChanged?: (pitchDeg: number) => void;
  public onHandednessChanged?: (handedness: 'CW' | 'CCW') => void;
  public onIncidenceChanged?: (incidenceDeg: number) => void;
  public onRemoveThruster?: () => void;

  private isDraggingTranslate = false;
  private isDraggingPitch = false;
  private isDraggingIncidence = false;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private dragStartY = 0;
  private startPitch = 18.0;
  private startIncidence = -5.2;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05131f);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 100);
    this.camera.position.set(0.65, 0.42, 0.85);

    // Initialize WebGPURenderer with automatic WebGL2 fallback
    const init = this.createRenderer(container, width, height);
    this.renderer = init.renderer;
    this.backend = init.backend;

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement as HTMLElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 4.0;
    this.controls.minDistance = 0.1;
    this.controls.target.set(0, 0, 0);

    // Setup Procedural Sky & Environment Reflections
    this.skyTexture = createProceduralSkyTexture();
    this.scene.environment = this.skyTexture;

    const skyGeo = new THREE.SphereGeometry(30, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: this.skyTexture, side: THREE.BackSide });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);

    // Setup Underwater Optics & Fog
    applyUnderwaterOpticalProperties(this.scene);

    // Setup Tunable Lighting & Sunlight
    this.setupLighting();

    // Initialize Animated Caustic Texture Generator
    this.caustics = new CausticTextureGenerator(128);

    // Submersible Test Tank Floor
    const planeGeo = new THREE.PlaneGeometry(2.4, 2.4);
    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x071520,
      roughness: 0.65,
      metalness: 0.25,
      map: this.caustics.texture,
      emissive: 0x00f2ff,
      emissiveMap: this.caustics.texture,
      emissiveIntensity: 0.35
    });
    this.groundPlane = new THREE.Mesh(planeGeo, this.floorMaterial);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -0.25;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);

    // Submersible Test Tank Boundary Grid for scale reference
    const gridHelper = new THREE.GridHelper(2.4, 24, 0x00f2ff, 0x0d283d);
    gridHelper.position.y = -0.249;
    this.scene.add(gridHelper);

    // Coordinate Axes Helper
    const axes = new THREE.AxesHelper(0.12);
    axes.position.set(-1.0, -0.248, -1.0);
    this.scene.add(axes);

    // Submersible Test Tank Transparent Glass Structure & Markers
    this.tankStructure = this.createTestTankStructure();
    this.scene.add(this.tankStructure);

    // Phase 3 Water Free Surface (Default 512x512 vertices)
    this.waterSurface = new WaterSurface({
      size: 2.4,
      elevation: 0.22,
      amplitude: 0.005,
      frequency: 2.5,
      speed: 1.1
    });
    this.scene.add(this.waterSurface.mesh);

    // Phase 4 3D Procedural Propeller with Direct Manipulation
    this.prop3D = new Propeller3D({
      design: CANDIDATE_A_DESIGN,
      materialType: 'rigid10k',
      handedness: 'CW'
    });
    this.prop3D.group.position.set(0, 0, 0);
    this.scene.add(this.prop3D.group);
    this.setupPropellerInteraction();

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  private createRenderer(container: HTMLElement, width: number, height: number): RendererInitResult {
    let renderer: THREE.WebGLRenderer | WebGPURenderer;
    let backend: 'WebGPU' | 'WebGL2' = 'WebGL2';

    // Headless / Node testing environment fallback
    if (typeof document === 'undefined') {
      const mockDoc = {
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      const mockDom = {
        parentElement: null,
        ownerDocument: mockDoc,
        getRootNode: () => mockDoc,
        clientWidth: width,
        clientHeight: height,
        style: {},
        addEventListener: () => {},
        removeEventListener: () => {},
        setPointerCapture: () => {},
        releasePointerCapture: () => {}
      };
      renderer = {
        domElement: mockDom,
        setSize: () => {},
        setPixelRatio: () => {},
        render: () => {},
        dispose: () => {},
        shadowMap: { enabled: true, type: 0 }
      } as any;
      if (container && typeof container.appendChild === 'function') {
        container.appendChild(mockDom as any);
      }
      return { renderer, backend };
    }

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

    if (hasWebGPU) {
      try {
        renderer = new WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
        backend = 'WebGPU';
      } catch (err) {
        console.warn('[Renderer] WebGPU initialization failed, falling back to WebGL2:', err);
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        backend = 'WebGL2';
      }
    } else {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      backend = 'WebGL2';
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    (renderer as any).shadowMap.enabled = true;
    (renderer as any).shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);
    return { renderer, backend };
  }

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0x0f2b42, 1.6);
    this.scene.add(this.ambientLight);

    // Primary Sunlight beam penetrating from above with tunable direction
    this.sunLight = new THREE.DirectionalLight(0xbae6fd, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.setSunDirection(45.0, 60.0);
    this.scene.add(this.sunLight);

    // Deep water bioluminescent upward bounce
    this.bounceLight = new THREE.DirectionalLight(0x00f2ff, 0.9);
    this.bounceLight.position.set(-1.8, -1.0, -1.8);
    this.scene.add(this.bounceLight);
  }

  /**
   * Sets sun position in spherical coordinates (elevation: 0-90°, azimuth: 0-360°).
   */
  public setSunDirection(elevationDeg: number, azimuthDeg: number): void {
    const elRad = (Math.max(2.0, Math.min(89.0, elevationDeg)) * Math.PI) / 180.0;
    const azRad = (azimuthDeg * Math.PI) / 180.0;
    const dist = 5.0;

    const x = dist * Math.cos(elRad) * Math.sin(azRad);
    const y = dist * Math.sin(elRad);
    const z = dist * Math.cos(elRad) * Math.cos(azRad);

    this.sunLight.position.set(x, y, z);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.target.updateMatrixWorld();
  }

  /**
   * Preset "Side Cutaway" view that shows the fluid cross-section directly face-on.
   * This aligns cleanly with the 2D fluid simulation vectors and streamtubes.
   */
  public setSideCutawayView(): void {
    this.camera.position.set(0.0, 0.05, 1.85);
    this.controls.target.set(0.0, 0.05, 0.0);
    this.controls.update();
  }

  /**
   * Resets camera to perspective orbit angle viewing tank, surface, and vehicle in 3D.
   */
  public resetOrbitView(): void {
    this.camera.position.set(0.65, 0.42, 0.85);
    this.controls.target.set(0.0, 0.0, 0.0);
    this.controls.update();
  }

  private createTestTankStructure(): THREE.Group {
    const tank = new THREE.Group();

    // Transparent acrylic/glass walls (transmission, IOR 1.52)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a2538,
      metalness: 0.05,
      roughness: 0.06,
      transmission: 0.94,
      ior: 1.52,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const tankHeight = 0.52; // from y = -0.25 to y = +0.27
    const halfSize = 1.2;
    const centerY = 0.01;

    // Front Wall (Z = +1.2)
    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tankHeight), glassMat);
    frontWall.position.set(0, centerY, halfSize);
    tank.add(frontWall);

    // Back Wall (Z = -1.2)
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tankHeight), glassMat);
    backWall.position.set(0, centerY, -halfSize);
    backWall.rotation.y = Math.PI;
    tank.add(backWall);

    // Left Wall (X = -1.2)
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tankHeight), glassMat);
    leftWall.position.set(-halfSize, centerY, 0);
    leftWall.rotation.y = Math.PI / 2;
    tank.add(leftWall);

    // Right Wall (X = +1.2)
    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tankHeight), glassMat);
    rightWall.position.set(halfSize, centerY, 0);
    rightWall.rotation.y = -Math.PI / 2;
    tank.add(rightWall);

    // 4 Corner support pillars with depth markers
    const pillarGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.52, 12);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9, roughness: 0.2 });

    const corners = [
      [-1.2, 0.01, -1.2],
      [1.2, 0.01, -1.2],
      [-1.2, 0.01, 1.2],
      [1.2, 0.01, 1.2]
    ];

    corners.forEach(pos => {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(pos[0], pos[1], pos[2]);
      tank.add(pillar);
    });

    // Top Rim
    const rimGeo = new THREE.BoxGeometry(2.42, 0.012, 0.012);
    const topRimFront = new THREE.Mesh(rimGeo, pillarMat);
    topRimFront.position.set(0, 0.27, 1.2);
    const topRimBack = new THREE.Mesh(rimGeo, pillarMat);
    topRimBack.position.set(0, 0.27, -1.2);
    tank.add(topRimFront, topRimBack);

    // Water level datum ring indicator (at +0.22m)
    const datumGeo = new THREE.BoxGeometry(2.41, 0.003, 0.003);
    const datumMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff });
    const datum = new THREE.Mesh(datumGeo, datumMat);
    datum.position.set(0, 0.22, 1.2);
    tank.add(datum);

    return tank;
  }

  private setupPropellerInteraction(): void {
    if (typeof window === 'undefined' || !this.renderer.domElement) return;
    const dom = this.renderer.domElement as HTMLElement;
    if (typeof dom.addEventListener !== 'function') return;

    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!this.prop3D) return;

      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects([this.prop3D.group], true);

      if (intersects.length > 0) {
        let hit = intersects[0].object;

        // Check if clicking handedness toggle badge
        if (hit === this.prop3D.handednessBadge) {
          const newH = this.prop3D.toggleHandedness();
          this.onHandednessChanged?.(newH);
          e.stopPropagation();
          return;
        }

        // Check if clicking translate handle
        if (hit.parent === this.prop3D.axisTranslateHandle || hit === this.prop3D.axisTranslateHandle) {
          this.isDraggingTranslate = true;
          this.controls.enabled = false;
          e.stopPropagation();
          return;
        }

        // Check if clicking pitch handle
        if (hit.parent === this.prop3D.pitchArcHandle || hit === this.prop3D.pitchArcHandle) {
          this.isDraggingPitch = true;
          this.dragStartY = e.clientY;
          this.startPitch = this.prop3D.currentPitchDeg;
          this.controls.enabled = false;
          e.stopPropagation();
          return;
        }

        // Check if clicking stator incidence handle
        if (hit.parent === this.prop3D.statorIncidenceHandle || hit === this.prop3D.statorIncidenceHandle) {
          this.isDraggingIncidence = true;
          this.dragStartY = e.clientY;
          this.startIncidence = this.prop3D.statorIncidenceDeg;
          this.controls.enabled = false;
          e.stopPropagation();
          return;
        }

        // Clicking propeller body/hub selects it
        this.prop3D.setSelected(true);
        this.onPropellerSelected?.();
      } else {
        // Clicking empty space deselects handles if not dragging
        if (!this.isDraggingTranslate && !this.isDraggingPitch && !this.isDraggingIncidence) {
          this.prop3D.setSelected(false);
        }
      }
    });

    dom.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.prop3D) return;

      if (this.isDraggingTranslate) {
        const delta = -e.movementY * 0.0015;
        this.prop3D.group.position.z = Math.max(-0.25, Math.min(0.25, this.prop3D.group.position.z + delta));
        this.onPropellerPositionChanged?.(this.prop3D.group.position.z);
      } else if (this.isDraggingPitch) {
        const dy = (this.dragStartY - e.clientY) * 0.2;
        const newPitch = Math.max(5.0, Math.min(35.0, this.startPitch + dy));
        this.prop3D.currentPitchDeg = newPitch;
        this.onPitchChanged?.(newPitch);
      } else if (this.isDraggingIncidence) {
        const dy = (this.dragStartY - e.clientY) * 0.15;
        const newInc = Math.max(-15.0, Math.min(15.0, this.startIncidence + dy));
        this.prop3D.setStatorIncidence(newInc);
        this.onIncidenceChanged?.(newInc);
      }
    });

    const onPointerUp = () => {
      if (this.isDraggingTranslate || this.isDraggingPitch || this.isDraggingIncidence) {
        this.isDraggingTranslate = false;
        this.isDraggingPitch = false;
        this.isDraggingIncidence = false;
        this.controls.enabled = true;
      }
    };

    window.addEventListener('pointerup', onPointerUp);

    // Keyboard shortcut: Delete or Backspace removes selected thruster
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.prop3D?.isSelected) {
          this.onRemoveThruster?.();
        }
      }
    });
  }

  public render(
    time = performance.now() * 0.001,
    causticIntensity = 1.0,
    fluidGrid?: FluidGrid,
    dt = 1.0 / 60.0,
    propAngle?: number,
    propRpm?: number
  ): void {
    if (this.isDisposed) return;

    // Update 3D free surface wave displacement coupled to 2D fluid velocity field & high shear foam
    this.waterSurface.update(time, dt, fluidGrid);

    // Update animated floor caustics
    this.caustics.update(time, causticIntensity);

    // Update 3D propeller rotation if attached with high-RPM blur
    if (this.prop3D && propAngle !== undefined) {
      this.prop3D.setRotation(propAngle, propRpm ?? 0);
    }

    this.controls.update();
    (this.renderer as any).render(this.scene, this.camera);
  }

  private onResize = (): void => {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  public dispose(): void {
    this.isDisposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    this.waterSurface.dispose();
    this.caustics.dispose();
    this.prop3D?.dispose();
    this.skyTexture.dispose();
    this.renderer.dispose();
  }
}
