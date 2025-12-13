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
export declare function isTextBlock(block: ContentBlock): block is TextBlock;
/**
 * Type guard to check if a content block is a ToolUseBlock
 */
export declare function isToolUseBlock(block: ContentBlock): block is ToolUseBlock;
/**
 * Type guard to check if a content block is a ToolResultBlock
 */
export declare function isToolResultBlock(block: ContentBlock): block is ToolResultBlock;
/**
 * Type guard to check if a content block is an ImageBlock
 */
export declare function isImageBlock(block: ContentBlock): block is ImageBlock;
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
export declare function isAssistantMessage(message: ClaudeSDKMessage): message is AssistantMessage;
/**
 * Type guard to check if a message is a ResultMessage
 */
export declare function isResultMessage(message: ClaudeSDKMessage): message is ResultMessage;
/**
 * Type guard to check if a message is a UserMessage
 */
export declare function isUserMessage(message: ClaudeSDKMessage): message is UserMessage;
/**
 * Type guard to check if a message is an ErrorMessage
 */
export declare function isErrorMessage(message: ClaudeSDKMessage): message is ErrorMessage;
/**
 * Known tool names used by the Claude Agent SDK
 */
export type ClaudeToolName = 'Read' | 'Write' | 'Edit' | 'MultiEdit' | 'Bash' | 'Glob' | 'Grep' | 'LS' | 'WebFetch';
/**
 * Runtime validation for content blocks from external API
 * Returns true if the object is a valid ContentBlock, false otherwise
 */
export declare function validateContentBlock(block: unknown): block is ContentBlock;
/**
 * Runtime validation for SDK messages from external API
 * Returns true if the object is a valid ClaudeSDKMessage, false otherwise
 */
export declare function validateSDKMessage(message: unknown): message is ClaudeSDKMessage;
/**
 * Safe accessor for tool use block properties
 * Extracts name and input from a ToolUseBlock with proper typing
 */
export declare function extractToolUseInfo(block: ToolUseBlock): {
    name: string;
    input: Record<string, unknown>;
};
/**
 * Safe accessor for text block content
 */
export declare function extractTextContent(block: TextBlock): string;
/**
 * Safe accessor for result message duration
 * Returns the duration in milliseconds, or a default value if not present
 */
export declare function extractResultDuration(message: ResultMessage, defaultMs: number): number;
//# sourceMappingURL=claude-sdk.d.ts.map