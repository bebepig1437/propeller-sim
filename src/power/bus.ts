import { DCMotorModel, MotorOperatingState, MABUCHI_RC280RA_SPECS } from '../motor/motor';

export interface MotorChannelConfig {
  id: string;
  name: string;
  throttle: number;
}

export interface PowerBusTelemetry {
  supplyV: number;
  terminalV: number;
  voltageDropV: number;
  totalBusCurrentA: number;
  totalPowerSupplyW: number;
  tetherLossWatts: number;
  motorDeliveredPowerW: number;
  electricalEfficiency: number;
  quiescentCurrentA: number;
  motors: MotorOperatingState[];
}

export interface PowerBusOptions {
  motorCount?: number;
  supplyV?: number;
  tetherResistance?: number;
  quiescentCurrentA?: number;
  maxMotorCurrentA?: number;
  maxBusCurrentA?: number;
}

export class PowerBus {
  public supplyV: number;
  public tetherResistance: number;
  public quiescentCurrentA: number;
  public maxMotorCurrentA: number;
  public maxBusCurrentA: number;
  public motors: DCMotorModel[] = [];
  private busTelemetryRing: PowerBusTelemetry[] = [];
  private ringIdx = 0;
  public lastTelemetry: PowerBusTelemetry | null = null;
  public thermalEnabled = true;

  constructor(
    motorCount = 3,
    supplyV = 12.0,
    tetherResistance = 0.782,
    options?: PowerBusOptions
  ) {
    this.supplyV = options?.supplyV ?? supplyV;
    this.tetherResistance = options?.tetherResistance ?? tetherResistance;
    this.quiescentCurrentA = options?.quiescentCurrentA ?? 0.0;
    this.maxMotorCurrentA = options?.maxMotorCurrentA ?? 3.5;
    this.maxBusCurrentA = options?.maxBusCurrentA ?? 10.0;

    const count = options?.motorCount ?? motorCount;
    for (let i = 0; i < count; i++) {
      this.motors.push(new DCMotorModel(MABUCHI_RC280RA_SPECS));
    }

    for (let s = 0; s < 4; s++) {
      const motorStates: MotorOperatingState[] = [];
      for (let i = 0; i < count; i++) {
        motorStates.push(this.motors[i].createIdleState(this.supplyV));
      }
      this.busTelemetryRing.push({
        supplyV: this.supplyV,
        terminalV: this.supplyV,
        voltageDropV: 0,
        totalBusCurrentA: 0,
        totalPowerSupplyW: 0,
        tetherLossWatts: 0,
        motorDeliveredPowerW: 0,
        electricalEfficiency: 0,
        quiescentCurrentA: this.quiescentCurrentA,
        motors: motorStates
      });
    }
    this.lastTelemetry = this.busTelemetryRing[0];
  }

  public solveBusNetwork(
    throttles: number[],
    loadTorqueFns: ((omegaRadS: number) => number)[]
  ): PowerBusTelemetry {
    const numMotors = this.motors.length;
    let vTerminal = this.supplyV;

    const maxIters = 60;
    const tol = 1e-7;

    const telemetry = this.busTelemetryRing[(this.ringIdx++) % 4];
    const motorStates = telemetry.motors;
    while (motorStates.length < numMotors) {
      const idx = motorStates.length;
      motorStates.push(this.motors[idx]?.createIdleState(vTerminal) ?? (new DCMotorModel(MABUCHI_RC280RA_SPECS)).createIdleState(vTerminal));
    }
    motorStates.length = numMotors;

    let totalMotorCurrent = 0;

    for (let iter = 0; iter < maxIters; iter++) {
      totalMotorCurrent = 0;

      for (let m = 0; m < numMotors; m++) {
        let u = throttles[m] ?? 0;
        const motor = this.motors[m];
        motor.thermalEnabled = this.thermalEnabled;

        if (motor.isCutout && this.thermalEnabled) {
          u = 0;
        } else if (this.thermalEnabled && motor.windingTempC > motor.specs.warnWindingTempC) {
          const derate = Math.max(0.4, 1.0 - (motor.windingTempC - 85.0) / 30.0);
          u *= derate;
        }

        const loadFn = loadTorqueFns[m] ?? (() => 0);
        const state = motor.solveVoltageMode(vTerminal, u, loadFn, motorStates[m]);

        let current = state.currentA;
        if (Math.abs(current) > this.maxMotorCurrentA) {
          current = Math.sign(current) * this.maxMotorCurrentA;
          state.currentA = current;
        }

        totalMotorCurrent += current;
      }

      let netBusCurrent = totalMotorCurrent + this.quiescentCurrentA;
      if (Math.abs(netBusCurrent) > this.maxBusCurrentA) {
        netBusCurrent = Math.sign(netBusCurrent) * this.maxBusCurrentA;
      }

      const vDrop = netBusCurrent * this.tetherResistance;
      const vTerminalNew = this.supplyV - vDrop;

      const vRelaxed = 0.5 * vTerminal + 0.5 * vTerminalNew;
      if (Math.abs(vRelaxed - vTerminal) < tol) {
        vTerminal = vRelaxed;
        break;
      }
      vTerminal = vRelaxed;
    }

    const netBusCurrent = totalMotorCurrent + this.quiescentCurrentA;
    const vDrop = netBusCurrent * this.tetherResistance;

    for (let m = 0; m < numMotors; m++) {
      motorStates[m].terminalVoltageV = vTerminal;
    }

    const tetherLossWatts = netBusCurrent * netBusCurrent * this.tetherResistance;
    const totalPowerSupply = this.supplyV * netBusCurrent;
    let motorDeliveredPower = 0;
    for (let m = 0; m < numMotors; m++) {
      motorDeliveredPower += motorStates[m].powerElecW;
    }
    const electricalEfficiency = totalPowerSupply > 0.01 ? Math.min(1.0, motorDeliveredPower / totalPowerSupply) : 0;

    telemetry.supplyV = this.supplyV;
    telemetry.terminalV = vTerminal;
    telemetry.voltageDropV = vDrop;
    telemetry.totalBusCurrentA = netBusCurrent;
    telemetry.totalPowerSupplyW = totalPowerSupply;
    telemetry.tetherLossWatts = tetherLossWatts;
    telemetry.motorDeliveredPowerW = motorDeliveredPower;
    telemetry.electricalEfficiency = electricalEfficiency;
    telemetry.quiescentCurrentA = this.quiescentCurrentA;
    telemetry.motors = motorStates;

    this.lastTelemetry = telemetry;
    return telemetry;
  }

  public stepThermal(dtSeconds: number): void {
    if (!this.thermalEnabled || !this.lastTelemetry || dtSeconds <= 0) return;
    for (let m = 0; m < this.motors.length; m++) {
      const current = this.lastTelemetry.motors[m]?.currentA ?? 0;
      this.motors[m].stepThermal(current, dtSeconds);
    }
  }

  public setAmbientTemperature(tempC: number): void {
    for (const motor of this.motors) {
      motor.ambientTempC = tempC;
    }
  }

  public resetThermal(): void {
    for (const motor of this.motors) {
      motor.resetThermal();
    }
  }
}
