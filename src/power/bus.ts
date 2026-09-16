import { DCMotorModel, MotorOperatingState, MABUCHI_RC280RA_SPECS } from '../prop/motor';
import { calculateTetherState, TetherVoltageDrop } from './tether';

export interface MotorChannelConfig {
  id: string;
  name: string;
  throttle: number; // [-1.0, 1.0]
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
  motors: MotorOperatingState[];
}

export class PowerBus {
  public supplyV: number;
  public tetherResistance: number;
  public motors: DCMotorModel[] = [];
  public lastTelemetry: PowerBusTelemetry | null = null;

  constructor(
    motorCount = 3,
    supplyV = 12.0,
    tetherResistance = 0.782
  ) {
    this.supplyV = supplyV;
    this.tetherResistance = tetherResistance;

    for (let i = 0; i < motorCount; i++) {
      this.motors.push(new DCMotorModel(MABUCHI_RC280RA_SPECS));
    }
  }

  /**
   * Solves the coupled multi-motor non-linear electrical network with tether voltage sag.
   * Uses iterative relaxation to converge terminal voltage and individual motor currents.
   */
  public solveBusNetwork(
    throttles: number[],
    loadTorqueFns: ((omegaRadS: number) => number)[]
  ): PowerBusTelemetry {
    const numMotors = this.motors.length;
    let vTerminal = this.supplyV; // Initial guess

    const maxIters = 20;
    const tol = 1e-4;

    let motorStates: MotorOperatingState[] = [];
    let totalCurrent = 0;

    for (let iter = 0; iter < maxIters; iter++) {
      totalCurrent = 0;
      motorStates = [];

      for (let m = 0; m < numMotors; m++) {
        const u = throttles[m] ?? 0;
        const loadFn = loadTorqueFns[m] ?? (() => 0);
        const state = this.motors[m].solveEquilibrium(vTerminal, u, loadFn);
        motorStates.push(state);
        totalCurrent += Math.abs(state.currentA);
      }

      // New terminal voltage with tether drop
      const vDrop = totalCurrent * this.tetherResistance;
      const vTerminalNew = Math.max(0, this.supplyV - vDrop);

      // Relaxed update
      const vRelaxed = 0.6 * vTerminal + 0.4 * vTerminalNew;
      if (Math.abs(vRelaxed - vTerminal) < tol) {
        vTerminal = vRelaxed;
        break;
      }
      vTerminal = vRelaxed;
    }

    const tetherState: TetherVoltageDrop = calculateTetherState(
      totalCurrent,
      this.supplyV,
      this.tetherResistance
    );

    const totalPowerSupply = this.supplyV * totalCurrent;
    const motorDeliveredPower = motorStates.reduce((acc, m) => acc + m.powerElecW, 0);
    const electricalEfficiency = totalPowerSupply > 0.01 ? motorDeliveredPower / totalPowerSupply : 0;

    const telemetry: PowerBusTelemetry = {
      supplyV: this.supplyV,
      terminalV: tetherState.terminalV,
      voltageDropV: tetherState.voltageDropV,
      totalBusCurrentA: totalCurrent,
      totalPowerSupplyW: totalPowerSupply,
      tetherLossWatts: tetherState.jouleLossWatts,
      motorDeliveredPowerW: motorDeliveredPower,
      electricalEfficiency,
      motors: motorStates
    };

    this.lastTelemetry = telemetry;
    return telemetry;
  }

  /**
   * Advances thermal status for all motors over dtSeconds.
   */
  public stepThermal(dtSeconds: number): void {
    if (!this.lastTelemetry) return;
    for (let m = 0; m < this.motors.length; m++) {
      const current = this.lastTelemetry.motors[m]?.currentA ?? 0;
      this.motors[m].stepThermal(Math.abs(current), dtSeconds);
    }
  }

  public resetThermal(): void {
    for (const motor of this.motors) {
      motor.resetThermal();
    }
  }
}
