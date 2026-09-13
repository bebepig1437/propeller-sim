export class SimClock {
  private fixedDeltaTime: number; // e.g. 1/60 (~0.016667 s)
  private maxSubsteps: number;    // e.g. 5
  private accumulator = 0;
  private lastTime = 0;
  private alpha = 0;
  private isRunning = false;
  private substepCount = 0;

  constructor(fixedDeltaTime = 1.0 / 60.0, maxSubsteps = 5) {
    this.fixedDeltaTime = fixedDeltaTime;
    this.maxSubsteps = maxSubsteps;
  }

  public start(startTimeMs = performance.now()): void {
    this.lastTime = startTimeMs;
    this.accumulator = 0;
    this.isRunning = true;
    this.substepCount = 0;
  }

  public stop(): void {
    this.isRunning = false;
  }

  public reset(): void {
    this.accumulator = 0;
    this.substepCount = 0;
    this.alpha = 0;
  }

  /**
   * Advances the clock and invokes `onSubstep(dt)` for each fixed simulation slice.
   * Clamps substeps to `maxSubsteps` to prevent spiral of death under heavy lag.
   * Returns interpolation factor `alpha` in [0, 1) for render smoothing.
   */
  public tick(currentTimeMs: number, onSubstep: (dt: number) => void): number {
    if (!this.isRunning) {
      this.start(currentTimeMs);
      return 0;
    }

    const frameDeltaSec = Math.min((currentTimeMs - this.lastTime) / 1000.0, 0.25);
    this.lastTime = currentTimeMs;
    this.accumulator += frameDeltaSec;

    let steps = 0;
    while (this.accumulator >= this.fixedDeltaTime && steps < this.maxSubsteps) {
      onSubstep(this.fixedDeltaTime);
      this.accumulator -= this.fixedDeltaTime;
      steps++;
    }

    // If still over accumulator budget after max substeps, discard excess to avoid spiral of death
    if (this.accumulator >= this.fixedDeltaTime) {
      this.accumulator = 0;
    }

    this.substepCount = steps;
    this.alpha = this.accumulator / this.fixedDeltaTime;
    return this.alpha;
  }

  public getAlpha(): number {
    return this.alpha;
  }

  public getSubstepsExecuted(): number {
    return this.substepCount;
  }

  public getFixedDeltaTime(): number {
    return this.fixedDeltaTime;
  }

  public setFixedDeltaTime(dt: number): void {
    this.fixedDeltaTime = dt;
  }

  public setMaxSubsteps(max: number): void {
    this.maxSubsteps = max;
  }
}
