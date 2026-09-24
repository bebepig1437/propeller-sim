import { DCMotorModel, MotorOperatingState, MABUCHI_RC280RA_SPECS } from '../prop/motor';

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
  public lastTelemetry: PowerBusTelemetry | null = null;

  constructor(
    motorCount = 1,
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
  }

  public solveBusNetwork(
    throttles: number[],
    loadTorqueFns: ((omegaRadS: number) => number)[]
  ): PowerBusTelemetry {
    const numMotors = this.motors.length;
    let vTerminal = this.supplyV;

    const maxIters = 60;
    const tol = 1e-7;

    const motorStates: MotorOperatingState[] = [];
    for (let i = 0; i < numMotors; i++) {
      motorStates.push(this.motors[i].createIdleState(vTerminal));
    }

    let totalMotorCurrent = 0;

    for (let iter = 0; iter < maxIters; iter++) {
      totalMotorCurrent = 0;

      for (let m = 0; m < numMotors; m++) {
        const u = throttles[m] ?? 0;
        const motor = this.motors[m];
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

    const telemetry: PowerBusTelemetry = {
      supplyV: this.supplyV,
      terminalV: vTerminal,
      voltageDropV: vDrop,
      totalBusCurrentA: netBusCurrent,
      totalPowerSupplyW: totalPowerSupply,
      tetherLossWatts,
      motorDeliveredPowerW: motorDeliveredPower,
      electricalEfficiency,
      quiescentCurrentA: this.quiescentCurrentA,
      motors: motorStates
    };

    this.lastTelemetry = telemetry;
    return telemetry;
  }
}
