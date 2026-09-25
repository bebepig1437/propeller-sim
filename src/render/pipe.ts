import * as THREE from 'three';
import { defaultConfig } from '../core/config';

export interface PipeOptions {
  lengthM?: number;
  radiusM?: number;
  propellerXFraction?: number;
}

export class TestStandPipe {
  public group: THREE.Group;
  public lengthM: number;
  public radiusM: number;
  public propellerXFraction: number;
  public propMountX: number;

  public pipeMesh: THREE.Mesh;
  public shaftMesh: THREE.Mesh;
  public inletRing: THREE.Mesh;
  public outletRing: THREE.Mesh;

  private pipeGeo: THREE.CylinderGeometry;
  private pipeMat: THREE.MeshPhysicalMaterial;
  private shaftGeo: THREE.CylinderGeometry;
  private shaftMat: THREE.MeshStandardMaterial;
  private inletRingGeo: THREE.TorusGeometry;
  private inletRingMat: THREE.MeshStandardMaterial;
  private outletRingGeo: THREE.TorusGeometry;
  private outletRingMat: THREE.MeshStandardMaterial;

  public targetOpacity = 0.22;
  public currentOpacity = 0.22;
  private opacityRate = (0.22 - 0.05) / 0.250;

  constructor(options?: PipeOptions) {
    this.lengthM = options?.lengthM ?? defaultConfig.tunnel.lengthM;
    this.radiusM = options?.radiusM ?? defaultConfig.tunnel.radiusM;
    this.propellerXFraction = options?.propellerXFraction ?? defaultConfig.tunnel.propellerXFraction;
    this.propMountX = -this.lengthM / 2.0 + this.propellerXFraction * this.lengthM;

    this.group = new THREE.Group();

    this.pipeGeo = new THREE.CylinderGeometry(this.radiusM, this.radiusM, this.lengthM, 48, 1, true);
    this.pipeGeo.rotateZ(-Math.PI / 2);

    this.pipeMat = new THREE.MeshPhysicalMaterial({
      color: 0xaad4ee,
      roughness: 0.06,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.pipeMesh = new THREE.Mesh(this.pipeGeo, this.pipeMat);
    this.pipeMesh.castShadow = false;
    this.pipeMesh.receiveShadow = false;
    this.group.add(this.pipeMesh);

    const shaftRadius = 0.0025;
    const shaftExtension = 0.020;
    const shaftLength = this.lengthM + 2.0 * shaftExtension;
    this.shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 32);
    this.shaftGeo.rotateZ(-Math.PI / 2);

    this.shaftMat = new THREE.MeshStandardMaterial({
      color: 0x505560,
      metalness: 0.9,
      roughness: 0.3
    });
    this.shaftMesh = new THREE.Mesh(this.shaftGeo, this.shaftMat);
    this.shaftMesh.castShadow = false;
    this.shaftMesh.receiveShadow = false;
    this.group.add(this.shaftMesh);

    const ringTubeRadius = 0.0012;
    this.inletRingGeo = new THREE.TorusGeometry(this.radiusM, ringTubeRadius, 16, 48);
    this.inletRingGeo.rotateY(Math.PI / 2);
    this.inletRingMat = new THREE.MeshStandardMaterial({
      color: 0x5ec8ff,
      metalness: 0.4,
      roughness: 0.25,
      emissive: 0x1a4866,
      emissiveIntensity: 0.35
    });
    this.inletRing = new THREE.Mesh(this.inletRingGeo, this.inletRingMat);
    this.inletRing.position.set(-this.lengthM / 2.0, 0, 0);
    this.inletRing.castShadow = false;
    this.inletRing.receiveShadow = false;
    this.group.add(this.inletRing);

    this.outletRingGeo = new THREE.TorusGeometry(this.radiusM, ringTubeRadius, 16, 48);
    this.outletRingGeo.rotateY(Math.PI / 2);
    this.outletRingMat = new THREE.MeshStandardMaterial({
      color: 0x3a8ab8,
      metalness: 0.4,
      roughness: 0.25,
      emissive: 0x10304a,
      emissiveIntensity: 0.35
    });
    this.outletRing = new THREE.Mesh(this.outletRingGeo, this.outletRingMat);
    this.outletRing.position.set(this.lengthM / 2.0, 0, 0);
    this.outletRing.castShadow = false;
    this.outletRing.receiveShadow = false;
    this.group.add(this.outletRing);
  }

  public setMedium(medium: 'water' | 'air'): void {
    this.targetOpacity = medium === 'air' ? 0.05 : 0.22;
  }

  public update(dt: number): void {
    if (Math.abs(this.currentOpacity - this.targetOpacity) > 1e-4) {
      const step = this.opacityRate * dt;
      if (this.currentOpacity < this.targetOpacity) {
        this.currentOpacity = Math.min(this.targetOpacity, this.currentOpacity + step);
      } else {
        this.currentOpacity = Math.max(this.targetOpacity, this.currentOpacity - step);
      }
      this.pipeMat.opacity = this.currentOpacity;
    }
  }

  public dispose(): void {
    this.pipeMesh.geometry.dispose();
    this.pipeMat.dispose();
    this.shaftMesh.geometry.dispose();
    this.shaftMat.dispose();
    this.inletRing.geometry.dispose();
    this.inletRingMat.dispose();
    this.outletRing.geometry.dispose();
    this.outletRingMat.dispose();
  }
}
