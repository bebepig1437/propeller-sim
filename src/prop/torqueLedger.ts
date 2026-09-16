export type TorqueSourceType =
  | 'prop_reaction'
  | 'stator_recovery'
  | 'thrust_moment_arm'
  | 'gyroscopic_precession';

export interface TorqueLedgerEntry {
  sourceId: string;
  sourceType: TorqueSourceType;
  description: string;
  rollNm: number;   // Mx
  pitchNm: number;  // My
  yawNm: number;    // Mz
}

export interface NetTorqueSummary {
  rollNm: number;
  pitchNm: number;
  yawNm: number;
  rollReactionRawNm: number;
  rollStatorRecoveryNm: number;
  rollResidualNm: number;
  rollCancellationEfficiencyPct: number;
  entries: TorqueLedgerEntry[];
}

export class TorqueLedger {
  private entries: TorqueLedgerEntry[] = [];

  public clear(): void {
    this.entries = [];
  }

  public record(entry: TorqueLedgerEntry): void {
    this.entries.push(entry);
  }

  /**
   * Computes gyroscopic precession torque:
   * tau_gyro = omega_body x (I_prop * Omega_prop)
   */
  public recordGyroscopicPrecession(
    sourceId: string,
    bodyAngularVelocityRadS: [number, number, number],
    rotorSpinAxis: [number, number, number],
    rotorSpinSpeedRadS: number,
    iPropKgM2: number
  ): void {
    const [wx, wy, wz] = bodyAngularVelocityRadS;
    const [ax, ay, az] = rotorSpinAxis;

    // Angular momentum of spinning rotor: H = I * Omega * axis
    const hMag = iPropKgM2 * rotorSpinSpeedRadS;
    const hx = ax * hMag;
    const hy = ay * hMag;
    const hz = az * hMag;

    // tau_gyro = - (omega_body x H) (reaction torque on vehicle hull)
    const tauX = -(wy * hz - wz * hy);
    const tauY = -(wz * hx - wx * hz);
    const tauZ = -(wx * hy - wy * hx);

    this.record({
      sourceId,
      sourceType: 'gyroscopic_precession',
      description: `Gyroscopic precession from ${sourceId}`,
      rollNm: tauX,
      pitchNm: tauY,
      yawNm: tauZ
    });
  }

  /**
   * Summarizes net torques and roll cancellation metrics.
   */
  public getNetSummary(): NetTorqueSummary {
    let roll = 0;
    let pitch = 0;
    let yaw = 0;
    let rollReactionRaw = 0;
    let rollStatorRecovery = 0;

    for (const e of this.entries) {
      roll += e.rollNm;
      pitch += e.pitchNm;
      yaw += e.yawNm;

      if (e.sourceType === 'prop_reaction') {
        rollReactionRaw += Math.abs(e.rollNm);
      } else if (e.sourceType === 'stator_recovery') {
        rollStatorRecovery += Math.abs(e.rollNm);
      }
    }

    let rollCancellationEfficiencyPct = 100.0;
    if (rollReactionRaw > 1e-6) {
      rollCancellationEfficiencyPct = Math.max(
        0,
        Math.min(100.0, ((rollReactionRaw - Math.abs(roll)) / rollReactionRaw) * 100.0)
      );
    }

    return {
      rollNm: roll,
      pitchNm: pitch,
      yawNm: yaw,
      rollReactionRawNm: rollReactionRaw,
      rollStatorRecoveryNm: rollStatorRecovery,
      rollResidualNm: roll,
      rollCancellationEfficiencyPct,
      entries: [...this.entries]
    };
  }
}
