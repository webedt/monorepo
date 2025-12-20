/**
 * Configuration Migration System
 *
 * This module handles migration of configuration files between versions.
 * When the configuration schema changes in breaking ways, migrations
 * ensure backward compatibility by transforming old configs to the new format.
 */

import { CURRENT_CONFIG_VERSION, type ConfigVersion, SUPPORTED_CONFIG_VERSIONS } from './schema.js';

// Re-export CURRENT_CONFIG_VERSION for convenience
export { CURRENT_CONFIG_VERSION, SUPPORTED_CONFIG_VERSIONS } from './schema.js';
import { logger } from '../utils/logger.js';

/**
 * Result of a migration operation
 */
export interface MigrationResult {
  /** Whether migration was successful */
  success: boolean;
  /** The migrated configuration (if successful) */
  config?: Record<string, unknown>;
  /** Original version before migration */
  fromVersion: number;
  /** Target version after migration */
  toVersion: number;
  /** List of changes made during migration */
  changes: MigrationChange[];
  /** Warnings about deprecated options or manual intervention needed */
  warnings: string[];
  /** Errors encountered during migration */
  errors: string[];
}

/**
 * Describes a single change made during migration
 */
export interface MigrationChange {
  /** Type of change */
  type: 'added' | 'removed' | 'renamed' | 'modified' | 'deprecated';
  /** Path to the affected field (e.g., 'repo.owner') */
  path: string;
  /** Description of the change */
  description: string;
  /** Old value (if applicable) */
  oldValue?: unknown;
  /** New value (if applicable) */
  newValue?: unknown;
}

/**
 * Migration function type
 * Takes a config and returns the migrated config
 */
type MigrationFn = (config: Record<string, unknown>) => {
  config: Record<string, unknown>;
  changes: MigrationChange[];
  warnings: string[];
};

/**
 * Registry of migrations from one version to the next
 */
const migrations: Map<number, MigrationFn> = new Map();

/**
 * Migration from v1 to v2
 *
 * Changes in v2:
 * - Added 'version' field (required)
 * - Added 'pullRequest' section with PR management options
 * - Added 'logging' section with structured logging options
 * - Added 'alerting' section for alert configuration
 * - Added 'metrics' section for performance tracking
 * - Added 'circuitBreaker' section for resilience settings
 * - Added 'cache' section for analysis caching
 * - Renamed 'discovery.maxDepth' default from undefined to 10
 * - Renamed 'discovery.maxFiles' default from undefined to 10000
 */
