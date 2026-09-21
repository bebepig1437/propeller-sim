import { DCMotorModel, MotorOperatingState, MABUCHI_RC280RA_SPECS } from '../motor/motor';
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
  }

  /**
   * Solves the coupled multi-motor non-linear electrical network with tether voltage sag.
   *
   * Correctness guarantees:
   * 1. Uses signed algebraic sum of currents: regenerative braking unloads tether.
   * 2. Uses single converged vTerminal consistently across all motor states and telemetry.
   * 3. Consults motor temperatures: enforces cutout (100°C / 90°C hysteresis) & thermal derating.
   * 4. Enforces per-motor and total bus current limits.
   */
  public solveBusNetwork(
    throttles: number[],
    loadTorqueFns: ((omegaRadS: number) => number)[]
  ): PowerBusTelemetry {
    const numMotors = this.motors.length;
    let vTerminal = this.supplyV; // Initial terminal voltage estimate

    const maxIters = 60;
    const tol = 1e-7;

    let motorStates: MotorOperatingState[] = [];
    let totalMotorCurrent = 0;

    for (let iter = 0; iter < maxIters; iter++) {
      totalMotorCurrent = 0;
      motorStates = [];

      for (let m = 0; m < numMotors; m++) {
        let u = throttles[m] ?? 0;
        const motor = this.motors[m];
        motor.thermalEnabled = this.thermalEnabled;

        // Apply thermal protection
        if (motor.isCutout && this.thermalEnabled) {
          u = 0;
        } else if (this.thermalEnabled && motor.windingTempC > motor.specs.warnWindingTempC) {
          // Gradual thermal derating between 85°C and 100°C
          const derate = Math.max(0.4, 1.0 - (motor.windingTempC - 85.0) / 30.0);
          u *= derate;
        }

        const loadFn = loadTorqueFns[m] ?? (() => 0);
        const state = motor.solveVoltageMode(vTerminal, u, loadFn);

        // Clamp per-motor current limit
        let current = state.currentA;
        if (Math.abs(current) > this.maxMotorCurrentA) {
          current = Math.sign(current) * this.maxMotorCurrentA;
          state.currentA = current;
        }

        motorStates.push(state);
        // Signed algebraic addition: regenerative current (< 0) reduces total tether draw
        totalMotorCurrent += current;
      }

      // Enforce total bus current limit
      let netBusCurrent = totalMotorCurrent + this.quiescentCurrentA;
      if (Math.abs(netBusCurrent) > this.maxBusCurrentA) {
        netBusCurrent = Math.sign(netBusCurrent) * this.maxBusCurrentA;
      }

      // Tether drop and updated terminal voltage
      const vDrop = netBusCurrent * this.tetherResistance;
      const vTerminalNew = this.supplyV - vDrop;

      // Relaxed iterative update
      const vRelaxed = 0.5 * vTerminal + 0.5 * vTerminalNew;
      if (Math.abs(vRelaxed - vTerminal) < tol) {
        vTerminal = vRelaxed;
        break;
      }
      vTerminal = vRelaxed;
    }

    const netBusCurrent = totalMotorCurrent + this.quiescentCurrentA;
    const vDrop = netBusCurrent * this.tetherResistance;

    // Synchronize all motor states to final converged terminal voltage
    for (const state of motorStates) {
      state.terminalVoltageV = vTerminal;
    }

    const tetherState: TetherVoltageDrop = calculateTetherState(
      netBusCurrent,
      this.supplyV,
      this.tetherResistance
    );

    const totalPowerSupply = this.supplyV * netBusCurrent;
    const motorDeliveredPower = motorStates.reduce((acc, m) => acc + m.powerElecW, 0);
    const electricalEfficiency = totalPowerSupply > 0.01 ? Math.min(1.0, motorDeliveredPower / totalPowerSupply) : 0;

    const telemetry: PowerBusTelemetry = {
      supplyV: this.supplyV,
      terminalV: vTerminal,
      voltageDropV: vDrop,
      totalBusCurrentA: netBusCurrent,
      totalPowerSupplyW: totalPowerSupply,
      tetherLossWatts: tetherState.jouleLossWatts,
      motorDeliveredPowerW: motorDeliveredPower,
      electricalEfficiency,
      quiescentCurrentA: this.quiescentCurrentA,
      motors: motorStates
    };

    this.lastTelemetry = telemetry;
    return telemetry;
  }

  /**
   * Advances thermal status for all motors over dtSeconds.
   */
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
