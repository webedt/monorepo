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

// Issues Service
export { GitHubIssuesService } from './issuesService.js';
export type {
  Issue,
  CreateIssueOptions,
  CreateIssueResult,
  ListIssuesOptions,
  UpdateIssueOptions,
  IssueComment,
  AutoTaskCommentInfo,
} from './issuesService.types.js';

// Projects v2 Service
export { GitHubProjectsService } from './projectsService.js';
export type {
  Project,
  ProjectField,
  ProjectFieldOption,
  StatusField,
  ProjectItem,
  AddItemResult,
} from './projectsService.types.js';

// Rate Limiter
export { GitHubRateLimiter, withRateLimiting } from './rateLimiter.js';
export type { RateLimitState, RateLimiterConfig } from './rateLimiter.js';
