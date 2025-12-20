#!/usr/bin/env tsx
/**
 * Database Schema Validation Script
 *
 * Validates the database schema against expected structure.
 * Usage: npm run db:validate
 */

import 'dotenv/config';
import pg from 'pg';
import {
  validateSchema,
  formatSchemaErrors,
  getCurrentMigrationVersion,
  getDatabaseDiagnostics,
} from '@webedt/shared';

const { Pool } = pg;

async function main(): Promise<void> {
  console.log('');
  console.log('🔎 Database Schema Validation');
  console.log('═'.repeat(60));
  console.log('');

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.error('');
    console.error('Set DATABASE_URL to your PostgreSQL connection string:');
    console.error('  export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname');
    process.exit(1);
  }

  // Mask password in URL for display
  const maskedUrl = databaseUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`📡 Connecting to: ${maskedUrl}`);
  console.log('');

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('✅ Connected to database');
    console.log('');

    // Check migration version
    const currentVersion = await getCurrentMigrationVersion(pool);
    console.log('📋 Migration Status:');
    console.log(`  Version: ${currentVersion || 'none (inline schema)'}`);
    console.log('');

    // Validate schema
    console.log('Validating schema...');
    console.log('');

    const validation = await validateSchema(pool);

    if (validation.valid) {
      console.log('✅ Schema validation passed');
      console.log('');
      console.log('All required tables and columns are present.');
    } else {
      console.log(formatSchemaErrors(validation));
    }

    if (validation.warnings.length > 0) {
      console.log('');
      console.log('⚠️  Warnings:');
      for (const warning of validation.warnings) {
        console.log(`  • ${warning}`);
      }
    }

    console.log('');
    console.log('═'.repeat(60));

    // Exit with error code if validation failed
    if (!validation.valid) {
      console.log('❌ Schema validation failed');
      process.exit(1);
    }

    console.log('✅ Schema validation completed');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Validation failed');
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
