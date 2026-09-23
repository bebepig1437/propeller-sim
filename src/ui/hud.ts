import { HudMetricsData } from '../types/telemetry';
export { type HudMetricsData } from '../types/telemetry';

export type MetricChannel =
  | 'thrust'
  | 'torque'
  | 'power'
  | 'efficiency'
  | 'advance_ratio'
  | 'rpm'
  | 'pitch'
  | 'inflow'
  | 'max_v'
  | 'bus_v'
  | 'current'
  | 'temp'
  | 'roll'
  | 'fps';

interface PopoverChart {
  channel: MetricChannel;
  title: string;
  unit: string;
  color: string;
  pinned: boolean;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
}

export class SimHudStrip {
  private container: HTMLElement;
  private popoversContainer: HTMLElement;
  private activePopovers: Map<MetricChannel, PopoverChart> = new Map();

  private historyBuffers: Map<MetricChannel, number[]> = new Map();
  private maxHistorySamples = 300;
  private lastSampleTime = 0;
  private lastMetrics?: HudMetricsData;

  private thrustEl!: HTMLElement;
  private torqueEl!: HTMLElement;
  private powerEl!: HTMLElement;
  private efficiencyEl!: HTMLElement;
  private advanceRatioEl!: HTMLElement;
  private rpmEl!: HTMLElement;
  private pitchEl!: HTMLElement;
  private inflowEl!: HTMLElement;
  private maxVEl!: HTMLElement;

  private busVEl!: HTMLElement;
  private currentEl!: HTMLElement;
  private tempEl!: HTMLElement;
  private rollEl!: HTMLElement;

  private fpsEl!: HTMLElement;
  private scaleEl!: HTMLElement;
  private gpuMsEl!: HTMLElement;
  private readbackEl!: HTMLElement;
  private tierItemEl!: HTMLElement;
  private tierEl!: HTMLElement;
  private presetEl!: HTMLElement;
  private burstTimerEl!: HTMLElement;
  private specStatusEl!: HTMLElement;

