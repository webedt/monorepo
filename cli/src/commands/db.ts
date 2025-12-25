import { Command } from 'commander';
import { db, users, getDatabaseCredentials, parseDatabaseUrl } from '@webedt/shared';
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
