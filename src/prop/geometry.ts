import * as THREE from 'three';
import { PropDesign, CANDIDATE_A_DESIGN, getDesignBladeChordAt, getDesignBladePitchAngleAt, getPropDesign } from './designs/index';
import type { PropellerMaterial } from './rigidbody';

export interface Propeller3DOptions {
  design?: PropDesign;
  materialType?: PropellerMaterial;
  handedness?: 'CW' | 'CCW';
}

export function createPropellerMaterial(type: PropellerMaterial): THREE.Material {
  switch (type) {
    case 'rigid10k':
      return new THREE.MeshPhysicalMaterial({
        color: 0x1e293b,
        roughness: 0.18,
        metalness: 0.25,
        clearcoat: 0.9,
        clearcoatRoughness: 0.1
      });
    case 'pa12cf15':
      return new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.72,
        metalness: 0.08
      });
    case 'petg':
      return new THREE.MeshPhysicalMaterial({
        color: 0x0ea5e9,
        roughness: 0.22,
        metalness: 0.1,
        transmission: 0.65,
        transparent: true,
        opacity: 0.85
      });
  }
}

export class Propeller3D {
  public group: THREE.Group;
  public rotorGroup: THREE.Group;
  public design: PropDesign;
  public currentMaterial: PropellerMaterial;
  public handedness: 'CW' | 'CCW';

  public get currentDesignId(): string {
    return this.design.id;
  }

  public get currentHandedness(): 'CW' | 'CCW' {
    return this.handedness;
  }

  private hubMesh!: THREE.Mesh;
  private spinnerMesh!: THREE.Mesh;
  private bladeMeshes: THREE.Mesh[] = [];

  constructor(options?: Propeller3DOptions) {
    this.design = options?.design ?? CANDIDATE_A_DESIGN;
    this.currentMaterial = options?.materialType ?? 'rigid10k';
    this.handedness = options?.handedness ?? 'CW';

    this.group = new THREE.Group();
    this.rotorGroup = new THREE.Group();
    this.group.add(this.rotorGroup);

    this.buildGeometry();
  }

  public rebuild(): void {
    while (this.rotorGroup.children.length > 0) {
      const child = this.rotorGroup.children[0] as THREE.Mesh;
      if (child.geometry) child.geometry.dispose();
      this.rotorGroup.remove(child);
    }
    this.bladeMeshes = [];
    this.buildGeometry();
  }

  private buildGeometry(): void {
    const D = this.design.diameterMm * 1e-3;
    const Dhub = this.design.hubDiameterMm * 1e-3;
    const Lhub = this.design.hubLenMm * 1e-3;
    const numBlades = this.design.blades;
    const isCCW = this.handedness === 'CCW';

    const mat = createPropellerMaterial(this.currentMaterial);

    const hubGeo = new THREE.CylinderGeometry(Dhub / 2.0, Dhub / 2.0, Lhub, 24);
    hubGeo.rotateX(Math.PI / 2);
    this.hubMesh = new THREE.Mesh(hubGeo, mat);
    this.hubMesh.castShadow = true;
    this.rotorGroup.add(this.hubMesh);

    const coneGeo = new THREE.ConeGeometry(Dhub / 2.0, Dhub * 0.75, 24);
    coneGeo.rotateX(Math.PI / 2);
    this.spinnerMesh = new THREE.Mesh(coneGeo, mat);
    this.spinnerMesh.position.z = Lhub / 2.0 + (Dhub * 0.75) / 2.0;
    this.spinnerMesh.castShadow = true;
    this.rotorGroup.add(this.spinnerMesh);

    const Rhub = Dhub / 2.0;
    const R = D / 2.0;
    const radialStations = 14;

    for (let b = 0; b < numBlades; b++) {
      const bladeAngle = (b * (2.0 * Math.PI)) / numBlades;
      const bladeGeo = this.generateParametricBladeGeometry(Rhub, R, radialStations, isCCW);
      const bladeMesh = new THREE.Mesh(bladeGeo, mat);
      bladeMesh.rotation.z = bladeAngle;
      bladeMesh.castShadow = true;
      this.rotorGroup.add(bladeMesh);
      this.bladeMeshes.push(bladeMesh);
    }
  }

  private generateParametricBladeGeometry(
    Rhub: number,
    R: number,
    stations: number,
    isCCW: boolean
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];

    const chiralitySign = isCCW ? -1.0 : 1.0;
    const rakeRad = (this.design.rakeDeg * Math.PI) / 180.0;
    const skewRad = (this.design.skewDeg * Math.PI) / 180.0;

    for (let s = 0; s <= stations; s++) {
      const t = s / stations;
      const r = Rhub + t * (R - Rhub);
      const chord = getDesignBladeChordAt(r, this.design);
      const theta = getDesignBladePitchAngleAt(r, this.design) * chiralitySign;

      const halfChord = chord / 2.0;
      const thickness = chord * 0.12 * (1.0 - t * 0.45);

      const zRake = t * Math.sin(rakeRad) * (R - Rhub);
      const xSkew = Math.sin(t * skewRad) * halfChord * chiralitySign;

      const leX = xSkew - halfChord * Math.cos(theta);
      const leZ = zRake + halfChord * Math.sin(theta);

      const teX = xSkew + halfChord * Math.cos(theta);
      const teZ = zRake - halfChord * Math.sin(theta);

      const midX = xSkew;
      const midZ = zRake + thickness * chiralitySign;
      const bellyZ = zRake - thickness * 0.5 * chiralitySign;

      positions.push(leX, r, leZ);
      positions.push(midX, r, midZ);
      positions.push(teX, r, teZ);
      positions.push(midX, r, bellyZ);
    }

    for (let s = 0; s < stations; s++) {
      const ring0 = s * 4;
      const ring1 = (s + 1) * 4;

      indices.push(ring0 + 0, ring1 + 0, ring1 + 1);
      indices.push(ring0 + 0, ring1 + 1, ring0 + 1);

      indices.push(ring0 + 1, ring1 + 1, ring1 + 2);
      indices.push(ring0 + 1, ring1 + 2, ring0 + 2);

      indices.push(ring0 + 2, ring1 + 2, ring1 + 3);
      indices.push(ring0 + 2, ring1 + 3, ring0 + 3);

      indices.push(ring0 + 3, ring1 + 3, ring1 + 0);
      indices.push(ring0 + 3, ring1 + 0, ring0 + 0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  public setRotation(angleRad: number): void {
    this.rotorGroup.rotation.z = angleRad;
  }

  public setMaterial(type: PropellerMaterial): void {
    this.currentMaterial = type;
    const newMat = createPropellerMaterial(type);
    this.hubMesh.material = newMat;
    this.spinnerMesh.material = newMat;
    for (const blade of this.bladeMeshes) {
      blade.material = newMat;
    }
  }

  public setDesign(designOrId: PropDesign | string): void {
    if (typeof designOrId === 'string') {
      this.design = getPropDesign(designOrId);
    } else {
      this.design = designOrId;
    }
    this.rebuild();
  }

  public setHandedness(handedness: 'CW' | 'CCW'): void {
    if (this.handedness !== handedness) {
      this.handedness = handedness;
      this.rebuild();
    }
  }

  public dispose(): void {
    this.hubMesh.geometry.dispose();
    this.spinnerMesh.geometry.dispose();
    for (const blade of this.bladeMeshes) {
      blade.geometry.dispose();
    }
  }
}
