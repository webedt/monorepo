/**
 * GitHub operations module exports
 */

// Abstract classes and types
export { AGitHelper } from './AGitHelper.js';
export { AGitHubClient, type GitHubPullOptions, type GitHubPullResult } from './AGitHubClient.js';

// Implementations
export * from './gitHelper.js';
export * from './githubClient.js';
export * from './operations.js';
