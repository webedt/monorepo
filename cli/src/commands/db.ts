import { Command } from 'commander';
import { db, users, getDatabaseCredentials, parseDatabaseUrl, eq } from '@webedt/shared';
import {
  isEncryptionEnabled,
  isEncrypted,
  safeEncrypt,
  safeEncryptJson,
  rotateEncryption,
} from '@webedt/shared';
import { sql } from 'drizzle-orm';
import net from 'net';

export const dbCommand = new Command('db')
  .description('Database operations');

// ============================================================================
// CHECK COMMAND
// ============================================================================

dbCommand
  .command('check')
  .description('Check database connection status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const credentials = getDatabaseCredentials();

    if (!credentials) {
      if (options.json) {
        console.log(JSON.stringify({ connected: false, error: 'No DATABASE_URL found' }, null, 2));
      } else {
        console.log('\nDatabase Connection Status:');
        console.log('  Connected: No');
        console.log('  Error: No DATABASE_URL found');
        console.log('');
        console.log('Checked:');
        console.log('  1. DATABASE_URL environment variable');
        console.log('  2. .env file in current directory');
        console.log('  3. .env file in parent directory');
      }
      process.exit(1);
    }

    const parsed = parseDatabaseUrl(credentials.connectionString);

    if (!parsed) {
      if (options.json) {
        console.log(JSON.stringify({ connected: false, error: 'Invalid DATABASE_URL format' }, null, 2));
      } else {
        console.log('\nDatabase Connection Status:');
        console.log('  Connected: No');
        console.log('  Error: Invalid DATABASE_URL format');
      }
      process.exit(1);
    }

    // Check if host is reachable
    const isReachable = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(parsed.port, parsed.host);
    });

    // Try actual DB connection
    let dbConnected = false;
    let dbError: string | null = null;

    if (isReachable) {
      try {
        await db.select({ one: sql`1` }).from(users).limit(1);
        dbConnected = true;
      } catch (error) {
        dbError = (error as Error).message;
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        connected: dbConnected,
        source: credentials.source,
        host: parsed.host,
        port: parsed.port,
        database: parsed.database,
        user: parsed.user,
        hostReachable: isReachable,
        error: dbError,
      }, null, 2));
      return;
    }

    console.log('\nDatabase Connection Status:');
    console.log(`  Source:       ${credentials.source}`);
    console.log(`  Host:         ${parsed.host}:${parsed.port}`);
    console.log(`  Database:     ${parsed.database}`);
    console.log(`  User:         ${parsed.user}`);
    console.log(`  Reachable:    ${isReachable ? 'Yes' : 'No'}`);
    console.log(`  Connected:    ${dbConnected ? 'Yes' : 'No'}`);
    if (dbError) {
      console.log(`  Error:        ${dbError.slice(0, 60)}`);
    }

    if (!dbConnected) {
      process.exit(1);
    }
  });

// ============================================================================
// ENCRYPT-DATA COMMAND
// ============================================================================

