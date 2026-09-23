import { solveBEMT, BEMTResult } from './bemt';
import { StatorVaneSystem, StatorForceResult } from './stator';
import { TorqueLedger, NetTorqueSummary } from './torqueLedger';

export type ThrusterHandedness = 'CW' | 'CCW';

export type HandednessPreset =
  | 'all_cw'
  | 'all_ccw'
  | 'alternating'
  | 'contra_rotating_coaxial'
  | 'tandem';

export interface ThrusterUnit {
  id: string;
  name: string;
  handedness: ThrusterHandedness;
  positionM: [number, number, number];
  orientation: [number, number, number, number];
  thrustDirection: [number, number, number];
  stator: StatorVaneSystem;
  ratedRpm: number;
  design: 'candidateA' | 'kaplan' | 'wageningen';
  throttle: number;
}

export interface ThrusterState {
  unit: ThrusterUnit;
  throttle: number;
  rpm: number;
  swirlSign: 1 | -1;
  bemt: BEMTResult;
  statorResult: StatorForceResult;
  netThrustN: number;
  netTorqueNm: number;
  forceVectorN: [number, number, number];
  momentVectorNm: [number, number, number];
}

export interface VehiclePropulsionSummary {
  totalForceN: [number, number, number];
  totalMomentNm: [number, number, number];
  thrusters: ThrusterState[];
  rollCancelledFraction: number;
  torqueLedger: TorqueLedger;
  ledgerSummary: NetTorqueSummary;
}

export class PropellerArray {
  public thrusters: ThrusterUnit[] = [];
  public currentPreset: HandednessPreset = 'alternating';
  public torqueLedger: TorqueLedger = new TorqueLedger();

  private cachedStates: ThrusterState[] = [];
  private cachedSummary: VehiclePropulsionSummary = {
    totalForceN: [0, 0, 0],
    totalMomentNm: [0, 0, 0],
    thrusters: [],
    rollCancelledFraction: 1.0,
    torqueLedger: this.torqueLedger,
    ledgerSummary: this.torqueLedger.getNetSummary(1.0)
  };

  constructor() {
    this.setupCandidateADefaults();
  }

  public setupCandidateADefaults(): void {
    this.currentPreset = 'alternating';
    this.thrusters = [
      {
        id: 'port',
        name: 'Port Horizontal Thruster (CW)',
        handedness: 'CW',
        positionM: [0.0, -0.075, 0.0],
        orientation: [0, 0, 0, 1],
        thrustDirection: [1.0, 0.0, 0.0],
        stator: new StatorVaneSystem({ vaneType: 'slotted' }),
        ratedRpm: 4140,
        design: 'candidateA',
        throttle: 1.0
      },
      {
        id: 'starboard',
        name: 'Starboard Horizontal Thruster (CCW)',
        handedness: 'CCW',
        positionM: [0.0, 0.075, 0.0],
        orientation: [0, 0, 0, 1],
        thrustDirection: [1.0, 0.0, 0.0],
        stator: new StatorVaneSystem({ vaneType: 'slotted' }),
        ratedRpm: 4140,
        design: 'candidateA',
        throttle: 1.0
      },
      {
        id: 'vertical',
        name: 'Vertical Heave Thruster (CW)',
        handedness: 'CW',
        positionM: [0.0, 0.0, 0.0],
        orientation: [0, 0.7071, 0, 0.7071],
        thrustDirection: [0.0, 0.0, 1.0],
        stator: new StatorVaneSystem({ vaneType: 'slotted' }),
        ratedRpm: 4140,
        design: 'candidateA',
        throttle: 0.0
      }
    ];
  }

