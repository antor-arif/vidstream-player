// Simple typed event bus — used internally and exposed on the player instance

type Handler = (...args: any[]) => void;

export class EventBus {
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler);
  }

  once(event: string, handler: Handler): void {
    const wrapped = (...args: any[]) => {
      handler(...args);
      this.off(event, wrapped);
    };
    this.on(event, wrapped);
  }

  emit(event: string, data?: unknown): void {
    this.listeners.get(event)?.forEach(h => h(data));
  }

  destroy(): void {
    this.listeners.clear();
  }
}