dbCommand
  .command('encrypt-data')
  .description('Encrypt existing plain text credentials in the database')
  .option('--dry-run', 'Show what would be encrypted without making changes')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!isEncryptionEnabled()) {
      console.error('Error: ENCRYPTION_KEY and ENCRYPTION_SALT environment variables must be set.');
      console.error('Generate with: openssl rand -hex 32 (for key) and openssl rand -hex 16 (for salt)');
      process.exit(1);
    }

    const allUsers = await db.select().from(users);
    const stats = {
      total: allUsers.length,
      alreadyEncrypted: 0,
      needsEncryption: 0,
      encrypted: 0,
      errors: 0,
      fields: {
        githubAccessToken: 0,
        claudeAuth: 0,
        codexAuth: 0,
        geminiAuth: 0,
        openrouterApiKey: 0,
        imageAiKeys: 0,
      },
    };

    for (const user of allUsers) {
      const updates: Record<string, unknown> = {};
      let needsUpdate = false;

      // Check githubAccessToken
      if (user.githubAccessToken && typeof user.githubAccessToken === 'string') {
        if (!isEncrypted(user.githubAccessToken)) {
          const encrypted = safeEncrypt(user.githubAccessToken);
          if (encrypted) {
            updates.githubAccessToken = encrypted;
            stats.fields.githubAccessToken++;
            needsUpdate = true;
          }
        } else {
          stats.alreadyEncrypted++;
        }
      }

      // Check openrouterApiKey
      if (user.openrouterApiKey && typeof user.openrouterApiKey === 'string') {
        if (!isEncrypted(user.openrouterApiKey)) {
          const encrypted = safeEncrypt(user.openrouterApiKey);
          if (encrypted) {
            updates.openrouterApiKey = encrypted;
            stats.fields.openrouterApiKey++;
            needsUpdate = true;
          }
        } else {
          stats.alreadyEncrypted++;
        }
      }

      // Check JSON auth fields
      const jsonFields = ['claudeAuth', 'codexAuth', 'geminiAuth', 'imageAiKeys'] as const;
      for (const field of jsonFields) {
        const value = user[field];
        if (value) {
          // Check if value is an object (unencrypted) or encrypted string
          if (typeof value === 'object') {
            const encrypted = safeEncryptJson(value);
            if (encrypted) {
              updates[field] = encrypted;
              stats.fields[field]++;
              needsUpdate = true;
            }
          } else if (typeof value === 'string' && isEncrypted(value)) {
            stats.alreadyEncrypted++;
          }
        }
      }

      if (needsUpdate) {
        stats.needsEncryption++;
        if (!options.dryRun) {
          try {
            await db.update(users).set(updates).where(eq(users.id, user.id));
            stats.encrypted++;
          } catch (error) {
            stats.errors++;
            if (!options.json) {
              console.error(`  Error encrypting user ${user.id}:`, error);
            }
          }
        }
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        success: stats.errors === 0,
        dryRun: options.dryRun,
        ...stats,
      }, null, 2));
      return;
    }

    console.log('\nEncryption Results:');
    console.log(`  Total users:         ${stats.total}`);
    console.log(`  Already encrypted:   ${stats.alreadyEncrypted}`);
    console.log(`  Needs encryption:    ${stats.needsEncryption}`);
    if (options.dryRun) {
      console.log(`  Would encrypt:       ${stats.needsEncryption} users`);
    } else {
      console.log(`  Successfully encrypted: ${stats.encrypted} users`);
    }
    console.log(`  Errors:              ${stats.errors}`);
    console.log('\nFields encrypted:');
    console.log(`  githubAccessToken:   ${stats.fields.githubAccessToken}`);
    console.log(`  claudeAuth:          ${stats.fields.claudeAuth}`);
    console.log(`  codexAuth:           ${stats.fields.codexAuth}`);
    console.log(`  geminiAuth:          ${stats.fields.geminiAuth}`);
    console.log(`  openrouterApiKey:    ${stats.fields.openrouterApiKey}`);
    console.log(`  imageAiKeys:         ${stats.fields.imageAiKeys}`);

    if (options.dryRun) {
      console.log('\n[DRY RUN] No changes were made. Remove --dry-run to encrypt data.');
    }
  });

// ============================================================================
// ROTATE-KEYS COMMAND
// ============================================================================

