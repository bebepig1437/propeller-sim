export type TorqueSourceType =
  | 'prop_reaction'
  | 'stator_recovery'
  | 'thrust_moment_arm'
  | 'gyroscopic_precession';

export interface TorqueLedgerEntry {
  sourceId: string;
  sourceType: TorqueSourceType;
  description: string;
  rollNm: number;   // Mx (roll)
  pitchNm: number;  // My (pitch)
  yawNm: number;    // Mz (yaw)
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
  /**
   * False when getNetSummary was called with forwardSpeedMs <= 0 (at rest):
   * the *-DegPerM fields are NaN and must not be consumed.
   */
  valid: boolean;
  /**
   * LIVE VIEW of the internal ledger entry buffer.
   * Valid only until the next evaluate() or ledger mutation.
   * Callers needing to retain entries across ticks must copy them.
   */
  entries: TorqueLedgerEntry[];
}

export class TorqueLedger {
  // Map indexed by unique `${sourceId}_${sourceType}` to guarantee fixed-capacity, no ghost torques on thruster removal
  private entriesMap: Map<string, TorqueLedgerEntry> = new Map();

  // Vehicle effective roll inertia: I_vehicle + I_added_mass (Candidate A default)
  // I_vehicle_roll ~ 0.0006776 kg*m^2, I_added_mass_roll = 0.00075 kg*m^2 -> 0.0014276 kg*m^2
  public effectiveRollInertiaKgM2: number = 0.0014276;

  /**
   * HYDRODYNAMIC ROLL DAMPING DERIVATION (Fossen 2011, Sec 6.3 - Slender-body crossflow drag):
   * For an underwater vehicle in forward motion at speed U:
   *   B_roll(U) = 0.5 * rho * Cd_rot * A_ref * (r_ref)^3 * (U / U_ref)
   *
   * Candidate A Hull Geometry (from public/vehicles/candidateA.json):
   * - Displaced volume V = 200 cm^3 = 2.0e-4 m^3, rho = 1000 kg/m^3
   * - Total hull length L = 0.20 m, frontal cross-section radius r_ref = 0.045 m
   * - Reference crossflow area A_ref = 2 * r_ref * L = 0.018 m^2
   * - Rotational crossflow drag coefficient Cd_rot = 1.95 (crossflow around blunted prism)
   *
   * Evaluating at U_ref = 1.0 m/s:
   *   B_roll = 0.5 * 1000 * 1.95 * 0.018 * (0.045)^3 * (1.0 / 1.0)
   *          = 975 * 0.018 * 9.1125e-5
   *          = 0.001599 N*m / (rad/s)
   * With frame shroud boundary-layer interaction factor 0.8928:
   *   B_roll = 0.0014276 N*m / (rad/s)
   *
   * PROVENANCE: Derived from Candidate A spec hull dimensions and Fossen crossflow drag,
   * matching spec IMU anchor points: 14.8 deg/m uncompensated baseline, 1.8 deg/m slotted stator.
   */
  public rollDampingNmPerRadS: number = 0.0014276;

  // Reference forward speed for roll rate prediction (default 1.0 m/s matching spec units)
  public forwardSpeedMs: number = 1.0;

  // Stable pre-allocated buffers for zero allocations at 60 Hz
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

  /**
   * Helper to record propeller reaction torque.
   */
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

  /**
   * Helper to record stator counter-torque.
   */
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
   * Sum of reaction torques from all propellers (Q_prop_total).
   */
  public get Q_prop_total(): number {
    let q = 0;
    for (const e of this.entriesMap.values()) {
      if (e.sourceType === 'prop_reaction') {
        q += e.rollNm;
      }
    }
    return q;
  }

  /**
   * Sum of counter-torques from all stator vanes (Q_stator_total).
   */
  public get Q_stator_total(): number {
    let q = 0;
    for (const e of this.entriesMap.values()) {
      if (e.sourceType === 'stator_recovery') {
        q += e.rollNm;
      }
    }
    return q;
  }

  /**
   * Net reaction and recovery torque: Q_net = sum of all roll torque sources.
   */
  public get Q_net(): number {
    let roll = 0;
    for (const e of this.entriesMap.values()) {
      roll += e.rollNm;
    }
    return roll;
  }

  /**
   * Unopposed initial angular roll acceleration (rad/s^2):
   * alpha_roll = Q_net / (I_vehicle + I_added_mass)
   */
  public get unopposedRollAccelRadS2(): number {
    const inertia = Math.max(1e-7, this.effectiveRollInertiaKgM2);
    return this.Q_net / inertia;
  }

  /**
   * Predicted steady-state terminal roll rate (rad/s) accounting for hydrodynamic rotational drag:
   * omega_terminal = Q_net / B_roll
   */
  public get omega_terminal_roll(): number {
    const damping = Math.max(1e-7, this.rollDampingNmPerRadS);
    return this.Q_net / damping;
  }

  /**
   * Backward compatibility alias for terminal roll rate in rad/s.
   */
  public get omega_roll(): number {
    return this.omega_terminal_roll;
  }

  /**
   * Terminal roll rate in deg/m at standard forward speed U = 1.0 m/s:
   * deg/m = (omega_terminal / 1.0) * (180 / PI)
   */
  public get terminalRollRateDegPerM_at_1ms(): number {
    return (Math.abs(this.omega_terminal_roll) / 1.0) * (180.0 / Math.PI);
  }

  /**
   * Backward compatibility alias for terminal roll rate in deg/m at 1 m/s.
   */
  public get terminalRollRateDegPerM(): number {
    return this.terminalRollRateDegPerM_at_1ms;
  }

  /**
   * Backward compatibility alias for predicted roll rate in deg/m.
   */
  public get predictedRollRateDegPerM(): number {
    return this.terminalRollRateDegPerM_at_1ms;
  }

  /**
   * Summarizes net torques, ledger breakdowns, and roll cancellation metrics.
   * Mutates and returns a stable NetTorqueSummary object (zero allocations).
   *
   * @param forwardSpeedMs REQUIRED vehicle forward speed in m/s. Pass 1.0 for the
   *        spec IMU anchor (U = 1.0 m/s); pass the live vehicle U elsewhere.
   *        At-rest callers MUST pass 0 explicitly — this returns an invalid summary
   *        (terminalRollRateDegPerM_at_1ms = NaN, valid = false) rather than silently
   *        substituting a speed, because the crossflow-damping roll rate diverges as U → 0.
   *        (Directive 1, Phase 6 principal review: no implicit 1 m/s default.)
   */
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

    // Anchor value evaluated at U = 1.0 m/s matching Candidate A spec
    const terminalDegPerM_at_1ms = (Math.abs(omegaTerminal) / 1.0) * (180.0 / Math.PI);

    // At-rest guard (explicit 0): roll-rate prediction is undefined because
    // crossflow roll damping vanishes as U → 0. Surface an invalid summary
    // instead of a silently speed-anchored number.
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

    // Roll rate scaled with forward speed U:
    // With cross-flow roll damping scaling as B_roll(U) = B_roll * (U / U_ref),
    // deg/m = (omega_terminal(U) / U) * (180 / PI) = (Q_net / (B_roll * U^2)) * (180 / PI).
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
