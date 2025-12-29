import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Apply to all TypeScript files in src/
    files: ['src/**/*.ts'],
    rules: {
      // Disallow console.error and console.warn - use logger instead
      'no-console': ['error', { allow: ['log', 'info', 'debug', 'warn'] }],
    },
  },
  {
    // Allow console in scripts directory (CLI tools)
    files: ['src/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Ignore build output
    ignores: ['dist/**'],
  }
);
