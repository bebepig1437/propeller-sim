import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPURenderer } from 'three/webgpu';
import { CausticTextureGenerator, applyUnderwaterOpticalProperties } from './water';
import { Propeller3D } from '../prop/geometry';
import { CANDIDATE_A_DESIGN } from '../prop/designs/index';
import type { FluidGrid } from '../fluid/grid';
import { DEBUG as debug, type SimConfig } from '../core/config';
import { Vehicle3D } from './vehicle3d';

export interface RendererInitResult {
  backend: 'WebGPU' | 'WebGL2';
  renderer: THREE.WebGLRenderer | WebGPURenderer;
}

function createProceduralSkyTexture(): THREE.CanvasTexture {
  let canvas: HTMLCanvasElement;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0.0, '#0369a1');
      grad.addColorStop(0.45, '#38bdf8');
      grad.addColorStop(0.5, '#7dd3fc');
      grad.addColorStop(0.55, '#072b42');
      grad.addColorStop(1.0, '#020b14');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 256);

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

  public isCutaway = false;
  private savedCameraPose = {
    position: new THREE.Vector3(0.55, 0.32, 0.75),
    target: new THREE.Vector3(0, 0, 0)
  };
  public cutawayAxisGroup: THREE.Group = new THREE.Group();
  public silhouetteGroup: THREE.Group = new THREE.Group();

  public vehicle3D?: Vehicle3D;

  public onPropellerSelected?: () => void;
  public onPropellerPositionChanged?: (zM: number) => void;
  public onPitchChanged?: (pitchDeg: number) => void;
  public onHandednessChanged?: (handedness: 'CW' | 'CCW') => void;
  public onIncidenceChanged?: (incidenceDeg: number) => void;
  public onStatorSlottedChanged?: (slotted: boolean) => void;
  public onRemoveThruster?: () => void;

  public onVehicleSelected?: () => void;
  public onVehiclePoseChanged?: (position: THREE.Vector3, yawRad: number) => void;
  public onVehiclePoseCommit?: (position: THREE.Vector3, yawRad: number) => void;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05131f);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 100);
    this.camera.position.set(0.55, 0.32, 0.75);

    const init = this.createRenderer(container, width, height);
    this.renderer = init.renderer;
    this.backend = init.backend;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement as HTMLElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 4.0;
    this.controls.minDistance = 0.1;
    this.controls.target.set(0, 0, 0);

    this.skyTexture = createProceduralSkyTexture();
    this.scene.environment = this.skyTexture;

    const skyGeo = new THREE.SphereGeometry(30, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: this.skyTexture, side: THREE.BackSide });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);

    applyUnderwaterOpticalProperties(this.scene);

    this.setupLighting();

    this.caustics = new CausticTextureGenerator(128);

    const planeGeo = new THREE.PlaneGeometry(3.0, 1.6);
    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x071520,
      roughness: 0.65,
      metalness: 0.25,
      map: this.caustics.texture,
      emissive: 0x00f2ff,
      emissiveMap: this.caustics.texture,
      emissiveIntensity: 0.2
    });
    this.groundPlane = new THREE.Mesh(planeGeo, this.floorMaterial);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -0.28;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);

    const gridHelper = new THREE.GridHelper(2.6, 26, 0x00f2ff, 0x0d283d);
    gridHelper.position.y = -0.279;
    this.scene.add(gridHelper);

    const axes = new THREE.AxesHelper(0.12);
    axes.position.set(-1.2, -0.278, -0.3);
    this.scene.add(axes);

    this.tankStructure = this.createWaterTunnelStructure();
    this.scene.add(this.tankStructure);


    this.prop3D = new Propeller3D({
      design: CANDIDATE_A_DESIGN,
      materialType: 'rigid10k',
      handedness: 'CW'
    });
    this.prop3D.group.position.set(0, 0, 0);
    this.scene.add(this.prop3D.group);
    this.setupInteraction();

    this.cutawayAxisGroup.name = 'cutawayAxisGroup';
    this.cutawayAxisGroup.visible = false;
    this.scene.add(this.cutawayAxisGroup);

    this.silhouetteGroup.name = 'silhouetteGroup';
    this.silhouetteGroup.visible = false;
    this.scene.add(this.silhouetteGroup);

    this.buildCutawayAxes();
    this.buildCutawaySilhouette();

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  public attachVehicle3D(config: SimConfig['vehicle']): Vehicle3D {
    if (this.vehicle3D) return this.vehicle3D;
    this.vehicle3D = new Vehicle3D(
      {
        cornerHalfGapM: config.frameTrussCornerHalfGapM,
        mountSwayM: 0.075,
        propDiameterM: 0.042,
        cobAboveCogM: config.cobAboveCogMm * 1e-3
      },
      {
        onSelected: () => this.onVehicleSelected?.(),
        onPoseChanged: (position, yawRad) => this.onVehiclePoseChanged?.(position, yawRad),
        onPoseCommit: (position, yawRad) => this.onVehiclePoseCommit?.(position, yawRad)
      }
    );
    this.scene.add(this.vehicle3D.root);
    return this.vehicle3D;
  }

  private createRenderer(container: HTMLElement, width: number, height: number): RendererInitResult {
    let renderer: THREE.WebGLRenderer | WebGPURenderer;
    let backend: 'WebGPU' | 'WebGL2' = 'WebGL2';

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
        if (debug) console.warn('[Renderer] WebGPU initialization failed, falling back to WebGL2:', err);
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

    this.sunLight = new THREE.DirectionalLight(0xbae6fd, 3.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.setSunDirection(45.0, 60.0);
    this.scene.add(this.sunLight);

    this.bounceLight = new THREE.DirectionalLight(0x00f2ff, 0.9);
    this.bounceLight.position.set(-1.8, -1.0, -1.8);
    this.scene.add(this.bounceLight);
  }

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

  private buildCutawayAxes(): void {
    const group = this.cutawayAxisGroup;
    const length = 2.4;
    const height = 0.5;
    const halfL = length / 2;
    const halfH = height / 2;

    const lineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6 });
    const points: THREE.Vector3[] = [
      new THREE.Vector3(-halfL, -halfH, 0),
      new THREE.Vector3(halfL, -halfH, 0),
      new THREE.Vector3(halfL, halfH, 0),
      new THREE.Vector3(-halfL, halfH, 0),
      new THREE.Vector3(-halfL, -halfH, 0)
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.Line(borderGeo, lineMat));

    const tickMat = new THREE.LineBasicMaterial({ color: 0x3b82f6 });
    const tickPoints: THREE.Vector3[] = [];
    for (let x = -halfL; x <= halfL + 1e-4; x += 0.4) {
      tickPoints.push(new THREE.Vector3(x, -halfH, 0), new THREE.Vector3(x, -halfH - 0.02, 0));
    }
    for (let y = -halfH; y <= halfH + 1e-4; y += 0.1) {
      tickPoints.push(new THREE.Vector3(-halfL, y, 0), new THREE.Vector3(-halfL - 0.02, y, 0));
    }
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPoints);
    group.add(new THREE.LineSegments(tickGeo, tickMat));
  }

  private buildCutawaySilhouette(): void {
    const group = this.silhouetteGroup;
    const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.85 });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 16), silhouetteMat);
    hub.rotation.z = Math.PI / 2;
    group.add(hub);

    const discOutlineMat = new THREE.LineBasicMaterial({ color: 0xff7700, transparent: true, opacity: 0.8 });
    const discPoints: THREE.Vector3[] = [
      new THREE.Vector3(0, -0.042, 0),
      new THREE.Vector3(0, 0.042, 0)
    ];
    const discGeo = new THREE.BufferGeometry().setFromPoints(discPoints);
    group.add(new THREE.Line(discGeo, discOutlineMat));
  }

  public setCutaway(active: boolean): void {
    if (this.isCutaway === active) return;
    this.isCutaway = active;

    if (active) {
      this.savedCameraPose.position.copy(this.camera.position);
      this.savedCameraPose.target.copy(this.controls.target);

      this.camera.position.set(0.0, 0.0, 1.85);
      this.controls.target.set(0.0, 0.0, 0.0);
      this.controls.update();

      this.tankStructure.visible = false;
      this.cutawayAxisGroup.visible = true;
      this.silhouetteGroup.visible = true;
    } else {
      this.camera.position.copy(this.savedCameraPose.position);
      this.controls.target.copy(this.savedCameraPose.target);
      this.controls.update();

      this.tankStructure.visible = true;
      this.cutawayAxisGroup.visible = false;
      this.silhouetteGroup.visible = false;
    }
  }

  public setSideCutawayView(): void {
    this.setCutaway(true);
  }

  public setFullTunnelView(): void {
    this.camera.position.set(0.0, 0.45, 2.2);
    this.controls.target.set(0.0, 0.0, 0.0);
    this.controls.update();
  }

  public setTestSectionCloseUpView(): void {
    this.camera.position.set(0.2, 0.15, 0.45);
    this.controls.target.set(0.0, 0.0, 0.0);
    this.controls.update();
  }

  public resetOrbitView(): void {
    this.camera.position.set(0.65, 0.42, 0.85);
    this.controls.target.set(0.0, 0.0, 0.0);
    this.controls.update();
  }

  public playIntroCameraMove(onComplete?: () => void): void {
    const targetPos = new THREE.Vector3(0.65, 0.42, 0.85);
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      this.camera.position.copy(targetPos);
      this.controls.target.set(0.0, 0.0, 0.0);
      this.controls.update();
      if (onComplete) onComplete();
      return;
    }

    const startPos = new THREE.Vector3(1.15, 0.65, 1.35);
    const duration = 1200;
    const startTime = (typeof performance !== "undefined" ? performance.now() : Date.now());
    this.camera.position.copy(startPos);
    this.controls.target.set(0.0, 0.0, 0.0);
    this.controls.update();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      const ease = 0.5 - 0.5 * Math.cos(progress * Math.PI);
      this.camera.position.lerpVectors(startPos, targetPos, ease);
      this.controls.update();
      if (progress < 1.0) {
        if (typeof requestAnimationFrame !== "undefined") {
          requestAnimationFrame(step);
        }
      } else {
        this.camera.position.copy(targetPos);
        this.controls.update();
        if (onComplete) onComplete();
      }
    };
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(step);
    } else {
      this.camera.position.copy(targetPos);
      this.controls.update();
      if (onComplete) onComplete();
    }
  }

  private createWaterTunnelStructure(): THREE.Group {
    const tunnel = new THREE.Group();

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c2a3e,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.92,
      ior: 1.49,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25
    });

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.7,
      roughness: 0.4
    });

    const accentMat = new THREE.MeshBasicMaterial({
      color: 0x00f2ff
    });

    const length = 2.4;
    const height = 0.5;
    const depth = 0.5;
    const halfL = length / 2;
    const halfH = height / 2;
    const halfD = depth / 2;

    const frontWindow = new THREE.Mesh(new THREE.PlaneGeometry(length, height), glassMat);
    frontWindow.position.set(0, 0, halfD);
    tunnel.add(frontWindow);

    const backWindow = new THREE.Mesh(new THREE.PlaneGeometry(length, height), glassMat);
    backWindow.position.set(0, 0, -halfD);
    backWindow.rotation.y = Math.PI;
    tunnel.add(backWindow);

    const topPlate = new THREE.Mesh(new THREE.PlaneGeometry(length, depth), plateMat);
    topPlate.position.set(0, halfH, 0);
    topPlate.rotation.x = Math.PI / 2;
    tunnel.add(topPlate);

    const bottomPlate = new THREE.Mesh(new THREE.PlaneGeometry(length, depth), plateMat);
    bottomPlate.position.set(0, -halfH, 0);
    bottomPlate.rotation.x = -Math.PI / 2;
    tunnel.add(bottomPlate);

    const railGeoX = new THREE.BoxGeometry(length + 0.02, 0.015, 0.015);
    const railPositions: [number, number, number][] = [
      [0, halfH, halfD],
      [0, halfH, -halfD],
      [0, -halfH, halfD],
      [0, -halfH, -halfD]
    ];
    railPositions.forEach(pos => {
      const rail = new THREE.Mesh(railGeoX, frameMat);
      rail.position.set(pos[0], pos[1], pos[2]);
      tunnel.add(rail);
    });

    const colGeo = new THREE.BoxGeometry(0.015, height, 0.015);
    const stationPositions = [-halfL, -halfL * 0.5, 0, halfL * 0.5, halfL];
    stationPositions.forEach(x => {
      const colF = new THREE.Mesh(colGeo, frameMat);
      colF.position.set(x, 0, halfD);
      const colB = new THREE.Mesh(colGeo, frameMat);
      colB.position.set(x, 0, -halfD);
      tunnel.add(colF, colB);
    });

    const strutGeo = new THREE.CylinderGeometry(0.008, 0.008, halfH, 16);
    const strutMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.9,
      roughness: 0.15
    });
    const strut = new THREE.Mesh(strutGeo, strutMat);
    strut.position.set(0, halfH / 2, 0);
    tunnel.add(strut);

    const loadCellGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 16);
    const loadCellMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.95,
      roughness: 0.1
    });
    const loadCell = new THREE.Mesh(loadCellGeo, loadCellMat);
    loadCell.position.set(0, 0.03, 0);
    tunnel.add(loadCell);

    const inletFrameGeo = new THREE.BoxGeometry(0.02, height + 0.02, depth + 0.02);
    const inletRing = new THREE.Mesh(inletFrameGeo, frameMat);
    inletRing.position.set(-halfL, 0, 0);
    tunnel.add(inletRing);

    const outletFrameGeo = new THREE.BoxGeometry(0.02, height + 0.02, depth + 0.02);
    const outletRing = new THREE.Mesh(outletFrameGeo, frameMat);
    outletRing.position.set(halfL, 0, 0);
    tunnel.add(outletRing);

    const datumGeo = new THREE.BoxGeometry(length, 0.003, 0.003);
    const datum = new THREE.Mesh(datumGeo, accentMat);
    datum.position.set(0, 0, halfD + 0.001);
    tunnel.add(datum);

    return tunnel;
  }

  private setupInteraction(): void {
    if (typeof window === 'undefined' || !this.renderer.domElement) return;
    const dom = this.renderer.domElement as HTMLElement;
    if (typeof dom.addEventListener !== 'function') return;

    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);

      const pickables: THREE.Object3D[] = [];
      if (this.prop3D) pickables.push(this.prop3D.group);
      if (this.vehicle3D) pickables.push(...this.vehicle3D.pickables());

      const intersects = this.raycaster.intersectObjects(pickables, true);
      if (intersects.length > 0) {
        const hit = intersects[0].object;
        let isProp = false;
        let curr: THREE.Object3D | null = hit;
        while (curr) {
          if (this.prop3D && curr === this.prop3D.group) {
            isProp = true;
            break;
          }
          curr = curr.parent;
        }

        if (isProp) {
          this.prop3D?.setSelected(true);
          this.vehicle3D?.setSelected(false);
          this.onPropellerSelected?.();
        } else {
          this.vehicle3D?.setSelected(true);
          this.prop3D?.setSelected(false);
          this.onVehicleSelected?.();
        }
      } else {
        this.prop3D?.setSelected(false);
        this.vehicle3D?.setSelected(false);
      }
    });

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
    _fluidGrid?: FluidGrid,
    _dt = 1.0 / 60.0,
    propAngle?: number,
    propRpm?: number
  ): void {
    if (this.isDisposed) return;

    this.caustics.update(time, causticIntensity);

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
    this.caustics.dispose();
    this.prop3D?.dispose();
    this.vehicle3D?.dispose();
    this.skyTexture.dispose();
    this.renderer.dispose();
  }
}
