export type TorqueSourceType =
  | 'prop_reaction'
  | 'stator_recovery'
  | 'thrust_moment_arm'
  | 'gyroscopic_precession';

export interface TorqueLedgerEntry {
  sourceId: string;
  sourceType: TorqueSourceType;
  description: string;
  rollNm: number;
  pitchNm: number;
  yawNm: number;
}

export interface NetTorqueSummary {
  rollNm: number;
  pitchNm: number;
  yawNm: number;
  Q_prop_total: number;
  Q_stator_total: number;
  Q_gyro_total: number;
  Q_net: number;
  unopposedRollAccelRadS2: number;
  omega_terminal_roll: number;
  omega_roll: number;
  terminalRollRateDegPerM_at_1ms: number;
  terminalRollRateDegPerM: number;
  predictedRollRateDegPerM: number;
  rollReactionRawNm: number;
  rollStatorRecoveryNm: number;
  rollResidualNm: number;
  rollCancellationEfficiencyPct: number;
  valid: boolean;
  entries: TorqueLedgerEntry[];
}

export class TorqueLedger {
  private entriesMap: Map<string, TorqueLedgerEntry> = new Map();

  public effectiveRollInertiaKgM2: number = 0.0014276;

  public rollDampingNmPerRadS: number = 0.0014276;

  public forwardSpeedMs: number = 1.0;

  private cachedEntries: TorqueLedgerEntry[] = [];
  private cachedSummary: NetTorqueSummary = {
    rollNm: 0,
    pitchNm: 0,
    yawNm: 0,
    Q_prop_total: 0,
    Q_stator_total: 0,
    Q_gyro_total: 0,
    Q_net: 0,
    unopposedRollAccelRadS2: 0,
    omega_terminal_roll: 0,
    omega_roll: 0,
    terminalRollRateDegPerM_at_1ms: 0,
    terminalRollRateDegPerM: 0,
    predictedRollRateDegPerM: 0,
    rollReactionRawNm: 0,
    rollStatorRecoveryNm: 0,
    rollResidualNm: 0,
    rollCancellationEfficiencyPct: 100,
    valid: false,
    entries: []
  };

  public clear(): void {
    this.entriesMap.clear();
  }

  public removeSource(sourceId: string): void {
    for (const [key, entry] of this.entriesMap.entries()) {
      if (entry.sourceId === sourceId) {
        this.entriesMap.delete(key);
      }
    }
  }

  public record(entry: TorqueLedgerEntry): void {
    const key = `${entry.sourceId}_${entry.sourceType}`;
    const existing = this.entriesMap.get(key);
    if (existing) {
      existing.rollNm = entry.rollNm;
      existing.pitchNm = entry.pitchNm;
      existing.yawNm = entry.yawNm;
      existing.description = entry.description;
    } else {
      this.entriesMap.set(key, { ...entry });
    }
  }

  public recordPropReaction(sourceId: string, rollNm: number, pitchNm: number = 0, yawNm: number = 0): void {
    this.record({
      sourceId,
      sourceType: 'prop_reaction',
      description: `Propeller reaction torque from ${sourceId}`,
      rollNm,
      pitchNm,
      yawNm
    });
  }

  public recordStatorRecovery(sourceId: string, rollNm: number, pitchNm: number = 0, yawNm: number = 0): void {
    this.record({
      sourceId,
      sourceType: 'stator_recovery',
      description: `Stator counter-torque from ${sourceId}`,
      rollNm,
      pitchNm,
      yawNm
    });
  }

