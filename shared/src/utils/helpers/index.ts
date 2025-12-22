/**
 * General-purpose helper utilities
 * @module utils/helpers
 */

// Emoji Mapper
export { getEventEmoji, applyEmoji } from './emojiMapper.js';

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