dbCommand
  .command('rotate-keys')
  .description('Rotate encryption keys for all encrypted credentials')
  .requiredOption('--old-key <key>', 'Old encryption key (ENCRYPTION_KEY)')
  .requiredOption('--old-salt <salt>', 'Old encryption salt (ENCRYPTION_SALT)')
  .requiredOption('--new-key <key>', 'New encryption key')
  .requiredOption('--new-salt <salt>', 'New encryption salt')
  .option('--dry-run', 'Show what would be rotated without making changes')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { oldKey, oldSalt, newKey, newSalt, dryRun } = options;

    // Validate inputs
    if (!oldKey || !oldSalt || !newKey || !newSalt) {
      console.error('Error: All key and salt parameters are required.');
      process.exit(1);
    }

    if (!/^[0-9a-fA-F]{32,}$/.test(oldSalt) || !/^[0-9a-fA-F]{32,}$/.test(newSalt)) {
      console.error('Error: Salt values must be hex strings of at least 32 characters.');
      process.exit(1);
    }

    const allUsers = await db.select().from(users);
    const stats = {
      total: allUsers.length,
      rotated: 0,
      skipped: 0,
      errors: 0,
      fields: {
        githubAccessToken: 0,
        claudeAuth: 0,
        codexAuth: 0,
        geminiAuth: 0,
        openrouterApiKey: 0,
        imageAiKeys: 0,
      },
    };

    for (const user of allUsers) {
      const updates: Record<string, string> = {};
      let needsUpdate = false;

      // Rotate text fields
      const textFields = ['githubAccessToken', 'openrouterApiKey'] as const;
      for (const field of textFields) {
        const value = user[field];
        if (value && typeof value === 'string' && isEncrypted(value)) {
          try {
            const rotated = rotateEncryption(value, oldKey, oldSalt, newKey, newSalt);
            updates[field] = rotated;
            stats.fields[field]++;
            needsUpdate = true;
          } catch (error) {
            stats.errors++;
            if (!options.json) {
              console.error(`  Error rotating ${field} for user ${user.id}:`, error);
            }
          }
        }
      }

      // Rotate JSON fields (stored as encrypted strings)
      const jsonFields = ['claudeAuth', 'codexAuth', 'geminiAuth', 'imageAiKeys'] as const;
      for (const field of jsonFields) {
        const value = user[field];
        if (value && typeof value === 'string' && isEncrypted(value)) {
          try {
            const rotated = rotateEncryption(value, oldKey, oldSalt, newKey, newSalt);
            updates[field] = rotated;
            stats.fields[field]++;
            needsUpdate = true;
          } catch (error) {
            stats.errors++;
            if (!options.json) {
              console.error(`  Error rotating ${field} for user ${user.id}:`, error);
            }
          }
        }
      }

      if (needsUpdate) {
        if (!dryRun) {
          try {
            await db.update(users).set(updates).where(eq(users.id, user.id));
            stats.rotated++;
          } catch (error) {
            stats.errors++;
            if (!options.json) {
              console.error(`  Error updating user ${user.id}:`, error);
            }
          }
        } else {
          stats.rotated++;
        }
      } else {
        stats.skipped++;
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        success: stats.errors === 0,
        dryRun,
        ...stats,
      }, null, 2));
      return;
    }

    console.log('\nKey Rotation Results:');
    console.log(`  Total users:     ${stats.total}`);
    console.log(`  Rotated:         ${stats.rotated}`);
    console.log(`  Skipped:         ${stats.skipped} (no encrypted data)`);
    console.log(`  Errors:          ${stats.errors}`);
    console.log('\nFields rotated:');
    console.log(`  githubAccessToken:   ${stats.fields.githubAccessToken}`);
    console.log(`  claudeAuth:          ${stats.fields.claudeAuth}`);
    console.log(`  codexAuth:           ${stats.fields.codexAuth}`);
    console.log(`  geminiAuth:          ${stats.fields.geminiAuth}`);
    console.log(`  openrouterApiKey:    ${stats.fields.openrouterApiKey}`);
    console.log(`  imageAiKeys:         ${stats.fields.imageAiKeys}`);

    if (dryRun) {
      console.log('\n[DRY RUN] No changes were made. Remove --dry-run to rotate keys.');
    } else {
      console.log('\n⚠️  IMPORTANT: Update your environment variables with the new key and salt!');
      console.log('    ENCRYPTION_KEY=<new-key>');
      console.log('    ENCRYPTION_SALT=<new-salt>');
    }
  });

// ============================================================================
// ANALYZE-QUERIES COMMAND
// ============================================================================

