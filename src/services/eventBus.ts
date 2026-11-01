// Simple typed event bus — used internally and exposed on the player instance

type Handler = (...args: any[]) => void;

export class EventBus {
  private listeners = new Map<string, Set<Handler>>();
  /** once() wrappers, keyed by the caller's handler so off(event, handler) can remove them */
  private onceWrappers = new Map<string, Map<Handler, Handler>>();

  on(event: string, handler: Handler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler);
    const wrapper = this.onceWrappers.get(event)?.get(handler);
    if (wrapper) {
      this.listeners.get(event)?.delete(wrapper);
      this.onceWrappers.get(event)!.delete(handler);
    }
  }

  once(event: string, handler: Handler): void {
    const wrapped = (...args: any[]) => {
      this.off(event, handler);
      handler(...args);
    };
    if (!this.onceWrappers.has(event)) {
      this.onceWrappers.set(event, new Map());
    }
    this.onceWrappers.get(event)!.set(handler, wrapped);
    this.on(event, wrapped);
  }

  emit(event: string, data?: unknown): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    // Snapshot so handlers that subscribe/unsubscribe during emit don't affect this dispatch,
    // and isolate failures so one throwing handler can't starve the rest
    for (const handler of Array.from(handlers)) {
      try {
        handler(data);
      } catch (error) {
        console.error(`[VideoPlayer] "${event}" handler threw:`, error);
      }
    }
  }

  destroy(): void {
    this.listeners.clear();
    this.onceWrappers.clear();
  }
}
