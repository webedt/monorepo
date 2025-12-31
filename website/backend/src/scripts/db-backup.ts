#!/usr/bin/env tsx
/**
 * Database Backup Script
 *
 * Creates a SQL backup of the database schema and data.
 * Usage: npm run db:backup [-- --output /path/to/backup]
 */

import 'dotenv/config';
import pg from 'pg';
import * as path from 'path';
import { createBackup, getDatabaseDiagnostics, DATABASE_URL, BACKUP_DIR } from '@webedt/shared';

const { Pool } = pg;

function parseArgs(): { outputDir: string } {
  const args = process.argv.slice(2);
  let outputDir = BACKUP_DIR || './backups';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputDir = args[i + 1] || outputDir;
      i++;
    }
  }

  return { outputDir: path.resolve(outputDir) };
}

async function main(): Promise<void> {
  console.log('');
  console.log('💾 Database Backup');
  console.log('═'.repeat(60));
  console.log('');

  const databaseUrl = DATABASE_URL;
  const { outputDir } = parseArgs();

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.error('');
    console.error('Set DATABASE_URL to your PostgreSQL connection string:');
    console.error('  export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname');
    process.exit(1);
  }

  // Mask password in URL for display
  const maskedUrl = databaseUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`📡 Database: ${maskedUrl}`);
  console.log(`📁 Output directory: ${outputDir}`);
  console.log('');

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  try {
    // Test connection
    console.log('Connecting to database...');
    await pool.query('SELECT 1');
    console.log('  ✅ Connected');
    console.log('');

    // Create backup
    console.log('Creating backup...');
    const startTime = Date.now();
    const result = await createBackup(pool, outputDir);
    const duration = Date.now() - startTime;

    if (result.success) {
      console.log('');
      console.log('✅ Backup completed successfully');
      console.log('');
      console.log(`  📄 File: ${result.backupPath}`);
      console.log(`  ⏱️  Duration: ${duration}ms`);
      console.log(`  🕐 Timestamp: ${result.timestamp}`);
      console.log('');
    } else {
      console.error('');
      console.error(`❌ Backup failed: ${result.error}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('');
    console.error('❌ Backup failed');
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
