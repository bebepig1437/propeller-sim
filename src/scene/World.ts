import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VehicleConfig } from '../types/vehicle';

export class World {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;
  
  private vehicleGroup: THREE.Group;
  private propMeshes: THREE.Mesh[] = [];
  private cobMarker!: THREE.Mesh;
  private cogMarker!: THREE.Mesh;
  private clock: THREE.Clock;
  private animationFrameId: number | null = null;
  private isDisposed = false;

  constructor(container: HTMLElement) {
    this.clock = new THREE.Clock();
    
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1118); // Deep marine dark blue
    this.scene.fog = new THREE.FogExp2(0x0a1118, 0.08);

    // Camera setup
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 100);
    this.camera.position.set(0.35, 0.25, 0.45);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 2.5;
    this.controls.minDistance = 0.1;
    this.controls.target.set(0, 0, 0);

    // Lighting
    this.setupLighting();

    // Environment: Submersible Test Tank & Coordinate System
    this.setupEnvironment();

    // Vehicle Container
    this.vehicleGroup = new THREE.Group();
    this.scene.add(this.vehicleGroup);

    // Resize Handler
    window.addEventListener('resize', this.onResize);

    // Start loop
    this.animate();
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0x334e68, 1.2);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0x64b5f6, 2.5);
    keyLight.position.set(1.5, 3.0, 2.0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x00f2ff, 1.0);
    rimLight.position.set(-2, -1, -2);
    this.scene.add(rimLight);
  }

  private setupEnvironment(): void {
    // Water test tank boundary grid
    const grid = new THREE.GridHelper(1.2, 24, 0x00f2ff, 0x16324f);
    grid.position.y = -0.15;
    this.scene.add(grid);

    // Test Tank Floor marker
    const floorGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x07111a,
      roughness: 0.85,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.151;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Coordinate Axes
    const axes = new THREE.AxesHelper(0.1);
    axes.position.set(-0.5, -0.149, -0.5);
    this.scene.add(axes);
  }

  public initVehicle(config: VehicleConfig): void {
    // Clear existing
    while (this.vehicleGroup.children.length > 0) {
      this.vehicleGroup.remove(this.vehicleGroup.children[0]);
    }
    this.propMeshes = [];

    // Main Chassis Frame (39.5g frame placeholder)
    const frameGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 16);
    frameGeo.rotateX(Math.PI / 2);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.85
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.castShadow = true;
    this.vehicleGroup.add(frame);

    // Cross spars
    const sparGeo = new THREE.BoxGeometry(0.12, 0.008, 0.008);
    const sparMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.2 });
    const spar1 = new THREE.Mesh(sparGeo, sparMat);
    spar1.position.set(0, 0, 0.03);
    const spar2 = new THREE.Mesh(sparGeo, sparMat);
    spar2.position.set(0, 0, -0.03);
    this.vehicleGroup.add(spar1, spar2);

    // Motor positions according to Candidate A (3 motors: Port, Starboard, Vertical/Aft)
    const motorOffsets = [
      { pos: new THREE.Vector3(-0.06, 0, 0.02), rot: new THREE.Euler(0, 0, 0), handedness: config.propeller.handedness[0] },
      { pos: new THREE.Vector3(0.06, 0, 0.02), rot: new THREE.Euler(0, 0, 0), handedness: config.propeller.handedness[1] },
      { pos: new THREE.Vector3(0, 0.035, -0.05), rot: new THREE.Euler(Math.PI / 2, 0, 0), handedness: config.propeller.handedness[2] }
    ];

    const propRadius = (config.propeller.D_mm / 2.0) / 1000.0; // mm to m (0.021 m)
    const hubLength = config.propeller.hub_len_mm / 1000.0;     // 0.011 m
    const motorLen = 0.035;

    motorOffsets.forEach((motor) => {
      const nacelle = new THREE.Group();
      nacelle.position.copy(motor.pos);
      nacelle.rotation.copy(motor.rot);

      // Motor Can (Mabuchi RC-280RA)
      const motorGeo = new THREE.CylinderGeometry(0.012, 0.012, motorLen, 16);
      motorGeo.rotateX(Math.PI / 2);
      const motorMat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        metalness: 0.9,
        roughness: 0.25
      });
      const motorCan = new THREE.Mesh(motorGeo, motorMat);
      motorCan.castShadow = true;
      nacelle.add(motorCan);

      // Propeller Hub + 3 Blades
      const hubGeo = new THREE.CylinderGeometry(0.004, 0.004, hubLength, 12);
      hubGeo.rotateX(Math.PI / 2);
      const propMat = new THREE.MeshStandardMaterial({
        color: motor.handedness === 'CW' ? 0x00f2ff : 0x38bdf8,
        metalness: 0.5,
        roughness: 0.2
      });
      const propAssembly = new THREE.Mesh(hubGeo, propMat);
      propAssembly.position.z = -(motorLen / 2 + hubLength / 2);

      // 3 Blades
      for (let b = 0; b < config.propeller.blades; b++) {
        const bladeGeo = new THREE.BoxGeometry(0.004, propRadius, 0.001);
        bladeGeo.translate(0, propRadius / 2, 0);
        const blade = new THREE.Mesh(bladeGeo, propMat);
        const angle = (b * 2 * Math.PI) / config.propeller.blades;
        blade.rotation.z = angle;
        blade.rotation.y = (motor.handedness === 'CW' ? 1 : -1) * THREE.MathUtils.degToRad(20);
        propAssembly.add(blade);
      }

      nacelle.add(propAssembly);
      this.propMeshes.push(propAssembly);
      this.vehicleGroup.add(nacelle);
    });

    // CoG and CoB Markers
    // Center of Gravity (CoG) at origin
    const cogGeo = new THREE.SphereGeometry(0.004, 16, 16);
    const cogMat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
    this.cogMarker = new THREE.Mesh(cogGeo, cogMat);
    this.vehicleGroup.add(this.cogMarker);

    // Center of Buoyancy (CoB) at +12.5mm above CoG in Y
    const cobGeo = new THREE.SphereGeometry(0.004, 16, 16);
    const cobMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
    this.cobMarker = new THREE.Mesh(cobGeo, cobMat);
    this.cobMarker.position.y = config.buoyancy.cob_above_cog_mm / 1000.0;
    this.vehicleGroup.add(this.cobMarker);

    // Line connecting CoG to CoB showing restoring stability vector
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, config.buoyancy.cob_above_cog_mm / 1000.0, 0)
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const stabilityLine = new THREE.Line(lineGeo, lineMat);
    this.vehicleGroup.add(stabilityLine);
  }

  public updateAnimation(rpm: number, delta: number): void {
    // Propeller spinning based on simulated RPM
    // rad/s = rpm * 2 * PI / 60
    const radPerSec = (rpm * 2 * Math.PI) / 60;
    const step = radPerSec * delta;

    this.propMeshes.forEach((prop, i) => {
      // Alternate direction based on handedness
      const direction = (i === 1) ? -1 : 1;
      prop.rotation.z += step * direction;
    });

    // Subtle gentle neutral vehicle water buoyancy bobbing
    const time = this.clock.getElapsedTime();
    this.vehicleGroup.position.y = Math.sin(time * 1.5) * 0.003;
    this.vehicleGroup.rotation.z = Math.sin(time * 0.8) * 0.015;
  }

  private animate = (): void => {
    if (this.isDisposed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

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
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