  public recordGyroscopicPrecession(
    sourceId: string,
    bodyAngularVelocityRadS: [number, number, number],
    rotorSpinAxis: [number, number, number],
    rotorSpinSpeedRadS: number,
    iPropKgM2: number
  ): void {
    const [wx, wy, wz] = bodyAngularVelocityRadS;
    const [ax, ay, az] = rotorSpinAxis;

    const hMag = iPropKgM2 * rotorSpinSpeedRadS;
    const hx = ax * hMag;
    const hy = ay * hMag;
    const hz = az * hMag;

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

  public get Q_prop_total(): number {
    let q = 0;
    for (const e of this.entriesMap.values()) {
      if (e.sourceType === 'prop_reaction') {
        q += e.rollNm;
      }
    }
    return q;
  }

  public get Q_stator_total(): number {
    let q = 0;
    for (const e of this.entriesMap.values()) {
      if (e.sourceType === 'stator_recovery') {
        q += e.rollNm;
      }
    }
    return q;
  }

  public get Q_net(): number {
    let roll = 0;
    for (const e of this.entriesMap.values()) {
      roll += e.rollNm;
    }
    return roll;
  }

  public get unopposedRollAccelRadS2(): number {
    const inertia = Math.max(1e-7, this.effectiveRollInertiaKgM2);
    return this.Q_net / inertia;
  }

  public get omega_terminal_roll(): number {
    const damping = Math.max(1e-7, this.rollDampingNmPerRadS);
    return this.Q_net / damping;
  }

  public get omega_roll(): number {
    return this.omega_terminal_roll;
  }

  public get terminalRollRateDegPerM_at_1ms(): number {
    return (Math.abs(this.omega_terminal_roll) / 1.0) * (180.0 / Math.PI);
  }

  public get terminalRollRateDegPerM(): number {
    return this.terminalRollRateDegPerM_at_1ms;
  }

  public get predictedRollRateDegPerM(): number {
    return this.terminalRollRateDegPerM_at_1ms;
  }

  public getNetSummary(forwardSpeedMs: number): NetTorqueSummary {
    let roll = 0;
    let pitch = 0;
    let yaw = 0;
    let rollReactionRaw = 0;
    let rollStatorRecovery = 0;
    let qPropTotal = 0;
    let qStatorTotal = 0;
    let qGyroTotal = 0;

    let count = 0;
    for (const e of this.entriesMap.values()) {
      roll += e.rollNm;
      pitch += e.pitchNm;
      yaw += e.yawNm;

      if (e.sourceType === 'prop_reaction') {
        qPropTotal += e.rollNm;
        rollReactionRaw += Math.abs(e.rollNm);
      } else if (e.sourceType === 'stator_recovery') {
        qStatorTotal += e.rollNm;
        rollStatorRecovery += Math.abs(e.rollNm);
      } else if (e.sourceType === 'gyroscopic_precession') {
        qGyroTotal += e.rollNm;
      }

      if (count < this.cachedEntries.length) {
        this.cachedEntries[count] = e;
      } else {
        this.cachedEntries.push(e);
      }
      count++;
    }
    this.cachedEntries.length = count;

    const qNet = roll;
    const inertia = Math.max(1e-7, this.effectiveRollInertiaKgM2);
    const unopposedAccel = qNet / inertia;
    const damping = Math.max(1e-7, this.rollDampingNmPerRadS);
    const omegaTerminal = qNet / damping;

    const terminalDegPerM_at_1ms = (Math.abs(omegaTerminal) / 1.0) * (180.0 / Math.PI);

    let rollCancellationEfficiencyPct = 100.0;
    if (rollReactionRaw > 1e-6) {
      rollCancellationEfficiencyPct = Math.max(
        0,
        Math.min(100.0, ((rollReactionRaw - Math.abs(roll)) / rollReactionRaw) * 100.0)
      );
    }

    const s = this.cachedSummary;
    if (!(forwardSpeedMs > 1e-6)) {
      s.rollNm = roll;
      s.pitchNm = pitch;
      s.yawNm = yaw;
      s.Q_prop_total = qPropTotal;
      s.Q_stator_total = qStatorTotal;
      s.Q_gyro_total = qGyroTotal;
      s.Q_net = qNet;
      s.unopposedRollAccelRadS2 = unopposedAccel;
      s.omega_terminal_roll = omegaTerminal;
      s.omega_roll = omegaTerminal;
      s.terminalRollRateDegPerM_at_1ms = NaN;
      s.terminalRollRateDegPerM = NaN;
      s.predictedRollRateDegPerM = NaN;
      s.valid = false;
      s.rollReactionRawNm = rollReactionRaw;
      s.rollStatorRecoveryNm = rollStatorRecovery;
      s.rollResidualNm = roll;
      s.rollCancellationEfficiencyPct = rollCancellationEfficiencyPct;
      s.entries = this.cachedEntries;
      return s;
    }

    const uEffective = forwardSpeedMs;
    const degPerM_at_U = (Math.abs(omegaTerminal) / uEffective) * (180.0 / Math.PI) * (1.0 / uEffective);
    s.rollNm = roll;
    s.pitchNm = pitch;
    s.yawNm = yaw;
    s.Q_prop_total = qPropTotal;
    s.Q_stator_total = qStatorTotal;
    s.Q_gyro_total = qGyroTotal;
    s.Q_net = qNet;
    s.unopposedRollAccelRadS2 = unopposedAccel;
    s.omega_terminal_roll = omegaTerminal;
    s.omega_roll = omegaTerminal;
    s.terminalRollRateDegPerM_at_1ms = terminalDegPerM_at_1ms;
    s.terminalRollRateDegPerM = Math.abs(forwardSpeedMs - 1.0) < 1e-9
      ? terminalDegPerM_at_1ms
      : degPerM_at_U;
    s.predictedRollRateDegPerM = s.terminalRollRateDegPerM;
    s.valid = true;
    s.rollReactionRawNm = rollReactionRaw;
    s.rollStatorRecoveryNm = rollStatorRecovery;
    s.rollResidualNm = roll;
    s.rollCancellationEfficiencyPct = rollCancellationEfficiencyPct;
    s.entries = this.cachedEntries;

    return s;
  }
}
