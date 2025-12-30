#!/usr/bin/env tsx
/**
 * Migration Script: Encrypt Sensitive User Data
 *
 * This script encrypts existing plaintext sensitive data in the users table.
 * It can be run multiple times safely - it will only encrypt data that isn't
 * already encrypted.
 *
 * Sensitive fields encrypted:
 * - githubAccessToken
 * - claudeAuth (JSON)
 * - codexAuth (JSON)
 * - geminiAuth (JSON)
 * - openrouterApiKey
 * - imageAiKeys (JSON)
 *
 * Usage:
 *   ENCRYPTION_KEY=your-secret-key npx tsx src/scripts/encrypt-sensitive-data.ts
 *
 * Options:
 *   --dry-run    Show what would be encrypted without making changes
 *   --verbose    Show detailed progress
 *   --batch=N    Process N users at a time (default: 100)
 */

import 'dotenv/config';
import { db, users, sql, type User } from '@webedt/shared';
import {
  isEncryptionEnabled,
  validateEncryptionConfig,
  isEncrypted,
} from '@webedt/shared';
import {
  encryptUserFields,
  hasUnencryptedSensitiveData,
} from '@webedt/shared';
import { eq } from 'drizzle-orm';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerbose = args.includes('--verbose');
const batchArg = args.find(a => a.startsWith('--batch='));
const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 100;

function log(message: string, verbose = false): void {
  if (!verbose || isVerbose) {
    console.log(message);
  }
}

function logError(message: string): void {
  console.error(`ERROR: ${message}`);
}

interface MigrationStats {
  totalUsers: number;
  usersWithSensitiveData: number;
  usersAlreadyEncrypted: number;
  usersEncrypted: number;
  errors: number;
  fieldsEncrypted: {
    githubAccessToken: number;
    claudeAuth: number;
    codexAuth: number;
    geminiAuth: number;
    openrouterApiKey: number;
    imageAiKeys: number;
  };
}

