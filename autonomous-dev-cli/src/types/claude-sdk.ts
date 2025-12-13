/**
 * TypeScript type definitions for Claude Agent SDK message types.
 * These types replace unsafe 'as any' assertions and provide compile-time type safety.
 */

/**
 * Text content block from Claude SDK assistant messages
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * Tool use content block from Claude SDK assistant messages
 */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content block
 */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

/**
 * Image content block
 */
export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

/**
 * Union type for all possible content blocks in Claude SDK messages
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

/**
 * Type guard to check if a content block is a TextBlock
 */
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text';
}

/**
 * Type guard to check if a content block is a ToolUseBlock
 */
export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

/**
 * Type guard to check if a content block is a ToolResultBlock
 */
export function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool_result';
}

/**
 * Type guard to check if a content block is an ImageBlock
 */
export function isImageBlock(block: ContentBlock): block is ImageBlock {
  return block.type === 'image';
}

/**
 * Claude SDK assistant message content structure
 */
export interface AssistantMessageContent {
  content: ContentBlock[];
}

/**
 * Claude SDK assistant message type
 */
export interface AssistantMessage {
  type: 'assistant';
  message?: AssistantMessageContent;
}

/**
 * Claude SDK result message type with execution metrics
 */
export interface ResultMessage {
  type: 'result';
  duration_ms?: number;
  result?: unknown;
}

/**
 * Claude SDK user message type
 */
export interface UserMessage {
  type: 'user';
  content: string | ContentBlock[];
}

/**
 * Claude SDK error message type
 */
export interface ErrorMessage {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

/**
 * Union type for all possible Claude SDK message types
 * This discriminated union allows TypeScript to narrow types based on the 'type' property
 */
export type ClaudeSDKMessage = AssistantMessage | ResultMessage | UserMessage | ErrorMessage;

/**
 * Type guard to check if a message is an AssistantMessage
 */
export function isAssistantMessage(message: ClaudeSDKMessage): message is AssistantMessage {
  return message.type === 'assistant';
}

/**
 * Type guard to check if a message is a ResultMessage
 */
export function isResultMessage(message: ClaudeSDKMessage): message is ResultMessage {
  return message.type === 'result';
}

/**
 * Type guard to check if a message is a UserMessage
 */
export function isUserMessage(message: ClaudeSDKMessage): message is UserMessage {
  return message.type === 'user';
}

/**
 * Type guard to check if a message is an ErrorMessage
 */
export function isErrorMessage(message: ClaudeSDKMessage): message is ErrorMessage {
  return message.type === 'error';
}

/**
 * Known tool names used by the Claude Agent SDK
 */
export type ClaudeToolName =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'MultiEdit'
  | 'Bash'
  | 'Glob'
  | 'Grep'
  | 'LS'
  | 'WebFetch';

/**
 * Runtime validation for content blocks from external API
 * Returns true if the object is a valid ContentBlock, false otherwise
 */
export function validateContentBlock(block: unknown): block is ContentBlock {
  if (typeof block !== 'object' || block === null) {
    return false;
  }

  const obj = block as Record<string, unknown>;

  if (typeof obj.type !== 'string') {
    return false;
  }

  switch (obj.type) {
    case 'text':
      return typeof obj.text === 'string';
    case 'tool_use':
      return (
        typeof obj.id === 'string' &&
        typeof obj.name === 'string' &&
        typeof obj.input === 'object' &&
        obj.input !== null
      );
    case 'tool_result':
      return typeof obj.tool_use_id === 'string';
    case 'image':
      return typeof obj.source === 'object' && obj.source !== null;
    default:
      return false;
  }
}

/**
 * Runtime validation for SDK messages from external API
 * Returns true if the object is a valid ClaudeSDKMessage, false otherwise
 */
export function validateSDKMessage(message: unknown): message is ClaudeSDKMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const obj = message as Record<string, unknown>;

  if (typeof obj.type !== 'string') {
    return false;
  }

  switch (obj.type) {
    case 'assistant':
      // Assistant messages may have an optional message property
      if (obj.message !== undefined) {
        if (typeof obj.message !== 'object' || obj.message === null) {
          return false;
        }
        const msgObj = obj.message as Record<string, unknown>;
        if (!Array.isArray(msgObj.content)) {
          return false;
        }
        // Validate each content block
        return msgObj.content.every(validateContentBlock);
      }
      return true;
    case 'result':
      // Result messages may have optional duration_ms
      if (obj.duration_ms !== undefined && typeof obj.duration_ms !== 'number') {
        return false;
      }
      return true;
    case 'user':
      // User messages can have content or message property, both are valid
      return true;
    case 'error':
      return (
        typeof obj.error === 'object' &&
        obj.error !== null &&
        typeof (obj.error as Record<string, unknown>).message === 'string'
      );
    default:
      // Unknown message types are allowed but not validated
      return true;
  }
}

/**
 * Safe accessor for tool use block properties
 * Extracts name and input from a ToolUseBlock with proper typing
 */
export function extractToolUseInfo(block: ToolUseBlock): {
  name: string;
  input: Record<string, unknown>;
} {
  return {
    name: block.name,
    input: block.input,
  };
}

/**
 * Safe accessor for text block content
 */
export function extractTextContent(block: TextBlock): string {
  return block.text;
}

/**
 * Safe accessor for result message duration
 * Returns the duration in milliseconds, or a default value if not present
 */
export function extractResultDuration(message: ResultMessage, defaultMs: number): number {
  return message.duration_ms ?? defaultMs;
}
