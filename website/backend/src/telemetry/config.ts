/**
 * OpenTelemetry Configuration
 *
 * Defines the configuration options for distributed tracing.
 * Supports console export in development and OTLP export in production.
 */

export interface TelemetryConfig {
  /** Service name for trace attribution */
  serviceName: string;

  /** Service version for trace attribution */
  serviceVersion: string;

  /** Enable/disable telemetry */
  enabled: boolean;

  /** Export format: 'console' for development, 'otlp' for production */
  exporterType: 'console' | 'otlp' | 'none';

  /** OTLP endpoint for production (e.g., http://jaeger:4318/v1/traces) */
  otlpEndpoint?: string;

  /** Sample rate (0.0 to 1.0) - 1.0 means sample all traces */
  sampleRate: number;

  /** Enable Express route instrumentation */
  instrumentExpress: boolean;

  /** Enable HTTP client instrumentation */
  instrumentHttp: boolean;

  /** Enable PostgreSQL/pg instrumentation */
  instrumentPg: boolean;

  /** Log spans to console (for debugging) */
  debugSpans: boolean;
}

/**
 * Environment variable names for telemetry configuration
 */
const ENV_VARS = {
  OTEL_ENABLED: 'OTEL_ENABLED',
  OTEL_EXPORTER_TYPE: 'OTEL_EXPORTER_TYPE',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  OTEL_SAMPLE_RATE: 'OTEL_SAMPLE_RATE',
  OTEL_DEBUG_SPANS: 'OTEL_DEBUG_SPANS',
  NODE_ENV: 'NODE_ENV',
} as const;

/**
 * Load telemetry configuration from environment variables
 */
export function loadTelemetryConfig(): TelemetryConfig {
  const nodeEnv = process.env[ENV_VARS.NODE_ENV] || 'development';
  const isDevelopment = nodeEnv === 'development';

  // Check if telemetry is explicitly enabled/disabled
  const otelEnabled = process.env[ENV_VARS.OTEL_ENABLED];
  let enabled: boolean;
  if (otelEnabled !== undefined) {
    enabled = otelEnabled === 'true' || otelEnabled === '1';
  } else {
    // Default: enabled in development for console output, disabled in production unless configured
    enabled = isDevelopment;
  }

  // Determine exporter type
  let exporterType: 'console' | 'otlp' | 'none';
  const configuredExporter = process.env[ENV_VARS.OTEL_EXPORTER_TYPE];
  if (configuredExporter === 'otlp' || configuredExporter === 'console' || configuredExporter === 'none') {
    exporterType = configuredExporter;
  } else if (process.env[ENV_VARS.OTEL_EXPORTER_OTLP_ENDPOINT]) {
    // If OTLP endpoint is configured, use OTLP exporter
    exporterType = 'otlp';
  } else {
    // Default to console in development, none in production
    exporterType = isDevelopment ? 'console' : 'none';
  }

  // Parse sample rate (default: 1.0 in dev, 0.1 in production)
  const sampleRateStr = process.env[ENV_VARS.OTEL_SAMPLE_RATE];
  let sampleRate: number;
  if (sampleRateStr) {
    sampleRate = parseFloat(sampleRateStr);
    if (isNaN(sampleRate) || sampleRate < 0 || sampleRate > 1) {
      console.warn(`[Telemetry] Invalid OTEL_SAMPLE_RATE "${sampleRateStr}", using default`);
      sampleRate = isDevelopment ? 1.0 : 0.1;
    }
  } else {
    sampleRate = isDevelopment ? 1.0 : 0.1;
  }

  // Debug spans flag
  const debugSpans = process.env[ENV_VARS.OTEL_DEBUG_SPANS] === 'true';

  return {
    serviceName: 'webedt-backend',
    serviceVersion: process.env.BUILD_VERSION || '1.0.0',
    enabled,
    exporterType,
    otlpEndpoint: process.env[ENV_VARS.OTEL_EXPORTER_OTLP_ENDPOINT],
    sampleRate,
    instrumentExpress: true,
    instrumentHttp: true,
    instrumentPg: true,
    debugSpans,
  };
}

/**
 * Log the current telemetry configuration
 */
export function logTelemetryConfig(config: TelemetryConfig): void {
  if (!config.enabled) {
    console.log('[Telemetry] Distributed tracing is disabled');
    return;
  }

  console.log('[Telemetry] Configuration:');
  console.log(`  Service: ${config.serviceName} v${config.serviceVersion}`);
  console.log(`  Exporter: ${config.exporterType}`);
  if (config.exporterType === 'otlp' && config.otlpEndpoint) {
    console.log(`  OTLP Endpoint: ${config.otlpEndpoint}`);
  }
  console.log(`  Sample Rate: ${(config.sampleRate * 100).toFixed(0)}%`);
  console.log(`  Instrumentations: Express=${config.instrumentExpress}, HTTP=${config.instrumentHttp}, PG=${config.instrumentPg}`);
  if (config.debugSpans) {
    console.log('  Debug: Span logging enabled');
  }
}
