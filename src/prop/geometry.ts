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
    default:
      return new THREE.MeshPhysicalMaterial({
        color: 0xdde6f0,
        metalness: 0.15,
        roughness: 0.35,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2
      });
    case 'pa12cf15':
      return new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.45,
        metalness: 0.2
      });
    case 'petg':
      return new THREE.MeshPhysicalMaterial({
        color: 0xbae6fd,
        roughness: 0.2,
        metalness: 0.1,
        transmission: 0.75,
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
  private tipMeshes: THREE.Mesh[] = [];
  private sweptDiscMesh!: THREE.Mesh;

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
    this.tipMeshes = [];
    this.buildGeometry();
  }

  private buildGeometry(): void {
    const D = this.design.diameterMm * 1e-3;
    const Dhub = this.design.hubDiameterMm * 1e-3;
    const Lhub = this.design.hubLenMm * 1e-3;
    const numBlades = this.design.blades;
    const isCCW = this.handedness === 'CCW';

    const mat = createPropellerMaterial(this.currentMaterial);
    const tipMat = new THREE.MeshPhysicalMaterial({
      color: 0xff8844,
      metalness: 0.2,
      roughness: 0.3,
      clearcoat: 0.8
    });

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
      const bladeGeo = this.generateParametricBladeGeometry(Rhub, Rhub + (R - Rhub) * 0.95, radialStations, isCCW);
      const bladeMesh = new THREE.Mesh(bladeGeo, mat);
      bladeMesh.rotation.z = bladeAngle;
      bladeMesh.castShadow = true;

      const tipGeo = this.generateParametricBladeGeometry(Rhub + (R - Rhub) * 0.95, R, 3, isCCW);
      const tipMesh = new THREE.Mesh(tipGeo, tipMat);
      tipMesh.castShadow = true;
      bladeMesh.add(tipMesh);
      this.tipMeshes.push(tipMesh);

      this.rotorGroup.add(bladeMesh);
      this.bladeMeshes.push(bladeMesh);
    }

    const discGeo = new THREE.RingGeometry(Rhub, R, 48);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xff8844,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.sweptDiscMesh = new THREE.Mesh(discGeo, discMat);
    this.sweptDiscMesh.position.z = -0.002;
    this.sweptDiscMesh.visible = false;
    this.group.add(this.sweptDiscMesh);
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

  public setRotation(angleRad: number, rpm = 0): void {
    this.rotorGroup.rotation.z = angleRad;
    if (this.sweptDiscMesh) {
      if (rpm <= 500) {
        this.sweptDiscMesh.visible = false;
      } else {
        this.sweptDiscMesh.visible = true;
        const frac = Math.min(1.0, (rpm - 500) / 2500);
        (this.sweptDiscMesh.material as THREE.MeshBasicMaterial).opacity = frac * 0.25;
      }
    }
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
    (this.hubMesh.material as THREE.Material).dispose();
    this.spinnerMesh.geometry.dispose();
    (this.spinnerMesh.material as THREE.Material).dispose();
    for (const blade of this.bladeMeshes) {
      blade.geometry.dispose();
      (blade.material as THREE.Material).dispose();
    }
    for (const tip of this.tipMeshes) {
      tip.geometry.dispose();
      (tip.material as THREE.Material).dispose();
    }
    if (this.sweptDiscMesh) {
      this.sweptDiscMesh.geometry.dispose();
      (this.sweptDiscMesh.material as THREE.Material).dispose();
    }
  }
}
