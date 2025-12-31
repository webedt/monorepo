#!/usr/bin/env tsx
/**
 * Database Schema Validation and Drift Detection Script
 *
 * Pre-deployment validation to catch schema mismatches before production.
 *
 * Features:
 * - Validates database schema against expected structure
 * - Detects schema drift between Drizzle definitions and actual database
 * - Reports missing tables/columns, type mismatches, index differences
 * - Generates migration suggestions for detected drift
 * - Exits non-zero if drift detected (for CI integration)
 *
 * Usage:
 *   npm run db:validate           # Full validation with drift detection
 *   npm run db:validate -- --ci   # CI mode: strict, exits on any drift
 *   npm run db:validate -- --show-suggestions  # Show migration SQL suggestions
 *   npm run db:validate -- --generate-expected # Generate EXPECTED_TABLES code
 */

import 'dotenv/config';
import pg from 'pg';
import {
  validateSchema,
  formatSchemaErrors,
  getCurrentMigrationVersion,
  getDatabaseDiagnostics,
  detectSchemaDrift,
  formatSchemaDriftResult,
  generateExpectedTables,
  formatExpectedTablesAsCode,
  DATABASE_URL,
} from '@webedt/shared';

const { Pool } = pg;

interface ValidationOptions {
  ci: boolean;
  showSuggestions: boolean;
  generateExpected: boolean;
}

function parseArgs(): ValidationOptions {
  const args = process.argv.slice(2);
  return {
    ci: args.includes('--ci'),
    showSuggestions: args.includes('--show-suggestions'),
    generateExpected: args.includes('--generate-expected'),
  };
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('');
  console.log('Database Schema Validation & Drift Detection');
  console.log('='.repeat(60));
  console.log('');

  const databaseUrl = DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is not set');
    console.error('');
    console.error('Set DATABASE_URL to your PostgreSQL connection string:');
    console.error('  export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname');
    process.exit(1);
  }

  // Mask password in URL for display
  const maskedUrl = databaseUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`Connecting to: ${maskedUrl}`);
  console.log('');

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  let hasErrors = false;

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('[OK] Connected to database');
    console.log('');

    // Check migration version
    const currentVersion = await getCurrentMigrationVersion(pool);
    console.log('Migration Status:');
    console.log(`  Version: ${currentVersion || 'none (inline schema)'}`);
    console.log('');

    // ========================================================================
    // PHASE 1: Basic Schema Validation (existing functionality)
    // ========================================================================
    console.log('-'.repeat(60));
    console.log('Phase 1: Basic Schema Validation');
    console.log('-'.repeat(60));
    console.log('');

    const validation = await validateSchema(pool);

    if (validation.valid) {
      console.log('[OK] Basic schema validation passed');
    } else {
      console.log('[FAIL] Basic schema validation failed');
      console.log('');
      console.log(formatSchemaErrors(validation));
      hasErrors = true;
    }

    if (validation.warnings.length > 0) {
      console.log('');
      console.log('Warnings:');
      for (const warning of validation.warnings) {
        console.log(`  [WARN] ${warning}`);
      }
    }

    console.log('');

    // ========================================================================
    // PHASE 2: Schema Drift Detection (new functionality)
    // ========================================================================
    console.log('-'.repeat(60));
    console.log('Phase 2: Schema Drift Detection');
    console.log('-'.repeat(60));
    console.log('');
    console.log('Comparing Drizzle schema definitions against database...');
    console.log('');

    const driftResult = await detectSchemaDrift(pool);

    if (driftResult.hasDrift) {
      console.log('[DRIFT] Schema drift detected');
      console.log('');
      console.log(formatSchemaDriftResult(driftResult));

      if (options.showSuggestions && driftResult.migrationSuggestions.length > 0) {
        console.log('');
        console.log('-'.repeat(60));
        console.log('Migration Suggestions:');
        console.log('-'.repeat(60));
        console.log('');
        for (const suggestion of driftResult.migrationSuggestions) {
          console.log(suggestion);
        }
      }

      hasErrors = true;
    } else {
      console.log('[OK] No schema drift detected');
      console.log('');
      console.log('Database schema matches Drizzle definitions');
    }

    // ========================================================================
    // PHASE 3: Generate EXPECTED_TABLES (optional)
    // ========================================================================
    if (options.generateExpected) {
      console.log('');
      console.log('-'.repeat(60));
      console.log('Generated EXPECTED_TABLES from Drizzle Schema:');
      console.log('-'.repeat(60));
      console.log('');

      const expectedTables = generateExpectedTables();
      console.log(formatExpectedTablesAsCode(expectedTables));
      console.log('');
      console.log(`Total tables: ${expectedTables.length}`);
    }

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('');
    console.log('='.repeat(60));

    if (hasErrors) {
      console.log('[FAIL] Validation failed');
      console.log('');

      if (options.ci) {
        console.log('CI mode: Exiting with error code 1');
        console.log('');
        console.log('To fix schema drift:');
        console.log('  1. Run: npx drizzle-kit push   (development)');
        console.log('  2. Or create a migration: npx drizzle-kit generate');
        console.log('  3. Apply migration: npm run db:migrate');
      } else {
        console.log('Run with --show-suggestions to see migration SQL');
        console.log('Run with --ci for strict CI validation');
      }

      process.exit(1);
    }

    console.log('[OK] All validations passed');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('[FAIL] Validation failed');
    console.error('');

    if (error instanceof Error) {
      console.error(getDatabaseDiagnostics(error));
    } else {
      console.error(`Error: ${error}`);
    }

    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