dbCommand
  .command('analyze-queries')
  .description('Analyze slow queries and detect potential N+1 patterns')
  .option('--threshold <ms>', 'Slow query threshold in milliseconds', '100')
  .option('--sample-queries', 'Run sample queries to demonstrate analysis')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { QueryAnalyzer, getPool } = await import('@webedt/shared');

    const threshold = parseInt(options.threshold, 10);

    if (isNaN(threshold) || threshold <= 0) {
      console.error('Error: Invalid threshold value. Must be a positive number.');
      process.exit(1);
    }

    console.log('\nQuery Analysis Tool');
    console.log('===================');
    console.log(`Slow query threshold: ${threshold}ms`);
    console.log('');

    // Create analyzer with custom threshold
    const analyzer = new QueryAnalyzer({
      enabled: true,
      slowQueryThresholdMs: threshold,
      explainEnabled: true,
      logAllQueries: true,
    });

    if (options.sampleQueries) {
      console.log('Running sample queries for analysis...\n');

      try {
        const pool = getPool();

        // Run some sample queries to analyze
        const sampleQueries = [
          'SELECT COUNT(*) FROM users',
          'SELECT id, email FROM users LIMIT 10',
          'SELECT * FROM chat_sessions ORDER BY created_at DESC LIMIT 5',
          'SELECT * FROM events WHERE session_id IS NOT NULL LIMIT 10',
        ];

        for (const query of sampleQueries) {
          const start = Date.now();
          try {
            await pool.query(query);
            const duration = Date.now() - start;
            await analyzer.analyzeQuery(pool, query, [], duration);
            console.log(`  [${duration}ms] ${query.slice(0, 60)}...`);
          } catch (error) {
            console.log(`  [ERROR] ${query.slice(0, 60)}... - ${(error as Error).message}`);
          }
        }

        console.log('');
      } catch (error) {
        console.error('Failed to run sample queries:', (error as Error).message);
        console.log('');
      }
    }

    // Get and display summary
    const summary = analyzer.getSummary();

    if (options.json) {
      console.log(JSON.stringify({
        threshold,
        totalQueries: summary.totalQueries,
        slowQueries: summary.slowQueries,
        sequentialScanQueries: summary.sequentialScanQueries,
        potentialN1Patterns: summary.potentialN1Patterns,
        topSlowQueries: summary.topSlowQueries.map(q => ({
          query: q.normalizedQuery,
          durationMs: q.durationMs,
          issues: q.issues.map(i => i.message),
        })),
        timeRange: {
          start: summary.timeRange.start.toISOString(),
          end: summary.timeRange.end.toISOString(),
        },
      }, null, 2));
      return;
    }

    // Display formatted summary
    console.log('Analysis Summary');
    console.log('----------------');
    console.log(`Total Queries Analyzed: ${summary.totalQueries}`);
    console.log(`Slow Queries: ${summary.slowQueries}`);
    console.log(`Sequential Scan Queries: ${summary.sequentialScanQueries}`);

    if (summary.potentialN1Patterns.length > 0) {
      console.log('\nPotential N+1 Patterns:');
      for (const pattern of summary.potentialN1Patterns) {
        console.log(`  - ${pattern}`);
      }
    }

    if (summary.topSlowQueries.length > 0) {
      console.log('\nTop Slow Queries:');
      for (const entry of summary.topSlowQueries) {
        console.log(`  [${entry.durationMs}ms] ${entry.normalizedQuery.slice(0, 70)}...`);
        for (const issue of entry.issues) {
          console.log(`    -> [${issue.severity.toUpperCase()}] ${issue.message}`);
          if (issue.suggestion) {
            console.log(`       Suggestion: ${issue.suggestion}`);
          }
        }
      }
    }

    if (summary.totalQueries === 0) {
      console.log('\nNo queries analyzed yet.');
      console.log('Use --sample-queries to run sample queries for demonstration.');
      console.log('');
      console.log('In your application, use the QueryAnalyzer to wrap queries:');
      console.log('');
      console.log('  import { QueryAnalyzer, getPool } from "@webedt/shared";');
      console.log('  const analyzer = new QueryAnalyzer({ slowQueryThresholdMs: 100 });');
      console.log('  const pool = getPool();');
      console.log('');
      console.log('  // Analyze a query');
      console.log('  const start = Date.now();');
      console.log('  const result = await pool.query("SELECT * FROM users");');
      console.log('  await analyzer.analyzeQuery(pool, "SELECT * FROM users", [], Date.now() - start);');
      console.log('');
      console.log('  // Get summary');
      console.log('  analyzer.printSummary();');
    }

    console.log('');
  });