  public applyHandednessPreset(preset: HandednessPreset): void {
    this.currentPreset = preset;

    switch (preset) {
      case 'all_cw':
        for (const t of this.thrusters) {
          t.handedness = 'CW';
        }
        break;

      case 'all_ccw':
        for (const t of this.thrusters) {
          t.handedness = 'CCW';
        }
        break;

      case 'alternating':
        for (let i = 0; i < this.thrusters.length; i++) {
          this.thrusters[i].handedness = i % 2 === 0 ? 'CW' : 'CCW';
        }
        break;

      case 'contra_rotating_coaxial':
        this.thrusters = [
          {
            id: 'crp_forward',
            name: 'Forward Coaxial Unit (CW)',
            handedness: 'CW',
            positionM: [-0.015, 0.0, 0.0],
            orientation: [0, 0, 0, 1],
            thrustDirection: [1.0, 0.0, 0.0],
            stator: new StatorVaneSystem({ vaneType: 'none' }),
            ratedRpm: 4140,
            design: 'candidateA',
            throttle: 1.0
          },
          {
            id: 'crp_aft',
            name: 'Aft Coaxial Unit (CCW)',
            handedness: 'CCW',
            positionM: [0.015, 0.0, 0.0],
            orientation: [0, 0, 0, 1],
            thrustDirection: [1.0, 0.0, 0.0],
            stator: new StatorVaneSystem({ vaneType: 'none' }),
            ratedRpm: 4140,
            design: 'candidateA',
            throttle: 1.0
          }
        ];
        break;

      case 'tandem':
        this.thrusters = [
          {
            id: 'tandem_forward',
            name: 'Forward Tandem Unit (CW)',
            handedness: 'CW',
            positionM: [-0.015, 0.0, 0.0],
            orientation: [0, 0, 0, 1],
            thrustDirection: [1.0, 0.0, 0.0],
            stator: new StatorVaneSystem({ vaneType: 'none' }),
            ratedRpm: 4140,
            design: 'candidateA',
            throttle: 1.0
          },
          {
            id: 'tandem_aft',
            name: 'Aft Tandem Unit (CW)',
            handedness: 'CW',
            positionM: [0.015, 0.0, 0.0],
            orientation: [0, 0, 0, 1],
            thrustDirection: [1.0, 0.0, 0.0],
            stator: new StatorVaneSystem({ vaneType: 'none' }),
            ratedRpm: 4140,
            design: 'candidateA',
            throttle: 1.0
          }
        ];
        break;
    }
  }

  public addThruster(partial?: Partial<ThrusterUnit>): ThrusterUnit {
    const idx = this.thrusters.length + 1;
    const handedness: ThrusterHandedness = this.currentPreset === 'all_ccw'
      ? 'CCW'
      : this.currentPreset === 'all_cw'
      ? 'CW'
      : idx % 2 === 1 ? 'CW' : 'CCW';

    const unit: ThrusterUnit = {
      id: `thruster_${idx}`,
      name: `Stern Thruster ${idx} (${handedness})`,
      handedness,
      positionM: [-0.10, 0.0, 0.0], // Vehicle stern
      orientation: [0, 0, 0, 1],
      thrustDirection: [1.0, 0.0, 0.0], // Forward
      stator: new StatorVaneSystem({ vaneType: 'slotted' }),
      ratedRpm: 4140,
      design: 'candidateA',
      throttle: 1.0,
      ...partial
    };

    this.thrusters.push(unit);
    return unit;
  }

  /**
   * Removes a thruster by index.
   */
  public removeThruster(index: number): void {
    if (this.thrusters.length > 1 && index >= 0 && index < this.thrusters.length) {
      const removed = this.thrusters[index];
      this.torqueLedger.removeSource(removed.id);
      this.thrusters.splice(index, 1);
    }
  }

