export interface GridOptions {
  width?: number;
  height?: number;
  dx?: number;
}

export class FluidGrid {
  public readonly width: number;
  public readonly height: number;
  public readonly size: number;
  public readonly dx: number;
  public readonly invDx: number;

  // Velocity buffers
  public u: Float32Array;
  public uPrev: Float32Array;
  public v: Float32Array;
  public vPrev: Float32Array;

  // Pressure & Divergence buffers
  public pressure: Float32Array;
  public pressurePrev: Float32Array;
  public div: Float32Array;

  // Scalar Dye tracer
  public dye: Float32Array;
  public dyePrev: Float32Array;

  // Vorticity / Curl buffer
  public curl: Float32Array;

  constructor(options?: GridOptions) {
    this.width = options?.width ?? 256;
    this.height = options?.height ?? 128;
    this.dx = options?.dx ?? 1.0;
    this.invDx = 1.0 / this.dx;
    this.size = this.width * this.height;

    this.u = new Float32Array(this.size);
    this.uPrev = new Float32Array(this.size);
    this.v = new Float32Array(this.size);
    this.vPrev = new Float32Array(this.size);

    this.pressure = new Float32Array(this.size);
    this.pressurePrev = new Float32Array(this.size);
    this.div = new Float32Array(this.size);

    this.dye = new Float32Array(this.size);
    this.dyePrev = new Float32Array(this.size);

    this.curl = new Float32Array(this.size);
  }

  public reset(): void {
    this.u.fill(0);
    this.uPrev.fill(0);
    this.v.fill(0);
    this.vPrev.fill(0);
    this.pressure.fill(0);
    this.pressurePrev.fill(0);
    this.div.fill(0);
    this.dye.fill(0);
    this.dyePrev.fill(0);
    this.curl.fill(0);
  }

  public idx(x: number, y: number): number {
    return y * this.width + x;
  }

  /**
   * Check if coordinate (x, y) is within grid bounds [0..width-1, 0..height-1].
   */
  public inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Explicit interior check: true if (x, y) is strictly inside boundaries (0 < x < W-1, 0 < y < H-1).
   */
  public isInterior(x: number, y: number): boolean {
    return x > 0 && x < this.width - 1 && y > 0 && y < this.height - 1;
  }

  /**
   * Explicit boundary check: true if (x, y) is on the outer border cells.
   */
  public isBoundary(x: number, y: number): boolean {
    return this.inBounds(x, y) && (x === 0 || x === this.width - 1 || y === 0 || y === this.height - 1);
  }

  /**
   * Get scalar value from a buffer at (x, y) with bounds checking.
   */
  public get(field: Float32Array, x: number, y: number): number {
    if (!this.inBounds(x, y)) {
      throw new RangeError(
        `Coordinates (${x}, ${y}) out of bounds for grid [0..${this.width - 1}, 0..${this.height - 1}]`
      );
    }
    return field[y * this.width + x];
  }

  /**
   * Set scalar value in a buffer at (x, y) with bounds checking.
   */
  public set(field: Float32Array, x: number, y: number, value: number): void {
    if (!this.inBounds(x, y)) {
      throw new RangeError(
        `Coordinates (${x}, ${y}) out of bounds for grid [0..${this.width - 1}, 0..${this.height - 1}]`
      );
    }
    field[y * this.width + x] = value;
  }

  public swapU(): void {
    const tmp = this.u;
    this.u = this.uPrev;
    this.uPrev = tmp;
  }

  public swapV(): void {
    const tmp = this.v;
    this.v = this.vPrev;
    this.vPrev = tmp;
  }

  public swapVelocity(): void {
    this.swapU();
    this.swapV();
  }

  public swapDye(): void {
    const tmp = this.dye;
    this.dye = this.dyePrev;
    this.dyePrev = tmp;
  }

  public swapPressure(): void {
    const tmp = this.pressure;
    this.pressure = this.pressurePrev;
    this.pressurePrev = tmp;
  }

  public resetAll(): void {
    this.u.fill(0);
    this.uPrev.fill(0);
    this.v.fill(0);
    this.vPrev.fill(0);
    this.pressure.fill(0);
    this.pressurePrev.fill(0);
    this.div.fill(0);
    this.dye.fill(0);
    this.dyePrev.fill(0);
    this.curl.fill(0);
  }

  /**
   * Fast bilinear interpolation of scalar field at continuous coordinates (x, y)
   * in grid space [0, width-1] x [0, height-1]. Clamped to boundaries.
   */
  public sampleBilinear(field: Float32Array, x: number, y: number): number {
    const W = this.width;
    const H = this.height;

    // Clamp coordinates
    const cx = Math.max(0.5, Math.min(W - 1.5, x));
    const cy = Math.max(0.5, Math.min(H - 1.5, y));

    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const s1 = cx - x0;
    const s0 = 1.0 - s1;
    const t1 = cy - y0;
    const t0 = 1.0 - t1;

    const i00 = y0 * W + x0;
    const i10 = y0 * W + x1;
    const i01 = y1 * W + x0;
    const i11 = y1 * W + x1;

    return (
      t0 * (s0 * field[i00] + s1 * field[i10]) +
      t1 * (s0 * field[i01] + s1 * field[i11])
    );
  }

  /**
   * Deep copies all active scalar and vector buffers from source grid.
   */
  public copyFrom(source: FluidGrid): void {
    if (this.size !== source.size) return;
    this.u.set(source.u);
    this.v.set(source.v);
    this.dye.set(source.dye);
    this.pressure.set(source.pressure);
    this.div.set(source.div);
    this.curl.set(source.curl);
  }
}
