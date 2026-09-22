

export type ResolutionScale = 1.0 | 0.5 | 0.25;

export interface AdaptiveResolutionConfig {
  baseWidth: number;
  baseHeight: number;
  targetBudgetMs?: number;
  dropThresholdMs?: number;
  restoreThresholdMs?: number;
  consecutiveDropFrames?: number;
  consecutiveRestoreFrames?: number;
  enabled?: boolean;
}

export class AdaptiveResolutionController {
  public baseWidth: number;
  public baseHeight: number;
  public currentScale: ResolutionScale = 1.0;
  public enabled = true;

  public targetBudgetMs: number;
  public dropThresholdMs: number;
  public restoreThresholdMs: number;
  public consecutiveDropFrames: number;
  public consecutiveRestoreFrames: number;

  private dropCounter = 0;
  private restoreCounter = 0;
  private smoothedFrameTimeMs = 16.67;

  public onResolutionChange?: (scale: ResolutionScale, width: number, height: number) => void;

  constructor(config?: Partial<AdaptiveResolutionConfig>) {
    this.baseWidth = config?.baseWidth ?? 1024;
    this.baseHeight = config?.baseHeight ?? 512;
    this.targetBudgetMs = config?.targetBudgetMs ?? 16.67;
    this.dropThresholdMs = config?.dropThresholdMs ?? 17.5;
    this.restoreThresholdMs = config?.restoreThresholdMs ?? 12.0;
    this.consecutiveDropFrames = config?.consecutiveDropFrames ?? 10;
    this.consecutiveRestoreFrames = config?.consecutiveRestoreFrames ?? 60;
    this.enabled = config?.enabled ?? true;
  }

  public get currentWidth(): number {
    return Math.round(this.baseWidth * this.currentScale);
  }

  public get currentHeight(): number {
    return Math.round(this.baseHeight * this.currentScale);
  }

  public get scaleLabel(): string {
    return `${this.currentScale.toFixed(2)}×`;
  }

  public recordFrameTime(frameTimeMs: number): boolean {
    if (!this.enabled) return false;

    this.smoothedFrameTimeMs = 0.85 * this.smoothedFrameTimeMs + 0.15 * frameTimeMs;

    if (this.smoothedFrameTimeMs > this.dropThresholdMs) {
      this.dropCounter++;
      this.restoreCounter = 0;

      if (this.dropCounter >= this.consecutiveDropFrames) {
        this.dropCounter = 0;
        return this.scaleDown();
      }
    } else if (this.smoothedFrameTimeMs < this.restoreThresholdMs) {
      this.restoreCounter++;
      this.dropCounter = 0;

      if (this.restoreCounter >= this.consecutiveRestoreFrames) {
        this.restoreCounter = 0;
        return this.scaleUp();
      }
    } else {
      this.dropCounter = Math.max(0, this.dropCounter - 1);
      this.restoreCounter = Math.max(0, this.restoreCounter - 1);
    }

    return false;
  }

  public scaleDown(): boolean {
    if (this.currentScale === 1.0) {
      this.currentScale = 0.5;
    } else if (this.currentScale === 0.5) {
      this.currentScale = 0.25;
    } else {
      return false;
    }
    this.onResolutionChange?.(this.currentScale, this.currentWidth, this.currentHeight);
    return true;
  }

  public scaleUp(): boolean {
    if (this.currentScale === 0.25) {
      this.currentScale = 0.5;
    } else if (this.currentScale === 0.5) {
      this.currentScale = 1.0;
    } else {
      return false;
    }
    this.onResolutionChange?.(this.currentScale, this.currentWidth, this.currentHeight);
    return true;
  }

  public setScale(scale: ResolutionScale): void {
    if (this.currentScale === scale) return;
    this.currentScale = scale;
    this.dropCounter = 0;
    this.restoreCounter = 0;
    this.onResolutionChange?.(this.currentScale, this.currentWidth, this.currentHeight);
  }
}
