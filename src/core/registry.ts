export interface TestArticlePose {
  readonly position: readonly [number, number, number];
  readonly rotationEulerDeg: readonly [number, number, number];
}

export class ServiceRegistry {
  private static services = new Map<string, unknown>();
  private static testArticlePose: TestArticlePose = {
    position: [0, 0, 0],
    rotationEulerDeg: [0, 0, 0]
  };
  private static inflowVelocity = 1.5;

  public static getTestArticlePose(): TestArticlePose {
    return this.testArticlePose;
  }

  public static setTestArticlePose(pose: TestArticlePose): void {
    this.testArticlePose = pose;
  }

  public static getInflowVelocity(): number {
    return this.inflowVelocity;
  }

  public static setInflowVelocity(velocityMs: number): void {
    this.inflowVelocity = velocityMs;
  }

  public static register<T>(key: string, service: T): void {
    this.services.set(key, service);
  }

  public static get<T>(key: string): T | undefined {
    return this.services.get(key) as T | undefined;
  }

  public static has(key: string): boolean {
    return this.services.has(key);
  }

  public static clear(): void {
    this.services.clear();
  }
}