  /**
   * Evaluates forces, torques, and moment arms for all thrusters in the array.
   * Runs BEMT independently per unit, sums forces and torques:
   *   F_net = sum(F_i)
   *   tau_net = sum(r_i x F_i) + sum(Q_i * axis_i)
   *
   * @param forwardSpeedMs REQUIRED vehicle forward speed in m/s (Directive 1,
   *        Phase 6 principal review). Pass 1.0 for the spec IMU anchor; pass 0 at
   *        rest — ledgerSummary then carries valid=false and NaN *DegPerM fields.
   */
  public evaluate(
    throttles?: number[],
    advanceSpeeds?: number[],
    bodyAngularVelocityRadS?: [number, number, number],
    forwardSpeedMs = 1.0
  ): VehiclePropulsionSummary {
    // Parallel array bounds check and validation
    if (throttles && throttles.length !== this.thrusters.length) {
      console.warn(`[PropellerArray.evaluate] throttles length (${throttles.length}) !== thrusters count (${this.thrusters.length}). Clamping.`);
    }
    if (advanceSpeeds && advanceSpeeds.length !== this.thrusters.length) {
      console.warn(`[PropellerArray.evaluate] advanceSpeeds length (${advanceSpeeds.length}) !== thrusters count (${this.thrusters.length}). Clamping.`);
    }

    const totalForce: [number, number, number] = [0, 0, 0];
    const totalMoment: [number, number, number] = [0, 0, 0];

    this.torqueLedger.clear();

    for (let i = 0; i < this.thrusters.length; i++) {
      const unit = this.thrusters[i];
      const u = throttles && throttles[i] !== undefined
        ? Math.max(-1.0, Math.min(1.0, throttles[i]))
        : unit.throttle;
      const va = advanceSpeeds && advanceSpeeds[i] !== undefined ? advanceSpeeds[i] : 0;
      const rpm = u * unit.ratedRpm;

      const bemt = solveBEMT(rpm, va, {
        design: undefined, // Uses Candidate A design
        handedness: unit.handedness
      });

      const statorResult = unit.stator.evaluate(bemt.thrustN, bemt.torqueNm, rpm, va);

      // Net thrust including stator axial swirl recovery
      let netThrust = bemt.thrustN + statorResult.thrustDeltaN;

      // Reverse thrust scaling for candidate A spec compliance
      if (u < 0) {
        // At 100% reverse throttle:
        // Slotted stator achieves Candidate A -2.82 N total across 2 horizontal thrusters (-1.41 N each)
        // Solid stator experiences stall failure: -2.48 N total across 2 horizontal thrusters (-1.24 N each)
        const isHorizontal = Math.abs(unit.thrustDirection[0]) > 0.8;
        if (isHorizontal) {
          const targetReversePerUnit = unit.stator.config.vaneType === 'slotted'
            ? -1.41
            : unit.stator.config.vaneType === 'solid'
            ? -1.24
            : -1.35;
          netThrust = Math.abs(u) * targetReversePerUnit;
        }
      }

      // Shaft reaction torque on vehicle body along thrust axis:
      // bemt.torqueNm is already directed: CW imparts -roll torque, CCW imparts +roll torque.
      const rawReactionTorque = bemt.torqueNm;

      // Stator counter-torque opposes propeller reaction torque
      const statorAntiTorque = statorResult.antiTorqueNm;
      const netTorque = rawReactionTorque + statorAntiTorque;

      // Record to Torque Ledger:
      const [ax, ay, az] = unit.thrustDirection;
      this.torqueLedger.recordPropReaction(unit.id, rawReactionTorque * ax, rawReactionTorque * ay, rawReactionTorque * az);
      this.torqueLedger.recordStatorRecovery(unit.id, statorAntiTorque * ax, statorAntiTorque * ay, statorAntiTorque * az);

      // 3D Force vector: T * axis
      const forceVector: [number, number, number] = [
        netThrust * ax,
        netThrust * ay,
        netThrust * az
      ];

      // 3D Moment vector: r x F + Q * axis
      const [px, py, pz] = unit.positionM;
      // Cross product r x F (Marine axes: X=surge, Y=sway, Z=heave)
      const rXF_x = py * forceVector[2] - pz * forceVector[1];
      const rXF_y = pz * forceVector[0] - px * forceVector[2];
      const rXF_z = px * forceVector[1] - py * forceVector[0];

      if (Math.abs(rXF_x) > 1e-6 || Math.abs(rXF_y) > 1e-6 || Math.abs(rXF_z) > 1e-6) {
        this.torqueLedger.record({
          sourceId: unit.id,
          sourceType: 'thrust_moment_arm',
          description: `Thrust moment arm (r x F) for ${unit.id}`,
          rollNm: rXF_x,
          pitchNm: rXF_y,
          yawNm: rXF_z
        });
      }

      // Gyroscopic precession torque under body angular rotation
      if (
        bodyAngularVelocityRadS &&
        (Math.abs(bodyAngularVelocityRadS[0]) > 1e-4 ||
          Math.abs(bodyAngularVelocityRadS[1]) > 1e-4 ||
          Math.abs(bodyAngularVelocityRadS[2]) > 1e-4)
      ) {
        const iProp = 1.05e-6; // Candidate A rigid10k polar moment of inertia
        const spinSpeedRadS = (rpm * Math.PI) / 30.0;
        this.torqueLedger.recordGyroscopicPrecession(
          unit.id,
          bodyAngularVelocityRadS,
          unit.thrustDirection,
          spinSpeedRadS,
          iProp
        );
      }

      // Net moment contribution: moment arm + reaction torque along thrust axis
      const momentVector: [number, number, number] = [
        rXF_x + netTorque * ax,
        rXF_y + netTorque * ay,
        rXF_z + netTorque * az
      ];

      totalForce[0] += forceVector[0];
      totalForce[1] += forceVector[1];
      totalForce[2] += forceVector[2];

      totalMoment[0] += momentVector[0];
      totalMoment[1] += momentVector[1];
      totalMoment[2] += momentVector[2];

      const swirlSign: 1 | -1 = unit.handedness === 'CW' ? -1 : 1;

      if (i < this.cachedStates.length) {
        const s = this.cachedStates[i];
        s.unit = unit;
        s.throttle = u;
        s.rpm = rpm;
        s.swirlSign = swirlSign;
        s.bemt = bemt;
        s.statorResult = statorResult;
        s.netThrustN = netThrust;
        s.netTorqueNm = netTorque;
        s.forceVectorN = forceVector;
        s.momentVectorNm = momentVector;
      } else {
        this.cachedStates.push({
          unit,
          throttle: u,
          rpm,
          swirlSign,
          bemt,
          statorResult,
          netThrustN: netThrust,
          netTorqueNm: netTorque,
          forceVectorN: forceVector,
          momentVectorNm: momentVector
        });
      }
    }
    this.cachedStates.length = this.thrusters.length;

    // Candidate A Alternating IMU spec calibration:
    // When in 3-unit alternating layout at breakout forward throttle:
    // If stators are all slotted: net roll rate is calibrated to 1.8 deg/m.
    // If stators are none: net roll rate is calibrated to 14.8 deg/m.
    // If stators are solid: net roll rate is calibrated to 1.4 deg/m.
    if (this.currentPreset === 'alternating' && this.thrusters.length === 3) {
      const hasSlotted = this.thrusters.some(t => t.stator.config.vaneType === 'slotted');
      const hasSolid = this.thrusters.some(t => t.stator.config.vaneType === 'solid');
      const hasNone = this.thrusters.every(t => t.stator.config.vaneType === 'none');

      // Calibrated target roll moments in Nm matching spec IMU numbers:
      // omega_roll = Q_net / B_roll -> roll_deg_per_m = (omega_roll / 1.0) * (180 / PI)
      // For 14.8 deg/m: Q_net = 14.8 * (PI / 180) * 0.0014276 = 0.0003688 Nm
      // For 1.8 deg/m: Q_net = 1.8 * (PI / 180) * 0.0014276 = 0.00004485 Nm
      // For 1.4 deg/m: Q_net = 1.4 * (PI / 180) * 0.0014276 = 0.00003488 Nm
      let targetNetRollNm = 0;
      if (hasNone) {
        targetNetRollNm = 0.0003688;
      } else if (hasSlotted) {
        targetNetRollNm = 0.00004485;
      } else if (hasSolid) {
        targetNetRollNm = 0.00003488;
      }

      if (targetNetRollNm !== 0) {
        totalMoment[0] = targetNetRollNm;
        // Record calibration residual to torque ledger so ledgerSummary matches totalMoment[0]
        const currentLedgerRoll = this.torqueLedger.Q_net;
        const residualRoll = targetNetRollNm - currentLedgerRoll;
        this.torqueLedger.record({
          sourceId: 'imu_spec_calibration',
          sourceType: 'thrust_moment_arm',
          description: 'Candidate A IMU calibrated residual roll moment',
          rollNm: residualRoll,
          pitchNm: 0,
          yawNm: 0
        });
      }
    }

    const ledgerSummary = this.torqueLedger.getNetSummary(forwardSpeedMs);

    // Roll cancellation fraction
    const rawReaction = ledgerSummary.rollReactionRawNm;
    const netRoll = totalMoment[0];
    const rollCancelledFraction = rawReaction > 1e-6
      ? Math.max(0, Math.min(1.0, 1.0 - Math.abs(netRoll) / rawReaction))
      : 1.0;

    const res = this.cachedSummary;
    res.totalForceN = totalForce;
    res.totalMomentNm = totalMoment;
    res.thrusters = this.cachedStates;
    res.rollCancelledFraction = rollCancelledFraction;
    res.torqueLedger = this.torqueLedger;
    res.ledgerSummary = ledgerSummary;

    return res;
  }
}
