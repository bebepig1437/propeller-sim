/**
 * Phase 6b — 3D vehicle body with direct-manipulation handles.
 *
 * GEOMETRY FRAME: every child of `body` is expressed in the three.js BODY frame,
 * i.e. marine (surge, sway, heave) remapped to (x = sway, y = heave, z = surge)
 * — the same mapping as src/render/frameMap.ts. A marine mount of
 * (0, ±0.075, 0) therefore becomes (x = ±0.075, y = 0, z = 0).
 *
 * MANIPULATION (stage):
 *   drag the translucent grab sphere   → translate in the world X–Z plane
 *   drag the vertical arrow (or shift) → translate along world Y
 *   drag the yaw ring                  → rotate about the heave axis
 * Pitch and roll are NOT user-set: they are owned by the buoyancy model.
 *
 * The body pose is authoritative in src/vehicle/body.ts; this class mirrors it
 * and reports edits back through the callbacks so the physics state is the only
 * source of truth.
 */

import * as THREE from 'three';

export interface Vehicle3DGeometry {
  /** Frame truss node offset from the CoG (m). */
  cornerHalfGapM: number;
  /** Lateral rotor mount offset (m), marine sway axis. */
  mountSwayM: number;
  /** Rotor diameter (m). */
  propDiameterM: number;
  /** Center of buoyancy height above the CoG (m). */
  cobAboveCogM: number;
}

export const DEFAULT_VEHICLE_3D_GEOMETRY: Vehicle3DGeometry = {
  cornerHalfGapM: 0.088,
  mountSwayM: 0.075,
  propDiameterM: 0.042,
  cobAboveCogM: 0.0125
};

export interface Vehicle3DCallbacks {
  onSelected?: () => void;
  /** Fired continuously while dragging: the physics state has been re-posed. */
  onPoseChanged?: (position: THREE.Vector3, yawRad: number) => void;
  /** Fired once when a drag gesture ends. */
  onPoseCommit?: (position: THREE.Vector3, yawRad: number) => void;
}

const COLOR_FRAME = 0x8fa8bf;
const COLOR_FRAME_SELECTED = 0x7dd3fc;
const COLOR_ROTOR = 0xf59e0b;
const COLOR_COG = 0xfbbf24;
const COLOR_COB = 0x22d3ee;
const COLOR_HANDLE = 0x38bdf8;
const COLOR_YAW = 0xa78bfa;

/** Ray → horizontal plane at `planeY`, in world space. Returns null if parallel. */
export function pointerToHorizontalPlane(
  ndc: THREE.Vector2,
  camera: THREE.Camera,
  planeY: number,
  out: THREE.Vector3
): THREE.Vector3 | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  return raycaster.ray.intersectPlane(plane, out) ? out : null;
}

export class Vehicle3D {
  public readonly root: THREE.Group = new THREE.Group();
  /** Pose-driven visual body (rotates with the vehicle quaternion). */
  public readonly body: THREE.Group = new THREE.Group();
  /** Handles: kept world-aligned (never inherits the vehicle's roll/pitch). */
  public readonly handleGroup: THREE.Group = new THREE.Group();

  public readonly grabSphere: THREE.Mesh;
  public readonly heaveHandle: THREE.Mesh;
  public readonly yawRing: THREE.Mesh;

  public isSelected = false;
  public readonly geometry: Vehicle3DGeometry;

  private callbacks: Vehicle3DCallbacks;
  private position = new THREE.Vector3(0, -0.1, 0);
  private yawRad = 0;

  private frameMaterial: THREE.MeshStandardMaterial;
  private handleMaterial: THREE.MeshBasicMaterial;
  private dragOffset = new THREE.Vector3();
  private dragStartHeaveM = 0;
  private dragStartClientY = 0;
  private yawStartPointerAngle = 0;
  private yawStartRad = 0;

