import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { logger } from '../utils/logging/logger.js';
import { circuitBreakerRegistry } from '../utils/resilience/circuitBreaker.js';
import { calculateBackoffDelay } from '../utils/resilience/retry.js';

import type { CircuitBreakerConfig } from '../utils/resilience/ACircuitBreaker.js';

/** Connection quality states for WebSocket connections */
export type WebSocketConnectionQuality = 'excellent' | 'good' | 'poor' | 'disconnected';

/** WebSocket connection states */
export type WebSocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Configuration for WebSocket health monitoring */
export interface WebSocketHealthConfig {
  /** Name for this connection (used in logging and circuit breaker) */
  name?: string;
  /** Interval between ping messages in milliseconds (default: 30000) */
  pingIntervalMs?: number;
  /** Timeout to wait for pong response in milliseconds (default: 5000) */
  pongTimeoutMs?: number;
  /** Number of missed pongs before considering connection dead (default: 2) */
  missedPongsThreshold?: number;
  /** Enable automatic reconnection (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay for reconnection backoff in milliseconds (default: 1000) */
  reconnectBaseDelayMs?: number;
  /** Maximum delay for reconnection backoff in milliseconds (default: 30000) */
  reconnectMaxDelayMs?: number;
  /** Backoff multiplier for reconnection (default: 2) */
  reconnectBackoffMultiplier?: number;
  /** Timeout for reconnection connection attempt in milliseconds (default: 10000) */
  reconnectConnectionTimeoutMs?: number;
  /** Enable circuit breaker integration (default: true) */
  useCircuitBreaker?: boolean;
  /** Custom circuit breaker configuration */
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  /** Number of latency samples to keep for averaging (default: 10) */
  latencySampleSize?: number;
  /** Latency threshold for "excellent" quality in ms (default: 100) */
  excellentLatencyThresholdMs?: number;
  /** Latency threshold for "good" quality in ms (default: 300) */
  goodLatencyThresholdMs?: number;
  /** Packet loss threshold for "excellent" quality (default: 0) */
  excellentPacketLossThreshold?: number;
  /** Packet loss threshold for "good" quality (default: 0.05 = 5%) */
  goodPacketLossThreshold?: number;
}

/** Metrics for WebSocket connection health */
export interface WebSocketHealthMetrics {
  /** Current connection quality */
  quality: WebSocketConnectionQuality;
  /** Current connection state */
  state: WebSocketConnectionState;
  /** Average round-trip latency in milliseconds */
  latencyMs: number | null;
  /** Minimum latency observed */
  minLatencyMs: number | null;
  /** Maximum latency observed */
  maxLatencyMs: number | null;
  /** Packet loss ratio (0-1) */
  packetLossRatio: number;
  /** Total pings sent */
  pingsSent: number;
  /** Total pongs received */
  pongsReceived: number;
  /** Consecutive missed pongs */
  consecutiveMissedPongs: number;
  /** Number of reconnection attempts */
  reconnectAttempts: number;
  /** Total successful reconnections */
  successfulReconnections: number;
  /** Time of last successful ping-pong */
  lastPongTime: number | null;
  /** Time of last received message */
  lastMessageTime: number | null;
  /** Session data that was preserved for reconnection */
  hasPreservedSession: boolean;
  /** Whether currently in reconnection attempt */
  isReconnecting: boolean;
}

/** Event types emitted by WebSocket health monitor */
export type WebSocketHealthEventType =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'reconnected'
  | 'reconnect_failed'
  | 'quality_changed'
  | 'ping_sent'
  | 'pong_received'
  | 'pong_timeout'
  | 'circuit_opened'
  | 'circuit_closed';

/** Event payload for health monitor events */
export interface WebSocketHealthEvent {
  type: WebSocketHealthEventType;
  timestamp: number;
  metrics: WebSocketHealthMetrics;
  /** Error message (for failure events) */
  error?: string;
  /** Previous quality (for quality_changed events) */
  previousQuality?: WebSocketConnectionQuality;
  /** Reconnection attempt number */
  reconnectAttempt?: number;
}