  constructor(container: HTMLElement, popoversContainer: HTMLElement) {
    this.container = container;
    this.popoversContainer = popoversContainer;

    const channels: MetricChannel[] = [
      'thrust',
      'torque',
      'power',
      'efficiency',
      'advance_ratio',
      'rpm',
      'pitch',
      'inflow',
      'max_v',
      'bus_v',
      'current',
      'temp',
      'roll'
    ];
    channels.forEach(ch => this.historyBuffers.set(ch, []));

    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="hud-strip">
        <div class="hud-item hud-metric hud-accent-thrust" data-channel="thrust" title="Thrust (N)">
          <output class="hud-metric-val" id="hud-thrust-val" aria-live="polite">0.00 N</output>
        </div>

        <div class="hud-item hud-metric hud-accent-torque" data-channel="torque" title="Torque (mN·m)">
          <output class="hud-metric-val" id="hud-torque-val" aria-live="polite">0.000 Nm</output>
        </div>

        <div class="hud-item hud-metric hud-accent-neutral" data-channel="rpm" title="RPM">
          <output class="hud-metric-val" id="hud-rpm-val" aria-live="polite">0 rpm</output>
        </div>

        <div class="hud-item hud-metric hud-accent-neutral" data-channel="bus_v" title="Bus voltage (V)">
          <output class="hud-metric-val" id="hud-busv-val" aria-live="polite">12.0 V</output>
        </div>

        <div class="hud-item hud-metric hud-accent-current" data-channel="current" title="Total current (A)">
          <output class="hud-metric-val" id="hud-current-val" aria-live="polite">0.00 A</output>
        </div>

        <div class="hud-item hud-metric hud-accent-heat" data-channel="temp" title="Max motor temperature (°C)">
          <output class="hud-metric-val" id="hud-temp-val" aria-live="polite">20.0 °C</output>
        </div>

        <div class="hud-item hud-fps-metric hud-accent-neutral" data-channel="fps" title="Frame rate (FPS)">
          <output class="hud-metric-val" id="hud-fps-val" aria-live="polite">60.0</output>
        </div>
      </div>

      <div class="hud-metric-secondary" style="display:none !important">
        <output class="hud-metric-val" id="hud-power-val">0.0 W</output>
        <output class="hud-metric-val" id="hud-efficiency-val">0.0 %</output>
        <output class="hud-metric-val" id="hud-advance-val">0.00</output>
        <output class="hud-metric-val" id="hud-pitch-val">0.0°</output>
        <output class="hud-metric-val" id="hud-inflow-val">0.00 m/s</output>
        <output class="hud-metric-val" id="hud-maxv-val">0.00 m/s</output>
        <output class="hud-metric-val" id="hud-roll-val">1.8 °/m</output>
        <span id="hud-burst-val">18.0 s</span>
        <div id="hud-spec-status">WITHIN SPEC</div>
        <span id="hud-scale-val">1.00×</span>
        <span id="hud-gpu-ms-val">0.0 ms</span>
        <span id="hud-readback-val">0.0 ms</span>
        <div id="hud-tier-item" style="display:none"><span id="hud-tier-val">WebGPU</span></div>
        <span id="hud-preset-val">Breakout</span>
      </div>
    `;

    this.thrustEl = this.container.querySelector('#hud-thrust-val') as HTMLElement;
    this.torqueEl = this.container.querySelector('#hud-torque-val') as HTMLElement;
    this.powerEl = this.container.querySelector('#hud-power-val') as HTMLElement;
    this.efficiencyEl = this.container.querySelector('#hud-efficiency-val') as HTMLElement;
    this.advanceRatioEl = this.container.querySelector('#hud-advance-val') as HTMLElement;
    this.rpmEl = this.container.querySelector('#hud-rpm-val') as HTMLElement;
    this.pitchEl = this.container.querySelector('#hud-pitch-val') as HTMLElement;
    this.inflowEl = this.container.querySelector('#hud-inflow-val') as HTMLElement;
    this.maxVEl = this.container.querySelector('#hud-maxv-val') as HTMLElement;

    this.busVEl = this.container.querySelector('#hud-busv-val') as HTMLElement;
    this.currentEl = this.container.querySelector('#hud-current-val') as HTMLElement;
    this.tempEl = this.container.querySelector('#hud-temp-val') as HTMLElement;
    this.rollEl = this.container.querySelector('#hud-roll-val') as HTMLElement;

    this.fpsEl = this.container.querySelector('#hud-fps-val') as HTMLElement;
    this.scaleEl = this.container.querySelector('#hud-scale-val') as HTMLElement;
    this.gpuMsEl = this.container.querySelector('#hud-gpu-ms-val') as HTMLElement;
    this.readbackEl = this.container.querySelector('#hud-readback-val') as HTMLElement;
    this.tierItemEl = this.container.querySelector('#hud-tier-item') as HTMLElement;
    this.tierEl = this.container.querySelector('#hud-tier-val') as HTMLElement;
    this.presetEl = this.container.querySelector('#hud-preset-val') as HTMLElement;
    this.burstTimerEl = this.container.querySelector('#hud-burst-val') as HTMLElement;
    this.specStatusEl = this.container.querySelector('#hud-spec-status') as HTMLElement;

    const items = this.container.querySelectorAll('.hud-item');
    items.forEach((el) => {
      el.addEventListener('click', (e) => {
        const channel = (e.currentTarget as HTMLElement).dataset.channel as MetricChannel;
        if (channel) this.togglePopover(channel);
      });
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeAllPopovers();
        }
      });
      document.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (this.activePopovers.size === 0) return;
        const insidePopover = target.closest('.stripchart-popover');
        const insideItem = target.closest('.hud-item');
        if (!insidePopover && !insideItem) {
          this.closeAllPopovers();
        }
      });
    }
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

    if (this.powerEl) this.powerEl.textContent = `${(metrics.power_W ?? 0).toFixed(1)} W`;
    if (this.efficiencyEl) this.efficiencyEl.textContent = `${(metrics.efficiency_pct ?? 0).toFixed(1)} %`;
    if (this.advanceRatioEl) this.advanceRatioEl.textContent = (metrics.advance_ratio_J ?? 0).toFixed(2);
    if (this.rpmEl) this.rpmEl.textContent = `${Math.round(metrics.rpm)} rpm`;
    if (this.pitchEl) this.pitchEl.textContent = `${(metrics.pitch_deg ?? 0).toFixed(1)}°`;
    if (this.inflowEl) this.inflowEl.textContent = `${(metrics.inflow_velocity_ms ?? 0).toFixed(2)} m/s`;
    if (this.maxVEl) this.maxVEl.textContent = `${(metrics.max_velocity_domain_ms ?? 0).toFixed(2)} m/s`;

    if (this.busVEl) this.busVEl.textContent = `${metrics.bus_V.toFixed(2)} V`;
    if (this.currentEl) this.currentEl.textContent = `${metrics.current_A.toFixed(2)} A`;
    if (this.tempEl) this.tempEl.textContent = `${metrics.temp_C.toFixed(1)} °C`;

    if (metrics.rollRatePrediction_deg_m !== undefined) {
      if (this.rollEl) {
        const rr = metrics.rollRatePrediction_deg_m;
        this.rollEl.textContent = Number.isFinite(rr) ? `${rr.toFixed(1)} °/m` : '— °/m';
      }
    }

    if (this.fpsEl) this.fpsEl.textContent = metrics.fps.toFixed(1);
    if (this.scaleEl) {
      const scale = metrics.resolutionScale ?? 1.0;
      this.scaleEl.textContent = scale.toFixed(2) + "×";
    }
    if (this.gpuMsEl) {
      const gpuMs = metrics.gpuMs ?? 0.0;
      this.gpuMsEl.textContent = `${gpuMs.toFixed(1)} ms`;
      if (metrics.overlayMs !== undefined && metrics.overlayMs > 0.5) {
        this.gpuMsEl.textContent += ` (+${metrics.overlayMs.toFixed(1)} ov)`;
      }
    }
    if (this.readbackEl) {
      const rb = metrics.readbackLatencyMs ?? 0.0;
      this.readbackEl.textContent = rb.toFixed(1) + " ms";
    }

    if (this.tierItemEl && this.tierEl) {
      const tier = metrics.renderTier ?? 'WebGPU';
      const degraded = tier !== 'WebGPU';
      this.tierItemEl.style.display = degraded ? '' : 'none';
      this.tierEl.textContent = tier;
      this.tierItemEl.style.color = tier === 'CPU' ? '#ef4444' : '#f59e0b';
    }

    if (this.presetEl) this.presetEl.textContent = metrics.presetName;

    if (this.burstTimerEl) {
      if (metrics.thermalBurstRemainingS === null) {
        this.burstTimerEl.textContent = '∞ (Unlimited)';
        this.burstTimerEl.style.color = '#38bdf8';
      } else {
        const rem = Math.max(0, metrics.thermalBurstRemainingS);
        this.burstTimerEl.textContent = `${rem.toFixed(1)} s`;
        if (rem <= 0) {
          this.burstTimerEl.style.color = '#ef4444';
          this.burstTimerEl.textContent = 'EXPIRED (0.0s)';
        } else if (rem <= 5.0) {
          this.burstTimerEl.style.color = '#f59e0b';
        } else {
          this.burstTimerEl.style.color = '#00f2ff';
        }
      }
    }

    if (this.specStatusEl) {
      this.specStatusEl.className = `hud-spec-badge status-${metrics.specStatus ?? 'within_spec'}`;
      this.specStatusEl.textContent = metrics.specStatusLabel ?? 'WITHIN SPEC';
    }

    this.lastMetrics = metrics;

    if (nowMs - this.lastSampleTime >= 100) {
      this.lastSampleTime = nowMs;
      this.recordSample('thrust', metrics.thrust_N);
      this.recordSample('torque', metrics.torque_Nm);
      this.recordSample('power', metrics.power_W);
      this.recordSample('efficiency', metrics.efficiency_pct);
      this.recordSample('advance_ratio', metrics.advance_ratio_J);
      this.recordSample('rpm', metrics.rpm);
      this.recordSample('pitch', metrics.pitch_deg);
      this.recordSample('inflow', metrics.inflow_velocity_ms);
      this.recordSample('max_v', metrics.max_velocity_domain_ms);
      this.recordSample('bus_v', metrics.bus_V);
      this.recordSample('current', metrics.current_A);
      this.recordSample('temp', metrics.temp_C);
      if (metrics.rollRatePrediction_deg_m !== undefined && Number.isFinite(metrics.rollRatePrediction_deg_m)) {
        this.recordSample('roll', metrics.rollRatePrediction_deg_m);
      }
      this.recordSample('fps', metrics.fps);

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

  public closeAllPopovers(): void {
    this.activePopovers.forEach((p) => p.el.remove());
    this.activePopovers.clear();
  }

  public togglePopover(channel: MetricChannel): void {
    const existing = this.activePopovers.get(channel);
    if (existing) {
      existing.el.remove();
      this.activePopovers.delete(channel);
      return;
    }
    this.closeAllPopovers();

    let title = 'Channel';
    let unit = '';
    let color = '#f0f6fc';

    switch (channel) {
      case 'thrust': title = 'Thrust'; unit = 'N'; color = '#ff7700'; break;
      case 'torque': title = 'Torque'; unit = 'mN·m'; color = '#d946ef'; break;
      case 'power': title = 'Power'; unit = 'W'; color = '#a855f7'; break;
      case 'efficiency': title = 'Efficiency'; unit = '%'; color = '#10b981'; break;
      case 'advance_ratio': title = 'Advance Ratio (J)'; unit = ''; color = '#38bdf8'; break;
      case 'rpm': title = 'RPM'; unit = 'rpm'; color = '#f0f6fc'; break;
      case 'pitch': title = 'Blade Pitch'; unit = '°'; color = '#f97316'; break;
      case 'inflow': title = 'Inflow Va'; unit = 'm/s'; color = '#14b8a6'; break;
      case 'max_v': title = 'Max Velocity'; unit = 'm/s'; color = '#06b6d4'; break;
      case 'bus_v': title = 'Bus Voltage'; unit = 'V'; color = '#f0f6fc'; break;
      case 'current': title = 'Total Current'; unit = 'A'; color = '#00f2ff'; break;
      case 'temp': title = 'Max Temperature'; unit = '°C'; color = '#ef4444'; break;
      case 'roll': title = 'Predicted Roll'; unit = '°/m'; color = '#fbbf24'; break;
      case 'fps': title = 'Frame Rate'; unit = 'fps'; color = '#f0f6fc'; break;
    }

    const popoverEl = document.createElement('div');
    popoverEl.className = 'stripchart-popover';
    popoverEl.innerHTML = `
      <div class="stripchart-header">
        <span class="stripchart-title" style="color:${color}; font-family:var(--font-mono, monospace);">${title} (30s)</span>
        <div class="stripchart-actions">
          <button class="stripchart-close" title="Close stripchart">×</button>
        </div>
      </div>
      <canvas class="stripchart-canvas" width="240" height="54"></canvas>
    `;

    const pinBtn = popoverEl.querySelector('.stripchart-pin') as HTMLButtonElement | null;
    if (pinBtn) {
      pinBtn.addEventListener('click', () => {
        const p = this.activePopovers.get(channel);
        if (p) {
          p.pinned = !p.pinned;
          if (p.pinned) pinBtn.classList.add('is-pinned'); else pinBtn.classList.remove('is-pinned');
        }
      });
    }

    popoverEl.querySelector('.stripchart-close')?.addEventListener('click', () => {
      popoverEl.remove();
      this.activePopovers.delete(channel);
    });

    const canvas = popoverEl.querySelector('canvas') as HTMLCanvasElement;
    this.popoversContainer.appendChild(popoverEl);

    const popoverObj: PopoverChart = { channel, title, unit, color, pinned: false, el: popoverEl, canvas };
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
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.fillText('Accumulating telemetry...', 20, 30);
      return;
    }

    let min = Math.min(...data);
    let max = Math.max(...data);
    if (Math.abs(max - min) < 1e-4) {
      min -= 1;
      max += 1;
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
      const x = (i / (this.maxHistorySamples - 1)) * width;
      const norm = (data[i] - min) / (max - min);
      const y = height - (norm * (height - 8) + 4);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    const curVal = data[data.length - 1];
    ctx.fillStyle = p.color;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${curVal.toFixed(2)} ${p.unit}`, width - 6, 13);

