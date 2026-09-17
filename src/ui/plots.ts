export interface PlotSample {
  thrustN: number;
  currentA: number;
  rpm: number;
  surgeSpeedMs: number;
}

export interface PlotConfig {
  maxSamples: number;
  thrustColor: string;
  currentColor: string;
  rpmColor: string;
  speedColor: string;
}

export const DEFAULT_PLOT_CONFIG: PlotConfig = {
  maxSamples: 120,
  thrustColor: '#10b981', // Neon green
  currentColor: '#fbbf24', // Amber
  rpmColor: '#38bdf8',    // Sky blue
  speedColor: '#00f2ff'   // Marine cyan
};

/**
 * Real-time canvas telemetry stripcharts (Phase 7).
 * Renders high-frequency scrolling waveforms for Thrust, Current, RPM, and Surge Speed.
 */
export class TelemetryPlots {
  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  public config: PlotConfig;

  private thrustBuffer: number[] = [];
  private currentBuffer: number[] = [];
  private rpmBuffer: number[] = [];
  private speedBuffer: number[] = [];

  constructor(canvas: HTMLCanvasElement, config: Partial<PlotConfig> = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = { ...DEFAULT_PLOT_CONFIG, ...config };
  }

  /**
   * Pushes a new telemetry sample into the circular buffer.
   */
  public pushSample(sample: PlotSample): void {
    this.thrustBuffer.push(sample.thrustN);
    this.currentBuffer.push(sample.currentA);
    this.rpmBuffer.push(sample.rpm);
    this.speedBuffer.push(sample.surgeSpeedMs);

    if (this.thrustBuffer.length > this.config.maxSamples) {
      this.thrustBuffer.shift();
      this.currentBuffer.shift();
      this.rpmBuffer.shift();
      this.speedBuffer.shift();
    }
  }

  /**
   * Renders the real-time stripchart to the canvas.
   */
  public render(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // 1. Clear background
    ctx.fillStyle = 'rgba(7, 15, 24, 0.88)';
    ctx.fillRect(0, 0, width, height);

    // 2. Draw subtle horizontal gridlines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    const gridRows = 4;
    for (let i = 1; i < gridRows; i++) {
      const y = (i / gridRows) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Zero-thrust line (middle)
    ctx.strokeStyle = 'rgba(0, 242, 255, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, height * 0.5);
    ctx.lineTo(width, height * 0.5);
    ctx.stroke();

    // 3. Draw Waveform Traces
    // Draw Thrust (-3N to +6N scale)
    this.drawChannel(this.thrustBuffer, -3.0, 6.0, this.config.thrustColor, 2);
    // Draw Current (0A to 3A scale)
    this.drawChannel(this.currentBuffer, 0.0, 3.0, this.config.currentColor, 1.5);
    // Draw Speed (-0.5 m/s to 1.5 m/s scale)
    this.drawChannel(this.speedBuffer, -0.5, 1.5, this.config.speedColor, 1.5);

    // 4. Draw Header / Legend
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';

    const latestT = this.thrustBuffer[this.thrustBuffer.length - 1] ?? 0;
    const latestI = this.currentBuffer[this.currentBuffer.length - 1] ?? 0;
    const latestV = this.speedBuffer[this.speedBuffer.length - 1] ?? 0;

    ctx.fillStyle = this.config.thrustColor;
    ctx.fillText(`T: ${latestT >= 0 ? '+' : ''}${latestT.toFixed(2)}N`, 10, 8);

    ctx.fillStyle = this.config.currentColor;
    ctx.fillText(`I: ${latestI.toFixed(2)}A`, 90, 8);

    ctx.fillStyle = this.config.speedColor;
    ctx.fillText(`V: ${latestV >= 0 ? '+' : ''}${latestV.toFixed(2)}m/s`, 160, 8);
  }

  private drawChannel(
    buffer: number[],
    minVal: number,
    maxVal: number,
    color: string,
    lineWidth: number
  ): void {
    if (!this.ctx || buffer.length < 2) return;
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const range = maxVal - minVal || 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    for (let i = 0; i < buffer.length; i++) {
      const x = (i / (this.config.maxSamples - 1)) * width;
      const normalized = (buffer[i] - minVal) / range;
      const y = height - Math.max(0, Math.min(height, normalized * height));

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  public clear(): void {
    this.thrustBuffer = [];
    this.currentBuffer = [];
    this.rpmBuffer = [];
    this.speedBuffer = [];
  }
}
