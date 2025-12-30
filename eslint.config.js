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
    },
  },
];