    if (p.channel === 'thrust' && this.lastMetrics?.dT_dr && this.lastMetrics.dT_dr.length > 0) {
      const radial = this.lastMetrics.dT_dr;
      const rMax = Math.max(1e-4, ...radial.map(x => x.dT));
      const insetW = 55;
      const insetH = 26;
      const insetX = 6;
      const insetY = 4;

      ctx.fillStyle = 'rgba(10, 25, 40, 0.85)';
      ctx.fillRect(insetX, insetY, insetW, insetH);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.strokeRect(insetX, insetY, insetW, insetH);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
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

export type DebugHudChannelId = 'ledger.qNet' | 'integrator.appliedTorque';

export interface DebugHudChannel {
  id: DebugHudChannelId;
  read: () => number;
}

const debugChannelValues: Record<DebugHudChannelId, number> = {
  'ledger.qNet': 0.0,
  'integrator.appliedTorque': 0.0
};

export function updateDebugHudValues(values: Partial<Record<DebugHudChannelId, number>>): void {
  Object.assign(debugChannelValues, values);
}

export function getDebugHudChannels(): Array<DebugHudChannel> {
  return [
    { id: 'ledger.qNet', read: () => debugChannelValues['ledger.qNet'] },
    { id: 'integrator.appliedTorque', read: () => debugChannelValues['integrator.appliedTorque'] }
  ];
}
