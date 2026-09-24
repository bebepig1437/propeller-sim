import type { HudMetricsData } from '../types/telemetry';

export class SimHudStrip {
  private thrustNumEl: HTMLElement;
  private torqueNumEl: HTMLElement;
  private rpmNumEl: HTMLElement;
  private inflowNumEl: HTMLElement;

  constructor(container: HTMLElement) {
    container.innerHTML = `
      <div class="hud-strip-inner">
        <div class="hud-stat-cell" title="Thrust (N)">
          <span class="hud-hover-label">Thrust</span>
          <span class="hud-reading thrust-accent">
            <span id="hud-thrust-val">0.00</span><span class="hud-unit">N</span>
          </span>
        </div>

        <div class="hud-stat-cell" title="Torque (mN·m)">
          <span class="hud-hover-label">Torque</span>
          <span class="hud-reading torque-accent">
            <span id="hud-torque-val">0.0</span><span class="hud-unit">mN·m</span>
          </span>
        </div>

        <div class="hud-stat-cell" title="Shaft Speed (RPM)">
          <span class="hud-hover-label">RPM</span>
          <span class="hud-reading neutral-accent">
            <span id="hud-rpm-val">0</span><span class="hud-unit">RPM</span>
          </span>
        </div>

        <div class="hud-stat-cell" title="Inflow Speed (m/s)">
          <span class="hud-hover-label">Inflow speed</span>
          <span class="hud-reading neutral-accent">
            <span id="hud-inflow-val">0.00</span><span class="hud-unit">m/s</span>
          </span>
        </div>
      </div>
    `;

    this.thrustNumEl = container.querySelector('#hud-thrust-val') as HTMLElement;
    this.torqueNumEl = container.querySelector('#hud-torque-val') as HTMLElement;
    this.rpmNumEl = container.querySelector('#hud-rpm-val') as HTMLElement;
    this.inflowNumEl = container.querySelector('#hud-inflow-val') as HTMLElement;
  }

  public update(metrics: HudMetricsData, timeMs?: number): void {
    void timeMs;
    const thrustN = metrics.thrust_N;
    const torqueMnm = metrics.torque_Nm * 1000.0;
    const rpm = metrics.rpm;
    const inflow = metrics.inflow_velocity_ms;

    this.thrustNumEl.textContent = thrustN.toFixed(2);
    this.torqueNumEl.textContent = torqueMnm.toFixed(1);
    this.rpmNumEl.textContent = Math.round(rpm).toString();
    this.inflowNumEl.textContent = inflow.toFixed(2);
  }
}
