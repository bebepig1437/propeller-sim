import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPURenderer } from 'three/webgpu';
import { WaterSurface } from './surface';
import { CausticTextureGenerator, applyUnderwaterOpticalProperties } from './water';
import { Propeller3D } from '../prop/geometry';
import { CANDIDATE_A_DESIGN } from '../prop/designs/index';
import type { FluidGrid } from '../fluid/grid';
import type { SimConfig } from '../core/config';
import { Vehicle3D, pointerToHorizontalPlane } from './vehicle3d';

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

  private vehicleDragMode: 'grab' | 'heave' | 'yaw' | null = null;

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

    const gridHelper = new THREE.GridHelper(2.4, 24, 0x00f2ff, 0x0d283d);
    gridHelper.position.y = -0.249;
    this.scene.add(gridHelper);

    const axes = new THREE.AxesHelper(0.12);
    axes.position.set(-1.0, -0.248, -1.0);
    this.scene.add(axes);

    this.tankStructure = this.createTestTankStructure();
    this.scene.add(this.tankStructure);

    this.waterSurface = new WaterSurface({
      size: 2.4,
      elevation: 0.22,
      amplitude: 0.005,
      frequency: 2.5,
      speed: 1.1
    });
    this.scene.add(this.waterSurface.mesh);

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
    this.setupVehicleInteraction();
    return this.vehicle3D;
  }

  private setupVehicleInteraction(): void {
    if (typeof window === 'undefined' || !this.renderer.domElement) return;
    const dom = this.renderer.domElement as HTMLElement;
    if (typeof dom.addEventListener !== 'function') return;

    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();

    const toNdc = (e: { clientX: number; clientY: number }) => {
      const rect = dom.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      return rect;
    };

    const pointerWorld = (e: PointerEvent, planeY: number): THREE.Vector3 | null => {
      toNdc(e);
      return pointerToHorizontalPlane(ndc, this.camera, planeY, hitPoint);
    };

    const metersPerPixel = (rect: DOMRect): number => {
      const v3 = this.vehicle3D;
      if (!v3) return 0.001;
      const dist = this.camera.position.distanceTo(v3.getPosition());
      const worldHeight = 2 * Math.tan(((this.camera.fov * Math.PI) / 180) / 2) * dist;
      return worldHeight / Math.max(1, rect.height);
    };

    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      const v3 = this.vehicle3D;
      if (!v3) return;

      toNdc(e);
      this.raycaster.setFromCamera(ndc, this.camera);
      const intersects = this.raycaster.intersectObjects(v3.pickables(), true);
      if (intersects.length === 0) return;

      const handle = v3.isHandle(intersects[0].object);

      if (handle === 'heave' || (e.shiftKey && handle === 'grab')) {
        this.vehicleDragMode = 'heave';
        v3.beginHeaveDrag(e.clientY);
      } else if (handle === 'yaw') {
        const p = pointerWorld(e, v3.getPosition().y);
        if (!p) return;
        this.vehicleDragMode = 'yaw';
        v3.beginYawDrag(p);
      } else if (handle === 'grab') {
        const p = pointerWorld(e, v3.getPosition().y);
        if (!p) return;
        this.vehicleDragMode = 'grab';
        v3.beginHorizontalDrag(p);
      } else {
        v3.setSelected(true);
        this.prop3D?.setSelected(false);
        this.onVehicleSelected?.();
        return;
      }

      this.controls.enabled = false;
      v3.setSelected(true);
      this.prop3D?.setSelected(false);
      this.onVehicleSelected?.();
      e.stopPropagation();
    });

    dom.addEventListener('pointermove', (e: PointerEvent) => {
      const v3 = this.vehicle3D;
      if (!v3 || !this.vehicleDragMode) return;

      const rect = toNdc(e);
      if (this.vehicleDragMode === 'heave') {
        v3.updateHeaveDrag(e.clientY, metersPerPixel(rect));
        return;
      }
      const p = pointerWorld(e, v3.getPosition().y);
      if (!p) return;
      if (this.vehicleDragMode === 'grab') v3.updateHorizontalDrag(p);
      else v3.updateYawDrag(p);
    });

    const onPointerUp = () => {
      if (!this.vehicleDragMode) return;
      const v3 = this.vehicle3D;
      this.vehicleDragMode = null;
      this.controls.enabled = true;
      v3?.commitDrag();
    };

    window.addEventListener('pointerup', onPointerUp);
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

  public setSideCutawayView(): void {
    this.camera.position.set(0.0, 0.05, 1.85);
    this.controls.target.set(0.0, 0.05, 0.0);
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

  private createTestTankStructure(): THREE.Group {
    const tank = new THREE.Group();

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

    const tankHeight = 0.52;
    const halfSize = 1.2;
    const centerY = 0.01;

    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tankHeight), glassMat);
    frontWall.position.set(0, centerY, halfSize);
    tank.add(frontWall);

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tankHeight), glassMat);
    backWall.position.set(0, centerY, -halfSize);
    backWall.rotation.y = Math.PI;
    tank.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tankHeight), glassMat);
    leftWall.position.set(-halfSize, centerY, 0);
    leftWall.rotation.y = Math.PI / 2;
    tank.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tankHeight), glassMat);
    rightWall.position.set(halfSize, centerY, 0);
    rightWall.rotation.y = -Math.PI / 2;
    tank.add(rightWall);

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

    const rimGeo = new THREE.BoxGeometry(2.42, 0.012, 0.012);
    const topRimFront = new THREE.Mesh(rimGeo, pillarMat);
    topRimFront.position.set(0, 0.27, 1.2);
    const topRimBack = new THREE.Mesh(rimGeo, pillarMat);
    topRimBack.position.set(0, 0.27, -1.2);
    tank.add(topRimFront, topRimBack);

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

        if (hit === this.prop3D.handednessBadge) {
          const newH = this.prop3D.toggleHandedness();
          this.onHandednessChanged?.(newH);
          e.stopPropagation();
          return;
        }

        if (hit.parent === this.prop3D.axisTranslateHandle || hit === this.prop3D.axisTranslateHandle) {
          this.isDraggingTranslate = true;
          this.controls.enabled = false;
          e.stopPropagation();
          return;
        }

        if (hit.parent === this.prop3D.pitchArcHandle || hit === this.prop3D.pitchArcHandle) {
          this.isDraggingPitch = true;
          this.dragStartY = e.clientY;
          this.startPitch = this.prop3D.currentPitchDeg;
          this.controls.enabled = false;
          e.stopPropagation();
          return;
        }

        if (hit.parent === this.prop3D.statorIncidenceHandle || hit === this.prop3D.statorIncidenceHandle) {
          this.isDraggingIncidence = true;
          this.dragStartY = e.clientY;
          this.startIncidence = this.prop3D.statorIncidenceDeg;
          this.controls.enabled = false;
          e.stopPropagation();
          return;
        }

        let isStatorHit = false;
        let currObj: THREE.Object3D | null = hit;
        while (currObj && currObj !== this.prop3D.group) {
          if (currObj === this.prop3D.statorGroup) {
            isStatorHit = true;
            break;
          }
          currObj = currObj.parent;
        }

        if (isStatorHit && this.prop3D.statorAttached) {
          const nextSlotted = !this.prop3D.statorSlotted;
          this.prop3D.setStatorSlotted(nextSlotted);
          this.onStatorSlottedChanged?.(nextSlotted);
          this.prop3D.setSelected(true);
          this.vehicle3D?.setSelected(false);
          this.onPropellerSelected?.();
          e.stopPropagation();
          return;
        }

        this.prop3D.setSelected(true);
        this.vehicle3D?.setSelected(false);
        this.onPropellerSelected?.();
      } else {
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

    this.waterSurface.update(time, dt, fluidGrid);

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
    this.waterSurface.dispose();
    this.caustics.dispose();
    this.prop3D?.dispose();
    this.vehicle3D?.dispose();
    this.skyTexture.dispose();
    this.renderer.dispose();
  }
}
