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
      '**/timerManager.ts', // TimerManager uses raw timers intentionally
      '**/timerRegistry.ts', // Frontend timer registry uses raw timers intentionally
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

      /**
       * Warn on direct setTimeout/setInterval usage
       *
       * Direct timer usage can cause memory leaks in long-running services.
       * Use TimerManager instead for lifecycle-aware timer management:
       *
       * For services extending BaseService:
       *   Bad:  setTimeout(() => ..., 1000)
       *   Good: this.timerManager.setTimeout(() => ..., 1000)
       *
       * For standalone utilities:
       *   const timerManager = new TimerManager();
       *   timerManager.setTimeout(() => ..., 1000);
       *   // ... cleanup:
       *   timerManager.dispose();
       *
       * See shared/src/utils/lifecycle/timerManager.ts for details.
       */
      'no-restricted-globals': ['warn',
        {
          name: 'setTimeout',
          message: 'Use TimerManager.setTimeout() for lifecycle-aware timer management. See shared/src/utils/lifecycle/timerManager.ts',
        },
        {
          name: 'setInterval',
          message: 'Use TimerManager.setInterval() for lifecycle-aware timer management. See shared/src/utils/lifecycle/timerManager.ts',
        },
        {
          name: 'clearTimeout',
          message: 'Use TimerManager.clearTimeout() for lifecycle-aware timer management. See shared/src/utils/lifecycle/timerManager.ts',
        },
        {
          name: 'clearInterval',
          message: 'Use TimerManager.clearInterval() for lifecycle-aware timer management. See shared/src/utils/lifecycle/timerManager.ts',
        },
      ],
    },
  },
];
