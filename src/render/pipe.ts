import * as THREE from 'three';

export interface PipeOptions {
  lengthM?: number;
  radiusM?: number;
  shaftRadiusM?: number;
  shaftExtensionM?: number;
}

export class PipeTestStand {
  public group: THREE.Group;
  public pipeMesh: THREE.Mesh;
  public shaftMesh: THREE.Mesh;
  public inletRing: THREE.Mesh;
  public outletRing: THREE.Mesh;

  public readonly lengthM: number;
  public readonly radiusM: number;
  public readonly propMountX: number;

  constructor(options?: PipeOptions) {
    this.lengthM = options?.lengthM ?? 1.0;
    this.radiusM = options?.radiusM ?? 0.06;
    const shaftRadiusM = options?.shaftRadiusM ?? 0.003;
    const shaftExtensionM = options?.shaftExtensionM ?? 0.12;

    this.group = new THREE.Group();

    const pipeGeo = new THREE.CylinderGeometry(
      this.radiusM,
      this.radiusM,
      this.lengthM,
      32,
      1,
      true
    );
    pipeGeo.rotateZ(-Math.PI / 2);

    const pipeMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      metalness: 0.1,
      roughness: 0.1,
      transmission: 0.85,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.pipeMesh = new THREE.Mesh(pipeGeo, pipeMat);
    this.group.add(this.pipeMesh);

    const shaftLength = this.lengthM + shaftExtensionM * 2;
    const shaftGeo = new THREE.CylinderGeometry(
      shaftRadiusM,
      shaftRadiusM,
      shaftLength,
      16
    );
    shaftGeo.rotateZ(-Math.PI / 2);

    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.25
    });
    this.shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
    this.shaftMesh.castShadow = true;
    this.group.add(this.shaftMesh);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.5,
      roughness: 0.3,
      emissive: 0x0284c7,
      emissiveIntensity: 0.4
    });

    const ringGeo = new THREE.TorusGeometry(this.radiusM, 0.002, 12, 32);
    ringGeo.rotateY(Math.PI / 2);

    this.inletRing = new THREE.Mesh(ringGeo, ringMat);
    this.inletRing.position.set(-this.lengthM / 2, 0, 0);
    this.group.add(this.inletRing);

    this.outletRing = new THREE.Mesh(ringGeo, ringMat);
    this.outletRing.position.set(this.lengthM / 2, 0, 0);
    this.group.add(this.outletRing);

    this.propMountX = -this.lengthM / 2 + this.lengthM * 0.25;
  }

  public dispose(): void {
    this.pipeMesh.geometry.dispose();
    this.shaftMesh.geometry.dispose();
    this.inletRing.geometry.dispose();
    this.outletRing.geometry.dispose();
  }
}
