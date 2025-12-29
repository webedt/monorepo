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
