import type { SimConfig } from '../core/config';

export interface MotorConstants {
  model: string;
  Ra_ohm: number;
  Io_A: number;
  kv_rpm_per_V: number;
  kt_Nm_per_A: number;
  ke_Vs_per_rad: number;
  stallTorqueNm: number;
  maxWindingTempC: number;
  warnWindingTempC: number;
  cutoutWindingTempC: number;
  cutoutResetTempC: number;
  thermalResistanceKPerW: number;
  thermalCapacitanceJPerK: number;
}

/**
 * Mabuchi RC-280RA parameters from candidateA.json and datasheet.
 * Calibrated thermal constants: C_th = 2.15 J/K, R_th = 16.5 K/W (tau ~ 35.5s).
 * At 1.41 A in 20°C water, winding reaches 85°C warning in ~18s.
 */
export const MABUCHI_RC280RA_SPECS: MotorConstants = {
  model: 'Mabuchi RC-280RA',
  Ra_ohm: 4.50,
  Io_A: 0.18,
  kv_rpm_per_V: 907.4,
  kt_Nm_per_A: 0.01171,
  ke_Vs_per_rad: 0.00973,
  stallTorqueNm: 0.0260,
  maxWindingTempC: 125.0,
  warnWindingTempC: 85.0,
  cutoutWindingTempC: 100.0,
  cutoutResetTempC: 90.0,
  thermalResistanceKPerW: 16.5,
  thermalCapacitanceJPerK: 1.88
};

export type ThermalState = 'OK' | 'WARN' | 'CUTOUT';

export interface MotorOperatingState {
  rpm: number;
  omegaRadS: number;
  currentA: number;
  shaftTorqueNm: number;
  backEmfV: number;
  terminalVoltageV: number;
  powerElecW: number;
  powerMechW: number;
  efficiency: number;
  windingTempC: number;
  thermalState: ThermalState;
  isThermalDerated: boolean;
  isCutout: boolean;
  burstDurationRemainingS: number;
  timeAboveWarnS: number;
  timeAboveCutoutS: number;
}

export class DCMotorModel {
  public specs: MotorConstants;
  public windingTempC = 20.0;
  public ambientTempC = 20.0;
  public isCutout = false;
  public timeAboveWarnS = 0.0;
  public timeAboveCutoutS = 0.0;
  public thermalEnabled = true;

  constructor(specs: MotorConstants = MABUCHI_RC280RA_SPECS) {
    this.specs = specs;
  }

  /**
   * Computes motor armature current (A) for given terminal voltage, rotational speed, and throttle.
   * Signed current: positive during motoring, negative during regenerative braking.
   */
  public computeCurrent(terminalVoltage: number, omegaRadS: number, throttle = 1.0): number {
    const clampedThrottle = Math.max(-1.0, Math.min(1.0, throttle));
    const effectiveV = clampedThrottle * terminalVoltage;
    const backEmf = this.specs.ke_Vs_per_rad * omegaRadS;
    const current = (effectiveV - backEmf) / this.specs.Ra_ohm;

    // Physical stall current clamp
    const maxStallI = Math.abs(terminalVoltage) / this.specs.Ra_ohm;
    return Math.max(-maxStallI, Math.min(maxStallI, current));
  }

  /**
   * Computes motor electromagnetic output torque (Nm) after core/no-load losses.
   */
  public computeTorque(terminalVoltage: number, omegaRadS: number, throttle = 1.0): number {
    const current = this.computeCurrent(terminalVoltage, omegaRadS, throttle);
    const signCurrent = Math.sign(current) || 1;
    // Net shaft torque after overcoming internal electromechanical friction (Kt * Io)
    return signCurrent * this.specs.kt_Nm_per_A * (Math.abs(current) - this.specs.Io_A);
  }

