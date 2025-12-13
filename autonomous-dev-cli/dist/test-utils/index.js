/**
 * Test utilities exports
 *
 * This module provides mock implementations, test fixtures, and helpers
 * for testing the autonomous-dev-cli components.
 *
 * Usage:
 * ```typescript
 * import {
 *   createMockIssue,
 *   createMockGitHub,
 *   fixtures,
 *   createTestDirectory,
 * } from './test-utils/index.js';
 * ```
 */
// Mock implementations for external dependencies
export * from './mocks.js';
// Test fixtures for common scenarios
export * from './fixtures.js';
// Re-export fixtures as default object for convenience
export { default as fixtures } from './fixtures.js';
//# sourceMappingURL=index.js.map