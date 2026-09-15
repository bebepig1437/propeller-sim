import * as THREE from 'three';
import type { VehiclePropulsionSummary } from '../prop/array';
import type { VehicleBody } from '../vehicle/body';

export interface OverlayConfig {
  showThrustVectors: boolean;
  showStreamtubes: boolean;
  showTorqueRings: boolean;
  showCogCob: boolean;
  vectorScale: number; // Scale factor for thrust arrows (m/N)
}

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  showThrustVectors: true,
  showStreamtubes: true,
  showTorqueRings: true,
  showCogCob: true,
  vectorScale: 0.05 // 1 N = 50mm arrow
};

/**
 * 3D Scientific Overlays (Phase 6):
 * - Thrust vector arrows (cyan for propulsion, green for net thrust)
 * - Contracting streamtube envelope downstream of propellers (BEMT slipstream contraction)
 * - Reaction torque arcs / rings
 * - CoG (yellow) and CoB (cyan) metacentric righting arm visualizers
 */
export class FlowOverlays {
  public group: THREE.Group = new THREE.Group();
  public config: OverlayConfig;

  // Visual sub-groups
  private thrustArrowsGroup: THREE.Group = new THREE.Group();
  private streamtubesGroup: THREE.Group = new THREE.Group();
  private torqueRingsGroup: THREE.Group = new THREE.Group();
  private cogCobGroup: THREE.Group = new THREE.Group();

  // Reusable arrow helpers & materials
  private arrowHelpers: THREE.ArrowHelper[] = [];
  private netArrowHelper: THREE.ArrowHelper;
  private streamtubeMeshes: THREE.LineSegments[] = [];
  private torqueArcs: THREE.Line[] = [];

  // CoG / CoB markers
  private cogMarker: THREE.Mesh;
  private cobMarker: THREE.Mesh;
  private rightingArmLine: THREE.Line;