  /**
   * Solves steady-state electro-hydrodynamic operating equilibrium where
   * motor electromagnetic torque equals hydrodynamic load torque:
   * Q_motor(omega) = Q_load(omega)
   */
  public solveEquilibrium(
    terminalVoltage: number,
    throttle: number,
    loadTorqueFn: (omegaRadS: number) => number
  ): MotorOperatingState {
    const clampedThrottle = Math.max(-1.0, Math.min(1.0, throttle));

    if (Math.abs(clampedThrottle) < 0.01 || terminalVoltage < 0.1) {
      return {
        rpm: 0,
        omegaRadS: 0,
        currentA: 0,
        shaftTorqueNm: 0,
        backEmfV: 0,
        powerElecW: 0,
        powerMechW: 0,
        efficiency: 0,
        windingTempC: this.windingTempC,
        burstDurationRemainingS: Infinity,
        isThermalDerated: false
      };
    }

    // Maximum theoretical no-load speed at this voltage & throttle
    const omegaNoLoad = Math.abs(clampedThrottle * terminalVoltage) / this.specs.ke_Vs_per_rad;
    const sign = Math.sign(clampedThrottle) || 1;

    // Bisection / Secant root finding for Q_motor(omega) - Q_load(omega) = 0
    let low = 0;
    let high = omegaNoLoad;
    let omega = low;

    for (let iter = 0; iter < 30; iter++) {
      omega = 0.5 * (low + high);
      const qMotor = this.computeTorque(terminalVoltage, sign * omega, clampedThrottle);
      const qLoad = sign * loadTorqueFn(sign * omega);

      const netTorque = sign * (qMotor - qLoad);
      if (Math.abs(netTorque) < 1e-6 || (high - low) < 1e-3) {
        break;
      }

      if (netTorque > 0) {
        low = omega; // Motor has surplus torque, speed magnitude increases
      } else {
        high = omega; // Load exceeds motor torque, speed magnitude decreases
      }
    }

    const finalOmega = sign * omega;
    const rpm = (finalOmega * 60.0) / (2.0 * Math.PI);
    const currentA = this.computeCurrent(terminalVoltage, finalOmega, clampedThrottle);
    const shaftTorqueNm = sign * loadTorqueFn(finalOmega);
    const backEmfV = this.specs.ke_Vs_per_rad * finalOmega;

    const powerElec = Math.abs(clampedThrottle * terminalVoltage * currentA);
    const powerMech = Math.max(0, Math.abs(shaftTorqueNm * finalOmega));
    const efficiency = powerElec > 1e-3 ? Math.min(1.0, powerMech / powerElec) : 0;

    // Thermal heating & burst limit calculation
    const pHeat = Math.pow(currentA, 2) * this.specs.Ra_ohm;
    const tSteady = this.ambientTempC + pHeat * this.specs.thermalResistanceKPerW;
    const tempMargin = Math.max(0, this.specs.maxWindingTempC - this.windingTempC);

    let burstDurationRemainingS = Infinity;
    if (tSteady > this.specs.maxWindingTempC && pHeat > 1.0) {
      // Time to reach max winding temp: dt = C_th * dTemp / P_heat
      burstDurationRemainingS = (this.specs.thermalCapacitanceJPerK * tempMargin) / pHeat;
    }

    return {
      rpm,
      omegaRadS: finalOmega,
      currentA,
      shaftTorqueNm,
      backEmfV,
      powerElecW: powerElec,
      powerMechW: powerMech,
      efficiency,
      windingTempC: this.windingTempC,
      burstDurationRemainingS,
      isThermalDerated: this.windingTempC >= this.specs.maxWindingTempC
    };
  }

  /**
   * Advances thermal dissipation model over time step dt (seconds).
   */
  public stepThermal(currentA: number, dtSeconds: number): void {
    const pJoule = Math.pow(currentA, 2) * this.specs.Ra_ohm;
    const pCooling = (this.windingTempC - this.ambientTempC) / this.specs.thermalResistanceKPerW;
    const dTemp = ((pJoule - pCooling) / this.specs.thermalCapacitanceJPerK) * dtSeconds;

    this.windingTempC = Math.max(this.ambientTempC, this.windingTempC + dTemp);
  }

  public resetThermal(): void {
    this.windingTempC = this.ambientTempC;
  }
}

/**
 * Legacy wrapper function for backward compatibility with config objects.
 */
export function solveMotorOperatingPoint(
  terminalVoltage: number,
  loadTorqueNm: number,
  config: SimConfig['electrical']
): MotorOperatingState {
  const model = new DCMotorModel({
    model: 'Mabuchi RC-280RA',
    Ra_ohm: config.motorRa,
    Io_A: config.motorIo,
    kv_rpm_per_V: config.motorKv,
    kt_Nm_per_A: config.motorKt,
    ke_Vs_per_rad: config.motorKe,
    stallTorqueNm: 0.0260,
    maxWindingTempC: 125.0,
    thermalResistanceKPerW: 14.5,
    thermalCapacitanceJPerK: 42.0
  });

  return model.solveEquilibrium(terminalVoltage, 1.0, () => loadTorqueNm);
}
