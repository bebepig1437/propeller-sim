import * as THREE from 'three';
import { PropDesign, CANDIDATE_A_DESIGN, getDesignBladeChordAt, getDesignBladePitchAngleAt, getPropDesign } from './designs/index';
import type { PropellerMaterial } from './rigidbody';

export interface Propeller3DOptions {
  design?: PropDesign;
  diameterMm?: number;
  hubOdMm?: number;
  hubLenMm?: number;
  blades?: number;
  pitchMm?: number;
  materialType?: PropellerMaterial;
  handedness?: 'CW' | 'CCW';
}

/**
 * Creates physical PBR materials representing Candidate A's propeller materials.
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
  public design: PropDesign;
  public currentMaterial: PropellerMaterial;
  public handedness: 'CW' | 'CCW';
  public currentPitchDeg: number;

  private hubMesh!: THREE.Mesh;
  private spinnerMesh!: THREE.Mesh;
  private bladeMeshes: THREE.Mesh[] = [];
  private blurDiscMesh!: THREE.Mesh;

  // Direct Manipulation Handles
  public isSelected = false;
  public selectionBox!: THREE.BoxHelper;
  public handlesGroup: THREE.Group;
  public axisTranslateHandle!: THREE.Group;
  public pitchArcHandle!: THREE.Group;
  public statorIncidenceHandle!: THREE.Group;
  public handednessBadge!: THREE.Mesh;

  // Stator 3D cascade
  public statorGroup: THREE.Group;
  public statorAttached = true;
  public statorSlotted = true;
  public statorIncidenceDeg = -5.2;
  private statorVaneMeshes: THREE.Mesh[] = [];

  public get currentDesignId(): string {
    return this.design.id;
  }

  public get currentHandedness(): 'CW' | 'CCW' {
    return this.handedness;
  }

  public get translateHandle(): THREE.Object3D {
    return this.axisTranslateHandle;
  }

  public get pitchHandle(): THREE.Object3D {
    return this.pitchArcHandle;
  }

  public get incidenceHandle(): THREE.Object3D {
    return this.statorIncidenceHandle;
  }

  constructor(options?: Propeller3DOptions) {
    this.design = options?.design ?? CANDIDATE_A_DESIGN;
    this.currentMaterial = options?.materialType ?? 'rigid10k';
    this.handedness = options?.handedness ?? 'CW';
    this.currentPitchDeg = 18.0;

    this.group = new THREE.Group();
    this.rotorGroup = new THREE.Group();
    this.statorGroup = new THREE.Group();
    this.handlesGroup = new THREE.Group();
    this.group.add(this.rotorGroup);
    this.group.add(this.statorGroup);
    this.group.add(this.handlesGroup);

    this.buildGeometry();
    this.buildStatorGeometry();
    this.buildDirectManipulationHandles();
  }

  /**
   * Rebuilds all procedural blade and hub meshes according to active design & handedness.
   */
  public rebuild(): void {
    // Clear existing children from rotorGroup
    while (this.rotorGroup.children.length > 0) {
      const child = this.rotorGroup.children[0] as THREE.Mesh;
      if (child.geometry) child.geometry.dispose();
      this.rotorGroup.remove(child);
    }
    this.bladeMeshes = [];
    this.buildGeometry();
  }

  private buildGeometry(): void {
    const D = (this.design.diameterMm) * 1e-3;
    const Dhub = (this.design.hubDiameterMm) * 1e-3;
    const Lhub = (this.design.hubLenMm) * 1e-3;
    const numBlades = this.design.blades;
    const isCCW = this.handedness === 'CCW';

    const mat = createPropellerMaterial(this.currentMaterial);

    // 1. Central Aerodynamic Hub
    const hubGeo = new THREE.CylinderGeometry(Dhub / 2.0, Dhub / 2.0, Lhub, 24);
    hubGeo.rotateX(Math.PI / 2); // Align thrust along Z axis
    this.hubMesh = new THREE.Mesh(hubGeo, mat);
    this.hubMesh.castShadow = true;
    this.hubMesh.receiveShadow = true;
    this.rotorGroup.add(this.hubMesh);

    // 2. Nose Cone / Spinner Cap
    const coneGeo = new THREE.ConeGeometry(Dhub / 2.0, Dhub * 0.75, 24);
    coneGeo.rotateX(Math.PI / 2);
    this.spinnerMesh = new THREE.Mesh(coneGeo, mat);
    this.spinnerMesh.position.z = Lhub / 2.0 + (Dhub * 0.75) / 2.0;
    this.spinnerMesh.castShadow = true;
    this.rotorGroup.add(this.spinnerMesh);

    // 3. Parametric Blades
    const Rhub = Dhub / 2.0;
    const R = D / 2.0;
    const radialStations = 14;

    for (let b = 0; b < numBlades; b++) {
      const bladeAngle = (b * (2.0 * Math.PI)) / numBlades;
      const bladeGeo = this.generateParametricBladeGeometry(Rhub, R, radialStations, isCCW);
      const bladeMesh = new THREE.Mesh(bladeGeo, mat);
      bladeMesh.rotation.z = bladeAngle;
      bladeMesh.castShadow = true;
      bladeMesh.receiveShadow = true;
      this.rotorGroup.add(bladeMesh);
      this.bladeMeshes.push(bladeMesh);
    }

    // 4. Subtle Motion Blur Disk for > 500 RPM anti-strobing
    const blurGeo = new THREE.RingGeometry(Rhub, R, 32);
    const blurMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.blurDiscMesh = new THREE.Mesh(blurGeo, blurMat);
    this.blurDiscMesh.position.z = 0;
    this.rotorGroup.add(this.blurDiscMesh);
  }

  /**
   * Generates blade surface buffer geometry using radial chord, twist, and camber distributions.
   */
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

      // Skew and Rake offsets
      const zRake = t * Math.sin(rakeRad) * (R - Rhub);
      const xSkew = Math.sin(t * skewRad) * halfChord * chiralitySign;

      // Leading edge (Z forward, X sideways)
      const leX = xSkew - halfChord * Math.cos(theta);
      const leZ = zRake + halfChord * Math.sin(theta);

      // Trailing edge
      const teX = xSkew + halfChord * Math.cos(theta);
      const teZ = zRake - halfChord * Math.sin(theta);

      // Camber upper crown and lower belly
      const midX = xSkew;
      const midZ = zRake + thickness * chiralitySign;
      const bellyZ = zRake - thickness * 0.5 * chiralitySign;

      // 4 points per radial ring: LE, Upper Crown, TE, Lower Belly
      positions.push(leX, r, leZ);
      positions.push(midX, r, midZ);
      positions.push(teX, r, teZ);
      positions.push(midX, r, bellyZ);
    }

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

  private buildDirectManipulationHandles(): void {
    // 1. Selection Outline / Bounding Box
    this.selectionBox = new THREE.BoxHelper(this.hubMesh, 0x00f2ff);
    this.selectionBox.visible = false;
    this.handlesGroup.add(this.selectionBox);

    // 2. Mount Axis Translation Handle (Z-axis Arrow)
    this.axisTranslateHandle = new THREE.Group();
    const arrowShaft = new THREE.CylinderGeometry(0.0015, 0.0015, 0.04, 12);
    arrowShaft.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const shaftMesh = new THREE.Mesh(arrowShaft, arrowMat);
    shaftMesh.position.z = 0.035;

    const arrowTip = new THREE.ConeGeometry(0.004, 0.012, 12);
    arrowTip.rotateX(Math.PI / 2);
    const tipMesh = new THREE.Mesh(arrowTip, arrowMat);
    tipMesh.position.z = 0.055;

    this.axisTranslateHandle.add(shaftMesh, tipMesh);
    this.axisTranslateHandle.visible = false;
    this.handlesGroup.add(this.axisTranslateHandle);

    // 3. Pitch Arc Handle at Tip
    this.pitchArcHandle = new THREE.Group();
    const arcCurve = new THREE.EllipseCurve(0, 0, 0.008, 0.008, -Math.PI / 4, Math.PI / 4, false, 0);
    const points = arcCurve.getPoints(16);
    const arcGeo = new THREE.BufferGeometry().setFromPoints(points);
    const arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0x38bdf8 }));
    arcLine.rotation.y = Math.PI / 2;
    arcLine.position.set(0, (this.design.diameterMm / 2.0) * 1e-3, 0);
    this.pitchArcHandle.add(arcLine);
    this.pitchArcHandle.visible = false;
    this.handlesGroup.add(this.pitchArcHandle);

    // 4. Stator Incidence Arc Handle (Amber)
    this.statorIncidenceHandle = new THREE.Group();
    const statorArc = new THREE.EllipseCurve(0, 0, 0.007, 0.007, -Math.PI / 4, Math.PI / 4, false, 0);
    const statorPoints = statorArc.getPoints(16);
    const statorArcGeo = new THREE.BufferGeometry().setFromPoints(statorPoints);
    const statorArcLine = new THREE.Line(statorArcGeo, new THREE.LineBasicMaterial({ color: 0xf59e0b }));
    statorArcLine.rotation.y = Math.PI / 2;
    statorArcLine.position.set(0, (this.design.diameterMm / 2.0) * 0.7 * 1e-3, -((this.design.hubLenMm * 1e-3) / 2.0 + 0.008));
    this.statorIncidenceHandle.add(statorArcLine);
    this.statorIncidenceHandle.visible = false;
    this.handlesGroup.add(this.statorIncidenceHandle);

    // 5. Handedness Badge Indicator on Hub
    const badgeGeo = new THREE.TorusGeometry(0.0055, 0.0008, 8, 16, Math.PI * 1.5);
    const badgeMat = new THREE.MeshBasicMaterial({ color: 0x00f2ff });
    this.handednessBadge = new THREE.Mesh(badgeGeo, badgeMat);
    this.handednessBadge.position.z = (this.design.hubLenMm * 1e-3) / 2.0 + 0.002;
    this.handednessBadge.visible = false;
    this.handlesGroup.add(this.handednessBadge);
  }

  /**
   * Builds stator vane cascade behind propeller hub.
   */
  public buildStatorGeometry(): void {
    while (this.statorGroup.children.length > 0) {
      const c = this.statorGroup.children[0] as THREE.Mesh;
      if (c.geometry) c.geometry.dispose();
      this.statorGroup.remove(c);
    }
    this.statorVaneMeshes = [];

    if (!this.statorAttached) {
      this.statorGroup.visible = false;
      return;
    }
    this.statorGroup.visible = true;

    const D = this.design.diameterMm * 1e-3;
    const Dhub = this.design.hubDiameterMm * 1e-3;
    const Lhub = this.design.hubLenMm * 1e-3;
    const R = D / 2.0;
    const Rhub = Dhub / 2.0;
    const span = R - Rhub;
    const chord = 0.012; // 12mm chord
    const thickness = chord * 0.12;

    const statorMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.4,
      metalness: 0.3
    });

    const zPos = -(Lhub / 2.0 + 0.006);
    const numVanes = 3;
    const incidenceRad = (this.statorIncidenceDeg * Math.PI) / 180.0;

    for (let v = 0; v < numVanes; v++) {
      const angle = (v * 2.0 * Math.PI) / numVanes;
      const vaneGroup = new THREE.Group();
      vaneGroup.rotation.z = angle;
      vaneGroup.position.z = zPos;

      // Stator vane blade
      const vaneGeo = new THREE.BoxGeometry(thickness, span, chord);
      vaneGeo.translate(0, Rhub + span / 2.0, 0);
      const vaneMesh = new THREE.Mesh(vaneGeo, statorMat);
      vaneMesh.rotation.y = incidenceRad;
      vaneMesh.castShadow = true;
      vaneMesh.receiveShadow = true;

      // Visual slot slit at 40% chord if slotted
      if (this.statorSlotted) {
        const slotGeo = new THREE.BoxGeometry(thickness * 1.2, span * 0.85, chord * 0.15);
        slotGeo.translate(0, Rhub + span / 2.0, -chord * 0.1);
        const slotMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
        const slotMesh = new THREE.Mesh(slotGeo, slotMat);
        vaneMesh.add(slotMesh);
      }

      vaneGroup.add(vaneMesh);
      this.statorGroup.add(vaneGroup);
      this.statorVaneMeshes.push(vaneMesh);
    }
  }

  /**
   * Sets stator attachment state.
   */
  public setStatorAttached(attached: boolean): void {
    this.statorAttached = attached;
    this.buildStatorGeometry();
  }

  /**
   * Sets stator slot configuration.
   */
  public setStatorSlotted(slotted: boolean): void {
    this.statorSlotted = slotted;
    this.buildStatorGeometry();
  }

  /**
   * Sets stator vane incidence angle.
   */
  public setStatorIncidence(deg: number): void {
    this.statorIncidenceDeg = deg;
    this.buildStatorGeometry();
  }

  /**
   * Sets selection state and toggles manipulation handles.
   */
  public setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.selectionBox.visible = selected;
    this.axisTranslateHandle.visible = selected;
    this.pitchArcHandle.visible = selected;
    this.statorIncidenceHandle.visible = selected && this.statorAttached;
    this.handednessBadge.visible = selected;
  }

  /**
   * Sets propeller rotation angle (in radians) around Z-thrust axis.
   */
  public setRotation(angleRad: number, rpm = 0): void {
    this.rotorGroup.rotation.z = angleRad;

    // Update anti-strobe blur disc opacity
    const absRpm = Math.abs(rpm);
    if (this.blurDiscMesh) {
      const mat = this.blurDiscMesh.material as THREE.MeshBasicMaterial;
      if (absRpm > 500) {
        mat.opacity = Math.min(0.35, ((absRpm - 500) / 3000.0) * 0.35);
      } else {
        mat.opacity = 0.0;
      }
    }
  }

  /**
   * Updates physical PBR material according to Candidate A selection.
   */
  public setMaterial(type: PropellerMaterial): void {
    this.currentMaterial = type;
    const newMat = createPropellerMaterial(type);
    this.hubMesh.material = newMat;
    this.spinnerMesh.material = newMat;
    for (const blade of this.bladeMeshes) {
      blade.material = newMat;
    }
  }

  /**
   * Sets propeller design variant.
   */
  public setDesign(designOrId: PropDesign | string): void {
    if (typeof designOrId === 'string') {
      this.design = getPropDesign(designOrId);
    } else {
      this.design = designOrId;
    }
    this.rebuild();
    this.selectionBox.update();
  }

  /**
   * Toggles handedness CW <-> CCW.
   */
  public toggleHandedness(): 'CW' | 'CCW' {
    this.handedness = this.handedness === 'CW' ? 'CCW' : 'CW';
    this.rebuild();
    return this.handedness;
  }

  public setHandedness(handedness: 'CW' | 'CCW'): void {
    if (this.handedness !== handedness) {
      this.handedness = handedness;
      this.rebuild();
    }
  }

  /**
   * Updates motor temperature-mapped emissive glow in 3D viewport.
   * - < 50°C: normal (no glow)
   * - 50–85°C: amber warning glow
   * - 85–100°C: fiery crimson cutout glow
   *
   * Phase 6 array form: `thrusterIndex` is REQUIRED (Directive 5, principal
   * review) so a caller can never silently write thruster 0's temperature by
   * forgetting an argument. This 3D unit renders the primary propulsor;
   * temperatures for index > 0 are visualized by the OverlaySystem thermal
   * overlay instead of here.
   */
  public setMotorTemperature(tempC: number, thrusterIndex: number): void {
    if (thrusterIndex <= 0) {
      this.applyMotorEmissive(tempC);
    }
  }

  /**
   * Explicit "all thrusters share this temperature" convenience (Directive 5):
   * keeps intent unambiguous at the call site rather than a defaulted index.
   */
  public setAllMotorTemperatures(tempC: number): void {
    this.applyMotorEmissive(tempC);
  }

  private applyMotorEmissive(tempC: number): void {
    const mat = this.hubMesh.material as THREE.MeshStandardMaterial;
    if (mat && 'emissive' in mat) {
      if (tempC < 50.0) {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0.0;
      } else if (tempC < 85.0) {
        const factor = (tempC - 50.0) / 35.0;
        mat.emissive.setHex(0xf59e0b);
        mat.emissiveIntensity = factor * 0.6;
      } else {
        const factor = Math.min(1.0, (tempC - 85.0) / 15.0);
        mat.emissive.setHex(0xef4444);
        mat.emissiveIntensity = 0.6 + factor * 0.8;
      }
    }
  }

  public dispose(): void {
    this.hubMesh.geometry.dispose();
    this.spinnerMesh.geometry.dispose();
    for (const blade of this.bladeMeshes) {
      blade.geometry.dispose();
    }
    if (this.blurDiscMesh) this.blurDiscMesh.geometry.dispose();
    this.selectionBox.dispose();
  }
}