migrations.set(1, (config: Record<string, unknown>) => {
  const changes: MigrationChange[] = [];
  const warnings: string[] = [];
  const migrated = { ...config };

  // Add version field
  migrated.version = 2;
  changes.push({
    type: 'added',
    path: 'version',
    description: 'Added configuration version field',
    newValue: 2,
  });

  // Add pullRequest section if not present
  if (!migrated.pullRequest) {
    migrated.pullRequest = {
      useDraftPRs: false,
      autoAssignReviewers: true,
      usePRTemplate: true,
      generateDescription: true,
      addCategoryLabels: true,
      addPriorityLabels: false,
      defaultPriority: 'medium',
      checkBranchProtection: true,
      additionalLabels: ['autonomous-dev'],
      defaultReviewers: [],
      maxReviewers: 5,
      linkIssue: true,
      includeChangedFiles: true,
      maxChangedFilesInDescription: 10,
    };
    changes.push({
      type: 'added',
      path: 'pullRequest',
      description: 'Added pull request management section with default values',
    });
  }

  // Add logging section if not present
  if (!migrated.logging) {
    migrated.logging = {
      format: 'pretty',
      level: 'info',
      includeCorrelationId: true,
      includeTimestamp: true,
      enableStructuredFileLogging: false,
      structuredLogDir: './logs',
      maxLogFileSizeBytes: 10 * 1024 * 1024,
      maxLogFiles: 5,
      includeMetrics: true,
      rotationPolicy: 'size',
      rotationInterval: 'daily',
      maxLogAgeDays: 30,
    };
    changes.push({
      type: 'added',
      path: 'logging',
      description: 'Added logging configuration section with default values',
    });
  }

  // Add alerting section if not present
  if (!migrated.alerting) {
    migrated.alerting = {
      enabled: true,
      cooldownMs: 60000,
      maxAlertsPerMinute: 30,
      consoleOutput: true,
      webhookMinSeverity: 'error',
    };
    changes.push({
      type: 'added',
      path: 'alerting',
      description: 'Added alerting configuration section with default values',
    });
  }

  // Add metrics section if not present
  if (!migrated.metrics) {
    migrated.metrics = {
      enableRegressionDetection: true,
      regressionThresholdPercent: 20,
      enableComplexityTracking: true,
      baselineSampleSize: 100,
      enableDashboard: true,
      metricsPort: 9090,
    };
    changes.push({
      type: 'added',
      path: 'metrics',
      description: 'Added metrics configuration section with default values',
    });
  }

  // Add circuitBreaker section if not present
  if (!migrated.circuitBreaker) {
    migrated.circuitBreaker = {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      baseDelayMs: 100,
      maxDelayMs: 30000,
      successThreshold: 1,
      enabled: true,
    };
    changes.push({
      type: 'added',
      path: 'circuitBreaker',
      description: 'Added circuit breaker resilience configuration with default values',
    });
  }

  // Add cache section if not present
  if (!migrated.cache) {
    migrated.cache = {
      enabled: true,
      maxEntries: 100,
      ttlMinutes: 30,
      maxSizeMB: 100,
      cacheDir: '.autonomous-dev-cache',
      persistToDisk: true,
      useGitInvalidation: true,
      enableIncrementalAnalysis: true,
      warmOnStartup: true,
    };
    changes.push({
      type: 'added',
      path: 'cache',
      description: 'Added analysis cache configuration with default values',
    });
  }

  // Ensure discovery section has new fields
  const discovery = migrated.discovery as Record<string, unknown> | undefined;
  if (discovery) {
    if (discovery.maxDepth === undefined) {
      discovery.maxDepth = 10;
      changes.push({
        type: 'added',
        path: 'discovery.maxDepth',
        description: 'Added maxDepth field with default value',
        newValue: 10,
      });
    }
    if (discovery.maxFiles === undefined) {
      discovery.maxFiles = 10000;
      changes.push({
        type: 'added',
        path: 'discovery.maxFiles',
        description: 'Added maxFiles field with default value',
        newValue: 10000,
      });
    }
  }

  // Check for any deprecated fields and warn
  if ((config as any).debug !== undefined) {
    warnings.push(
      'The "debug" field is deprecated. Use "logging.level: debug" instead. ' +
      'Example: { "logging": { "level": "debug" } }'
    );
    changes.push({
      type: 'deprecated',
      path: 'debug',
      description: 'Field deprecated in favor of logging.level',
      oldValue: (config as any).debug,
    });
  }

  if ((config as any).verbose !== undefined) {
    warnings.push(
      'The "verbose" field is deprecated. Use "logging.level: debug" instead. ' +
      'Example: { "logging": { "level": "debug" } }'
    );
    changes.push({
      type: 'deprecated',
      path: 'verbose',
      description: 'Field deprecated in favor of logging.level',
      oldValue: (config as any).verbose,
    });
  }

  return { config: migrated, changes, warnings };
});

/**
 * Deprecated configuration fields that should trigger warnings
 */
export const DEPRECATED_FIELDS: Record<string, { message: string; replacement?: string; example?: string }> = {
  'debug': {
    message: 'The "debug" field is deprecated.',
    replacement: 'logging.level',
    example: '{ "logging": { "level": "debug" } }',
  },
  'verbose': {
    message: 'The "verbose" field is deprecated.',
    replacement: 'logging.level',
    example: '{ "logging": { "level": "debug" } }',
  },
  'logFile': {
    message: 'The "logFile" field is deprecated.',
    replacement: 'logging.enableStructuredFileLogging and logging.structuredLogDir',
    example: '{ "logging": { "enableStructuredFileLogging": true, "structuredLogDir": "./logs" } }',
  },
};

/**
 * Detect the version of a configuration object
 * Returns 1 for legacy configs without version field
 */
export function detectConfigVersion(config: Record<string, unknown>): number {
  if (typeof config.version === 'number') {
    return config.version;
  }
  // Legacy config without version field is treated as v1
  return 1;
}

/**
 * Check if a configuration version is supported
 */
export function isVersionSupported(version: number): version is ConfigVersion {
  return SUPPORTED_CONFIG_VERSIONS.includes(version as ConfigVersion);
}

/**
 * Migrate a configuration from its current version to the latest version
 */
