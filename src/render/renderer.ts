import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Propeller3D } from '../prop/geometry';
import { CANDIDATE_A_DESIGN, KAPLAN_DESIGN, PropDesign } from '../prop/designs/index';
import { TestStandPipe } from './pipe';
import { WaterVisualization } from './waterViz';
import { FluidGrid } from '../fluid/grid';
import type { PropellerShaft } from '../prop/rigidbody';
import type { PropellerMaterial } from '../prop/rigidbody';
import type { SimulationMedium } from '../core/config';

export interface RendererInitResult {
  backend: 'WebGL2';
  renderer: THREE.WebGLRenderer;
}

export class AppRenderer {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;
  public backend: 'WebGL2';

  public keyLight: THREE.DirectionalLight;
  public rimLight: THREE.DirectionalLight;
  public fillLight: THREE.HemisphereLight;

  public pipe: TestStandPipe;
  public prop3D: Propeller3D;
  public waterViz: WaterVisualization;

  public sceneB: THREE.Scene;
  public cameraB: THREE.PerspectiveCamera;
  public pipeB: TestStandPipe;
  public prop3D_B: Propeller3D;
  public waterVizB: WaterVisualization;
  public keyLightB: THREE.DirectionalLight;
  public rimLightB: THREE.DirectionalLight;
  public fillLightB: THREE.HemisphereLight;

  public activeMedium: SimulationMedium = 'water';
  public isCompareMode = false;

  private dryIndicator: HTMLElement | null = null;
  private compareDivider: HTMLElement | null = null;
  private colLabelA: HTMLElement | null = null;
  private colLabelB: HTMLElement | null = null;

  private isDisposed = false;
  public readonly container: HTMLElement;

  constructor(container: HTMLElement, fluidGrid?: FluidGrid) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = null;

