#!/usr/bin/env tsx
/**
 * Database Health Check Script
 *
 * Checks database connectivity and reports status.
 * Usage: npm run db:check
 */

import 'dotenv/config';
import pg from 'pg';
import {
  validateSchema,
  formatSchemaErrors,
  getCurrentMigrationVersion,
  getAppliedMigrations,
  getDatabaseDiagnostics,
  DATABASE_URL,
} from '@webedt/shared';

const { Pool } = pg;

async function main(): Promise<void> {
  console.log('');
  console.log('🔍 Database Health Check');
  console.log('═'.repeat(60));
  console.log('');

  const databaseUrl = DATABASE_URL;

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
    // Test basic connectivity
    console.log('Testing connection...');
    const startTime = Date.now();
    await pool.query('SELECT 1');
    const latency = Date.now() - startTime;
    console.log(`  ✅ Connected successfully (${latency}ms)`);
    console.log('');

    // Get PostgreSQL version
    const versionResult = await pool.query('SELECT version()');
    console.log(`📊 PostgreSQL Version:`);
    console.log(`  ${versionResult.rows[0].version.split(',')[0]}`);
    console.log('');

    // Get database name
    const dbNameResult = await pool.query('SELECT current_database()');
    console.log(`📁 Database: ${dbNameResult.rows[0].current_database}`);
    console.log('');

    // Check migration status
    console.log('📋 Migration Status:');
    const currentVersion = await getCurrentMigrationVersion(pool);
    const appliedMigrations = await getAppliedMigrations(pool);

    if (currentVersion) {
      console.log(`  Current version: ${currentVersion}`);
      console.log(`  Applied migrations: ${appliedMigrations.length}`);
    } else {
      console.log('  No migrations applied yet (or using inline schema)');
    }
    console.log('');

    // Validate schema
    console.log('🔎 Schema Validation:');
    const validation = await validateSchema(pool);

    if (validation.valid) {
      console.log('  ✅ Schema is valid');
    } else {
      console.log('');
      console.log(formatSchemaErrors(validation));
    }

    if (validation.warnings.length > 0) {
      console.log('');
      console.log('  Warnings:');
      for (const warning of validation.warnings) {
        console.log(`    ⚠️  ${warning}`);
      }
    }
    console.log('');

    // Get table statistics
    console.log('📊 Table Statistics:');
    const tablesResult = await pool.query(`
      SELECT
        schemaname,
        relname as table_name,
        n_live_tup as row_count,
        pg_size_pretty(pg_total_relation_size(relid)) as total_size
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC;
    `);

    if (tablesResult.rows.length > 0) {
      console.log('');
      console.log('  Table                  Rows        Size');
      console.log('  ' + '─'.repeat(50));
      for (const row of tablesResult.rows) {
        const tableName = row.table_name.padEnd(20);
        const rowCount = String(row.row_count).padStart(10);
        const size = row.total_size.padStart(12);
        console.log(`  ${tableName} ${rowCount} ${size}`);
      }
    } else {
      console.log('  No tables found');
    }
    console.log('');

    // Get connection pool settings
    console.log('⚙️  Connection Settings:');
    const maxConnectionsResult = await pool.query('SHOW max_connections');
    console.log(`  Max connections: ${maxConnectionsResult.rows[0].max_connections}`);
    console.log('');

    console.log('═'.repeat(60));
    console.log('✅ Database health check completed successfully');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Health check failed');
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