export function migrateConfig(config: Record<string, unknown>): MigrationResult {
  const fromVersion = detectConfigVersion(config);
  const toVersion = CURRENT_CONFIG_VERSION;

  // Already at current version
  if (fromVersion === toVersion) {
    return {
      success: true,
      config,
      fromVersion,
      toVersion,
      changes: [],
      warnings: [],
      errors: [],
    };
  }

  // Check if version is supported
  if (!isVersionSupported(fromVersion)) {
    return {
      success: false,
      fromVersion,
      toVersion,
      changes: [],
      warnings: [],
      errors: [
        `Unsupported configuration version: ${fromVersion}. ` +
        `Supported versions: ${SUPPORTED_CONFIG_VERSIONS.join(', ')}. ` +
        `Please create a new configuration using "autonomous-dev init".`
      ],
    };
  }

  // Check if version is newer than current (shouldn't happen)
  if (fromVersion > toVersion) {
    return {
      success: false,
      fromVersion,
      toVersion,
      changes: [],
      warnings: [],
      errors: [
        `Configuration version ${fromVersion} is newer than the supported version ${toVersion}. ` +
        `Please upgrade your CLI to the latest version.`
      ],
    };
  }

  // Apply migrations sequentially
  let currentConfig = { ...config };
  const allChanges: MigrationChange[] = [];
  const allWarnings: string[] = [];
  const allErrors: string[] = [];

  for (let v = fromVersion; v < toVersion; v++) {
    const migration = migrations.get(v);
    if (!migration) {
      allErrors.push(`No migration found for version ${v} to ${v + 1}`);
      return {
        success: false,
        fromVersion,
        toVersion,
        changes: allChanges,
        warnings: allWarnings,
        errors: allErrors,
      };
    }

    try {
      const result = migration(currentConfig);
      currentConfig = result.config;
      allChanges.push(...result.changes);
      allWarnings.push(...result.warnings);
      logger.debug(`Migrated config from v${v} to v${v + 1}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      allErrors.push(`Migration from v${v} to v${v + 1} failed: ${errorMessage}`);
      return {
        success: false,
        fromVersion,
        toVersion,
        changes: allChanges,
        warnings: allWarnings,
        errors: allErrors,
      };
    }
  }

  return {
    success: true,
    config: currentConfig,
    fromVersion,
    toVersion,
    changes: allChanges,
    warnings: allWarnings,
    errors: [],
  };
}

/**
 * Check for deprecated fields in a configuration and return warnings
 */
export function checkDeprecatedFields(config: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  const checkObject = (obj: Record<string, unknown>, prefix = ''): void => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const deprecation = DEPRECATED_FIELDS[path];

      if (deprecation) {
        let warning = deprecation.message;
        if (deprecation.replacement) {
          warning += ` Use "${deprecation.replacement}" instead.`;
        }
        if (deprecation.example) {
          warning += ` Example: ${deprecation.example}`;
        }
        warnings.push(warning);
      }

      // Recursively check nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        checkObject(value as Record<string, unknown>, path);
      }
    }
  };

  checkObject(config);
  return warnings;
}

/**
 * Generate a summary of migration changes for display
 */
export function formatMigrationSummary(result: MigrationResult): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push(`✓ Configuration migrated successfully from v${result.fromVersion} to v${result.toVersion}`);
    lines.push('');

    if (result.changes.length > 0) {
      lines.push('Changes made:');
      for (const change of result.changes) {
        const icon = change.type === 'added' ? '+' :
                     change.type === 'removed' ? '-' :
                     change.type === 'renamed' ? '~' :
                     change.type === 'deprecated' ? '!' : '*';
        lines.push(`  ${icon} ${change.path}: ${change.description}`);
      }
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push('Warnings:');
      for (const warning of result.warnings) {
        lines.push(`  ⚠ ${warning}`);
      }
      lines.push('');
    }
  } else {
    lines.push(`✗ Configuration migration failed from v${result.fromVersion} to v${result.toVersion}`);
    lines.push('');

    if (result.errors.length > 0) {
      lines.push('Errors:');
      for (const error of result.errors) {
        lines.push(`  ✗ ${error}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Check if a configuration needs migration
 */
export function needsMigration(config: Record<string, unknown>): boolean {
  const version = detectConfigVersion(config);
  return version < CURRENT_CONFIG_VERSION;
}
