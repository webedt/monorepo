/**
 * ESLint Configuration (Flat Config - ESLint 9.x)
 *
 * This configuration focuses on preventing silent error swallowing
 * in catch blocks across the codebase.
 *
 * Run with: npx eslint shared/src cli/src website/frontend/src website/backend/src
 */

import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    // Ignore build artifacts and dependencies
    // Note: This must come first in the config array
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.d.ts', // Declaration files
    ],
  },
  {
    // Apply to all TypeScript files
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: typescriptParser,
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    rules: {
      /**
       * Disallow empty catch clauses
       *
       * Empty catch blocks silently swallow errors, making debugging difficult.
       * Every catch block must either:
       * - Log the error with context
       * - Re-throw with additional context
       * - Handle the error with a user notification
       * - Use a documented fallback pattern
       *
       * See CODING_STYLE.md for approved error handling patterns.
       */
      'no-empty': ['error', { allowEmptyCatch: false }],

      /**
       * Require error parameter in catch clauses
       *
       * Using 'catch { }' without binding the error makes it impossible
       * to log or inspect the error. Always capture the error even if
       * just for logging.
       *
       * Bad:  catch { console.log('error'); }
       * Good: catch (error) { console.log('error:', error); }
       */
      '@typescript-eslint/no-unused-vars': ['warn', {
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],

      /**
       * Disallow explicit 'any' type annotations
       *
       * Using 'any' loses type safety. Particularly important in catch blocks:
       *
       * Bad:  catch (error: any) { ... }
       * Good: catch (error: unknown) { ... }
       *
       * When handling unknown errors, use type guards from shared/src/utils/errorTypes.ts:
       * - error instanceof Error for standard errors
       * - isValidationError(error) for ValidationError
       * - isAuthenticationError(error) for AuthenticationError
       * - isDomainError(error) for any DomainError subclass
       *
       * Set to 'warn' to flag issues without breaking builds during migration.
       */
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Stricter rules for the shared package - enforce safe JSON parsing
    files: ['shared/src/**/*.ts'],
    rules: {
      /**
       * Disallow direct JSON.parse usage in shared package
       *
       * Raw JSON.parse throws on malformed input, causing runtime crashes.
       * Use safeJsonParse from shared/src/utils/api/safeJson.js instead.
       *
       * Bad:  const data = JSON.parse(str);
       * Good: const result = safeJsonParse(str);
       *       if (result.success) { /* use result.data */ }
       *
       * Good with default: const data = safeJsonParse(str, defaultValue);
       *
       * Set to 'warn' initially to flag issues without breaking builds.
       * The only exception is within safeJson.ts itself.
       */
      'no-restricted-syntax': ['warn', {
        selector: 'CallExpression[callee.object.name="JSON"][callee.property.name="parse"]',
        message: 'Avoid direct JSON.parse - use safeJsonParse from shared/src/utils/api/safeJson.js for safe parsing with error handling and optional logging.',
      }],
    },
  },
  {
    // Allow JSON.parse only in the safeJson utility itself
    files: ['shared/src/utils/api/safeJson.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