  constructor(geometry: Partial<Vehicle3DGeometry> = {}, callbacks: Vehicle3DCallbacks = {}) {
    this.geometry = { ...DEFAULT_VEHICLE_3D_GEOMETRY, ...geometry };
    this.callbacks = callbacks;

    this.frameMaterial = new THREE.MeshStandardMaterial({
      color: COLOR_FRAME,
      metalness: 0.55,
      roughness: 0.35,
      emissive: 0x0b3247,
      emissiveIntensity: 0.6
    });
    this.handleMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_HANDLE,
      transparent: true,
      opacity: 0.45
    });

    this.buildFrame();
    this.grabSphere = this.buildGrabSphere();
    this.heaveHandle = this.buildHeaveHandle();
    this.yawRing = this.buildYawRing();
    this.handleGroup.add(this.grabSphere, this.heaveHandle, this.yawRing);
    this.handleGroup.visible = false;

    this.root.add(this.body, this.handleGroup);
    this.syncHandlePose();
  }

  // ---------------------------------------------------------------- geometry

  private buildFrame(): void {
    const c = this.geometry.cornerHalfGapM;
    const beam = 0.006;

    // 12 truss beams of the (±c, ±c, ±c) lattice, in the three.js body frame.
    const rails: [THREE.Vector3, THREE.Vector3][] = [];
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      for (const su of [-1, 1]) {
        for (const sv of [-1, 1]) {
          const a = new THREE.Vector3();
          const b = new THREE.Vector3();
          a.setComponent(axis, -c);
          b.setComponent(axis, c);
          a.setComponent(u, su * c);
          b.setComponent(u, su * c);
          a.setComponent(v, sv * c);
          b.setComponent(v, sv * c);
          rails.push([a, b]);
        }
      }
    }

    const beamGeo = new THREE.BoxGeometry(beam, beam, 1);
    for (const [a, b] of rails) {
      const mesh = new THREE.Mesh(beamGeo, this.frameMaterial);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mesh.position.copy(mid);
      mesh.scale.z = a.distanceTo(b);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
      mesh.castShadow = true;
      this.body.add(mesh);
    }

    // Corner nodes.
    const nodeGeo = new THREE.SphereGeometry(0.005, 10, 8);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const node = new THREE.Mesh(nodeGeo, this.frameMaterial);
          node.position.set(sx * c, sy * c, sz * c);
          this.body.add(node);
        }
      }
    }

    // Motor pods + rotor discs at the array mount points. Marine (surge, sway,
    // heave) → three body (z, x, y); horizontal rotors spin about the marine
    // surge axis (three body +Z), the vertical rotor about the marine heave
    // axis (three body +Y).
    const s = this.geometry.mountSwayM;
    const R = this.geometry.propDiameterM / 2;
    const pods: { pos: THREE.Vector3; axis: THREE.Vector3 }[] = [
      { pos: new THREE.Vector3(-s, 0, 0), axis: new THREE.Vector3(0, 0, 1) },
      { pos: new THREE.Vector3(s, 0, 0), axis: new THREE.Vector3(0, 0, 1) },
      { pos: new THREE.Vector3(0, 0, 0), axis: new THREE.Vector3(0, 1, 0) }
    ];

    const podGeo = new THREE.CylinderGeometry(R * 0.42, R * 0.42, 0.026, 14);
    const podMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.25 });
    const discGeo = new THREE.CylinderGeometry(R, R, 0.0016, 22);
    const discMat = new THREE.MeshStandardMaterial({
      color: COLOR_ROTOR,
      metalness: 0.7,
      roughness: 0.3,
      transparent: true,
      opacity: 0.55
    });

    for (const { pos, axis } of pods) {
      const pod = new THREE.Mesh(podGeo, podMat);
      pod.position.copy(pos);
      pod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      this.body.add(pod);

      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.copy(pos).addScaledVector(axis, 0.016);
      disc.quaternion.copy(pod.quaternion);
      this.body.add(disc);
    }

    // CoG marker + CoB marker (marine heave is three body +Y) and the
    // CoB−CoG lever that produces the righting moment.
    const cog = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), new THREE.MeshBasicMaterial({ color: COLOR_COG }));
    const cob = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), new THREE.MeshBasicMaterial({ color: COLOR_COB }));
    cob.position.set(0, this.geometry.cobAboveCogM, 0);
    const lever = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0008, 0.0008, this.geometry.cobAboveCogM, 6),
      new THREE.MeshBasicMaterial({ color: COLOR_COB, transparent: true, opacity: 0.7 })
    );
    lever.position.set(0, this.geometry.cobAboveCogM / 2, 0);
    this.body.add(cog, cob, lever);
  }

  private buildGrabSphere(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.geometry.cornerHalfGapM * 1.2, 18, 12),
      new THREE.MeshBasicMaterial({ color: COLOR_HANDLE, transparent: true, opacity: 0.05, depthWrite: false })
    );
    mesh.name = 'vehicle-grab';
    return mesh;
  }

  private buildHeaveHandle(): THREE.Mesh {
    // Double-headed arrow along world +Y, sitting above the vehicle.
    const group = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.09, 10), this.handleMaterial);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.018, 12), this.handleMaterial);
    tip.position.y = 0.054;
    group.add(tip);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.018, 12), this.handleMaterial);
    tail.position.y = -0.054;
    tail.rotation.x = Math.PI;
    group.add(tail);
    group.position.y = this.geometry.cornerHalfGapM + 0.075;
    group.name = 'vehicle-heave';
    return group;
  }

  private buildYawRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(this.geometry.cornerHalfGapM * 1.45, 0.0035, 8, 40),
      new THREE.MeshBasicMaterial({ color: COLOR_YAW, transparent: true, opacity: 0.75 })
    );
    ring.rotation.x = Math.PI / 2; // lay flat: rotation is about world Y
    ring.name = 'vehicle-yaw';
    return ring;
  }

  // -------------------------------------------------------------------- state

  public getPosition(): THREE.Vector3 {
    return this.position;
  }

  public getYawRad(): number {
    return this.yawRad;
  }

  /** Mirrors the physics body pose (called every frame after the solver). */
  public setPose(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.position.copy(position);
    this.body.quaternion.copy(quaternion);
    this.yawRad = this.extractYawRad(quaternion);
    this.root.position.copy(position);
    this.syncHandlePose();
  }

  public setInterpolatedPose(pose: { position: [number, number, number]; yawRad: number; scale: number }): void {
    this.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yawRad);
    this.yawRad = pose.yawRad;
    this.root.position.copy(this.position);
    this.root.scale.setScalar(pose.scale);
    this.syncHandlePose();
  }

  private extractYawRad(q: THREE.Quaternion): number {
    return new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  }

  private syncHandlePose(): void {
    this.handleGroup.position.copy(this.position);
    this.handleGroup.rotation.set(0, 0, 0);
  }

  public setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.handleGroup.visible = selected;
    this.frameMaterial.color.setHex(selected ? COLOR_FRAME_SELECTED : COLOR_FRAME);
    this.frameMaterial.emissiveIntensity = selected ? 1.4 : 0.6;
  }

  /** Objects eligible for picking (frame body + handles). */
  public pickables(): THREE.Object3D[] {
    return [this.body, this.grabSphere, this.heaveHandle, this.yawRing];
  }

  public isHandle(object: THREE.Object3D): 'grab' | 'heave' | 'yaw' | null {
    let node: THREE.Object3D | null = object;
    while (node) {
      if (node === this.grabSphere) return 'grab';
      if (node === this.heaveHandle) return 'heave';
      if (node === this.yawRing) return 'yaw';
      node = node.parent;
    }
    return null;
  }

  // ------------------------------------------------------------- drag gestures

  public beginHorizontalDrag(pointerWorld: THREE.Vector3): void {
    this.dragOffset.copy(this.position).sub(pointerWorld);
  }

  public updateHorizontalDrag(pointerWorld: THREE.Vector3): void {
    this.position.copy(pointerWorld).add(this.dragOffset);
    this.root.position.copy(this.position);
    this.syncHandlePose();
    this.callbacks.onPoseChanged?.(this.position, this.yawRad);
  }

  public beginHeaveDrag(clientY: number): void {
    this.dragStartClientY = clientY;
    this.dragStartHeaveM = this.position.y;
  }

  /** metersPerPixel converts a screen-space drag into world meters along +Y. */
  public updateHeaveDrag(clientY: number, metersPerPixel: number): void {
    this.position.y = this.dragStartHeaveM + (this.dragStartClientY - clientY) * metersPerPixel;
    this.root.position.copy(this.position);
    this.syncHandlePose();
    this.callbacks.onPoseChanged?.(this.position, this.yawRad);
  }

  public beginYawDrag(pointerWorld: THREE.Vector3): void {
    this.yawStartPointerAngle = Math.atan2(pointerWorld.z - this.position.z, pointerWorld.x - this.position.x);
    this.yawStartRad = this.yawRad;
  }

  public updateYawDrag(pointerWorld: THREE.Vector3): void {
    const angle = Math.atan2(pointerWorld.z - this.position.z, pointerWorld.x - this.position.x);
    let delta = angle - this.yawStartPointerAngle;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    this.yawRad = this.yawStartRad + delta;
    this.body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yawRad);
    this.callbacks.onPoseChanged?.(this.position, this.yawRad);
  }

  public commitDrag(): void {
    this.callbacks.onPoseCommit?.(this.position, this.yawRad);
  }

  public commitPose(): void {
    this.callbacks.onPoseChanged?.(this.position, this.yawRad);
    this.callbacks.onPoseCommit?.(this.position, this.yawRad);
  }

  public dispose(): void {
    this.root.removeFromParent();
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.frameMaterial.dispose();
    this.handleMaterial.dispose();
  }
}
