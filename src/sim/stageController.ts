import * as THREE from 'three';
import type { VehicleBody } from '../vehicle/body';
import type { Vehicle3D } from '../render/vehicle3d';
import type { InterpolatedPose } from './interpolation';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class VehicleStageController {
  private vehicle: VehicleBody;
  private stage: Vehicle3D;

  constructor(vehicle: VehicleBody, stage: Vehicle3D) {
    this.vehicle = vehicle;
    this.stage = stage;
  }

  public beginHorizontalDrag(pointerWorld: THREE.Vector3): void {
    this.stage.beginHorizontalDrag(pointerWorld);
  }

  public updateHorizontalDrag(pointerWorld: THREE.Vector3): void {
    this.stage.updateHorizontalDrag(pointerWorld);
    this.writePoseToBody();
  }

  public beginHeaveDrag(clientY: number): void {
    this.stage.beginHeaveDrag(clientY);
  }

  public updateHeaveDrag(clientY: number, metersPerPixel: number): void {
    this.stage.updateHeaveDrag(clientY, metersPerPixel);
    this.writePoseToBody();
  }

  public beginYawDrag(pointerWorld: THREE.Vector3): void {
    this.stage.beginYawDrag(pointerWorld);
  }

  public updateYawDrag(pointerWorld: THREE.Vector3): void {
    this.stage.updateYawDrag(pointerWorld);
    this.writePoseToBody();
  }

  public commitDrag(): void {
    this.stage.commitDrag();
    this.writePoseToBody();
  }

  public resetPose(pose: InterpolatedPose): void {
    const position = new THREE.Vector3(...pose.position);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, pose.yawRad);
    this.vehicle.reset([...pose.position] as [number, number, number], pose.yawRad);
    this.stage.setPose(position, quaternion);
    this.stage.commitPose();
  }

  private writePoseToBody(): void {
    const position = this.stage.getPosition();
    const yawRad = this.stage.getYawRad();
    this.vehicle.reset(position.toArray() as [number, number, number], yawRad);
  }
}
