export interface TelemetryFrame {
  timestamp: number;
  fps: number;
  frameMs: number;
  gpuMs: number;
  substeps: number;
}

export class TelemetryLogger {
  private capacity: number;
  private buffer: TelemetryFrame[];
  private index = 0;
  private isFull = false;

  constructor(capacity = 300) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  public push(frame: TelemetryFrame): void {
    this.buffer[this.index] = frame;
    this.index = (this.index + 1) % this.capacity;
    if (this.index === 0) {
      this.isFull = true;
    }
  }

  public getRecent(count = 60): TelemetryFrame[] {
    const size = this.isFull ? this.capacity : this.index;
    const n = Math.min(count, size);
    const result: TelemetryFrame[] = [];

    for (let i = 0; i < n; i++) {
      const idx = (this.index - 1 - i + this.capacity) % this.capacity;
      result.unshift(this.buffer[idx]);
    }
    return result;
  }
}
