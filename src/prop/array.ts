import { solveBEMT, BEMTResult } from './bemt';
import { StatorVaneSystem, StatorForceResult } from './stator';

export type ThrusterHandedness = 'CW' | 'CCW';

export interface ThrusterUnit {
  id: string;
  name: string;
  handedness: ThrusterHandedness;
  positionM: [number, number, number]; // [x, y, z] relative to vehicle Center of Gravity
  thrustDirection: [number, number, number]; // Normalized thrust vector
  stator: StatorVaneSystem;
  ratedRpm: number;
}

export interface ThrusterState {
  unit: ThrusterUnit;
  throttle: number;
  rpm: number;
  bemt: BEMTResult;
  statorResult: StatorForceResult;
  netThrustN: number;
  netTorqueNm: number;
  forceVectorN: [number, number, number];
  momentVectorNm: [number, number, number];
}

export interface VehiclePropulsionSummary {
  totalForceN: [number, number, number]; // [Fx, Fy, Fz]
  totalMomentNm: [number, number, number]; // [Mx (roll), My (pitch), Mz (yaw)]
  thrusters: ThrusterState[];
  rollCancelledFraction: number;
}

export class PropellerArray {
  public thrusters: ThrusterUnit[] = [];

  constructor() {
    this.setupCandidateADefaults();
  }

  private setupCandidateADefaults(): void {
    // Candidate A: 3 Thrusters with handedness ["CW", "CCW", "CW"]
    // Port thruster: Left side, forward pointing (+Z or +X depending on convention, let's use +X forward, +Y right, +Z up)
    this.thrusters = [
      {
        id: 'port',
        name: 'Port Horizontal Thruster (CW)',
        handedness: 'CW',
        positionM: [0.0, -0.075, 0.0], // 75mm to the left
        thrustDirection: [1.0, 0.0, 0.0], // Forward
        stator: new StatorVaneSystem({ vaneType: 'slotted' }),
        ratedRpm: 4140
      },
      {
        id: 'starboard',
        name: 'Starboard Horizontal Thruster (CCW)',
        handedness: 'CCW',
        positionM: [0.0, 0.075, 0.0], // 75mm to the right
        thrustDirection: [1.0, 0.0, 0.0], // Forward
        stator: new StatorVaneSystem({ vaneType: 'slotted' }),
        ratedRpm: 4140
      },
      {
        id: 'vertical',
        name: 'Vertical Heave Thruster (CW)',
        handedness: 'CW',
        positionM: [0.0, 0.0, 0.0], // Centered
        thrustDirection: [0.0, 0.0, 1.0], // Upward heave
        stator: new StatorVaneSystem({ vaneType: 'slotted' }),
        ratedRpm: 4140
      }
    ];
  }

  /**
   * Evaluates forces, torques, and moment arms for all thrusters in the array.
   */
  public evaluate(
    throttles: [number, number, number],
    advanceSpeeds: [number, number, number] = [0, 0, 0]
  ): VehiclePropulsionSummary {
    const states: ThrusterState[] = [];
    const totalForce: [number, number, number] = [0, 0, 0];
    const totalMoment: [number, number, number] = [0, 0, 0];

    for (let i = 0; i < this.thrusters.length; i++) {
      const unit = this.thrusters[i];
      const u = Math.max(-1.0, Math.min(1.0, throttles[i] ?? 0));
      const va = advanceSpeeds[i] ?? 0;
      const rpm = u * unit.ratedRpm;

      const bemt = solveBEMT(rpm, va);
      const statorResult = unit.stator.evaluate(bemt.thrustN, bemt.torqueNm, rpm);

      // Net thrust including stator swirl recovery
      const netThrust = bemt.thrustN + statorResult.thrustDeltaN;

      // Shaft reaction torque on vehicle body:
      // A CW propeller imparts CCW (-roll) torque on the body.
      // A CCW propeller imparts CW (+roll) torque on the body.
      const handSign = unit.handedness === 'CW' ? -1.0 : 1.0;
      const rawReactionTorque = handSign * bemt.torqueNm;
      // Stator anti-torque opposes the reaction torque
      const netTorque = rawReactionTorque + handSign * statorResult.antiTorqueNm;

      // 3D Force vector: T * direction
      const [dx, dy, dz] = unit.thrustDirection;
      const forceVector: [number, number, number] = [
        netThrust * dx,
        netThrust * dy,
        netThrust * dz
      ];

      // 3D Moment vector: r x F + Q * direction
      const [px, py, pz] = unit.positionM;
      // Cross product r x F
      const rXF_x = py * forceVector[2] - pz * forceVector[1];
      const rXF_y = pz * forceVector[0] - px * forceVector[2];
      const rXF_z = px * forceVector[1] - py * forceVector[0];

      // Moment = thrust moment arm + reaction torque along thrust axis
      const momentVector: [number, number, number] = [
        rXF_x + netTorque * dx,
        rXF_y + netTorque * dy,
        rXF_z + netTorque * dz
      ];

      totalForce[0] += forceVector[0];
      totalForce[1] += forceVector[1];
      totalForce[2] += forceVector[2];

      totalMoment[0] += momentVector[0];
      totalMoment[1] += momentVector[1];
      totalMoment[2] += momentVector[2];

      states.push({
        unit,
        throttle: u,
        rpm,
        bemt,
        statorResult,
        netThrustN: netThrust,
        netTorqueNm: netTorque,
        forceVectorN: forceVector,
        momentVectorNm: momentVector
      });
    }

    // Roll cancellation metric: compare counter-rotating pair vs single prop
    const uncancelledRoll = states[0].netTorqueNm;
    const netRoll = totalMoment[0];
    const rollCancelledFraction = Math.abs(uncancelledRoll) > 1e-5
      ? Math.max(0, Math.min(1.0, 1.0 - Math.abs(netRoll) / Math.abs(uncancelledRoll)))
      : 1.0;

    return {
      totalForceN: totalForce,
      totalMomentNm: totalMoment,
      thrusters: states,
      rollCancelledFraction
    };
  }
}
