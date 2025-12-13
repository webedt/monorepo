import { type Config } from './schema.js';
import { type MigrationResult } from './migrations.js';
/**
 * Generate comprehensive configuration help text
 */
export declare function getConfigHelp(): string;
/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
    /** Path to configuration file */
    configPath?: string;
    /** Whether to automatically migrate old configs (default: true) */
    autoMigrate?: boolean;
    /** Whether to show deprecation warnings (default: true) */
    showDeprecationWarnings?: boolean;
}
export declare function loadConfig(configPath?: string, options?: Omit<LoadConfigOptions, 'configPath'>): Config;
export type { Config } from './schema.js';
/**
 * Result of an upgrade operation
 */
export interface UpgradeResult {
    success: boolean;
    configPath: string;
    migrationResult: MigrationResult;
    backupPath?: string;
}
/**
 * Upgrade a configuration file to the latest version
 * Creates a backup of the original file before modifying
 */
export declare function upgradeConfig(configPath?: string): UpgradeResult;
export { migrateConfig, needsMigration, checkDeprecatedFields, formatMigrationSummary, detectConfigVersion, CURRENT_CONFIG_VERSION, type MigrationResult, } from './migrations.js';
export { CURRENT_CONFIG_VERSION as CONFIG_VERSION } from './schema.js';
//# sourceMappingURL=index.d.ts.map