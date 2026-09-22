import * as THREE from 'three';
import type { FluidGrid } from '../fluid/grid';
import type { VehicleBody } from './body';
import type { ThrusterUnit, VehiclePropulsionSummary } from '../prop/array';
import { worldToGrid, bodyPointToWorld } from '../render/frameMap';
import { marineAngularToThree } from './body';

export interface VehicleCouplerConfig {
  gridCenter: THREE.Vector3;
  gridDxM: number;
  depthM: number;
  fluidDensity: number;
  inflowRelaxation: number;
  dyeEmissionRate: number;
  injectionRadiusCells: number;
  injectionOffsetCells: number;
  ambientSampleOffsetCells: number;
  enabled: boolean;
}

export interface VehicleCouplerTelemetry {
  advanceSpeedsMs: number[];
  rawAdvanceSpeedsMs: number[];
  ambientFlowWorld: [number, number, number];
  injectedMomentumNs: number;
}

const gridPoint = { x: 0, y: 0 };
const diskWorldPosition = new THREE.Vector3();
const thrustAxisWorld = new THREE.Vector3();
const rotorArm = new THREE.Vector3();
const angularVelocityWorld = new THREE.Vector3();
const diskPointVelocityWorld = new THREE.Vector3();
const bodyVelocityWorld = new THREE.Vector3();

export class VehicleFluidCoupler {
  public config: VehicleCouplerConfig;
  public lastTelemetry: VehicleCouplerTelemetry = {
    advanceSpeedsMs: [],
    rawAdvanceSpeedsMs: [],
    ambientFlowWorld: [0, 0, 0],
    injectedMomentumNs: 0
  };

  private relaxedInflows: number[] = [];

  constructor(config?: Partial<VehicleCouplerConfig>) {
    this.config = {
      gridCenter: config?.gridCenter ?? new THREE.Vector3(0, 0, 0),
      gridDxM: config?.gridDxM ?? 0.0015,
      depthM: config?.depthM ?? 0.042,
      fluidDensity: config?.fluidDensity ?? 1000,
      inflowRelaxation: config?.inflowRelaxation ?? 0.5,
      dyeEmissionRate: config?.dyeEmissionRate ?? 0.6,
      injectionRadiusCells: config?.injectionRadiusCells ?? 14,
      injectionOffsetCells: config?.injectionOffsetCells ?? 14,
      ambientSampleOffsetCells: config?.ambientSampleOffsetCells ?? 28,
      enabled: config?.enabled ?? true
    };
  }

  public reset(): void {
    this.relaxedInflows.length = 0;
    this.lastTelemetry.advanceSpeedsMs.length = 0;
    this.lastTelemetry.rawAdvanceSpeedsMs.length = 0;
    this.lastTelemetry.ambientFlowWorld = [0, 0, 0];
    this.lastTelemetry.injectedMomentumNs = 0;
  }

  public ambientFlowAt(grid: FluidGrid, worldX: number, worldY: number, out: THREE.Vector3): THREE.Vector3 {
    worldToGrid(worldX, worldY, grid.width, grid.height, this.config.gridDxM, this.config.gridCenter, gridPoint);
    out.set(
      grid.sampleBilinear(grid.u, gridPoint.x, gridPoint.y),
      grid.sampleBilinear(grid.v, gridPoint.x, gridPoint.y),
      0
    );
    return out;
  }

  public ambientFlowAtVehicle(
    grid: FluidGrid,
    vehicle: VehicleBody,
    units: ThrusterUnit[],
    out: THREE.Vector3
  ): THREE.Vector3 {
    let thrustX = 0;
    let thrustY = 0;

    for (let index = 0; index < units.length; index++) {
      const unit = units[index];
      if (unit.throttle === 0) continue;
      thrustAxisWorld
        .set(unit.thrustDirection[1], unit.thrustDirection[2], unit.thrustDirection[0])
        .applyQuaternion(vehicle.quaternion);
      thrustX += unit.throttle * thrustAxisWorld.x;
      thrustY += unit.throttle * thrustAxisWorld.y;
    }

    const magnitude = Math.hypot(thrustX, thrustY);
    if (magnitude > 1e-9) {
      const offsetM = this.config.ambientSampleOffsetCells * this.config.gridDxM;
      return this.ambientFlowAt(
        grid,
        vehicle.position.x - (thrustX / magnitude) * offsetM,
        vehicle.position.y - (thrustY / magnitude) * offsetM,
        out
      );
    }

    return this.ambientFlowAt(grid, vehicle.position.x, vehicle.position.y, out);
  }

