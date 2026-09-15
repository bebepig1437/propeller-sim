import * as THREE from 'three';
import { getBladeChordAt, getBladePitchAngleAt } from './bemt';
import type { PropellerMaterial } from './rigidbody';

export interface Propeller3DOptions {
  diameterMm?: number;     // 42.0
  hubOdMm?: number;        // 8.0
  hubLenMm?: number;       // 11.0
  blades?: number;         // 3
  pitchMm?: number;        // 44.0
  materialType?: PropellerMaterial;
  handedness?: 'CW' | 'CCW';
}

/**
 * Creates physical materials representing Candidate A's propeller materials.
 */
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
  private hubMesh: THREE.Mesh;
  private bladeMeshes: THREE.Mesh[] = [];
  public currentMaterial: PropellerMaterial;

  constructor(options?: Propeller3DOptions) {
    const D = (options?.diameterMm ?? 42.0) * 1e-3;
    const Dhub = (options?.hubOdMm ?? 8.0) * 1e-3;
    const Lhub = (options?.hubLenMm ?? 11.0) * 1e-3;
    const numBlades = options?.blades ?? 3;
    const pitchM = (options?.pitchMm ?? 44.0) * 1e-3;
    const isCCW = options?.handedness === 'CCW';
    this.currentMaterial = options?.materialType ?? 'rigid10k';

    this.group = new THREE.Group();
    this.rotorGroup = new THREE.Group();
    this.group.add(this.rotorGroup);

    const mat = createPropellerMaterial(this.currentMaterial);

    // 1. Central Aerodynamic Hub & Nose Cone
    const hubGeo = new THREE.CylinderGeometry(Dhub / 2.0, Dhub / 2.0, Lhub, 24);
    hubGeo.rotateX(Math.PI / 2); // Align thrust along Z axis
    this.hubMesh = new THREE.Mesh(hubGeo, mat);
    this.hubMesh.castShadow = true;
    this.hubMesh.receiveShadow = true;
    this.rotorGroup.add(this.hubMesh);

    // Nose Cone / Spinner cap
    const coneGeo = new THREE.ConeGeometry(Dhub / 2.0, Dhub * 0.7, 24);
    coneGeo.rotateX(Math.PI / 2);
    const coneMesh = new THREE.Mesh(coneGeo, mat);
    coneMesh.position.z = Lhub / 2.0 + (Dhub * 0.7) / 2.0;
    coneMesh.castShadow = true;
    this.rotorGroup.add(coneMesh);

    // 2. Parametric Blades
    const Rhub = Dhub / 2.0;
    const R = D / 2.0;
    const radialStations = 12;

    for (let b = 0; b < numBlades; b++) {
      const bladeAngle = (b * (2.0 * Math.PI)) / numBlades;
      const bladeGeo = this.generateBladeGeometry(Rhub, R, radialStations, pitchM, isCCW);
      const bladeMesh = new THREE.Mesh(bladeGeo, mat);
      bladeMesh.rotation.z = bladeAngle;
      bladeMesh.castShadow = true;
      bladeMesh.receiveShadow = true;
      this.rotorGroup.add(bladeMesh);
      this.bladeMeshes.push(bladeMesh);
    }
  }

  /**
   * Generates a realistic twisted, cambered blade geometry.
   */
  private generateBladeGeometry(
    Rhub: number,
    R: number,
    stations: number,
    pitchM: number,
    isCCW: boolean
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const indices: number[] = [];

    // Discretize blade into radial stations with leading and trailing edge vertices
    for (let s = 0; s <= stations; s++) {
      const t = s / stations;
      const r = Rhub + t * (R - Rhub);
      const chord = getBladeChordAt(r, Rhub, R);
      let theta = getBladePitchAngleAt(r, pitchM);
      if (isCCW) theta = -theta;

      const halfChord = chord / 2.0;
      const thickness = chord * 0.12 * (1.0 - t * 0.4); // 12% thickness down to 7% at tip

      // Leading edge (Z forward, X trailing)
      const leX = -halfChord * Math.cos(theta);
      const leZ = halfChord * Math.sin(theta);

      // Trailing edge
      const teX = halfChord * Math.cos(theta);
      const teZ = -halfChord * Math.sin(theta);

      // Upper camber crown
      const midX = 0;
      const midZ = thickness;

      // 4 points per radial ring: LE, Upper Crown, TE, Lower Belly
      positions.push(leX, r, leZ);                   // 0: LE
      positions.push(midX, r, midZ);                 // 1: Upper
      positions.push(teX, r, teZ);                   // 2: TE
      positions.push(midX, r, -thickness * 0.6);     // 3: Lower
    }

    // Connect stations with quad faces (2 triangles each)
    for (let s = 0; s < stations; s++) {
      const ring0 = s * 4;
      const ring1 = (s + 1) * 4;

      // Top surface (LE -> Upper -> TE)
      indices.push(ring0 + 0, ring1 + 0, ring1 + 1);
      indices.push(ring0 + 0, ring1 + 1, ring0 + 1);

      indices.push(ring0 + 1, ring1 + 1, ring1 + 2);
      indices.push(ring0 + 1, ring1 + 2, ring0 + 2);

      // Bottom surface (TE -> Lower -> LE)
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

  /**
   * Sets propeller rotation angle (in radians) around Z-thrust axis.
   */
  public setRotation(angleRad: number): void {
    this.rotorGroup.rotation.z = angleRad;
  }

  /**
   * Updates physical PBR material according to Candidate A selection.
   */
  public setMaterial(type: PropellerMaterial): void {
    this.currentMaterial = type;
    const newMat = createPropellerMaterial(type);
    this.hubMesh.material = newMat;
    for (const blade of this.bladeMeshes) {
      blade.material = newMat;
    }
  }

  public dispose(): void {
    this.hubMesh.geometry.dispose();
    for (const blade of this.bladeMeshes) {
      blade.geometry.dispose();
    }
  }
}
