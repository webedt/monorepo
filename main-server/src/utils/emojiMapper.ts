/**
 * Emoji mapper for SSE messages
 * Centralizes emoji assignment based on message stage/action
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
  'github': '🐙',
  'main-server': '🖥️',
  'ai-worker': '🤖',
  'claude': '🤖',
};

/**
 * Get emoji for an SSE event based on stage, type, and source
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
 * Apply emoji prefix to a message
 */
export function applyEmoji(message: string, event: {
  type?: string;
  stage?: string;
  source?: string;
}): string {
  const emoji = getEventEmoji(event);
  return `${emoji} ${message}`;
}
