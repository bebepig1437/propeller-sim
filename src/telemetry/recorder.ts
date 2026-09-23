export interface ThrusterSample {
  rpm: number;
  pitchDeg: number;
  thrustN: number;
  torqueNm: number;
  currentA: number;
  vTermV: number;
  tMotorC: number;
}

export interface TelemetrySample {
  t: number;
  dt: number;
  fps: number;

  thrusters: ThrusterSample[];

  busV: number;
  iTotalA: number;
  pTotalW: number;

  pos: [number, number, number];
  vel: [number, number, number];
  quat: [number, number, number, number];
  omega: [number, number, number];
  rollDevPerM: number;

  fluidMaxV: number;
  fluidMeanV: number;
  fluidMaxVorticity: number;

  pressureIters: number;
  residual: number;
  gpuMs: number;
  sourcesMs?: number;
  curlMs?: number;
  vorticityMs?: number;
  advectMs?: number;
  divergenceMs?: number;
  pressureMs?: number;
  projectMs?: number;
}

export class TelemetryRecorder {
  private records: TelemetrySample[] = [];
  private isRecording = false;
  private maxCapacity: number;

  constructor(maxCapacity = 10000) {
    this.maxCapacity = maxCapacity;
  }

  public start(): void {
    this.isRecording = true;
  }

  public stop(): void {
    this.isRecording = false;
  }

  public reset(): void {
    this.records = [];
  }

  public isActive(): boolean {
    return this.isRecording;
  }

  public record(sample: TelemetrySample): void {
    if (!this.isRecording) return;
    this.records.push(sample);
    if (this.records.length > this.maxCapacity) {
      this.records.shift();
    }
  }

  public getCount(): number {
    return this.records.length;
  }

  public getLatest(): TelemetrySample | undefined {
    return this.records[this.records.length - 1];
  }

  public generateCsv(): string {
    const numThrusters = this.records.length > 0 ? this.records[0].thrusters.length : 3;

    const headers: string[] = ['t_s', 'dt_s', 'fps'];

    for (let i = 0; i < numThrusters; i++) {
      headers.push(
        `u${i}_rpm`,
        `u${i}_pitch_deg`,
        `u${i}_thrust_N`,
        `u${i}_torque_Nm`,
        `u${i}_current_A`,
        `u${i}_vterm_V`,
        `u${i}_tmotor_C`
      );
    }

    headers.push(
      'v_bus_V',
      'i_total_A',
      'p_total_W',
      'pos_x_m',
      'pos_y_m',
      'pos_z_m',
      'vel_x_ms',
      'vel_y_ms',
      'vel_z_ms',
      'quat_w',
      'quat_x',
      'quat_y',
      'quat_z',
      'omega_p_rads',
      'omega_q_rads',
      'omega_r_rads',
      'roll_dev_deg_per_m',
      'fluid_max_v_ms',
      'fluid_mean_v_ms',
      'fluid_max_vorticity_s',
      'pressure_iters',
      'pressure_residual',
      'gpu_total_ms',
      'sources_ms',
      'curl_ms',
      'vorticity_ms',
      'advect_ms',
      'divergence_ms',
      'pressure_ms',
      'project_ms'
    );

    const rows: string[] = [headers.join(',')];

    for (const r of this.records) {
      const row: (string | number)[] = [
        r.t.toFixed(6),
        r.dt.toFixed(5),
        r.fps.toFixed(1)
      ];

      for (let i = 0; i < numThrusters; i++) {
        const u = r.thrusters[i] || {
          rpm: 0,
          pitchDeg: 0,
          thrustN: 0,
          torqueNm: 0,
          currentA: 0,
          vTermV: 0,
          tMotorC: 20
        };
        row.push(
          u.rpm.toFixed(1),
          u.pitchDeg.toFixed(2),
          u.thrustN.toFixed(4),
          u.torqueNm.toFixed(5),
          u.currentA.toFixed(3),
          u.vTermV.toFixed(2),
          u.tMotorC.toFixed(1)
        );
      }

      row.push(
        r.busV.toFixed(2),
        r.iTotalA.toFixed(3),
        r.pTotalW.toFixed(2),
        r.pos[0].toFixed(4),
        r.pos[1].toFixed(4),
        r.pos[2].toFixed(4),
        r.vel[0].toFixed(4),
        r.vel[1].toFixed(4),
        r.vel[2].toFixed(4),
        r.quat[0].toFixed(5),
        r.quat[1].toFixed(5),
        r.quat[2].toFixed(5),
        r.quat[3].toFixed(5),
        r.omega[0].toFixed(4),
        r.omega[1].toFixed(4),
        r.omega[2].toFixed(4),
        Number.isFinite(r.rollDevPerM) ? r.rollDevPerM.toFixed(2) : 'NaN',
        r.fluidMaxV.toFixed(3),
        r.fluidMeanV.toFixed(3),
        r.fluidMaxVorticity.toFixed(3),
        r.pressureIters,
        r.residual.toExponential(3),
        r.gpuMs.toFixed(2),
        (r.sourcesMs ?? 0).toFixed(2),
        (r.curlMs ?? 0).toFixed(2),
        (r.vorticityMs ?? 0).toFixed(2),
        (r.advectMs ?? 0).toFixed(2),
        (r.divergenceMs ?? 0).toFixed(2),
        (r.pressureMs ?? 0).toFixed(2),
        (r.projectMs ?? 0).toFixed(2)
      );

      rows.push(row.join(','));
    }

    return rows.join('\n');
  }

  public downloadCsv(filename = `propeller_sim_telemetry_${Date.now()}.csv`): void {
    const csv = this.generateCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
