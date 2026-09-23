import type { FluidGrid } from './grid';

export type FluidRenderMode = 'DYE' | 'VORTICITY' | 'PRESSURE' | 'VELOCITY' | 'DIFF';

export class FluidRenderer2D {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  private imageData: ImageData;
  private pixelBuffer: Uint32Array;
  public mode: FluidRenderMode = 'DYE';

  constructor(canvas: HTMLCanvasElement, width = 1024, height = 512) {
    this.canvas = canvas;
    this.canvas.width = width;
    this.canvas.height = height;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Failed to acquire 2D context for fluid canvas overlay');
    }
    this.ctx = ctx;

    this.imageData = this.ctx.createImageData(width, height);
    this.pixelBuffer = new Uint32Array(this.imageData.data.buffer);
  }

  public resize(width: number, height: number): void {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.imageData = this.ctx.createImageData(width, height);
    this.pixelBuffer = new Uint32Array(this.imageData.data.buffer);
  }

  public render(grid: FluidGrid): void {
    const { size, dye, curl, pressure, u, v } = grid;
    const pixels = this.pixelBuffer;

    if (this.mode === 'DYE') {
      for (let i = 0; i < size; i++) {
        const d = Math.min(1.0, Math.max(0, dye[i]));
        if (d <= 0.001) {
          pixels[i] = 0x00000000;
          continue;
        }

        const r = Math.min(255, Math.floor(d * d * 220));
        const g = Math.min(255, Math.floor(d * 242));
        const b = Math.min(255, Math.floor(255 * Math.sqrt(d)));
        const a = Math.min(240, Math.floor(d * 240));

        pixels[i] = (a << 24) | (b << 16) | (g << 8) | r;
      }
    } else if (this.mode === 'VORTICITY') {
      for (let i = 0; i < size; i++) {
        const c = curl[i] * 0.15;
        const a = Math.min(220, Math.floor(Math.abs(c) * 255));
        if (a <= 5) {
          pixels[i] = 0x00000000;
          continue;
        }

        let r = 0, g = 0, b = 0;
        if (c > 0) {
          r = 0;
          g = Math.min(255, Math.floor(c * 200));
          b = Math.min(255, Math.floor(c * 255));
        } else {
          r = Math.min(255, Math.floor(-c * 255));
          g = Math.min(255, Math.floor(-c * 120));
          b = 0;
        }
        pixels[i] = (a << 24) | (b << 16) | (g << 8) | r;
      }
    } else if (this.mode === 'VELOCITY') {
      for (let i = 0; i < size; i++) {
        const speed = Math.hypot(u[i], v[i]) * 0.4;
        const s = Math.min(1.0, speed);
        const a = Math.min(220, Math.floor(s * 255));
        const r = Math.min(255, Math.floor(s * 255));
        const g = Math.min(255, Math.floor(s * 200));
        const b = Math.min(255, Math.floor((1.0 - s) * 255));
        pixels[i] = (a << 24) | (b << 16) | (g << 8) | r;
      }
    } else {
      for (let i = 0; i < size; i++) {
        const p = pressure[i] * 2.0;
        const normP = Math.min(1.0, Math.max(-1.0, p));
        const a = Math.min(200, Math.floor(Math.abs(normP) * 255));
        const r = normP > 0 ? Math.floor(normP * 255) : 0;
        const b = normP < 0 ? Math.floor(-normP * 255) : 0;
        pixels[i] = (a << 24) | (b << 16) | 0 | r;
      }
    }

    this.ctx.putImageData(this.imageData, 0, 0);
    this.renderDiagnosticOverlay(grid);
  }

  public renderDiff(gridA: FluidGrid, gridB: FluidGrid): void {
    const size = Math.min(gridA.size, gridB.size);
    const pixels = this.pixelBuffer;
    const dyeA = gridA.dye;
    const dyeB = gridB.dye;

    for (let i = 0; i < size; i++) {
      const diff = Math.abs(dyeA[i] - dyeB[i]) * 10.0;
      const d = Math.min(1.0, Math.max(0.0, diff));
      if (d <= 0.002) {
        pixels[i] = 0x00000000;
        continue;
      }
      const r = Math.min(255, Math.floor(d * 255));
      const g = Math.min(255, Math.floor(d * d * 180));
      const b = Math.min(255, Math.floor(d * 240));
      const a = Math.min(250, Math.floor(d * 250));
      pixels[i] = (a << 24) | (b << 16) | (g << 8) | r;
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }

  public sampleField(grid: FluidGrid, x: number, y: number, mode = this.mode): number {
    const cx = Math.max(0, Math.min(grid.width - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(grid.height - 1, Math.floor(y)));
    const idx = grid.idx(cx, cy);

    if (mode === 'DYE') return grid.dye[idx];
    if (mode === 'VORTICITY') return grid.curl[idx];
    if (mode === 'PRESSURE') return grid.pressure[idx];
    if (mode === 'VELOCITY') return Math.hypot(grid.u[idx], grid.v[idx]);
    return grid.dye[idx];
  }

  private renderDiagnosticOverlay(grid: FluidGrid): void {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.fillText !== 'function') return;

    try {
      const W = this.canvas.width;
      const H = this.canvas.height;

      ctx.save();
      ctx.font = '10px monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;

      ctx.strokeRect(10, 10, W - 20, H - 20);

      const xSteps = [0, Math.floor(grid.width * 0.25), Math.floor(grid.width * 0.5), Math.floor(grid.width * 0.75), grid.width];
      xSteps.forEach(gx => {
        const px = 10 + (gx / grid.width) * (W - 20);
        ctx.beginPath();
        ctx.moveTo(px, H - 10);
        ctx.lineTo(px, H - 5);
        ctx.stroke();
        ctx.fillText(`${gx}`, px - 6, H - 2);
      });

      const ySteps = [0, Math.floor(grid.height * 0.5), grid.height];
      ySteps.forEach(gy => {
        const py = (H - 10) - (gy / grid.height) * (H - 20);
        ctx.beginPath();
        ctx.moveTo(5, py);
        ctx.lineTo(10, py);
        ctx.stroke();
        ctx.fillText(`${gy}`, 1, py + 3);
      });

      const barX = W - 32;
      const barY = 20;
      const barW = 12;
      const barH = 100;

      ctx.strokeRect(barX, barY, barW, barH);
      ctx.fillText(this.mode, barX - 10, barY - 4);

      const grad = ctx.createLinearGradient(0, barY + barH, 0, barY);
      if (this.mode === 'DYE') {
        grad.addColorStop(0, 'rgba(3, 105, 161, 0.2)');
        grad.addColorStop(0.5, '#00f2ff');
        grad.addColorStop(1, '#ffffff');
        ctx.fillText('1.0', barX - 22, barY + 8);
        ctx.fillText('0.5', barX - 22, barY + barH * 0.5 + 4);
        ctx.fillText('0.0', barX - 22, barY + barH);
      } else if (this.mode === 'VELOCITY') {
        grad.addColorStop(0, '#0000ff');
        grad.addColorStop(0.5, '#00ffc8');
        grad.addColorStop(1, '#ff0000');
        ctx.fillText('2.5', barX - 22, barY + 8);
        ctx.fillText('1.2', barX - 22, barY + barH * 0.5 + 4);
        ctx.fillText('0.0', barX - 22, barY + barH);
      } else {
        grad.addColorStop(0, '#ff6600');
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        grad.addColorStop(1, '#00ccff');
        ctx.fillText('+max', barX - 28, barY + 8);
        ctx.fillText('0', barX - 12, barY + barH * 0.5 + 4);
        ctx.fillText('-max', barX - 28, barY + barH);
      }

      ctx.fillStyle = grad;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.restore();
    } catch {
      // Ignore canvas drawing failure in headless mock context
    }
  }
}
