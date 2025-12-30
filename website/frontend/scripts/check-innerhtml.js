#!/usr/bin/env node

/**
 * Security Lint Script: Check for potentially unsafe innerHTML usage
 *
 * This script scans TypeScript files for innerHTML assignments that may
 * introduce XSS vulnerabilities. It looks for patterns where dynamic
 * content is interpolated without sanitization.
 *
 * Usage: npm run lint:security
 *
 * Limitations:
 * - Multi-line template literals: The static string detection regex operates
 *   line-by-line and may not correctly identify multi-line template literals
 *   as safe. Files with multi-line static templates should be added to
 *   AUDITED_FILES after manual review.
 * - Context-sensitive analysis: This script uses pattern matching, not AST
 *   parsing. Some edge cases may produce false positives or negatives.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC_DIR = new URL('../src', import.meta.url).pathname;

// Patterns that indicate safe usage
const SAFE_PATTERNS = [
  /sanitizeHtml/,
  /sanitizeHtmlPermissive/,
  /escapeHtml/,
  /escapeText/,
  /safeHtml`/,
  /\.textContent\s*=/,
  /innerHTML\s*=\s*['"`][^$]*['"`]\s*;?$/,  // Static string without interpolation
  /innerHTML\s*=\s*''\s*;?$/,  // Empty string
  /innerHTML\s*=\s*""\s*;?$/,  // Empty string
];

// Files known to be audited and safe (using static templates or controlled data)
const AUDITED_FILES = new Set([
  // These files were manually audited and use static HTML only or controlled numeric/constant data
  'components/toast/Toast.ts',
  'components/icon/Icon.ts',
  'lib/infiniteScroll.ts',
  // GameCard uses star ratings from numeric values (0-5 range)
  'components/game-card/GameCard.ts',
  // ChartWidget uses numeric totals computed internally
  'components/widget/ChartWidget.ts',
  // main.ts uses THEME_META and NAV_LINKS constants (static data)
  'main.ts',
  // PricingPage uses static feature arrays defined in component
  'pages/pricing/PricingPage.ts',
]);

let totalIssues = 0;
const issues = [];

function walkDir(dir, callback) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filepath = join(dir, file);
    const stat = statSync(filepath);
    if (stat.isDirectory()) {
      walkDir(filepath, callback);
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts')) {
      callback(filepath);
    }
  }
}

function checkFile(filepath) {
  const relativePath = relative(SRC_DIR, filepath);

  // Skip audited files
  if (AUDITED_FILES.has(relativePath)) {
    return;
  }

  const content = readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');

  // Check if file imports sanitization utilities
  const importsSanitize = /import\s+.*from\s+['"].*sanitize['"]/.test(content);
  const hasLocalEscape = /escapeHtml|sanitize/.test(content);

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Look for innerHTML assignments
    if (/\.innerHTML\s*=/.test(line)) {
      // Check if this line uses safe patterns
      const isSafe = SAFE_PATTERNS.some(pattern => pattern.test(line));

      if (!isSafe) {
        // Check for template literals with interpolation
        const hasInterpolation = /\$\{/.test(line);
        const hasStringConcat = /\+\s*[a-zA-Z]/.test(line) || /[a-zA-Z]\s*\+/.test(line);

        if (hasInterpolation || hasStringConcat) {
          // This is potentially unsafe
          if (!importsSanitize && !hasLocalEscape) {
            totalIssues++;
            issues.push({
              file: relativePath,
              line: lineNum,
              code: line.trim(),
              severity: 'error',
              message: 'innerHTML with interpolation without imported sanitization',
            });
          } else {
            // Has sanitization imports but this line may not use them
            // Check if sanitization function is on this line or nearby context
            const contextStart = Math.max(0, index - 3);
            const contextEnd = Math.min(lines.length, index + 1);
            const context = lines.slice(contextStart, contextEnd).join('\n');

            if (!SAFE_PATTERNS.some(pattern => pattern.test(context))) {
              totalIssues++;
              issues.push({
                file: relativePath,
                line: lineNum,
                code: line.trim(),
                severity: 'warning',
                message: 'innerHTML with interpolation - verify sanitization is applied',
              });
            }
          }
        }
      }
    }
  });
}

console.log('Scanning for potentially unsafe innerHTML usage...\n');

walkDir(SRC_DIR, checkFile);

if (issues.length === 0) {
  console.log('No issues found. All innerHTML usage appears to be safe or audited.');
  process.exit(0);
} else {
  console.log(`Found ${totalIssues} potential issue(s):\n`);

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    console.log('ERRORS (require fix):');
    console.log('─'.repeat(60));
    for (const issue of errors) {
      console.log(`  ${issue.file}:${issue.line}`);
      console.log(`    ${issue.message}`);
      console.log(`    Code: ${issue.code.substring(0, 80)}${issue.code.length > 80 ? '...' : ''}`);
      console.log();
    }
  }

  if (warnings.length > 0) {
    console.log('WARNINGS (verify manually):');
    console.log('─'.repeat(60));
    for (const issue of warnings) {
      console.log(`  ${issue.file}:${issue.line}`);
      console.log(`    ${issue.message}`);
      console.log(`    Code: ${issue.code.substring(0, 80)}${issue.code.length > 80 ? '...' : ''}`);
      console.log();
    }
  }

  console.log('─'.repeat(60));
  console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s)`);
  console.log('\nTo fix issues:');
  console.log('  1. Import sanitization: import { escapeText, sanitizeHtml } from "../../lib/sanitize";');
  console.log('  2. Wrap user content: element.innerHTML = `<p>${escapeText(userInput)}</p>`;');
  console.log('  3. For HTML content: element.innerHTML = sanitizeHtml(htmlFromApi);');

  // Exit with error only if there are errors (not warnings)
  process.exit(errors.length > 0 ? 1 : 0);
}