async function migrateUsers(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    totalUsers: 0,
    usersWithSensitiveData: 0,
    usersAlreadyEncrypted: 0,
    usersEncrypted: 0,
    errors: 0,
    fieldsEncrypted: {
      githubAccessToken: 0,
      claudeAuth: 0,
      codexAuth: 0,
      geminiAuth: 0,
      openrouterApiKey: 0,
      imageAiKeys: 0,
    },
  };

  // Count total users first (doesn't load all data into memory)
  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(users);
  stats.totalUsers = Number(countResult?.count ?? 0);

  log(`Found ${stats.totalUsers} users to process`);

  // Process users in batches using pagination (offset-based)
  let offset = 0;
  let batchNumber = 0;
  const totalBatches = Math.ceil(stats.totalUsers / batchSize);

  while (offset < stats.totalUsers) {
    batchNumber++;
    log(`Processing batch ${batchNumber}/${totalBatches}`, true);

    // Fetch only the current batch from database
    const batch = await db.select().from(users).limit(batchSize).offset(offset);

    if (batch.length === 0) {
      break; // No more users
    }

    for (const user of batch) {
      try {
        // Check if user has any sensitive data
        const hasSensitive =
          user.githubAccessToken ||
          user.claudeAuth ||
          user.codexAuth ||
          user.geminiAuth ||
          user.openrouterApiKey ||
          user.imageAiKeys;

        if (!hasSensitive) {
          continue;
        }

        stats.usersWithSensitiveData++;

        // Check if already encrypted
        if (!hasUnencryptedSensitiveData(user)) {
          stats.usersAlreadyEncrypted++;
          log(`User ${user.id}: Already encrypted`, true);
          continue;
        }

        // Determine which fields need encryption
        const fieldsToEncrypt: Record<string, any> = {};

        if (user.githubAccessToken && !isEncrypted(user.githubAccessToken)) {
          fieldsToEncrypt.githubAccessToken = user.githubAccessToken;
          stats.fieldsEncrypted.githubAccessToken++;
        }

        if (user.claudeAuth && typeof user.claudeAuth === 'object') {
          fieldsToEncrypt.claudeAuth = user.claudeAuth;
          stats.fieldsEncrypted.claudeAuth++;
        }

        if (user.codexAuth && typeof user.codexAuth === 'object') {
          fieldsToEncrypt.codexAuth = user.codexAuth;
          stats.fieldsEncrypted.codexAuth++;
        }

        if (user.geminiAuth && typeof user.geminiAuth === 'object') {
          fieldsToEncrypt.geminiAuth = user.geminiAuth;
          stats.fieldsEncrypted.geminiAuth++;
        }

        if (user.openrouterApiKey && !isEncrypted(user.openrouterApiKey)) {
          fieldsToEncrypt.openrouterApiKey = user.openrouterApiKey;
          stats.fieldsEncrypted.openrouterApiKey++;
        }

        if (user.imageAiKeys && typeof user.imageAiKeys === 'object') {
          fieldsToEncrypt.imageAiKeys = user.imageAiKeys;
          stats.fieldsEncrypted.imageAiKeys++;
        }

        if (Object.keys(fieldsToEncrypt).length === 0) {
          continue;
        }

        log(`User ${user.id}: Encrypting ${Object.keys(fieldsToEncrypt).join(', ')}`, true);

        if (!isDryRun) {
          // Encrypt and update
          const encryptedFields = encryptUserFields(fieldsToEncrypt);
          await db
            .update(users)
            .set(encryptedFields as Partial<User>)
            .where(eq(users.id, user.id));
        }

        stats.usersEncrypted++;
      } catch (error) {
        stats.errors++;
        logError(`Failed to encrypt data for user ${user.id}: ${error}`);
      }
    }

    // Move to next batch
    offset += batchSize;
  }

  return stats;
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Sensitive Data Encryption Migration');
  console.log('='.repeat(60));

  if (isDryRun) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Validate encryption is configured
  if (!isEncryptionEnabled()) {
    logError('ENCRYPTION_KEY environment variable is not set');
    logError('Set a strong passphrase (32+ characters recommended) and run again');
    process.exit(1);
  }

  const validation = validateEncryptionConfig();
  if (!validation.valid) {
    logError(`Encryption configuration invalid: ${validation.error}`);
    process.exit(1);
  }

  console.log('✓ Encryption key validated\n');

  try {
    const stats = await migrateUsers();

    console.log('\n' + '='.repeat(60));
    console.log('Migration Summary');
    console.log('='.repeat(60));
    console.log(`Total users:              ${stats.totalUsers}`);
    console.log(`Users with sensitive data: ${stats.usersWithSensitiveData}`);
    console.log(`Already encrypted:        ${stats.usersAlreadyEncrypted}`);
    console.log(`Newly encrypted:          ${stats.usersEncrypted}`);
    console.log(`Errors:                   ${stats.errors}`);
    console.log('\nFields encrypted:');
    console.log(`  githubAccessToken:      ${stats.fieldsEncrypted.githubAccessToken}`);
    console.log(`  claudeAuth:             ${stats.fieldsEncrypted.claudeAuth}`);
    console.log(`  codexAuth:              ${stats.fieldsEncrypted.codexAuth}`);
    console.log(`  geminiAuth:             ${stats.fieldsEncrypted.geminiAuth}`);
    console.log(`  openrouterApiKey:       ${stats.fieldsEncrypted.openrouterApiKey}`);
    console.log(`  imageAiKeys:            ${stats.fieldsEncrypted.imageAiKeys}`);

    if (isDryRun) {
      console.log('\n🔍 This was a dry run. Run without --dry-run to apply changes.');
    } else if (stats.usersEncrypted > 0) {
      console.log('\n✓ Migration completed successfully');
    } else if (stats.usersAlreadyEncrypted === stats.usersWithSensitiveData) {
      console.log('\n✓ All sensitive data is already encrypted');
    }

    process.exit(stats.errors > 0 ? 1 : 0);
  } catch (error) {
    logError(`Migration failed: ${error}`);
    process.exit(1);
  }
}

main();