  public sampleInflows(
    grid: FluidGrid,
    vehicle: VehicleBody,
    units: ThrusterUnit[],
    outAdvanceSpeeds: number[],
    outRawAdvanceSpeeds?: number[]
  ): number[] {
    outAdvanceSpeeds.length = units.length;

    marineAngularToThree(
      vehicle.angularVelocityBodyRadS[0],
      vehicle.angularVelocityBodyRadS[1],
      vehicle.angularVelocityBodyRadS[2],
      angularVelocityWorld
    ).applyQuaternion(vehicle.quaternion);
    vehicle.worldVelocity(bodyVelocityWorld);

    const relaxation = Math.max(0.01, Math.min(1, this.config.inflowRelaxation));

    for (let index = 0; index < units.length; index++) {
      const unit = units[index];

      bodyPointToWorld(
        vehicle,
        unit.positionM[0],
        unit.positionM[1],
        unit.positionM[2],
        diskWorldPosition
      );
      thrustAxisWorld
        .set(unit.thrustDirection[1], unit.thrustDirection[2], unit.thrustDirection[0])
        .applyQuaternion(vehicle.quaternion)
        .normalize();

      rotorArm.copy(diskWorldPosition).sub(vehicle.position);
      diskPointVelocityWorld.copy(angularVelocityWorld).cross(rotorArm).add(bodyVelocityWorld);

      worldToGrid(
        diskWorldPosition.x,
        diskWorldPosition.y,
        grid.width,
        grid.height,
        this.config.gridDxM,
        this.config.gridCenter,
        gridPoint
      );
      const fluidU = grid.sampleBilinear(grid.u, gridPoint.x, gridPoint.y);
      const fluidV = grid.sampleBilinear(grid.v, gridPoint.x, gridPoint.y);

      const rawAdvanceSpeed =
        (diskPointVelocityWorld.x - fluidU) * thrustAxisWorld.x +
        (diskPointVelocityWorld.y - fluidV) * thrustAxisWorld.y +
        diskPointVelocityWorld.z * thrustAxisWorld.z;

      const previous = this.relaxedInflows[index] ?? 0;
      const relaxed = (1 - relaxation) * previous + relaxation * rawAdvanceSpeed;
      this.relaxedInflows[index] = relaxed;

      outAdvanceSpeeds[index] = relaxed;
      if (outRawAdvanceSpeeds) outRawAdvanceSpeeds[index] = rawAdvanceSpeed;
    }

    this.relaxedInflows.length = units.length;
    return outAdvanceSpeeds;
  }

  public injectSlipstream(
    grid: FluidGrid,
    vehicle: VehicleBody,
    summary: VehiclePropulsionSummary,
    dt: number
  ): number {
    if (!this.config.enabled || dt <= 0) return 0;

    const { gridDxM, depthM, fluidDensity, injectionRadiusCells, dyeEmissionRate } = this.config;
    const width = grid.width;
    const height = grid.height;
    const cellMassKg = fluidDensity * gridDxM * gridDxM * depthM;
    if (cellMassKg <= 0) return 0;

    let totalInjectedNs = 0;

    for (let index = 0; index < summary.thrusters.length; index++) {
      const state = summary.thrusters[index];
      const unit = state.unit;
      const thrustN = state.netThrustN;
      if (Math.abs(thrustN) < 1e-9) continue;

      bodyPointToWorld(vehicle, unit.positionM[0], unit.positionM[1], unit.positionM[2], diskWorldPosition);
      thrustAxisWorld
        .set(unit.thrustDirection[1], unit.thrustDirection[2], unit.thrustDirection[0])
        .applyQuaternion(vehicle.quaternion)
        .normalize();

      const inPlaneMagnitude = Math.hypot(thrustAxisWorld.x, thrustAxisWorld.y);
      if (inPlaneMagnitude < 1e-12) continue;

      const inPlaneThrustN = inPlaneMagnitude * thrustN;
      if (Math.abs(inPlaneThrustN) < 1e-9) continue;

      const directionX = thrustAxisWorld.x / inPlaneMagnitude;
      const directionY = thrustAxisWorld.y / inPlaneMagnitude;

      worldToGrid(diskWorldPosition.x, diskWorldPosition.y, width, height, gridDxM, this.config.gridCenter, gridPoint);
      const centerX = gridPoint.x + directionX * this.config.injectionOffsetCells;
      const centerY = gridPoint.y + directionY * this.config.injectionOffsetCells;
      const radiusCells = Math.max(1, injectionRadiusCells);

      const x0 = Math.max(1, Math.floor(centerX - radiusCells));
      const x1 = Math.min(width - 2, Math.ceil(centerX + radiusCells));
      const y0 = Math.max(1, Math.floor(centerY - radiusCells));
      const y1 = Math.min(height - 2, Math.ceil(centerY + radiusCells));

      let weightSum = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          const radiusSquared = (dx * dx + dy * dy) / (radiusCells * radiusCells);
          if (radiusSquared >= 1) continue;
          weightSum += Math.sqrt(1 - radiusSquared);
        }
      }
      if (weightSum <= 0) continue;

      const impulseNs = inPlaneThrustN * dt;
      const impulsePerWeight = impulseNs / weightSum;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          const radiusSquared = (dx * dx + dy * dy) / (radiusCells * radiusCells);
          if (radiusSquared >= 1) continue;
          const weight = Math.sqrt(1 - radiusSquared);
          const cellIndex = y * width + x;
          const deltaVelocity = (impulsePerWeight * weight) / cellMassKg;
          grid.u[cellIndex] += deltaVelocity * directionX;
          grid.v[cellIndex] += deltaVelocity * directionY;
          const dye = (Math.abs(thrustN) * dyeEmissionRate * weight) / weightSum;
          grid.dye[cellIndex] = Math.min(1, grid.dye[cellIndex] + dye);
        }
      }

      totalInjectedNs += impulseNs;
    }

    this.lastTelemetry.injectedMomentumNs = totalInjectedNs;
    return totalInjectedNs;
  }

  public update(
    grid: FluidGrid,
    vehicle: VehicleBody,
    units: ThrusterUnit[],
    outAmbientFlow: THREE.Vector3
  ): number[] {
    const advances = this.sampleInflows(
      grid,
      vehicle,
      units,
      this.lastTelemetry.advanceSpeedsMs,
      this.lastTelemetry.rawAdvanceSpeedsMs
    );
    this.ambientFlowAtVehicle(grid, vehicle, units, outAmbientFlow);
    this.lastTelemetry.ambientFlowWorld[0] = outAmbientFlow.x;
    this.lastTelemetry.ambientFlowWorld[1] = outAmbientFlow.y;
    this.lastTelemetry.ambientFlowWorld[2] = outAmbientFlow.z;
    return advances;
  }
}
