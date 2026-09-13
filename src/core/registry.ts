export class ServiceRegistry {
  private static services = new Map<string, unknown>();

  public static register<T>(key: string, service: T): void {
    this.services.set(key, service);
  }

  public static get<T>(key: string): T {
    const s = this.services.get(key);
    if (!s) {
      throw new Error(`Service not found in registry: ${key}`);
    }
    return s as T;
  }

  public static has(key: string): boolean {
    return this.services.has(key);
  }

  public static clear(): void {
    this.services.clear();
  }
}
