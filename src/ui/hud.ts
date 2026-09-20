/**
 * Simulation HUD Strip (Bottom, always visible)
 * Displays exactly 6 physical metrics at rest (monospace, unit-suffixed, accent colored):
 * 1. Thrust (cyan)
 * 2. Torque (amber)
 * 3. RPM (white)
 * 4. Bus V (white)
 * 5. Total Current (violet)
 * 6. Max Motor Temp (ruby)
 * (7. Optional Phase 5b torque ledger roll rate prediction)
 * Right: FPS, Frame ms, GPU ms, Current preset name
 *
 * Clicking any metric opens a 30s plot popover stripchart in the stage corner!
 */

export interface HudMetricsData {
  thrust_N: number;
  torque_Nm: number;
  rpm: number;
  bus_V: number;
  current_A: number;
  temp_C: number;
  rollRatePrediction_deg_m?: number;
  netThrustVector_N?: [number, number, number];
  netTorqueVector_Nm?: [number, number, number];
  perUnitTelemetry?: {
    id: string;
    thrust_N: number;
    torque_Nm: number;
    rpm: number;
    current_A: number;
    temp_C: number;
  }[];
  dT_dr?: { rOverR: number; dT: number }[];

  fps: number;
  frameMs: number;
  gpuMs: number;
  /** OverlaySystem.update() cost, EMA-smoothed (Directive 7 frame-budget gate). */
  overlayMs?: number;
  presetName: string;
}

export type MetricChannel = 'thrust' | 'torque' | 'rpm' | 'bus_v' | 'current' | 'temp' | 'roll';

interface PopoverChart {
  channel: MetricChannel;
  title: string;
  unit: string;
  color: string;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
}

export class SimHudStrip {
  private container: HTMLElement;
  private popoversContainer: HTMLElement;
  private activePopovers: Map<MetricChannel, PopoverChart> = new Map();

  // 30-second rolling history buffers (sampling at ~10 Hz = 300 points)
  private historyBuffers: Map<MetricChannel, number[]> = new Map();
  private maxHistorySamples = 300;
  private lastSampleTime = 0;
  private lastMetrics?: HudMetricsData;

  // Cached DOM elements
  private thrustEl!: HTMLElement;
  private torqueEl!: HTMLElement;
  private rpmEl!: HTMLElement;
  private busVEl!: HTMLElement;
  private currentEl!: HTMLElement;
  private tempEl!: HTMLElement;
  private rollEl!: HTMLElement;

  private fpsEl!: HTMLElement;
  private frameMsEl!: HTMLElement;
  private gpuMsEl!: HTMLElement;
  private presetEl!: HTMLElement;

