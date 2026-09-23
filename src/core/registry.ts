export class ServiceRegistry {
  private static services = new Map<string, unknown>();

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
