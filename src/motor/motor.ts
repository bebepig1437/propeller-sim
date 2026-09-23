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
  private scratchState: MotorOperatingState = {
    rpm: 0,
    omegaRadS: 0,
    currentA: 0,
    shaftTorqueNm: 0,
    backEmfV: 0,
    terminalVoltageV: 0,
    powerElecW: 0,
    powerMechW: 0,
    efficiency: 0,
    windingTempC: 20,
    thermalState: "OK",
    isThermalDerated: false,
    isCutout: false,
    burstDurationRemainingS: Infinity,
    timeAboveWarnS: 0,
    timeAboveCutoutS: 0
  };

  constructor(specs: MotorConstants = MABUCHI_RC280RA_SPECS) {
    this.specs = specs;
  }

  public computeCurrent(terminalVoltage: number, omegaRadS: number, throttle = 1.0): number {
    const clampedThrottle = Math.max(-1.0, Math.min(1.0, throttle));
    const effectiveV = clampedThrottle * terminalVoltage;
    const backEmf = this.specs.ke_Vs_per_rad * omegaRadS;
    const current = (effectiveV - backEmf) / this.specs.Ra_ohm;

    const maxStallI = Math.abs(terminalVoltage) / this.specs.Ra_ohm;
    return Math.max(-maxStallI, Math.min(maxStallI, current));
  }

  public computeTorque(terminalVoltage: number, omegaRadS: number, throttle = 1.0): number {
    const current = this.computeCurrent(terminalVoltage, omegaRadS, throttle);
    const signCurrent = Math.sign(current) || 1;
    const netCurrent = Math.max(0, Math.abs(current) - this.specs.Io_A);
    return signCurrent * this.specs.kt_Nm_per_A * netCurrent;
  }

  public solveVoltageMode(
    terminalVoltage: number,
    throttle: number,
    loadTorqueFn: (omegaRadS: number) => number,
    out?: MotorOperatingState
  ): MotorOperatingState {
    const clampedThrottle = Math.max(-1.0, Math.min(1.0, throttle));

    if (this.isCutout && this.thermalEnabled) {
      return this.createCutoutState(terminalVoltage, out);
    }

    if (Math.abs(clampedThrottle) < 0.01 || Math.abs(terminalVoltage) < 0.1) {
      return this.createIdleState(terminalVoltage, out);
    }

    const omegaNoLoad = Math.abs(clampedThrottle * terminalVoltage) / this.specs.ke_Vs_per_rad;
    const sign = Math.sign(clampedThrottle) || 1;

    let low = 0;
    let high = omegaNoLoad;
    let omega = low;

    for (let iter = 0; iter < 35; iter++) {
      omega = 0.5 * (low + high);
      const qMotor = this.computeTorque(terminalVoltage, sign * omega, clampedThrottle);
      const qLoad = sign * loadTorqueFn(sign * omega);

      const netTorque = sign * (qMotor - qLoad);
      if (Math.abs(netTorque) < 1e-6 || (high - low) < 1e-3) {
        break;
      }

      if (netTorque > 0) {
        low = omega;
      } else {
        high = omega;
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

    const thermalState = this.getThermalState();

    const pHeat = Math.pow(currentA, 2) * this.specs.Ra_ohm;
    const tempMargin = Math.max(0, this.specs.cutoutWindingTempC - this.windingTempC);
    const burstDurationRemainingS = pHeat > 1.0 ? (this.specs.thermalCapacitanceJPerK * tempMargin) / pHeat : Infinity;

    const res = out ?? { ...this.scratchState };
    res.rpm = rpm;
    res.omegaRadS = finalOmega;
    res.currentA = currentA;
    res.shaftTorqueNm = shaftTorqueNm;
    res.backEmfV = backEmfV;
    res.terminalVoltageV = terminalVoltage;
    res.powerElecW = powerElec;
    res.powerMechW = powerMech;
    res.efficiency = efficiency;
    res.windingTempC = this.windingTempC;
    res.thermalState = thermalState;
    res.isThermalDerated = thermalState !== "OK";
    res.isCutout = this.isCutout;
    res.burstDurationRemainingS = burstDurationRemainingS;
    res.timeAboveWarnS = this.timeAboveWarnS;
    res.timeAboveCutoutS = this.timeAboveCutoutS;
    return res;
  }

  public solveEquilibrium(
    terminalVoltage: number,
    throttle: number,
    loadTorqueFn: (omegaRadS: number) => number
  ): MotorOperatingState {
    return this.solveVoltageMode(terminalVoltage, throttle, loadTorqueFn);
  }

  public solveRpmMode(
    commandedRpm: number,
    loadTorqueFn: (omegaRadS: number) => number
  ): MotorOperatingState {
    if (this.isCutout && this.thermalEnabled) {
      return this.createCutoutState(0);
    }

    if (Math.abs(commandedRpm) < 1.0) {
      return this.createIdleState(0);
    }

    const omega = (commandedRpm * 2.0 * Math.PI) / 60.0;
    const sign = Math.sign(omega) || 1;

    const shaftTorqueNm = sign * loadTorqueFn(omega);
    const absTorque = Math.abs(shaftTorqueNm);

    const currentA = sign * (this.specs.Io_A + absTorque / this.specs.kt_Nm_per_A);
    const backEmfV = this.specs.ke_Vs_per_rad * omega;

    const terminalVoltageV = backEmfV + currentA * this.specs.Ra_ohm;

    const powerElec = Math.abs(terminalVoltageV * currentA);
    const powerMech = Math.max(0, Math.abs(shaftTorqueNm * omega));
    const efficiency = powerElec > 1e-3 ? Math.min(1.0, powerMech / powerElec) : 0;

    const thermalState = this.getThermalState();
    const pHeat = Math.pow(currentA, 2) * this.specs.Ra_ohm;
    const tempMargin = Math.max(0, this.specs.cutoutWindingTempC - this.windingTempC);
    const burstDurationRemainingS = pHeat > 1.0 ? (this.specs.thermalCapacitanceJPerK * tempMargin) / pHeat : Infinity;

    return {
      rpm: commandedRpm,
      omegaRadS: omega,
      currentA,
      shaftTorqueNm,
      backEmfV,
      terminalVoltageV,
      powerElecW: powerElec,
      powerMechW: powerMech,
      efficiency,
      windingTempC: this.windingTempC,
      thermalState,
      isThermalDerated: thermalState !== 'OK',
      isCutout: this.isCutout,
      burstDurationRemainingS,
      timeAboveWarnS: this.timeAboveWarnS,
      timeAboveCutoutS: this.timeAboveCutoutS
    };
  }

  public stepThermal(currentA: number, dtSeconds: number): void {
    if (!this.thermalEnabled || dtSeconds <= 0) return;

    const tau = this.specs.thermalResistanceKPerW * this.specs.thermalCapacitanceJPerK;
    const pJoule = Math.pow(currentA, 2) * this.specs.Ra_ohm;

    const decay = Math.exp(-dtSeconds / Math.max(1e-3, tau));
    const deltaTprev = this.windingTempC - this.ambientTempC;
    const jHeat = (pJoule * dtSeconds) / this.specs.thermalCapacitanceJPerK;

    this.windingTempC = this.ambientTempC + deltaTprev * decay + jHeat;

    if (this.windingTempC >= this.specs.warnWindingTempC) {
      this.timeAboveWarnS += dtSeconds;
    } else {
      this.timeAboveWarnS = Math.max(0, this.timeAboveWarnS - dtSeconds);
    }

    if (!this.isCutout && this.windingTempC >= this.specs.cutoutWindingTempC) {
      this.isCutout = true;
      this.timeAboveCutoutS += dtSeconds;
    } else if (this.isCutout) {
      this.timeAboveCutoutS += dtSeconds;
      if (this.windingTempC <= this.specs.cutoutResetTempC) {
        this.isCutout = false;
        this.timeAboveCutoutS = 0;
      }
    }
  }

  public getThermalState(): ThermalState {
    if (this.isCutout) return 'CUTOUT';
    if (this.windingTempC >= this.specs.warnWindingTempC) return 'WARN';
    return 'OK';
  }

  public resetThermal(): void {
    this.windingTempC = this.ambientTempC;
    this.isCutout = false;
    this.timeAboveWarnS = 0;
    this.timeAboveCutoutS = 0;
  }

  public createIdleState(terminalVoltage: number, out?: MotorOperatingState): MotorOperatingState {
    const thermalState = this.getThermalState();
    const res = out ?? { ...this.scratchState };
    res.rpm = 0;
    res.omegaRadS = 0;
    res.currentA = 0;
    res.shaftTorqueNm = 0;
    res.backEmfV = 0;
    res.terminalVoltageV = terminalVoltage;
    res.powerElecW = 0;
    res.powerMechW = 0;
    res.efficiency = 0;
    res.windingTempC = this.windingTempC;
    res.thermalState = thermalState;
    res.isThermalDerated = thermalState !== "OK";
    res.isCutout = this.isCutout;
    res.burstDurationRemainingS = Infinity;
    res.timeAboveWarnS = this.timeAboveWarnS;
    res.timeAboveCutoutS = this.timeAboveCutoutS;
    return res;
  }

  public createCutoutState(terminalVoltage: number, out?: MotorOperatingState): MotorOperatingState {
    const res = out ?? { ...this.scratchState };
    res.rpm = 0;
    res.omegaRadS = 0;
    res.currentA = 0;
    res.shaftTorqueNm = 0;
    res.backEmfV = 0;
    res.terminalVoltageV = terminalVoltage;
    res.powerElecW = 0;
    res.powerMechW = 0;
    res.efficiency = 0;
    res.windingTempC = this.windingTempC;
    res.thermalState = "CUTOUT";
    res.isThermalDerated = true;
    res.isCutout = true;
    res.burstDurationRemainingS = 0;
    res.timeAboveWarnS = this.timeAboveWarnS;
    res.timeAboveCutoutS = this.timeAboveCutoutS;
    return res;
  }
}

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
    warnWindingTempC: 85.0,
    cutoutWindingTempC: 100.0,
    cutoutResetTempC: 90.0,
    thermalResistanceKPerW: 16.5,
    thermalCapacitanceJPerK: 2.15
  });

  return model.solveEquilibrium(terminalVoltage, 1.0, () => loadTorqueNm);
}