/** Callback for health events */
export type WebSocketHealthEventCallback = (event: WebSocketHealthEvent) => void | Promise<void>;

/** Factory function for creating WebSocket connections */
export type WebSocketFactory = (url: string, headers: Record<string, string>) => WebSocket;

/** Session context for reconnection */
export interface WebSocketSessionContext {
  /** Session ID for the WebSocket connection */
  sessionId: string;
  /** Last received event ID for resumption */
  lastEventId?: string;
  /** IDs of events already processed (for deduplication) */
  processedEventIds?: Set<string>;
  /** Custom data to preserve across reconnections */
  customData?: Record<string, unknown>;
}

const DEFAULT_CONFIG: Required<Omit<WebSocketHealthConfig, 'circuitBreakerConfig'>> & { circuitBreakerConfig?: Partial<CircuitBreakerConfig> } = {
  name: 'websocket',
  pingIntervalMs: 30000,
  pongTimeoutMs: 5000,
  missedPongsThreshold: 2,
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectBaseDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  reconnectBackoffMultiplier: 2,
  reconnectConnectionTimeoutMs: 10000,
  useCircuitBreaker: true,
  circuitBreakerConfig: undefined,
  latencySampleSize: 10,
  excellentLatencyThresholdMs: 100,
  goodLatencyThresholdMs: 300,
  excellentPacketLossThreshold: 0,
  goodPacketLossThreshold: 0.05,
};

/**
 * WebSocket Health Monitor with auto-recovery capabilities.
 *
 * Provides:
 * - Ping-pong heartbeat protocol for connection health checks
 * - Connection quality tracking (latency, packet loss)
 * - Automatic reconnection with exponential backoff
 * - Session preservation for seamless resumption
 * - Circuit breaker integration for failure protection
 */
export class WebSocketHealthMonitor {
  private config: Required<Omit<WebSocketHealthConfig, 'circuitBreakerConfig'>> & { circuitBreakerConfig?: Partial<CircuitBreakerConfig> };
  private ws: WebSocket | null = null;
  private wsFactory: WebSocketFactory;
  private wsUrl: string = '';
  private wsHeaders: Record<string, string> = {};

  // Ping-pong tracking
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingPing: { id: string; sentAt: number; protocolPongReceived: boolean } | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;

  // Latency tracking
  private latencySamples: number[] = [];

  // State tracking
  private state: WebSocketConnectionState = 'disconnected';
  private consecutiveMissedPongs = 0;
  private pingsSent = 0;
  private pongsReceived = 0;
  private reconnectAttempts = 0;
  private successfulReconnections = 0;
  private lastPongTime: number | null = null;
  private lastMessageTime: number | null = null;
  private lastQuality: WebSocketConnectionQuality = 'disconnected';

  // Session context for reconnection
  private sessionContext: WebSocketSessionContext | null = null;

  // Event listeners
  private eventListeners: WebSocketHealthEventCallback[] = [];

  // Cleanup flag
  private isDestroyed = false;

