export interface GpuTimerResult {
  durationMs: number;
  backend: 'webgpu' | 'webgl2-ext' | 'cpu-fallback';
}

export class GpuTimer {
  private backend: 'webgpu' | 'webgl2-ext' | 'cpu-fallback' = 'cpu-fallback';
  private lastDurationMs = 0;
  private cpuStartTime = 0;

  private gl: WebGL2RenderingContext | null = null;
  private extTimerQuery: any = null;
  private activeQuery: WebGLQuery | null = null;

  public webgpuDevice: any = null;
  public querySet: any = null;
  public resolveBuffer: any = null;
  public resultBuffer: any = null;

  constructor(rendererContext?: { gl?: WebGL2RenderingContext; device?: any }) {
    if (rendererContext?.device) {
      this.initWebGPU(rendererContext.device);
    } else if (rendererContext?.gl) {
      this.initWebGL2(rendererContext.gl);
    }
  }

  private initWebGPU(device: any): void {
    try {
      if (device?.features?.has?.('timestamp-query')) {
        this.webgpuDevice = device;
        this.querySet = device.createQuerySet({
          type: 'timestamp',
          count: 2
        });
        this.resolveBuffer = device.createBuffer({
          size: 16,
          usage: 0x0004 | 0x0008
        });
        this.resultBuffer = device.createBuffer({
          size: 16,
          usage: 0x0001 | 0x0008
        });
        this.backend = 'webgpu';
      }
    } catch {
      this.backend = 'cpu-fallback';
    }
  }

  private initWebGL2(gl: WebGL2RenderingContext): void {
    try {
      this.gl = gl;
      this.extTimerQuery = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (this.extTimerQuery) {
        this.backend = 'webgl2-ext';
      }
    } catch {
      this.backend = 'cpu-fallback';
    }
  }

  public begin(): void {
    this.cpuStartTime = performance.now();

    if (this.backend === 'webgl2-ext' && this.gl && this.extTimerQuery) {
      this.activeQuery = this.gl.createQuery();
      if (this.activeQuery) {
        this.gl.beginQuery(this.extTimerQuery.TIME_ELAPSED_EXT, this.activeQuery);
      }
    }
  }

  public end(): void {
    if (this.backend === 'webgl2-ext' && this.gl && this.extTimerQuery && this.activeQuery) {
      this.gl.endQuery(this.extTimerQuery.TIME_ELAPSED_EXT);
    }

    const cpuElapsed = performance.now() - this.cpuStartTime;
    this.lastDurationMs = cpuElapsed;
  }

  public resolve(): GpuTimerResult {
    if (this.backend === 'webgl2-ext' && this.gl && this.activeQuery) {
      const available = this.gl.getQueryParameter(this.activeQuery, this.gl.QUERY_RESULT_AVAILABLE);
      const disjoint = this.gl.getParameter(this.extTimerQuery.GPU_DISJOINT_EXT);

      if (available && !disjoint) {
        const timeElapsedNs = this.gl.getQueryParameter(this.activeQuery, this.gl.QUERY_RESULT);
        this.lastDurationMs = timeElapsedNs / 1_000_000.0;
        this.gl.deleteQuery(this.activeQuery);
        this.activeQuery = null;
      }
    }

    return {
      durationMs: this.lastDurationMs,
      backend: this.backend
    };
  }

  public getBackend(): 'webgpu' | 'webgl2-ext' | 'cpu-fallback' {
    return this.backend;
  }
}
