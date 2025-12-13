/**
 * Configuration Migration System
 *
 * This module handles migration of configuration files between versions.
 * When the configuration schema changes in breaking ways, migrations
 * ensure backward compatibility by transforming old configs to the new format.
 */
import { type ConfigVersion } from './schema.js';
export { CURRENT_CONFIG_VERSION, SUPPORTED_CONFIG_VERSIONS } from './schema.js';
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
 * Deprecated configuration fields that should trigger warnings
 */
export declare const DEPRECATED_FIELDS: Record<string, {
    message: string;
    replacement?: string;
    example?: string;
}>;
/**
 * Detect the version of a configuration object
 * Returns 1 for legacy configs without version field
 */
export declare function detectConfigVersion(config: Record<string, unknown>): number;
/**
 * Check if a configuration version is supported
 */
export declare function isVersionSupported(version: number): version is ConfigVersion;
/**
 * Migrate a configuration from its current version to the latest version
 */
export declare function migrateConfig(config: Record<string, unknown>): MigrationResult;
/**
 * Check for deprecated fields in a configuration and return warnings
 */
export declare function checkDeprecatedFields(config: Record<string, unknown>): string[];
/**
 * Generate a summary of migration changes for display
 */
export declare function formatMigrationSummary(result: MigrationResult): string;
/**
 * Check if a configuration needs migration
 */
export declare function needsMigration(config: Record<string, unknown>): boolean;
//# sourceMappingURL=migrations.d.ts.map