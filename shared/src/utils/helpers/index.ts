/**
 * General-purpose helper utilities
 * @module utils/helpers
 */

// Emoji Mapper
export { getEventEmoji, applyEmoji } from './emojiMapper.js';

// Git URL Security Helper
export {
  parseGitUrl,
  validateBranchName,
  sanitizeBranchName,
  extractRepoOwner,
  extractRepoName,
  validateGitUrl,
} from './gitUrlHelper.js';
export type { ParsedGitUrl, ParsedGitUrlError } from './gitUrlHelper.js';

// Session Path Helper
export {
  parseRepoUrl,
  generateSessionPath,
  parseSessionPath,
  sessionPathToDir,
  validateSessionPath,
  normalizeRepoName,
  normalizeRepoUrl,
} from './sessionPathHelper.js';

// Preview URL Helper
export {
  getPreviewUrl,
  getPreviewUrlFromSession,
  hasWebedtFile,
  readWebedtConfig,
} from './previewUrlHelper.js';
export type { WebedtConfig } from './previewUrlHelper.js';

// Event Helper
export { extractEventUuid } from './eventHelper.js';
