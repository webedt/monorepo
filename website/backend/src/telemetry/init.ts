/**
 * OpenTelemetry Initialization
 *
 * IMPORTANT: This file must be imported and called BEFORE any other imports
 * to ensure instrumentation is registered before modules are loaded.
 *
 * Usage in index.ts:
 *   import { initializeTelemetry } from './telemetry/init.js';
 *   initializeTelemetry();
 *   // ... rest of imports
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { TelemetryConfig } from './config.js';
import { loadTelemetryConfig, logTelemetryConfig } from './config.js';

let sdk: NodeSDK | null = null;
let isInitialized = false;

/**
 * Initialize the OpenTelemetry SDK
 *
 * This must be called before any other imports to ensure auto-instrumentation
 * captures all HTTP, Express, and database calls.
 *
 * @param overrideConfig - Optional configuration overrides
 * @returns The loaded configuration
 */
export function initializeTelemetry(overrideConfig?: Partial<TelemetryConfig>): TelemetryConfig {
  if (isInitialized) {
    console.warn('[Telemetry] Already initialized, skipping');
    return loadTelemetryConfig();
  }

  const config = { ...loadTelemetryConfig(), ...overrideConfig };

  if (!config.enabled) {
    logTelemetryConfig(config);
    isInitialized = true;
    return config;
  }

  // Create resource with service information
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    'deployment.environment.name': process.env.NODE_ENV || 'development',
  });

  // Configure span exporter based on config
  let traceExporter: SpanExporter | undefined;
  if (config.exporterType === 'console') {
    traceExporter = new ConsoleSpanExporter();
  } else if (config.exporterType === 'otlp' && config.otlpEndpoint) {
    traceExporter = new OTLPTraceExporter({
      url: config.otlpEndpoint,
    });
  } else {
    // No exporter configured, telemetry is effectively disabled
    logTelemetryConfig({ ...config, enabled: false });
    isInitialized = true;
    return config;
  }

  // Configure auto-instrumentations
  const instrumentations = getNodeAutoInstrumentations({
    // Express instrumentation for route tracing
    '@opentelemetry/instrumentation-express': {
      enabled: config.instrumentExpress,
    },
    // HTTP instrumentation for outbound requests
    '@opentelemetry/instrumentation-http': {
      enabled: config.instrumentHttp,
      // Ignore health check endpoints to reduce noise
      ignoreIncomingRequestHook: (request) => {
        const url = request.url || '';
        return url === '/health' || url === '/ready' || url === '/live' || url === '/metrics';
      },
    },
    // PostgreSQL instrumentation for database queries
    '@opentelemetry/instrumentation-pg': {
      enabled: config.instrumentPg,
      // Add query text to spans (be careful with PII in production)
      enhancedDatabaseReporting: process.env.NODE_ENV === 'development',
    },
    // Disable instrumentations we don't need
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
    '@opentelemetry/instrumentation-net': { enabled: false },
  });

  // Configure sampler based on sample rate
  const sampler = new TraceIdRatioBasedSampler(config.sampleRate);

  // Initialize the SDK
  sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations,
    sampler,
  });

  try {
    sdk.start();
    logTelemetryConfig(config);
    console.log('[Telemetry] SDK initialized successfully');
    isInitialized = true;
    // Note: Shutdown is handled by gracefulShutdown.ts to avoid duplicate handlers
  } catch (error) {
    console.error('[Telemetry] Failed to initialize SDK:', error);
    isInitialized = true; // Prevent retry
  }

  return config;
}

/**
 * Gracefully shutdown the OpenTelemetry SDK
 *
 * Flushes any pending spans before shutdown.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log('[Telemetry] SDK shut down successfully');
    } catch (error) {
      console.error('[Telemetry] Error during SDK shutdown:', error);
    }
  }
}

/**
 * Check if telemetry is initialized
 */
export function isTelemetryInitialized(): boolean {
  return isInitialized;
}