  constructor(container: HTMLElement, popoversContainer: HTMLElement) {
    this.container = container;
    this.popoversContainer = popoversContainer;

    const channels: MetricChannel[] = ['thrust', 'torque', 'rpm', 'bus_v', 'current', 'temp', 'roll'];
    channels.forEach(ch => this.historyBuffers.set(ch, []));

    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="hud-left">
        <div class="hud-metric" data-channel="thrust" title="Click to view 30s Thrust stripchart">
          <span class="hud-metric-label">Thrust</span>
          <span class="hud-metric-val" id="hud-thrust-val">0.00 N</span>
        </div>

        <div class="hud-metric" data-channel="torque" title="Click to view 30s Torque stripchart">
          <span class="hud-metric-label">Torque</span>
          <span class="hud-metric-val" id="hud-torque-val">0.000 Nm</span>
        </div>

        <div class="hud-metric" data-channel="rpm" title="Click to view 30s RPM stripchart">
          <span class="hud-metric-label">RPM</span>
          <span class="hud-metric-val" id="hud-rpm-val">0 rpm</span>
        </div>

        <div class="hud-metric" data-channel="bus_v" title="Click to view 30s Bus Voltage stripchart">
          <span class="hud-metric-label">Bus V</span>
          <span class="hud-metric-val" id="hud-busv-val">12.0 V</span>
        </div>

        <div class="hud-metric" data-channel="current" title="Click to view 30s Current stripchart">
          <span class="hud-metric-label">Current</span>
          <span class="hud-metric-val" id="hud-current-val">0.00 A</span>
        </div>

        <div class="hud-metric" data-channel="temp" title="Click to view 30s Motor Temp stripchart">
          <span class="hud-metric-label">Temp</span>
          <span class="hud-metric-val" id="hud-temp-val">20.0 °C</span>
        </div>

        <div class="hud-metric" data-channel="roll" id="hud-roll-metric" title="Predicted net roll rate at 1 m/s (Torque Ledger prediction, not a measurement)">
          <span class="hud-metric-label">Pred Roll</span>
          <span class="hud-metric-val" id="hud-roll-val">1.8 °/m</span>
        </div>
      </div>

      <div class="hud-right">
        <div class="hud-perf-item">FPS: <span id="hud-fps-val">60.0</span></div>
        <div class="hud-perf-item">FRAME: <span id="hud-frame-ms-val">16.6 ms</span></div>
        <div class="hud-perf-item">GPU: <span id="hud-gpu-ms-val">0.0 ms</span></div>
        <div class="hud-perf-item">PRESET: <span id="hud-preset-val">Breakout</span></div>
      </div>
    `;

    this.thrustEl = this.container.querySelector('#hud-thrust-val') as HTMLElement;
    this.torqueEl = this.container.querySelector('#hud-torque-val') as HTMLElement;
    this.rpmEl = this.container.querySelector('#hud-rpm-val') as HTMLElement;
    this.busVEl = this.container.querySelector('#hud-busv-val') as HTMLElement;
    this.currentEl = this.container.querySelector('#hud-current-val') as HTMLElement;
    this.tempEl = this.container.querySelector('#hud-temp-val') as HTMLElement;
    this.rollEl = this.container.querySelector('#hud-roll-val') as HTMLElement;

    this.fpsEl = this.container.querySelector('#hud-fps-val') as HTMLElement;
    this.frameMsEl = this.container.querySelector('#hud-frame-ms-val') as HTMLElement;
    this.gpuMsEl = this.container.querySelector('#hud-gpu-ms-val') as HTMLElement;
    this.presetEl = this.container.querySelector('#hud-preset-val') as HTMLElement;

    // Attach click listeners to all metrics
    const metricElements = this.container.querySelectorAll('.hud-metric');
    metricElements.forEach((el) => {
      el.addEventListener('click', (e) => {
        const channel = (e.currentTarget as HTMLElement).dataset.channel as MetricChannel;
        this.togglePopover(channel);
      });
    });
  }

  public update(metrics: HudMetricsData, nowMs: number = performance.now()): void {
    if (this.thrustEl) {
      if (metrics.netThrustVector_N) {
        const [fx, fy, fz] = metrics.netThrustVector_N;
        this.thrustEl.textContent = `${metrics.thrust_N.toFixed(2)} N`;
        this.thrustEl.parentElement?.setAttribute(
          'title',
          `Net Thrust Vector: [Surge: ${fx.toFixed(2)} N, Sway: ${fy.toFixed(2)} N, Heave: ${fz.toFixed(2)} N]`
        );
      } else {
        this.thrustEl.textContent = `${metrics.thrust_N.toFixed(2)} N`;
      }
    }

    if (this.torqueEl) {
      if (metrics.netTorqueVector_Nm) {
        const [mx, my, mz] = metrics.netTorqueVector_Nm;
        this.torqueEl.textContent = `${metrics.torque_Nm.toFixed(3)} Nm`;
        this.torqueEl.parentElement?.setAttribute(
          'title',
          `Net Torque Vector: [Roll: ${mx.toFixed(4)} Nm, Pitch: ${my.toFixed(4)} Nm, Yaw: ${mz.toFixed(4)} Nm]`
        );
      } else {
        this.torqueEl.textContent = `${metrics.torque_Nm.toFixed(3)} Nm`;
      }
    }

    if (this.rpmEl) this.rpmEl.textContent = `${Math.round(metrics.rpm)} rpm`;
    if (this.busVEl) this.busVEl.textContent = `${metrics.bus_V.toFixed(2)} V`;
    if (this.currentEl) this.currentEl.textContent = `${metrics.current_A.toFixed(2)} A`;
    if (this.tempEl) this.tempEl.textContent = `${metrics.temp_C.toFixed(1)} °C`;

    // Directive 1: NaN roll rate means "at rest / no speed-anchored prediction"
    // — display an explicit em dash, never a silently 1 m/s-anchored number.
    if (metrics.rollRatePrediction_deg_m !== undefined) {
      if (this.rollEl) {
        const rr = metrics.rollRatePrediction_deg_m;
        this.rollEl.textContent = Number.isFinite(rr) ? `${rr.toFixed(1)} °/m` : '— °/m';
      }
    }

    if (this.fpsEl) this.fpsEl.textContent = metrics.fps.toFixed(1);
    if (this.frameMsEl) this.frameMsEl.textContent = `${metrics.frameMs.toFixed(1)} ms`;
    if (this.gpuMsEl) this.gpuMsEl.textContent = `${metrics.gpuMs.toFixed(1)} ms`;
    // Directive 7: overlay cost is rendered into the GPU cell as a suffix when
    // non-trivial, so the 60 fps acceptance can be watched live without new chrome.
    if (this.gpuMsEl && metrics.overlayMs !== undefined && metrics.overlayMs > 0.5) {
      this.gpuMsEl.textContent += ` (+${metrics.overlayMs.toFixed(1)} ov)`;
    }
    if (this.presetEl) this.presetEl.textContent = metrics.presetName;

    this.lastMetrics = metrics;

    // History sample every 100ms (10 Hz)
    if (nowMs - this.lastSampleTime >= 100) {
      this.lastSampleTime = nowMs;
      this.recordSample('thrust', metrics.thrust_N);
      this.recordSample('torque', metrics.torque_Nm);
      this.recordSample('rpm', metrics.rpm);
      this.recordSample('bus_v', metrics.bus_V);
      this.recordSample('current', metrics.current_A);
      this.recordSample('temp', metrics.temp_C);
      if (metrics.rollRatePrediction_deg_m !== undefined && Number.isFinite(metrics.rollRatePrediction_deg_m)) {
        this.recordSample('roll', metrics.rollRatePrediction_deg_m);
      }

      // Re-render open popover canvases
      this.activePopovers.forEach((popover) => {
        this.renderPopoverCanvas(popover);
      });
    }
  }

  private recordSample(channel: MetricChannel, value: number): void {
    const buf = this.historyBuffers.get(channel);
    if (buf) {
      buf.push(value);
      if (buf.length > this.maxHistorySamples) {
        buf.shift();
      }
    }
  }

  public togglePopover(channel: MetricChannel): void {
    if (this.activePopovers.has(channel)) {
      const p = this.activePopovers.get(channel)!;
      p.el.remove();
      this.activePopovers.delete(channel);
      return;
    }

    // Create new popover
    let title = 'Channel';
    let unit = '';
    let color = '#f0f6fc';

    switch (channel) {
      case 'thrust': title = 'Thrust Force'; unit = 'N'; color = '#00f2ff'; break;
      case 'torque': title = 'Torque'; unit = 'Nm'; color = '#f59e0b'; break;
      case 'rpm': title = 'Shaft Velocity'; unit = 'RPM'; color = '#f0f6fc'; break;
      case 'bus_v': title = 'Tether Bus Voltage'; unit = 'V'; color = '#f0f6fc'; break;
      case 'current': title = 'Tether Current'; unit = 'A'; color = '#a855f7'; break;
      case 'temp': title = 'Motor Temperature'; unit = '°C'; color = '#ef4444'; break;
      case 'roll': title = 'Predicted Roll Rate'; unit = '°/m'; color = '#f59e0b'; break;
    }

    const popoverEl = document.createElement('div');
    popoverEl.className = 'stripchart-popover';
    popoverEl.innerHTML = `
      <div class="stripchart-header">
        <span style="color:${color};">${title} (30s)</span>
        <button class="stripchart-close" title="Close stripchart">×</button>
      </div>
      <canvas class="stripchart-canvas" width="220" height="48"></canvas>
    `;

    popoverEl.querySelector('.stripchart-close')?.addEventListener('click', () => {
      popoverEl.remove();
      this.activePopovers.delete(channel);
    });

    const canvas = popoverEl.querySelector('canvas') as HTMLCanvasElement;
    this.popoversContainer.appendChild(popoverEl);

    const popoverObj: PopoverChart = { channel, title, unit, color, el: popoverEl, canvas };
    this.activePopovers.set(channel, popoverObj);
    this.renderPopoverCanvas(popoverObj);
  }

  private renderPopoverCanvas(p: PopoverChart): void {
    const ctx = p.canvas.getContext('2d');
    if (!ctx) return;

    const width = p.canvas.width;
    const height = p.canvas.height;
    ctx.clearRect(0, 0, width, height);

    const data = this.historyBuffers.get(p.channel) || [];
    if (data.length < 2) {
      ctx.fillStyle = '#484f58';
      ctx.font = '10px monospace';
      ctx.fillText('Accumulating telemetry...', 20, 28);
      return;
    }

    let min = Math.min(...data);
    let max = Math.max(...data);
    if (Math.abs(max - min) < 1e-4) {
      min -= 1;
      max += 1;
    }

    // Grid baseline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Data line
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
      const x = (i / (this.maxHistorySamples - 1)) * width;
      const norm = (data[i] - min) / (max - min);
      const y = height - (norm * (height - 6) + 3);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Current value badge
    const curVal = data[data.length - 1];
    ctx.fillStyle = p.color;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${curVal.toFixed(2)} ${p.unit}`, width - 4, 12);

    // Live radial dT/dr profile inset for thrust channel
    if (p.channel === 'thrust' && this.lastMetrics?.dT_dr && this.lastMetrics.dT_dr.length > 0) {
      const radial = this.lastMetrics.dT_dr;
      const rMax = Math.max(1e-4, ...radial.map(x => x.dT));
      const insetW = 55;
      const insetH = 26;
      const insetX = 6;
      const insetY = 4;

      ctx.fillStyle = 'rgba(10, 25, 40, 0.75)';
      ctx.fillRect(insetX, insetY, insetW, insetH);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.strokeRect(insetX, insetY, insetW, insetH);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '7px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('dT/dr', insetX + 2, insetY + 8);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < radial.length; i++) {
        const px = insetX + 2 + (i / (radial.length - 1)) * (insetW - 4);
        const py = insetY + insetH - 2 - (radial[i].dT / rMax) * (insetH - 12);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
}
