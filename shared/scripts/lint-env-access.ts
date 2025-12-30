#!/usr/bin/env tsx
/**
 * Lint script to detect direct process.env access outside of config/env.ts
 *
 * This script checks for process.env usage in source files and warns if
 * any are found outside the centralized config module.
 *
 * Usage:
 *   npx tsx shared/scripts/lint-env-access.ts
 *   npm run lint:env  (if added to package.json)
 *
 * Exit codes:
 *   0 - No violations found
 *   1 - Violations found
 */

import { execSync } from 'child_process';
import { resolve } from 'path';
import { minimatch } from 'minimatch';

// Files that are allowed to access process.env directly
const ALLOWED_PATTERNS = [
  // The centralized config module itself
  'shared/src/config/env.ts',
  // Test files may need to mock env vars
  '**/*.test.ts',
  '**/*.spec.ts',
  // Build scripts that run outside the application context
  'shared/scripts/**',
  'website/backend/src/scripts/**',
  // Entry points that load dotenv/config
  'website/backend/src/index.ts',
];

// Content patterns that are explicitly allowed
const ALLOWED_CONTENT_PATTERNS = [
  "import 'dotenv/config'",
];

interface Violation {
  file: string;
  line: number;
  content: string;
}

/**
 * Check if a file path matches any of the allowed patterns
 */
function isFileAllowed(filePath: string): boolean {
  return ALLOWED_PATTERNS.some((pattern) => {
    // Use minimatch for proper glob matching
    return minimatch(filePath, pattern, { matchBase: false });
  });
}

/**
 * Check if content contains an allowed pattern (e.g., dotenv import)
 */
function isContentAllowed(content: string): boolean {
  return ALLOWED_CONTENT_PATTERNS.some((p) => content.includes(p));
}

function main() {
  const repoRoot = resolve(import.meta.dirname, '../..');
  const violations: Violation[] = [];

  console.log('Checking for direct process.env access...\n');

  try {
    // Find all TypeScript files with process.env usage
    const grepResult = execSync(
      'grep -rn "process\\.env\\." --include="*.ts" shared website/backend cli 2>/dev/null || true',
      { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const lines = grepResult.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!match) continue;

      const [, filePath, lineNum, content] = match;

      // Check if file is in allowed list using minimatch
      if (isFileAllowed(filePath)) continue;

      // Check if content matches allowed patterns
      if (isContentAllowed(content)) continue;

      violations.push({
        file: filePath,
        line: parseInt(lineNum, 10),
        content: content.trim(),
      });
    }

    if (violations.length === 0) {
      console.log('✅ No violations found. All process.env access is properly centralized.');
      process.exit(0);
    }

    console.log(
      `❌ Found ${violations.length} direct process.env access(es) that should use centralized config:\n`
    );

    for (const v of violations) {
      console.log(`  ${v.file}:${v.line}`);
      console.log(`    ${v.content}\n`);
    }

    console.log('To fix these violations:');
    console.log('1. Add the env var to shared/src/config/env.ts');
    console.log('2. Import the value from @webedt/shared or ../config/env.js');
    console.log('3. Replace process.env.VAR_NAME with the imported constant\n');

    process.exit(1);
  } catch (error) {
    console.error('Error running lint check:', error);
    process.exit(1);
  }
}

main();
