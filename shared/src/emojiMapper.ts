/**
 * Emoji Mapper for SSE Messages
 *
 * Provides consistent emoji decoration for Server-Sent Events (SSE) based on
 * the event's stage, type, and source. Used to make progress updates visually
 * distinct in the frontend.
 *
 * ## Emoji Priority
 *
 * 1. **Stage** - Most specific (e.g., `cloning`, `pushing`, `committed`)
 * 2. **Type** - Event type fallback (e.g., `message`, `tool_use`, `error`)
 * 3. **Source** - Default by origin (e.g., `storage`, `github`, `ai-worker`)
 * 4. **Default** - 💬 if nothing else matches
 *
 * ## Available Stage Emojis
 *
 * | Stage | Emoji | Description |
 * |-------|-------|-------------|
 * | `preparing` | 🔧 | Initialization |
 * | `cloning` | 📥 | Cloning repository |
 * | `creating_branch` | 🌿 | Creating git branch |
 * | `generating_name` | 🤖 | AI generating names |
 * | `committing` | 💾 | Creating commit |
 * | `pushing` | 📤 | Pushing to remote |
 * | `completed` | ✅ | Operation finished |
 * | `error` | ❌ | Operation failed |
 *
 * ## Usage
 *
 * ```typescript
 * import { getEventEmoji, applyEmoji } from '@webedt/shared';
 *
 * // Get emoji for an event
 * const emoji = getEventEmoji({ stage: 'cloning' }); // '📥'
 *
 * // Apply emoji to a message
 * const decorated = applyEmoji('Cloning repository...', { stage: 'cloning' });
 * // '📥 Cloning repository...'
 * ```
 *
 * @module emojiMapper
 */

// Stage-to-emoji mapping for progress/message events
const stageEmojis: Record<string, string> = {
  // Session/storage operations
  'preparing': '🔧',
  'downloading_session': '📥',
  'checking_session': '🔍',
  'session_found': '📂',
  'new_session': '🆕',
  'uploading': '📤',
  'uploaded': '✅',

  // Repository operations
  'cloning': '📥',
  'cloned': '✅',
  'repo_exists': '📂',

  // Branch operations
  'generating_name': '🤖',
  'name_generated': '✨',
  'creating_branch': '🌿',
  'pushing': '📤',
  'pushed': '✅',
  'push_failed': '⚠️',

  // Analysis/changes
  'analyzing': '🔍',
  'changes_detected': '📝',

  // Commit operations
  'generating_message': '🤖',
  'committing': '💾',
  'committed': '✅',

  // PR operations
  'creating_pr': '📋',
  'pr_created': '✅',
  'merging_base': '🔀',
  'base_merged': '✅',
  'merging_pr': '🔀',
  'pr_merged': '✅',
  'deleting_branch': '🗑️',
  'branch_deleted': '✅',

  // Completion/status
  'completed': '✅',
  'error': '❌',
  'fallback': '⚠️',
  'skipped': '⏭️',
};

// Event type to emoji mapping (fallback when no stage)
const typeEmojis: Record<string, string> = {
  'message': '💬',
  'debug': '🐛',
  'branch_created': '🌿',
  'session_name': '📝',
  'session_started': '🚀',
  'commit_progress': '📤',
  'pr_progress': '📋',
  'tool_use': '🔧',
  'tool_result': '📋',
  'completed': '✅',
  'error': '❌',
};

// Source-specific default emojis
const sourceEmojis: Record<string, string> = {
  'storage': '🗄️',
  'storage-worker': '🗄️',
  'github': '🐙',
  'internal-api-server': '🖥️',
  'ai-worker': '🤖',
  'claude': '🤖',
};

/**
 * Get the appropriate emoji for an SSE event.
 *
 * Resolution order:
 * 1. Stage-specific emoji (most specific)
 * 2. Event type emoji
 * 3. Source-specific emoji
 * 4. Default fallback (💬)
 *
 * @param event - Event with optional stage, type, and source fields
 * @returns The emoji character for the event
 *
 * @example
 * ```typescript
 * getEventEmoji({ stage: 'cloning' });     // '📥'
 * getEventEmoji({ type: 'tool_use' });      // '🔧'
 * getEventEmoji({ source: 'github' });      // '🐙'
 * getEventEmoji({});                        // '💬'
 * ```
 */
export function getEventEmoji(event: {
  type?: string;
  stage?: string;
  source?: string;
}): string {
  // Priority 1: Stage-specific emoji (most specific)
  if (event.stage && stageEmojis[event.stage]) {
    return stageEmojis[event.stage];
  }

  // Priority 2: Type-specific emoji
  if (event.type && typeEmojis[event.type]) {
    return typeEmojis[event.type];
  }

  // Priority 3: Source-specific default
  if (event.source && sourceEmojis[event.source]) {
    return sourceEmojis[event.source];
  }

  // Default fallback
  return '💬';
}

/**
 * Apply an emoji prefix to a message based on event context.
 *
 * @param message - The message text to decorate
 * @param event - Event with optional stage, type, and source fields
 * @returns The message with emoji prefix (e.g., "📥 Cloning repository...")
 *
 * @example
 * ```typescript
 * applyEmoji('Cloning repository...', { stage: 'cloning' });
 * // '📥 Cloning repository...'
 *
 * applyEmoji('Operation complete', { type: 'completed' });
 * // '✅ Operation complete'
 * ```
 */
export function applyEmoji(message: string, event: {
  type?: string;
  stage?: string;
  source?: string;
}): string {
  const emoji = getEventEmoji(event);
  return `${emoji} ${message}`;
}