// ============================================================================
// EXPLAIN COMMAND
// ============================================================================

dbCommand
  .command('explain <query>')
  .description('Run EXPLAIN ANALYZE on a query and detect performance issues')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    const { QueryAnalyzer, getPool } = await import('@webedt/shared');

    // Only allow SELECT queries to prevent unintended data modifications
    // EXPLAIN ANALYZE actually executes the query, so INSERT/UPDATE/DELETE would cause side effects
    const trimmedQuery = query.trim().toUpperCase();
    if (!trimmedQuery.startsWith('SELECT') && !trimmedQuery.startsWith('WITH')) {
      console.error('Error: Only SELECT queries are supported by the explain command.');
      console.error('EXPLAIN ANALYZE executes the query, so INSERT/UPDATE/DELETE would cause data modifications.');
      process.exit(1);
    }

    console.log('\nQuery EXPLAIN Analysis');
    console.log('======================\n');

    const analyzer = new QueryAnalyzer({
      enabled: true,
      explainEnabled: true,
    });

    try {
      const pool = getPool();

      // Run the query first to get timing (safe because we only allow SELECT)
      const start = Date.now();
      await pool.query(query);
      const duration = Date.now() - start;

      console.log(`Query: ${query}`);
      console.log(`Execution Time: ${duration}ms\n`);

      // Now run EXPLAIN ANALYZE
      const result = await analyzer.runExplainAnalyze(pool, query);

      if (options.json) {
        console.log(JSON.stringify({
          query,
          executionTimeMs: duration,
          planningTimeMs: result.planningTime,
          explainExecutionTimeMs: result.executionTime,
          issues: result.issues,
          plan: result.plan,
        }, null, 2));
        return;
      }

      console.log('EXPLAIN ANALYZE Results:');
      console.log(`  Planning Time: ${result.planningTime.toFixed(2)}ms`);
      console.log(`  Execution Time: ${result.executionTime.toFixed(2)}ms`);

      // Display plan tree
      console.log('\nExecution Plan:');
      printPlanNode(result.plan, 0);

      if (result.issues.length > 0) {
        console.log('\nDetected Issues:');
        for (const issue of result.issues) {
          console.log(`  [${issue.severity.toUpperCase()}] ${issue.message}`);
          if (issue.table) {
            console.log(`    Table: ${issue.table}`);
          }
          if (issue.suggestion) {
            console.log(`    Suggestion: ${issue.suggestion}`);
          }
        }
      } else {
        console.log('\nNo performance issues detected.');
      }

      console.log('');
    } catch (error) {
      console.error('Failed to analyze query:', (error as Error).message);
      process.exit(1);
    }
  });

/**
 * Helper function to print EXPLAIN plan node
 */
function printPlanNode(node: {
  nodeType: string;
  relationName?: string;
  totalCost: number;
  planRows: number;
  actualRows?: number;
  actualTime?: number;
  indexName?: string;
  plans?: unknown[];
}, indent: number): void {
  const prefix = '  '.repeat(indent);
  let line = `${prefix}-> ${node.nodeType}`;

  if (node.relationName) {
    line += ` on "${node.relationName}"`;
  }
  if (node.indexName) {
    line += ` using "${node.indexName}"`;
  }

  console.log(line);

  const details: string[] = [];
  details.push(`cost=${node.totalCost.toFixed(2)}`);
  details.push(`rows=${node.planRows}`);
  if (node.actualRows !== undefined) {
    details.push(`actual_rows=${node.actualRows}`);
  }
  if (node.actualTime !== undefined) {
    details.push(`time=${node.actualTime.toFixed(2)}ms`);
  }
  console.log(`${prefix}   (${details.join(', ')})`);

  if (node.plans && Array.isArray(node.plans)) {
    for (const child of node.plans) {
      printPlanNode(child as typeof node, indent + 1);
    }
  }
}