  constructor(wsFactory: WebSocketFactory, config: WebSocketHealthConfig = {}) {
    this.wsFactory = wsFactory;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Attach to an existing WebSocket connection and start monitoring
   */
  attach(ws: WebSocket, url: string, headers: Record<string, string>, sessionContext?: WebSocketSessionContext): void {
    this.detach();

    this.ws = ws;
    this.wsUrl = url;
    this.wsHeaders = headers;
    this.sessionContext = sessionContext || null;

    this.setupWebSocketHandlers(ws);

    if (ws.readyState === WebSocket.OPEN) {
      this.onConnected();
    } else if (ws.readyState === WebSocket.CONNECTING) {
      this.setState('connecting');
    }
  }

  /**
   * Detach from current WebSocket and stop monitoring
   */
  detach(): void {
    this.stopPingInterval();
    this.clearPongTimeout();

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /**
   * Get current health metrics
   */
  getMetrics(): WebSocketHealthMetrics {
    return {
      quality: this.calculateQuality(),
      state: this.state,
      latencyMs: this.getAverageLatency(),
      minLatencyMs: this.latencySamples.length > 0 ? Math.min(...this.latencySamples) : null,
      maxLatencyMs: this.latencySamples.length > 0 ? Math.max(...this.latencySamples) : null,
      packetLossRatio: this.calculatePacketLoss(),
      pingsSent: this.pingsSent,
      pongsReceived: this.pongsReceived,
      consecutiveMissedPongs: this.consecutiveMissedPongs,
      reconnectAttempts: this.reconnectAttempts,
      successfulReconnections: this.successfulReconnections,
      lastPongTime: this.lastPongTime,
      lastMessageTime: this.lastMessageTime,
      hasPreservedSession: this.sessionContext !== null,
      isReconnecting: this.state === 'reconnecting',
    };
  }

  /**
   * Get the current connection quality
   */
  getQuality(): WebSocketConnectionQuality {
    return this.calculateQuality();
  }

  /**
   * Get the session context for reconnection
   */
  getSessionContext(): WebSocketSessionContext | null {
    return this.sessionContext;
  }

  /**
   * Update session context (e.g., after receiving new events)
   */
  updateSessionContext(updates: Partial<WebSocketSessionContext>): void {
    if (this.sessionContext) {
      this.sessionContext = { ...this.sessionContext, ...updates };
    } else if (updates.sessionId) {
      this.sessionContext = {
        sessionId: updates.sessionId,
        lastEventId: updates.lastEventId,
        processedEventIds: updates.processedEventIds,
        customData: updates.customData,
      };
    }
  }

  /**
   * Add last event ID to session context for resumption
   */
  recordEventId(eventId: string): void {
    if (!this.sessionContext) return;

    this.sessionContext.lastEventId = eventId;

    if (!this.sessionContext.processedEventIds) {
      this.sessionContext.processedEventIds = new Set();
    }
    this.sessionContext.processedEventIds.add(eventId);

    // Limit the size of processed event IDs
    if (this.sessionContext.processedEventIds.size > 1000) {
      const ids = Array.from(this.sessionContext.processedEventIds);
      this.sessionContext.processedEventIds = new Set(ids.slice(-500));
    }
  }

  /**
   * Check if an event has already been processed
   */
  hasProcessedEvent(eventId: string): boolean {
    return this.sessionContext?.processedEventIds?.has(eventId) ?? false;
  }

  /**
   * Subscribe to health events
   */
  onEvent(callback: WebSocketHealthEventCallback): () => void {
    this.eventListeners.push(callback);
    return () => {
      const index = this.eventListeners.indexOf(callback);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Mark a message as received (updates last message time)
   */
  recordMessageReceived(): void {
    this.lastMessageTime = Date.now();
  }

  /**
   * Manually trigger reconnection
   */
  async reconnect(): Promise<boolean> {
    if (this.state === 'reconnecting') {
      logger.debug('Reconnection already in progress', {
        component: 'WebSocketHealthMonitor',
        name: this.config.name,
      });
      return false;
    }

    return this.attemptReconnection();
  }

  /**
   * Clean up and destroy the monitor
   */
  destroy(): void {
    this.isDestroyed = true;
    this.detach();
    this.eventListeners = [];
    this.sessionContext = null;
    this.latencySamples = [];
    this.resetStats();
  }

  /**
   * Check if connection is healthy
   */
  isHealthy(): boolean {
    return this.state === 'connected' &&
           this.consecutiveMissedPongs < this.config.missedPongsThreshold;
  }

  // Private methods

  private setupWebSocketHandlers(ws: WebSocket): void {
    ws.on('open', () => this.onConnected());
    ws.on('close', (code, reason) => this.onDisconnected(code, reason.toString('utf-8')));
    ws.on('error', (error) => this.onError(error));
    ws.on('message', (data) => this.onMessage(data));
    ws.on('pong', () => this.onProtocolPong());
  }

  private onConnected(): void {
    const wasReconnecting = this.state === 'reconnecting';
    this.setState('connected');
    this.consecutiveMissedPongs = 0;

    if (wasReconnecting) {
      this.successfulReconnections++;
      this.reconnectAttempts = 0;
      this.emitEvent('reconnected');

      // Record success with circuit breaker
      if (this.config.useCircuitBreaker) {
        const breaker = circuitBreakerRegistry.get(
          `ws-${this.config.name}`,
          this.config.circuitBreakerConfig
        );
        // Reset the circuit breaker on successful reconnect
        breaker.reset();
      }
    } else {
      this.emitEvent('connected');
    }

    this.startPingInterval();
  }

  private onDisconnected(code: number, reason: string): void {
    this.stopPingInterval();
    this.clearPongTimeout();

    const wasConnected = this.state === 'connected';

    logger.warn('WebSocket disconnected', {
      component: 'WebSocketHealthMonitor',
      name: this.config.name,
      code,
      reason,
      wasConnected,
    });

    this.emitEvent('disconnected', { error: `Closed with code ${code}: ${reason}` });

    // Normal closure codes - don't attempt reconnection
    if (code === 1000 || code === 1001) {
      this.setState('disconnected');
      return;
    }

    // Attempt reconnection for abnormal closures
    if (this.config.autoReconnect && wasConnected) {
      this.attemptReconnection();
    } else {
      this.setState('disconnected');
    }
  }

  private onError(error: Error): void {
    logger.error('WebSocket error', {
      component: 'WebSocketHealthMonitor',
      name: this.config.name,
      error: error.message,
    });

    // Record failure with circuit breaker
    if (this.config.useCircuitBreaker) {
      const breaker = circuitBreakerRegistry.get(
        `ws-${this.config.name}`,
        this.config.circuitBreakerConfig
      );

      // Record the failure - execute with a rejected promise to register the error
      breaker.execute(() => Promise.reject(error)).catch(() => {
        // Expected rejection - we're just recording the failure
      });

      // Check if circuit is now open after recording the failure
      const stats = breaker.getStats();
      if (stats.state === 'open') {
        this.emitEvent('circuit_opened');
      }
    }
  }

  private onMessage(data: WebSocket.Data): void {
    this.recordMessageReceived();

    // Check for application-level pong response in message
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'pong' && message.id === this.pendingPing?.id) {
        this.handleApplicationPong();
      }
    } catch {
      // Not a JSON message or not a pong - ignore
    }
  }

  private onProtocolPong(): void {
    // Handle WebSocket protocol-level pong
    // Mark that we received a protocol pong to avoid double-counting
    if (this.pendingPing && !this.pendingPing.protocolPongReceived) {
      this.pendingPing.protocolPongReceived = true;
      this.handlePongResponse();
    }
  }

  private handleApplicationPong(): void {
    // Handle application-level pong (JSON message with type: 'pong')
    // Only count if we haven't already received a protocol pong
    if (this.pendingPing && !this.pendingPing.protocolPongReceived) {
      this.handlePongResponse();
    }
    // If protocol pong was already received, this is a duplicate - ignore
  }

  private handlePongResponse(): void {
    if (!this.pendingPing) return;

    const latency = Date.now() - this.pendingPing.sentAt;
    this.latencySamples.push(latency);

    // Keep only the last N samples
    if (this.latencySamples.length > this.config.latencySampleSize) {
      this.latencySamples.shift();
    }

    this.pongsReceived++;
    this.consecutiveMissedPongs = 0;
    this.lastPongTime = Date.now();
    this.pendingPing = null;

    this.clearPongTimeout();
    this.checkQualityChange();

    this.emitEvent('pong_received');
  }

  private startPingInterval(): void {
    this.stopPingInterval();

    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, this.config.pingIntervalMs);

    // Send initial ping
    this.sendPing();
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // If we still have a pending ping that hasn't been responded to,
    // count it as a missed pong
    if (this.pendingPing) {
      this.consecutiveMissedPongs++;
      this.checkConnectionHealth();
    }

    const pingId = randomUUID();
    this.pendingPing = {
      id: pingId,
      sentAt: Date.now(),
      protocolPongReceived: false,
    };
    this.pingsSent++;

    // Send both protocol-level ping and application-level ping
    // The protocol-level ping is more reliable but some proxies strip it
    try {
      this.ws.ping();

      // Also send application-level ping as backup
      this.ws.send(JSON.stringify({
        type: 'ping',
        id: pingId,
        timestamp: Date.now(),
      }));
    } catch (error) {
      logger.debug('Failed to send ping', {
        component: 'WebSocketHealthMonitor',
        name: this.config.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    this.emitEvent('ping_sent');

    // Set timeout for pong response
    this.setPongTimeout();
  }

  private setPongTimeout(): void {
    this.clearPongTimeout();

    this.pongTimeout = setTimeout(() => {
      if (this.pendingPing) {
        this.consecutiveMissedPongs++;
        this.pendingPing = null;
        this.checkConnectionHealth();
        this.emitEvent('pong_timeout');
      }
    }, this.config.pongTimeoutMs);
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private checkConnectionHealth(): void {
    if (this.consecutiveMissedPongs >= this.config.missedPongsThreshold) {
      logger.warn('Connection appears dead - missed pong threshold reached', {
        component: 'WebSocketHealthMonitor',
        name: this.config.name,
        consecutiveMissedPongs: this.consecutiveMissedPongs,
        threshold: this.config.missedPongsThreshold,
      });

      // Force close and trigger reconnection
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(4000, 'Connection health check failed');
      }
    }

    this.checkQualityChange();
  }

  private async attemptReconnection(): Promise<boolean> {
    if (this.isDestroyed) return false;

    // Check circuit breaker
    if (this.config.useCircuitBreaker) {
      const breaker = circuitBreakerRegistry.get(
        `ws-${this.config.name}`,
        this.config.circuitBreakerConfig
      );

      if (!breaker.canExecute()) {
        logger.warn('Circuit breaker is open, skipping reconnection', {
          component: 'WebSocketHealthMonitor',
          name: this.config.name,
        });
        this.setState('disconnected');
        this.emitEvent('reconnect_failed', { error: 'Circuit breaker is open' });
        return false;
      }
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error('Maximum reconnection attempts reached', {
        component: 'WebSocketHealthMonitor',
        name: this.config.name,
        attempts: this.reconnectAttempts,
      });
      this.setState('disconnected');
      this.emitEvent('reconnect_failed', { error: 'Maximum attempts reached' });
      return false;
    }

    this.reconnectAttempts++;
    this.setState('reconnecting');

    const delay = calculateBackoffDelay(this.reconnectAttempts, {
      baseDelayMs: this.config.reconnectBaseDelayMs,
      maxDelayMs: this.config.reconnectMaxDelayMs,
      backoffMultiplier: this.config.reconnectBackoffMultiplier,
      useJitter: true,
      jitterFactor: 0.1,
    });

    logger.info(`Attempting WebSocket reconnection in ${delay}ms`, {
      component: 'WebSocketHealthMonitor',
      name: this.config.name,
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
      delayMs: delay,
    });

    this.emitEvent('reconnecting', { reconnectAttempt: this.reconnectAttempts });

    await this.sleep(delay);

    if (this.isDestroyed) return false;

    try {
      // Clean up old WebSocket
      if (this.ws) {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
        this.ws = null;
      }

      // Create new WebSocket
      const newWs = this.wsFactory(this.wsUrl, this.wsHeaders);

      // Set up handlers BEFORE waiting for open to avoid race conditions
      // This ensures close/error handlers are registered even if connection
      // fails between creation and open event
      this.ws = newWs;
      this.setupWebSocketHandlers(newWs);

      // Wait for connection with configurable timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          newWs.close();
          reject(new Error('Connection timeout'));
        }, this.config.reconnectConnectionTimeoutMs);

        // Use once handlers that remove themselves after firing
        const onOpen = () => {
          clearTimeout(timeout);
          newWs.off('error', onError);
          resolve();
        };

        const onError = (error: Error) => {
          clearTimeout(timeout);
          newWs.off('open', onOpen);
          reject(error);
        };

        newWs.once('open', onOpen);
        newWs.once('error', onError);
      });

      // Connection successful - onConnected will be called by the 'open' handler
      // we set up in setupWebSocketHandlers, but we need to ensure it's called
      // in case the socket was already open when we attached handlers
      if (newWs.readyState === WebSocket.OPEN && this.state !== 'connected') {
        this.onConnected();
      }

      return true;
    } catch (error) {
      logger.error('Reconnection attempt failed', {
        component: 'WebSocketHealthMonitor',
        name: this.config.name,
        attempt: this.reconnectAttempts,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Record failure with circuit breaker
      if (this.config.useCircuitBreaker) {
        const breaker = circuitBreakerRegistry.get(
          `ws-${this.config.name}`,
          this.config.circuitBreakerConfig
        );
        await breaker.execute(() => Promise.reject(error));
      }

      // Try again if we haven't hit the limit
      if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
        return this.attemptReconnection();
      }

      this.setState('disconnected');
      this.emitEvent('reconnect_failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }

  private calculateQuality(): WebSocketConnectionQuality {
    if (this.state !== 'connected') {
      return 'disconnected';
    }

    const latency = this.getAverageLatency();
    const packetLoss = this.calculatePacketLoss();

    // If we don't have enough data, assume excellent
    if (latency === null || this.pingsSent < 3) {
      return 'excellent';
    }

    // Excellent: low latency, no packet loss
    if (latency <= this.config.excellentLatencyThresholdMs &&
        packetLoss <= this.config.excellentPacketLossThreshold) {
      return 'excellent';
    }

    // Good: moderate latency or minimal packet loss
    if (latency <= this.config.goodLatencyThresholdMs &&
        packetLoss <= this.config.goodPacketLossThreshold) {
      return 'good';
    }

    // Poor: high latency or significant packet loss
    return 'poor';
  }

  private getAverageLatency(): number | null {
    if (this.latencySamples.length === 0) {
      return null;
    }

    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencySamples.length);
  }

  private calculatePacketLoss(): number {
    if (this.pingsSent === 0) {
      return 0;
    }

    return (this.pingsSent - this.pongsReceived) / this.pingsSent;
  }

  private checkQualityChange(): void {
    const newQuality = this.calculateQuality();

    if (newQuality !== this.lastQuality) {
      const previousQuality = this.lastQuality;
      this.lastQuality = newQuality;

      this.emitEvent('quality_changed', { previousQuality });

      // Log significant quality changes
      if (previousQuality !== 'disconnected' && newQuality !== 'disconnected') {
        logger.info('WebSocket connection quality changed', {
          component: 'WebSocketHealthMonitor',
          name: this.config.name,
          previousQuality,
          newQuality,
          latencyMs: this.getAverageLatency(),
          packetLoss: this.calculatePacketLoss(),
        });
      }
    }
  }

  private setState(state: WebSocketConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.checkQualityChange();
    }
  }

  private emitEvent(
    type: WebSocketHealthEventType,
    extra?: { error?: string; previousQuality?: WebSocketConnectionQuality; reconnectAttempt?: number }
  ): void {
    const event: WebSocketHealthEvent = {
      type,
      timestamp: Date.now(),
      metrics: this.getMetrics(),
      ...extra,
    };

    for (const listener of this.eventListeners) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          result.catch((e) => {
            logger.debug('Error in health event listener', {
              component: 'WebSocketHealthMonitor',
              error: e instanceof Error ? e.message : 'Unknown error',
            });
          });
        }
      } catch (e) {
        logger.debug('Error in health event listener', {
          component: 'WebSocketHealthMonitor',
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }
  }

  private resetStats(): void {
    this.pingsSent = 0;
    this.pongsReceived = 0;
    this.consecutiveMissedPongs = 0;
    this.reconnectAttempts = 0;
    this.successfulReconnections = 0;
    this.lastPongTime = null;
    this.lastMessageTime = null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a WebSocket health monitor with default WebSocket factory
 */
export function createWebSocketHealthMonitor(config: WebSocketHealthConfig = {}): WebSocketHealthMonitor {
  const factory: WebSocketFactory = (url, headers) => {
    return new WebSocket(url, { headers });
  };

  return new WebSocketHealthMonitor(factory, config);
}
