import type { HudMetricsData } from '../types/telemetry';

export class SimHudStrip {
  private thrustNumEl: HTMLElement;
  private torqueNumEl: HTMLElement;
  private rpmNumEl: HTMLElement;
  private rpmSuffixEl: HTMLElement;
  private inflowNumEl: HTMLElement;
  private jNumEl: HTMLElement;
  private machCellEl: HTMLElement;
  private machNumEl: HTMLElement;
  private fpsNumEl: HTMLElement;

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
            <span id="hud-rpm-suffix" class="hud-time-suffix" style="display: none;"></span>
          </span>
        </div>

        <div class="hud-stat-cell" title="Inflow Speed (m/s)">
          <span class="hud-hover-label">Inflow speed</span>
          <span class="hud-reading neutral-accent">
            <span id="hud-inflow-val">0.00</span><span class="hud-unit">m/s</span>
          </span>
        </div>

        <div class="hud-stat-cell" title="Advance Ratio J = V / (n * D)">
          <span class="hud-hover-label">Advance ratio J</span>
          <span class="hud-reading neutral-accent">
            <span id="hud-j-val">0.000</span>
          </span>
        </div>

        <div class="hud-stat-cell" id="hud-mach-cell" title="Tip Mach = V_tip / c_sound" style="display: none;">
          <span class="hud-hover-label">Tip Mach</span>
          <span class="hud-reading neutral-accent">
            <span id="hud-mach-val">0.000</span><span class="hud-unit">M</span>
          </span>
        </div>

        <div class="hud-stat-cell" title="Render Frame Rate">
          <span class="hud-hover-label">FPS</span>
          <span class="hud-reading neutral-accent">
            <span id="hud-fps-val">60</span><span class="hud-unit">FPS</span>
          </span>
        </div>
      </div>
    `;

    this.thrustNumEl = container.querySelector('#hud-thrust-val') as HTMLElement;
    this.torqueNumEl = container.querySelector('#hud-torque-val') as HTMLElement;
    this.rpmNumEl = container.querySelector('#hud-rpm-val') as HTMLElement;
    this.rpmSuffixEl = container.querySelector('#hud-rpm-suffix') as HTMLElement;
    this.inflowNumEl = container.querySelector('#hud-inflow-val') as HTMLElement;
    this.jNumEl = container.querySelector('#hud-j-val') as HTMLElement;
    this.machCellEl = container.querySelector('#hud-mach-cell') as HTMLElement;
    this.machNumEl = container.querySelector('#hud-mach-val') as HTMLElement;
    this.fpsNumEl = container.querySelector('#hud-fps-val') as HTMLElement;
  }

  public update(metrics: HudMetricsData, timeMs?: number): void {
    void timeMs;
    const thrustN = metrics.thrust_N;
    const torqueMnm = metrics.torque_Nm * 1000.0;
    const rpm = metrics.rpm;
    const inflow = metrics.inflow_velocity_ms;
    const j = metrics.advance_ratio_J;
    const mach = metrics.tip_mach ?? 0;
    const scale = metrics.timeScale ?? 1.0;
    const fps = metrics.fps;

    this.thrustNumEl.textContent = thrustN.toFixed(2);
    this.torqueNumEl.textContent = torqueMnm.toFixed(1);
    this.rpmNumEl.textContent = Math.round(rpm).toString();

    if (Math.abs(scale - 1.0) > 1e-4) {
      this.rpmSuffixEl.style.display = 'inline';
      this.rpmSuffixEl.textContent = `×${scale.toString()}`;
    } else {
      this.rpmSuffixEl.style.display = 'none';
    }

    this.inflowNumEl.textContent = inflow.toFixed(2);
    this.jNumEl.textContent = Number.isFinite(j) ? j.toFixed(3) : '0.000';

    if (scale < 0.5) {
      this.machCellEl.style.display = 'flex';
      this.machNumEl.textContent = mach.toFixed(3);
    } else {
      this.machCellEl.style.display = 'none';
    }

    this.fpsNumEl.textContent = Math.round(fps).toString();
  }
}
