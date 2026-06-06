/**
 * Analytics Adapter Interface & Implementations
 * 
 * This module provides the analytics system for the video player.
 * It includes:
 * - Base adapter interface
 * - Console logging adapter (for development)
 * - HTTP adapter (for production)
 * - Adapter factory for easy creation
 */

import type { 
  AnalyticsAdapter, 
  AnalyticsEventPayload, 
  AnalyticsConfig,
  AnalyticsEventName,
} from '../types';

// ============================================================================
// CONSOLE LOGGING ADAPTER
// ============================================================================

/**
 * Console logging adapter for development and debugging
 * Logs all analytics events to the browser console with formatting
 */
export class ConsoleAnalyticsAdapter implements AnalyticsAdapter {
  private prefix: string;
  private enableColors: boolean;

  constructor(options: { prefix?: string; enableColors?: boolean } = {}) {
    this.prefix = options.prefix ?? '[VideoPlayer Analytics]';
    this.enableColors = options.enableColors ?? true;
  }

  trackEvent(payload: AnalyticsEventPayload): void {
    const styles = this.enableColors ? this.getEventStyles(payload.eventName) : '';
    
    console.groupCollapsed(
      `%c${this.prefix} ${payload.eventName}`,
      styles
    );
    
    console.log('Timestamp:', payload.timestamp);
    console.log('Session ID:', payload.sessionId);
    console.log('Current Time:', `${payload.currentTime.toFixed(2)}s / ${payload.duration.toFixed(2)}s`);
    console.log('Volume:', `${(payload.volume * 100).toFixed(0)}%${payload.muted ? ' (muted)' : ''}`);
    console.log('Playback Rate:', `${payload.playbackRate}x`);
    
    if (payload.quality) {
      console.log('Quality:', payload.quality);
    }
    
    if (payload.customData && Object.keys(payload.customData).length > 0) {
      console.log('Custom Data:', payload.customData);
    }
    
    console.log('Full Payload:', payload);
    console.groupEnd();
  }

  private getEventStyles(eventName: AnalyticsEventName): string {
    const baseStyle = 'padding: 2px 6px; border-radius: 3px; font-weight: bold;';
    
    const colorMap: Record<string, string> = {
      play: 'background: #4CAF50; color: white;',
      pause: 'background: #FF9800; color: white;',
      ended: 'background: #9C27B0; color: white;',
      error: 'background: #F44336; color: white;',
      buffering: 'background: #2196F3; color: white;',
      heartbeat: 'background: #607D8B; color: white;',
      milestone_reached: 'background: #E91E63; color: white;',
    };

    return baseStyle + (colorMap[eventName] ?? 'background: #333; color: white;');
  }

  flush(): void {
    // Console adapter doesn't need flushing
  }

  destroy(): void {
    // Console adapter doesn't need cleanup
  }
}

// ============================================================================
// HTTP ANALYTICS ADAPTER
// ============================================================================

export interface HttpAdapterOptions {
  /** API endpoint URL */
  endpoint: string;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT';
  /** Additional headers */
  headers?: Record<string, string>;
  /** Batch events before sending (count) */
  batchSize?: number;
  /** Batch events before sending (time in ms) */
  batchTimeout?: number;
  /** Retry failed requests */
  retryOnFailure?: boolean;
  /** Number of retry attempts */
  maxRetries?: number;
  /** Transform payload before sending */
  transformPayload?: (payload: AnalyticsEventPayload) => unknown;
  /** Called on successful send */
  onSuccess?: (payload: AnalyticsEventPayload[]) => void;
  /** Called on send failure */
  onError?: (error: Error, payload: AnalyticsEventPayload[]) => void;
}

/**
 * HTTP analytics adapter for production use
 * Sends analytics events to a backend API endpoint
 * Supports batching, retries, and offline queuing
 */
