

export type RenderBackendType = 'WebGPU' | 'WebGL2' | 'CPU';

export interface RecoveryCoordinatorOptions {
  onBackendChange?: (newBackend: RenderBackendType) => void;
  onPause?: () => void;
  onResume?: () => void;
  onResize?: (width: number, height: number, dpr: number) => void;
  reinitProbe?: () => Promise<boolean> | boolean;
}

export class RecoveryCoordinator {
  public currentBackend: RenderBackendType = 'WebGPU';
  public reinitAttempts = 0;
  public maxReinitAttempts = 2;
  public isPaused = false;
  public isTabHidden = false;

  private onBackendChange?: (newBackend: RenderBackendType) => void;
  private onPauseCallback?: () => void;
  private onResumeCallback?: () => void;
  private onResizeCallback?: (width: number, height: number, dpr: number) => void;
  private reinitProbe?: () => Promise<boolean> | boolean;

  constructor(options?: RecoveryCoordinatorOptions) {
    this.onBackendChange = options?.onBackendChange;
    this.onPauseCallback = options?.onPause;
    this.onResumeCallback = options?.onResume;
    this.onResizeCallback = options?.onResize;
    this.reinitProbe = options?.reinitProbe;

    this.attachLifecycleListeners();
  }

  private attachLifecycleListeners(): void {
    if (typeof document === 'undefined') return;

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.handleTabBackground();
      } else {
        this.handleTabForeground();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.onResizeCallback?.(width, height, dpr);
      });
    }
  }

  public handleTabBackground(): void {
    this.isTabHidden = true;
    this.isPaused = true;
    console.log('[RecoveryCoordinator] Tab backgrounded: pausing RAF loop cleanly');
    this.onPauseCallback?.();
  }

  public handleTabForeground(): void {
    this.isTabHidden = false;
    this.isPaused = false;
    console.log('[RecoveryCoordinator] Tab foregrounded: cleanly resuming RAF loop');
    this.onResumeCallback?.();
  }

  public async handleDeviceLoss(): Promise<RenderBackendType> {
    console.warn(`[RecoveryCoordinator] Device loss triggered on ${this.currentBackend}`);

    if (this.currentBackend === 'WebGPU') {
      this.reinitAttempts++;
      if (this.reinitAttempts <= this.maxReinitAttempts) {
        let recovered = true;
        if (this.reinitProbe) {
          try {
            recovered = await this.reinitProbe();
          } catch (err) {
            console.warn('[RecoveryCoordinator] Reinit probe threw:', err);
            recovered = false;
          }
        }

        if (recovered) {
          console.log(`[RecoveryCoordinator] WebGPU reinitialized (${this.reinitAttempts}/${this.maxReinitAttempts})`);
          this.currentBackend = 'WebGPU';
          this.onBackendChange?.('WebGPU');
          return 'WebGPU';
        }

        console.warn(`[RecoveryCoordinator] WebGPU reinit failed (${this.reinitAttempts}/${this.maxReinitAttempts})`);
        if (this.reinitAttempts < this.maxReinitAttempts) {

          this.currentBackend = 'WebGPU';
          return 'WebGPU';
        }
      }

      console.warn('[RecoveryCoordinator] WebGPU reinit failed twice: falling back to WebGL2');
      this.currentBackend = 'WebGL2';
      this.onBackendChange?.('WebGL2');
      return 'WebGL2';
    }

    if (this.currentBackend === 'WebGL2') {
      console.warn('[RecoveryCoordinator] WebGL2 context loss: falling back to CPU reference');
      this.currentBackend = 'CPU';
      this.onBackendChange?.('CPU');
      return 'CPU';
    }

    return 'CPU';
  }

  public async simulateDeviceLoss(target?: RenderBackendType): Promise<RenderBackendType> {
    if (target) {
      if (target === 'CPU') {
        this.currentBackend = 'WebGL2';
        return this.handleDeviceLoss();
      }
      if (target === 'WebGL2') {
        this.currentBackend = 'WebGPU';
        this.reinitAttempts = this.maxReinitAttempts;
        return this.handleDeviceLoss();
      }
      if (target === 'WebGPU') {
        this.currentBackend = 'WebGPU';
        this.reinitAttempts = 0;
        return this.handleDeviceLoss();
      }
    }
    return this.handleDeviceLoss();
  }
}
