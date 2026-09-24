import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPURenderer } from 'three/webgpu';
import { Propeller3D } from '../prop/geometry';
import { CANDIDATE_A_DESIGN } from '../prop/designs/index';
import type { FluidGrid } from '../fluid/grid';
import { PipeTestStand } from './pipe';
import { FlowVisualization } from './flowViz';

export interface RendererInitResult {
  backend: 'WebGPU' | 'WebGL2';
  renderer: THREE.WebGLRenderer | WebGPURenderer;
}

export class AppRenderer {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer | WebGPURenderer;
  public controls: OrbitControls;
  public backend: 'WebGPU' | 'WebGL2';

  public keyLight: THREE.DirectionalLight;
  public rimLight: THREE.DirectionalLight;
  public fillLight: THREE.HemisphereLight;
  public hubLight: THREE.PointLight;
  public pipe: PipeTestStand;
  public prop3D: Propeller3D;
  public flowViz: FlowVisualization;

  private isDisposed = false;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = null;

    const width = container.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
    const height = container.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    this.camera.position.set(0.0, 0.25, 0.78);

    const init = this.createRenderer(container, width, height);
    this.renderer = init.renderer;
    this.backend = init.backend;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement as HTMLElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 4.0;
    this.controls.minDistance = 0.1;
    this.controls.target.set(0, 0, 0);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.keyLight.position.set(-2, 3, 2);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x5ec8ff, 1.8);
    this.rimLight.position.set(2, -1, -3);
    this.scene.add(this.rimLight);

    this.fillLight = new THREE.HemisphereLight(0x88bbee, 0x1a1f27, 0.6);
    this.scene.add(this.fillLight);

    this.pipe = new PipeTestStand({ lengthM: 1.0, radiusM: 0.06 });
    this.scene.add(this.pipe.group);

    this.hubLight = new THREE.PointLight(0xffaa44, 0.8, 0.15);
    this.hubLight.position.set(this.pipe.propMountX, 0, 0);
    this.scene.add(this.hubLight);

    this.prop3D = new Propeller3D({
      design: CANDIDATE_A_DESIGN,
      materialType: 'rigid10k',
      handedness: 'CW'
    });
    this.prop3D.group.position.set(this.pipe.propMountX, 0, 0);
    this.prop3D.group.rotation.y = Math.PI / 2;
    this.scene.add(this.prop3D.group);

    this.flowViz = new FlowVisualization({ pipeLengthM: 1.0, pipeRadiusM: 0.06 });
    this.scene.add(this.flowViz.group);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  private createRenderer(container: HTMLElement, width: number, height: number): RendererInitResult {
    let renderer: THREE.WebGLRenderer | WebGPURenderer;
    let backend: 'WebGPU' | 'WebGL2' = 'WebGL2';

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
        dispose: () => {}
      } as any;
      if (container && typeof container.appendChild === 'function') {
        container.appendChild(mockDom as any);
      }
      return { renderer, backend };
    }

    backend = 'WebGL2';
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    container.appendChild(renderer.domElement);
    return { renderer, backend };
  }

  public setVisualizationMode(mode: 'dye_velocity' | 'dye_vorticity' | 'pressure' | 'none'): void {
    this.flowViz.setMode(mode);
  }

  public setTimeScale(scale: number): void {
    void scale;
  }

  public render(
    bladePhaseRad: number,
    currentRpm = 0,
    thrustN = 0,
    dt = 1.0 / 60.0,
    fluidGrid?: FluidGrid
  ): void {
    if (this.isDisposed) return;

    this.prop3D.setRotation(bladePhaseRad, currentRpm);
    this.flowViz.update(dt, thrustN, this.prop3D.group.position, fluidGrid, bladePhaseRad, currentRpm);
    this.controls.update();
    (this.renderer as any).render(this.scene, this.camera);
  }

  private onResize = (): void => {
    const parent = this.renderer.domElement?.parentElement;
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
    this.scene.remove(this.keyLight);
    this.scene.remove(this.rimLight);
    this.scene.remove(this.fillLight);
    this.scene.remove(this.hubLight);
    this.keyLight.dispose?.();
    this.rimLight.dispose?.();
    this.hubLight.dispose?.();
    this.prop3D.dispose();
    this.pipe.dispose();
    this.flowViz.dispose();
    this.renderer.dispose();
  }
}
