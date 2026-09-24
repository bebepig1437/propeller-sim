import * as THREE from 'three';
import { PropDesign, CANDIDATE_A_DESIGN, getPropDesign } from './designs/index';
import { buildPropeller, PropellerRotorGroup } from './propGeometry';
import { applyMaterial, PROP_MATERIALS, PropMaterialId } from './materials';
import type { PropellerMaterial } from './rigidbody';

export interface Propeller3DOptions {
  design?: PropDesign;
  materialType?: PropellerMaterial;
  handedness?: 'CW' | 'CCW';
}

export class Propeller3D {
  public group: THREE.Group;
  public rotorGroup: THREE.Group;
  public design: PropDesign;
  public currentMaterial: PropellerMaterial;
  public handedness: 'CW' | 'CCW';

  private propMeshGroup!: PropellerRotorGroup;

  public get currentDesignId(): string {
    return this.design.id;
  }

  public get currentHandedness(): 'CW' | 'CCW' {
    return this.handedness;
  }

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
    if (this.propMeshGroup) {
      this.rotorGroup.remove(this.propMeshGroup);
      this.propMeshGroup.dispose();
    }
    this.buildGeometry();
  }

  private buildGeometry(): void {
    this.propMeshGroup = buildPropeller(this.design);
    if (this.currentMaterial !== 'rigid10k') {
      const spec = PROP_MATERIALS[this.currentMaterial as PropMaterialId];
      if (spec) {
        applyMaterial(this.propMeshGroup, spec);
      }
    }
    this.rotorGroup.add(this.propMeshGroup);
  }

  public setRotation(angleRad: number, rpm = 0): void {
    void rpm;
    this.rotorGroup.rotation.z = angleRad;
    this.propMeshGroup.setRotation(angleRad);
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

  public setMaterial(type: PropellerMaterial): void {
    this.currentMaterial = type;
    const spec = PROP_MATERIALS[type as PropMaterialId];
    if (spec && this.propMeshGroup) {
      applyMaterial(this.propMeshGroup, spec);
    }
  }

  public dispose(): void {
    if (this.propMeshGroup) {
      this.propMeshGroup.dispose();
      this.rotorGroup.remove(this.propMeshGroup);
    }
  }
}