    const width = container.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
    const height = container.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);

    this.pipe = new TestStandPipe();
    this.scene.add(this.pipe.group);

    const propTargetX = this.pipe.propMountX;

    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 10);
    this.camera.position.set(propTargetX - 0.0612, 0.0308, 0.1312);

    const init = this.createRenderer(container, width, height);
    this.renderer = init.renderer;
    this.backend = init.backend;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement as HTMLElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 0.04;
    this.controls.maxDistance = 0.45;
    this.controls.enablePan = false;
    this.controls.autoRotate = false;
    this.controls.target.set(propTargetX, 0, 0);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    this.keyLight.position.set(-0.15, 0.20, 0.10);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x6ba8d8, 1.6);
    this.rimLight.position.set(0.15, -0.05, -0.15);
    this.scene.add(this.rimLight);

    this.fillLight = new THREE.HemisphereLight(0x4a5a70, 0x0a0d12, 0.45);
    this.scene.add(this.fillLight);

    this.prop3D = new Propeller3D({
      design: CANDIDATE_A_DESIGN,
      materialType: 'rigid10k',
      handedness: 'CW'
    });
    this.prop3D.group.position.set(propTargetX, 0, 0);
    this.prop3D.group.rotation.y = Math.PI / 2;
    this.scene.add(this.prop3D.group);

    const initialGrid = fluidGrid ?? new FluidGrid({ width: 256, height: 128 });
    this.waterViz = new WaterVisualization(this.pipe, initialGrid);
    this.scene.add(this.waterViz.group);

    this.sceneB = new THREE.Scene();
    this.sceneB.background = null;

    this.pipeB = new TestStandPipe();
    this.sceneB.add(this.pipeB.group);

    this.cameraB = new THREE.PerspectiveCamera(35, (width / 2) / height, 0.01, 10);
    this.cameraB.position.set(this.pipeB.propMountX - 0.0612, 0.0308, 0.1312);
    this.cameraB.lookAt(this.pipeB.propMountX, 0, 0);

    this.keyLightB = new THREE.DirectionalLight(0xffffff, 2.2);
    this.keyLightB.position.set(-0.15, 0.20, 0.10);
    this.sceneB.add(this.keyLightB);

    this.rimLightB = new THREE.DirectionalLight(0x6ba8d8, 1.6);
    this.rimLightB.position.set(0.15, -0.05, -0.15);
    this.sceneB.add(this.rimLightB);

    this.fillLightB = new THREE.HemisphereLight(0x4a5a70, 0x0a0d12, 0.45);
    this.sceneB.add(this.fillLightB);

    this.prop3D_B = new Propeller3D({
      design: KAPLAN_DESIGN,
      materialType: 'rigid10k',
      handedness: 'CW'
    });
    this.prop3D_B.group.position.set(this.pipeB.propMountX, 0, 0);
    this.prop3D_B.group.rotation.y = Math.PI / 2;
    this.sceneB.add(this.prop3D_B.group);

    this.waterVizB = new WaterVisualization(this.pipeB, initialGrid);
    this.sceneB.add(this.waterVizB.group);

    this.setupOverlays(container);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  private setupOverlays(container: HTMLElement): void {
    if (typeof document === 'undefined') return;

    this.dryIndicator = document.createElement('div');
    this.dryIndicator.id = 'dry-indicator';
    this.dryIndicator.className = 'dry-indicator';
    this.dryIndicator.textContent = 'DRY';
    this.dryIndicator.style.display = 'none';
    container.appendChild(this.dryIndicator);

    this.compareDivider = document.createElement('div');
    this.compareDivider.id = 'compare-stage-divider';
    this.compareDivider.className = 'compare-stage-divider';
    this.compareDivider.style.display = 'none';
    container.appendChild(this.compareDivider);

    this.colLabelA = document.createElement('div');
    this.colLabelA.id = 'col-label-a';
    this.colLabelA.className = 'compare-column-label col-a';
    this.colLabelA.textContent = 'A: Candidate A';
    this.colLabelA.style.display = 'none';
    container.appendChild(this.colLabelA);

    this.colLabelB = document.createElement('div');
    this.colLabelB.id = 'col-label-b';
    this.colLabelB.className = 'compare-column-label col-b';
    this.colLabelB.textContent = 'B: Kaplan High-Thrust';
    this.colLabelB.style.display = 'none';
    container.appendChild(this.colLabelB);
  }

  public setMedium(medium: SimulationMedium): void {
    this.activeMedium = medium;
    this.pipe.setMedium(medium);
    this.pipeB.setMedium(medium);
    this.waterViz.group.visible = (medium === 'water');
    if (this.waterVizB) this.waterVizB.group.visible = (medium === 'water');

    if (this.dryIndicator) {
      this.dryIndicator.style.display = medium === 'air' ? 'block' : 'none';
    }
  }

  public setCompareMode(enabled: boolean, designB?: PropDesign, materialB?: PropellerMaterial): void {
    this.isCompareMode = enabled;
    if (designB) {
      this.prop3D_B.setDesign(designB);
      if (this.colLabelB) {
        this.colLabelB.textContent = `B: ${designB.name || designB.id}`;
      }
    }
    if (materialB) {
      this.prop3D_B.setMaterial(materialB);
    }

    if (this.compareDivider) {
      this.compareDivider.style.display = enabled ? 'block' : 'none';
    }
    if (this.colLabelA) {
      this.colLabelA.style.display = enabled ? 'block' : 'none';
    }
    if (this.colLabelB) {
      this.colLabelB.style.display = enabled ? 'block' : 'none';
    }

    this.onResize();
  }

  public updateColumnLabels(nameA: string, nameB: string): void {
    if (this.colLabelA) this.colLabelA.textContent = `A: ${nameA}`;
    if (this.colLabelB) this.colLabelB.textContent = `B: ${nameB}`;
  }

  private createRenderer(container: HTMLElement, width: number, height: number): RendererInitResult {
    let renderer: THREE.WebGLRenderer;
    const backend: 'WebGL2' = 'WebGL2';

    if (typeof document === 'undefined') {
      const mockDoc = { addEventListener: () => {}, removeEventListener: () => {} };
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
        setScissorTest: () => {},
        setScissor: () => {},
        setViewport: () => {},
        dispose: () => {}
      } as any;
      if (container && typeof container.appendChild === 'function') {
        container.appendChild(mockDom as any);
      }
      return { renderer, backend };
    }

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    container.appendChild(renderer.domElement);
    return { renderer, backend };
  }

  public render(
    bladePhaseRad: number,
    currentRpm = 0,
    dt = 1 / 60,
    fluidGrid?: FluidGrid,
    shaft?: PropellerShaft,
    bladePhaseRadB?: number,
    currentRpmB = 0,
    fluidGridB?: FluidGrid,
    shaftB?: PropellerShaft
  ): void {
    void currentRpm;
    void currentRpmB;
    if (this.isDisposed) return;

    this.pipe.update(dt);
    this.pipeB.update(dt);

    this.prop3D.setRotation(bladePhaseRad);
    if (this.isCompareMode && bladePhaseRadB !== undefined) {
      this.prop3D_B.setRotation(bladePhaseRadB);
    }

    if (this.activeMedium === 'water' && fluidGrid && shaft) {
      this.waterViz.group.visible = true;
      this.waterViz.update(dt, fluidGrid, shaft, this.camera);
    } else {
      this.waterViz.group.visible = false;
    }

    if (this.isCompareMode && this.waterVizB) {
      if (this.activeMedium === 'water' && (fluidGridB || fluidGrid) && (shaftB || shaft)) {
        this.waterVizB.group.visible = true;
        this.waterVizB.update(dt, fluidGridB ?? fluidGrid!, shaftB ?? shaft!, this.cameraB);
      } else {
        this.waterVizB.group.visible = false;
      }
    }

    this.controls.update();

    const parent = this.renderer.domElement?.parentElement;
    const width = parent?.clientWidth || 800;
    const height = parent?.clientHeight || 600;

    if (!this.isCompareMode) {
      if (typeof this.renderer.setScissorTest === 'function') {
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, width, height);
      }
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
    } else {
      const halfW = Math.floor(width / 2);
      if (typeof this.renderer.setScissorTest === 'function') {
        this.renderer.setScissorTest(true);

        this.renderer.setScissor(0, 0, halfW, height);
        this.renderer.setViewport(0, 0, halfW, height);
        this.camera.aspect = halfW / height;
        this.camera.updateProjectionMatrix();
        this.renderer.render(this.scene, this.camera);

        this.renderer.setScissor(halfW, 0, width - halfW, height);
        this.renderer.setViewport(halfW, 0, width - halfW, height);
        this.cameraB.aspect = (width - halfW) / height;
        this.cameraB.updateProjectionMatrix();
        this.renderer.render(this.sceneB, this.cameraB);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  private onResize = (): void => {
    const parent = this.renderer.domElement?.parentElement;
    if (!parent) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;

    if (!this.isCompareMode) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    } else {
      const halfW = Math.floor(width / 2);
      this.camera.aspect = halfW / height;
      this.camera.updateProjectionMatrix();
      this.cameraB.aspect = (width - halfW) / height;
      this.cameraB.updateProjectionMatrix();
    }
    this.renderer.setSize(width, height);
  };

  public dispose(): void {
    this.isDisposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    this.scene.remove(this.keyLight);
    this.scene.remove(this.rimLight);
    this.scene.remove(this.fillLight);
    this.scene.remove(this.pipe.group);
    this.scene.remove(this.prop3D.group);
    this.scene.remove(this.waterViz.group);

    this.sceneB.remove(this.keyLightB);
    this.sceneB.remove(this.rimLightB);
    this.sceneB.remove(this.fillLightB);
    this.sceneB.remove(this.pipeB.group);
    this.sceneB.remove(this.prop3D_B.group);
    this.sceneB.remove(this.waterVizB.group);

    this.keyLight.dispose?.();
    this.rimLight.dispose?.();
    this.pipe.dispose();
    this.waterViz.dispose();
    this.prop3D.dispose();

    this.keyLightB.dispose?.();
    this.rimLightB.dispose?.();
    this.pipeB.dispose();
    this.waterVizB.dispose();
    this.prop3D_B.dispose();

    if (this.dryIndicator?.parentElement) this.dryIndicator.parentElement.removeChild(this.dryIndicator);
    if (this.compareDivider?.parentElement) this.compareDivider.parentElement.removeChild(this.compareDivider);
    if (this.colLabelA?.parentElement) this.colLabelA.parentElement.removeChild(this.colLabelA);
    if (this.colLabelB?.parentElement) this.colLabelB.parentElement.removeChild(this.colLabelB);

    this.renderer.dispose();
  }
}