export class HttpAnalyticsAdapter implements AnalyticsAdapter {
  private endpoint: string;
  private method: 'POST' | 'PUT';
  private headers: Record<string, string>;
  private batchSize: number;
  private batchTimeout: number;
  private retryOnFailure: boolean;
  private maxRetries: number;
  private transformPayload: (payload: AnalyticsEventPayload) => unknown;
  private onSuccess?: (payload: AnalyticsEventPayload[]) => void;
  private onError?: (error: Error, payload: AnalyticsEventPayload[]) => void;

  private eventQueue: AnalyticsEventPayload[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;

  constructor(options: HttpAdapterOptions) {
    this.endpoint = options.endpoint;
    this.method = options.method ?? 'POST';
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    this.batchSize = options.batchSize ?? 10;
    this.batchTimeout = options.batchTimeout ?? 5000;
    this.retryOnFailure = options.retryOnFailure ?? true;
    this.maxRetries = options.maxRetries ?? 3;
    this.transformPayload = options.transformPayload ?? ((p) => p);
    this.onSuccess = options.onSuccess;
    this.onError = options.onError;
  }

  async trackEvent(payload: AnalyticsEventPayload): Promise<void> {
    if (this.isDestroyed) return;

    this.eventQueue.push(payload);

    // Send immediately for important events
    const immediateEvents: AnalyticsEventName[] = ['error', 'session_end', 'ended'];
    if (immediateEvents.includes(payload.eventName)) {
      await this.flush();
      return;
    }

    // Check batch size
    if (this.eventQueue.length >= this.batchSize) {
      await this.flush();
      return;
    }

    // Start batch timer if not already running
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flush();
      }, this.batchTimeout);
    }
  }

  async flush(): Promise<void> {
    if (this.isDestroyed || this.eventQueue.length === 0) return;

    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Get events to send and clear queue
    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    await this.sendEvents(eventsToSend, 0);
  }

  private async sendEvents(events: AnalyticsEventPayload[], attempt: number): Promise<void> {
    try {
      const transformedEvents = events.map(this.transformPayload);
      
      const response = await fetch(this.endpoint, {
        method: this.method,
        headers: this.headers,
        body: JSON.stringify({ events: transformedEvents }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.onSuccess?.(events);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      // Retry if enabled and attempts remaining
      if (this.retryOnFailure && attempt < this.maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        await this.sendEvents(events, attempt + 1);
        return;
      }

      this.onError?.(err, events);
      console.error('[VideoPlayer Analytics] Failed to send events:', err);
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    // Attempt to send remaining events
    if (this.eventQueue.length > 0) {
      this.flush().catch(() => {});
    }
  }
}

// ============================================================================
// ANALYTICS MANAGER
// ============================================================================

/**
 * Analytics Manager - coordinates analytics tracking for the player
 */
export class AnalyticsManager {
  private config: AnalyticsConfig;
  private adapter: AnalyticsAdapter;
  private sessionId: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastTimeUpdate = 0;
  private sourceUrl = '';
  private isDestroyed = false;

  constructor(config: AnalyticsConfig) {
    this.config = config;
    this.sessionId = this.generateSessionId();
    
    // Use provided adapter or create console adapter
    this.adapter = config.adapter ?? new ConsoleAnalyticsAdapter();
  }

  /**
   * Initialize analytics session
   */
  initialize(sourceUrl: string): void {
    this.sourceUrl = sourceUrl;
    this.trackEvent('session_start', { currentTime: 0, duration: 0, volume: 1, muted: false, playbackRate: 1 });
  }

  /**
   * Start heartbeat tracking
   */
  startHeartbeat(getState: () => { currentTime: number; duration: number; volume: number; muted: boolean; playbackRate: number }): void {
    const interval = this.config.heartbeatInterval ?? 30000;
    
    this.heartbeatTimer = setInterval(() => {
      if (!this.isDestroyed) {
        const state = getState();
        this.trackEvent('heartbeat', state);
      }
    }, interval);
  }

  /**
   * Stop heartbeat tracking
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Track a player event
   */
  trackEvent(
    eventName: AnalyticsEventName,
    state: { currentTime: number; duration: number; volume: number; muted: boolean; playbackRate: number; quality?: string },
    customData?: Record<string, unknown>
  ): void {
    if (!this.config.enabled || this.isDestroyed) return;

    // Throttle time_update events
    if (eventName === 'time_update') {
      const now = Date.now();
      const throttle = this.config.timeUpdateThrottle ?? 1000;
      if (now - this.lastTimeUpdate < throttle) return;
      this.lastTimeUpdate = now;
    }

    const payload: AnalyticsEventPayload = {
      eventName,
      tenantId: this.config.tenantId,
      userId: this.config.userId,
      videoId: this.config.videoId,
      sessionId: this.sessionId,
      currentTime: state.currentTime,
      duration: state.duration,
      sourceUrl: this.sourceUrl,
      quality: state.quality,
      volume: state.volume,
      muted: state.muted,
      playbackRate: state.playbackRate,
      timestamp: new Date().toISOString(),
      platform: this.config.platform ?? 'web',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      customData: { ...this.config.customData, ...customData },
    };

    this.adapter.trackEvent(payload);
  }

  /**
   * End analytics session
   */
  endSession(state: { currentTime: number; duration: number; volume: number; muted: boolean; playbackRate: number }): void {
    this.stopHeartbeat();
    this.trackEvent('session_end', state);
    this.adapter.flush?.();
  }

  /**
   * Destroy analytics manager
   */
  destroy(): void {
    this.isDestroyed = true;
    this.stopHeartbeat();
    this.adapter.destroy?.();
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

// ============================================================================
// ADAPTER FACTORY
// ============================================================================

export type AdapterType = 'console' | 'http';

export interface AdapterFactoryOptions {
  type: AdapterType;
  httpOptions?: HttpAdapterOptions;
  consoleOptions?: { prefix?: string; enableColors?: boolean };
}

/**
 * Factory function to create analytics adapters
 */
export function createAnalyticsAdapter(options: AdapterFactoryOptions): AnalyticsAdapter {
  switch (options.type) {
    case 'http':
      if (!options.httpOptions) {
        throw new Error('httpOptions required for HTTP adapter');
      }
      return new HttpAnalyticsAdapter(options.httpOptions);
    
    case 'console':
    default:
      return new ConsoleAnalyticsAdapter(options.consoleOptions);
  }
}

// ============================================================================
// EXAMPLE BACKEND ADAPTER
// ============================================================================

/**
 * Example adapter configured for a typical backend API
 * Customize this for your specific backend
 */
export function createExampleBackendAdapter(
  baseUrl: string,
  authToken?: string
): HttpAnalyticsAdapter {
  return new HttpAnalyticsAdapter({
    endpoint: `${baseUrl}/api/player/events`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken && { Authorization: `Bearer ${authToken}` }),
    },
    batchSize: 10,
    batchTimeout: 5000,
    retryOnFailure: true,
    maxRetries: 3,
    transformPayload: (payload) => ({
      event: payload.eventName,
      data: {
        tenant_id: payload.tenantId,
        user_id: payload.userId,
        video_id: payload.videoId,
        session_id: payload.sessionId,
        current_time: payload.currentTime,
        duration: payload.duration,
        source_url: payload.sourceUrl,
        quality: payload.quality,
        volume: payload.volume,
        muted: payload.muted,
        playback_rate: payload.playbackRate,
        timestamp: payload.timestamp,
        platform: payload.platform,
        user_agent: payload.userAgent,
        custom_data: payload.customData,
      },
    }),
    onSuccess: (events) => {
      console.debug(`[Analytics] Successfully sent ${events.length} events`);
    },
    onError: (error, events) => {
      console.error(`[Analytics] Failed to send ${events.length} events:`, error);
    },
  });
}
