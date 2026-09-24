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
      color: 0x88ccff,
      metalness: 0.0,
      roughness: 0.08,
      transmission: 0.98,
      thickness: 0.02,
      ior: 1.33,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.45,
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
      color: 0x888888,
      metalness: 0.9,
      roughness: 0.25
    });
    this.shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
    this.shaftMesh.castShadow = true;
    this.group.add(this.shaftMesh);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x5ec8ff,
      metalness: 0.5,
      roughness: 0.3,
      emissive: 0x1a5e8a,
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

    const seamGeo = new THREE.BufferGeometry();
    const halfL = this.lengthM / 2;
    const seamPositions = new Float32Array([
      -halfL, this.radiusM, 0,
       halfL, this.radiusM, 0,
      -halfL, -this.radiusM, 0,
       halfL, -this.radiusM, 0
    ]);
    seamGeo.setAttribute('position', new THREE.BufferAttribute(seamPositions, 3));
    const seamMat = new THREE.LineBasicMaterial({
      color: 0x5ec8ff,
      transparent: true,
      opacity: 0.25
    });
    this.seamLines = new THREE.LineSegments(seamGeo, seamMat);
    this.group.add(this.seamLines);

    this.propMountX = -this.lengthM / 2 + this.lengthM * 0.25;
  }

  public seamLines!: THREE.LineSegments;

  public dispose(): void {
    this.pipeMesh.geometry.dispose();
    (this.pipeMesh.material as THREE.Material).dispose();
    this.shaftMesh.geometry.dispose();
    (this.shaftMesh.material as THREE.Material).dispose();
    this.inletRing.geometry.dispose();
    (this.inletRing.material as THREE.Material).dispose();
    this.outletRing.geometry.dispose();
    (this.outletRing.material as THREE.Material).dispose();
    this.seamLines.geometry.dispose();
    (this.seamLines.material as THREE.Material).dispose();
  }
}
