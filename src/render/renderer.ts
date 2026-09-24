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
  public ambientLight: THREE.AmbientLight;
  public pipe: PipeTestStand;
  public prop3D: Propeller3D;
  public flowViz: FlowVisualization;

  private isDisposed = false;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1116);

    const width = container.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
    const height = container.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    this.camera.position.set(0.0, 0.32, 0.85);

    const init = this.createRenderer(container, width, height);
    this.renderer = init.renderer;
    this.backend = init.backend;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement as HTMLElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 4.0;
    this.controls.minDistance = 0.1;
    this.controls.target.set(0, 0, 0);

    this.ambientLight = new THREE.AmbientLight(0x334155, 1.2);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xf8fafc, 2.8);
    this.keyLight.position.set(1.5, 2.5, 2.0);
    this.scene.add(this.keyLight);

    this.pipe = new PipeTestStand({ lengthM: 1.0, radiusM: 0.06 });
    this.scene.add(this.pipe.group);

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

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    if (hasWebGPU) {
      try {
        renderer = new WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
        backend = 'WebGPU';
      } catch {
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
    renderer.toneMappingExposure = 1.1;

    container.appendChild(renderer.domElement);
    return { renderer, backend };
  }

  public render(
    bladePhaseRad: number,
    thrustN = 0,
    dt = 1.0 / 60.0,
    fluidGrid?: FluidGrid
  ): void {
    if (this.isDisposed) return;

    this.prop3D.setRotation(bladePhaseRad);
    this.flowViz.update(dt, thrustN, this.prop3D.group.position, fluidGrid);
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
    this.prop3D.dispose();
    this.pipe.dispose();
    this.flowViz.dispose();
    this.renderer.dispose();
  }
}