  constructor(config: Partial<OverlayConfig> = {}) {
    this.config = { ...DEFAULT_OVERLAY_CONFIG, ...config };

    this.group.add(this.thrustArrowsGroup);
    this.group.add(this.streamtubesGroup);
    this.group.add(this.torqueRingsGroup);
    this.group.add(this.cogCobGroup);

    // Initialize 3 thruster arrows + 1 net thrust arrow
    const thrusterColors = [0x00f2ff, 0x00f2ff, 0x38bdf8];
    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, 0),
        0.05,
        thrusterColors[i],
        0.015,
        0.008
      );
      this.arrowHelpers.push(arrow);
      this.thrustArrowsGroup.add(arrow);
    }

    // Net thrust arrow (bright neon green)
    this.netArrowHelper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0),
      0.08,
      0x10b981,
      0.02,
      0.01
    );
    this.thrustArrowsGroup.add(this.netArrowHelper);

    // Initialize contracting streamtube line meshes for 3 thrusters
    for (let i = 0; i < 3; i++) {
      const tubeGeo = this.buildStreamtubeGeometry(0.021, 0.015, 0.12, 12, 6);
      const tubeMat = new THREE.LineBasicMaterial({
        color: 0x00f2ff,
        transparent: true,
        opacity: 0.45
      });
      const tubeMesh = new THREE.LineSegments(tubeGeo, tubeMat);
      this.streamtubeMeshes.push(tubeMesh);
      this.streamtubesGroup.add(tubeMesh);
    }

    // Initialize reaction torque circular arcs
    for (let i = 0; i < 3; i++) {
      const arcGeo = this.buildTorqueArcGeometry(0.025, Math.PI * 1.5);
      const arcMat = new THREE.LineBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.75,
        linewidth: 2
      });
      const arc = new THREE.Line(arcGeo, arcMat);
      this.torqueArcs.push(arc);
      this.torqueRingsGroup.add(arc);
    }

    // Initialize CoG / CoB Visualizers
    const cogGeo = new THREE.SphereGeometry(0.006, 12, 12);
    const cogMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 }); // Gold CoG
    this.cogMarker = new THREE.Mesh(cogGeo, cogMat);

    const cobGeo = new THREE.SphereGeometry(0.006, 12, 12);
    const cobMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 }); // Cyan CoB
    this.cobMarker = new THREE.Mesh(cobGeo, cobMat);

    const armGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.0125, 0)
    ]);
    const armMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    this.rightingArmLine = new THREE.Line(armGeo, armMat);

    this.cogCobGroup.add(this.cogMarker);
    this.cogCobGroup.add(this.cobMarker);
    this.cogCobGroup.add(this.rightingArmLine);
  }

  /**
   * Generates a contracting streamtube wireframe geometry downstream of the actuator disc.
   * R_stream(x) = R_0 * sqrt((Va + vi) / (Va + 2*vi * (x/L)))
   */
  private buildStreamtubeGeometry(
    r0: number,
    rInf: number,
    length: number,
    radialSegs: number,
    axialSegs: number
  ): THREE.BufferGeometry {
    const points: THREE.Vector3[] = [];

    // Generate axial streamlines
    for (let i = 0; i < radialSegs; i++) {
      const theta = (i / radialSegs) * Math.PI * 2;
      for (let j = 0; j < axialSegs; j++) {
        const s1 = j / axialSegs;
        const s2 = (j + 1) / axialSegs;
        const r1 = r0 + (rInf - r0) * Math.sqrt(s1);
        const r2 = r0 + (rInf - r0) * Math.sqrt(s2);
        const z1 = s1 * length;
        const z2 = s2 * length;

        points.push(new THREE.Vector3(r1 * Math.cos(theta), r1 * Math.sin(theta), z1));
        points.push(new THREE.Vector3(r2 * Math.cos(theta), r2 * Math.sin(theta), z2));
      }
    }

    // Generate circular cross-section rings
    for (let j = 0; j <= axialSegs; j++) {
      const s = j / axialSegs;
      const r = r0 + (rInf - r0) * Math.sqrt(s);
      const z = s * length;
      for (let i = 0; i < radialSegs; i++) {
        const theta1 = (i / radialSegs) * Math.PI * 2;
        const theta2 = ((i + 1) / radialSegs) * Math.PI * 2;
        points.push(new THREE.Vector3(r * Math.cos(theta1), r * Math.sin(theta1), z));
        points.push(new THREE.Vector3(r * Math.cos(theta2), r * Math.sin(theta2), z));
      }
    }

    return new THREE.BufferGeometry().setFromPoints(points);
  }

  /**
   * Generates a circular arc wireframe indicating rotational torque direction.
   */
  private buildTorqueArcGeometry(radius: number, angleSpan: number): THREE.BufferGeometry {
    const points: THREE.Vector3[] = [];
    const segments = 24;
    for (let i = 0; i < segments; i++) {
      const theta1 = (i / segments) * angleSpan;
      const theta2 = ((i + 1) / segments) * angleSpan;
      points.push(new THREE.Vector3(radius * Math.cos(theta1), radius * Math.sin(theta1), 0));
      points.push(new THREE.Vector3(radius * Math.cos(theta2), radius * Math.sin(theta2), 0));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }

  /**
   * Updates all 3D overlays from current vehicle dynamics and thruster telemetry.
   */
  public update(
    vehicle: VehicleBody,
    propSummary: VehiclePropulsionSummary,
    advanceSpeed = 0.0
  ): void {
    // Sync visibility flags
    this.thrustArrowsGroup.visible = this.config.showThrustVectors;
    this.streamtubesGroup.visible = this.config.showStreamtubes;
    this.torqueRingsGroup.visible = this.config.showTorqueRings;
    this.cogCobGroup.visible = this.config.showCogCob;

    const vPos = vehicle.position;
    const vQuat = vehicle.quaternion;

    // 1. Update CoG / CoB Visualizers
    if (this.config.showCogCob) {
      this.cogMarker.position.copy(vPos);
      const cobWorld = vehicle.localToWorldPoint(
        new THREE.Vector3(...vehicle.buoyancyForces.cobOffsetBodyM)
      );
      this.cobMarker.position.copy(cobWorld);

      const armPos = this.rightingArmLine.geometry.attributes.position as THREE.BufferAttribute;
      armPos.setXYZ(0, vPos.x, vPos.y, vPos.z);
      armPos.setXYZ(1, cobWorld.x, cobWorld.y, cobWorld.z);
      armPos.needsUpdate = true;
    }

    // 2. Update Thruster & Net Thrust Vectors
    if (this.config.showThrustVectors) {
      const thrusters = propSummary.thrusters;
      for (let i = 0; i < Math.min(thrusters.length, this.arrowHelpers.length); i++) {
        const t = thrusters[i];
        const arrow = this.arrowHelpers[i];

        // Thruster mounting position in world frame:
        // Thruster positionM: [0, -0.075, 0] in array.ts -> map to body axes [Sway X, Heave Y, Surge Z]
        // Port thruster is at Sway = -0.075, Starboard at Sway = +0.075
        const posBody = new THREE.Vector3(t.unit.positionM[1], t.unit.positionM[2], t.unit.positionM[0]);
        const posWorld = vehicle.localToWorldPoint(posBody);

        // Thrust vector direction: t.forceVectorN
        const fBody = new THREE.Vector3(t.forceVectorN[1], t.forceVectorN[2], t.forceVectorN[0]);
        const fWorld = vehicle.localToWorldVector(fBody);
        const fMag = fWorld.length();

        if (fMag > 1e-4) {
          arrow.visible = true;
          arrow.position.copy(posWorld);
          arrow.setDirection(fWorld.clone().normalize());
          const arrowLen = Math.max(0.02, Math.min(0.35, fMag * this.config.vectorScale));
          arrow.setLength(arrowLen, arrowLen * 0.25, arrowLen * 0.12);
        } else {
          arrow.visible = false;
        }
      }

      // Net thrust arrow from CoG
      const fNetBody = new THREE.Vector3(
        propSummary.totalForceN[1],
        propSummary.totalForceN[2],
        propSummary.totalForceN[0]
      );
      const fNetWorld = vehicle.localToWorldVector(fNetBody);
      const netMag = fNetWorld.length();
      if (netMag > 1e-3) {
        this.netArrowHelper.visible = true;
        this.netArrowHelper.position.copy(vPos);
        this.netArrowHelper.setDirection(fNetWorld.clone().normalize());
        const netLen = Math.max(0.03, Math.min(0.45, netMag * this.config.vectorScale));
        this.netArrowHelper.setLength(netLen, netLen * 0.22, netLen * 0.1);
      } else {
        this.netArrowHelper.visible = false;
      }
    }

    // 3. Update Streamtube Geometries (Contracting slipstream)
    if (this.config.showStreamtubes) {
      const thrusters = propSummary.thrusters;
      for (let i = 0; i < Math.min(thrusters.length, this.streamtubeMeshes.length); i++) {
        const t = thrusters[i];
        const mesh = this.streamtubeMeshes[i];

        if (Math.abs(t.rpm) > 200) {
          mesh.visible = true;
          const posBody = new THREE.Vector3(t.unit.positionM[1], t.unit.positionM[2], t.unit.positionM[0]);
          mesh.position.copy(vehicle.localToWorldPoint(posBody));
          mesh.quaternion.copy(vQuat);

          // Streamtube contracts downstream: R_inf = R0 * sqrt((Va + vi) / (Va + 2*vi))
          const r0 = 0.021; // 42mm propeller radius
          const meanVi = t.bemt.elements && t.bemt.elements.length > 0
            ? t.bemt.elements.reduce((acc, el) => acc + el.axialInducedMs, 0) / t.bemt.elements.length
            : 0.5;
          const vi = Math.max(0.1, meanVi);
          const rInf = r0 * Math.sqrt((advanceSpeed + vi) / (advanceSpeed + 2.0 * vi));

          // Rebuild dynamic streamtube geometry if needed
          mesh.geometry.dispose();
          mesh.geometry = this.buildStreamtubeGeometry(r0, Math.max(0.012, rInf), 0.15, 12, 6);
        } else {
          mesh.visible = false;
        }
      }
    }

    // 4. Update Reaction Torque Arcs
    if (this.config.showTorqueRings) {
      const thrusters = propSummary.thrusters;
      for (let i = 0; i < Math.min(thrusters.length, this.torqueArcs.length); i++) {
        const t = thrusters[i];
        const arc = this.torqueArcs[i];

        if (Math.abs(t.netTorqueNm) > 1e-4) {
          arc.visible = true;
          const posBody = new THREE.Vector3(t.unit.positionM[1], t.unit.positionM[2], t.unit.positionM[0]);
          arc.position.copy(vehicle.localToWorldPoint(posBody));
          arc.quaternion.copy(vQuat);

          // If CW propeller, reaction torque on body is CCW (negative roll)
          const isCw = t.unit.handedness === 'CW';
          arc.rotation.z = isCw ? Math.PI : 0;
        } else {
          arc.visible = false;
        }
      }
    }
  }

  public dispose(): void {
    for (const arrow of this.arrowHelpers) {
      arrow.dispose();
    }
    this.netArrowHelper.dispose();
    for (const mesh of this.streamtubeMeshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const arc of this.torqueArcs) {
      arc.geometry.dispose();
      (arc.material as THREE.Material).dispose();
    }
    this.cogMarker.geometry.dispose();
    (this.cogMarker.material as THREE.Material).dispose();
    this.cobMarker.geometry.dispose();
    (this.cobMarker.material as THREE.Material).dispose();
    this.rightingArmLine.geometry.dispose();
    (this.rightingArmLine.material as THREE.Material).dispose();
  }
}
