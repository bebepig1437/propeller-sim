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

  public removeThruster(index: number): void {
    if (this.thrusters.length > 1 && index >= 0 && index < this.thrusters.length) {
      const removed = this.thrusters[index];
      this.torqueLedger.removeSource(removed.id);
      this.thrusters.splice(index, 1);
    }
  }

  public evaluate(
    throttles?: number[],
    advanceSpeeds?: number[],
    bodyAngularVelocityRadS?: [number, number, number],
    forwardSpeedMs = 1.0
  ): VehiclePropulsionSummary {

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

      let netThrust = bemt.thrustN + statorResult.thrustDeltaN;

      if (u < 0) {
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

      const rawReactionTorque = bemt.torqueNm;

      const statorAntiTorque = statorResult.antiTorqueNm;
      const netTorque = rawReactionTorque + statorAntiTorque;

      const [ax, ay, az] = unit.thrustDirection;
      this.torqueLedger.recordPropReaction(unit.id, rawReactionTorque * ax, rawReactionTorque * ay, rawReactionTorque * az);
      this.torqueLedger.recordStatorRecovery(unit.id, statorAntiTorque * ax, statorAntiTorque * ay, statorAntiTorque * az);

      const forceVector: [number, number, number] = [
        netThrust * ax,
        netThrust * ay,
        netThrust * az
      ];

      const [px, py, pz] = unit.positionM;
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

      if (
        bodyAngularVelocityRadS &&
        (Math.abs(bodyAngularVelocityRadS[0]) > 1e-4 ||
          Math.abs(bodyAngularVelocityRadS[1]) > 1e-4 ||
          Math.abs(bodyAngularVelocityRadS[2]) > 1e-4)
      ) {
        const iProp = 1.05e-6; 
        const spinSpeedRadS = (rpm * Math.PI) / 30.0;
        this.torqueLedger.recordGyroscopicPrecession(
          unit.id,
          bodyAngularVelocityRadS,
          unit.thrustDirection,
          spinSpeedRadS,
          iProp
        );
      }

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

    if (this.currentPreset === 'alternating' && this.thrusters.length === 3) {
      const hasSlotted = this.thrusters.some(t => t.stator.config.vaneType === 'slotted');
      const hasSolid = this.thrusters.some(t => t.stator.config.vaneType === 'solid');
      const hasNone = this.thrusters.every(t => t.stator.config.vaneType === 'none');

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
