/**
 * TypeScript type definitions for Claude Agent SDK message types.
 * These types replace unsafe 'as any' assertions and provide compile-time type safety.
 */
/**
 * Type guard to check if a content block is a TextBlock
 */
export function isTextBlock(block) {
    return block.type === 'text';
}
/**
 * Type guard to check if a content block is a ToolUseBlock
 */
export function isToolUseBlock(block) {
    return block.type === 'tool_use';
}
/**
 * Type guard to check if a content block is a ToolResultBlock
 */
export function isToolResultBlock(block) {
    return block.type === 'tool_result';
}
/**
 * Type guard to check if a content block is an ImageBlock
 */
export function isImageBlock(block) {
    return block.type === 'image';
}
/**
 * Type guard to check if a message is an AssistantMessage
 */
export function isAssistantMessage(message) {
    return message.type === 'assistant';
}
/**
 * Type guard to check if a message is a ResultMessage
 */
export function isResultMessage(message) {
    return message.type === 'result';
}
/**
 * Type guard to check if a message is a UserMessage
 */
export function isUserMessage(message) {
    return message.type === 'user';
}
/**
 * Type guard to check if a message is an ErrorMessage
 */
export function isErrorMessage(message) {
    return message.type === 'error';
}
/**
 * Runtime validation for content blocks from external API
 * Returns true if the object is a valid ContentBlock, false otherwise
 */
export function validateContentBlock(block) {
    if (typeof block !== 'object' || block === null) {
        return false;
    }
    const obj = block;
    if (typeof obj.type !== 'string') {
        return false;
    }
    switch (obj.type) {
        case 'text':
            return typeof obj.text === 'string';
        case 'tool_use':
            return (typeof obj.id === 'string' &&
                typeof obj.name === 'string' &&
                typeof obj.input === 'object' &&
                obj.input !== null);
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
export function validateSDKMessage(message) {
    if (typeof message !== 'object' || message === null) {
        return false;
    }
    const obj = message;
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
                const msgObj = obj.message;
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
            return typeof obj.content === 'string' || Array.isArray(obj.content);
        case 'error':
            return (typeof obj.error === 'object' &&
                obj.error !== null &&
                typeof obj.error.message === 'string');
        default:
            // Unknown message types are allowed but not validated
            return true;
    }
}
/**
 * Safe accessor for tool use block properties
 * Extracts name and input from a ToolUseBlock with proper typing
 */
export function extractToolUseInfo(block) {
    return {
        name: block.name,
        input: block.input,
    };
}
/**
 * Safe accessor for text block content
 */
export function extractTextContent(block) {
    return block.text;
}
/**
 * Safe accessor for result message duration
 * Returns the duration in milliseconds, or a default value if not present
 */
export function extractResultDuration(message, defaultMs) {
    return message.duration_ms ?? defaultMs;
}
//# sourceMappingURL=claude-sdk.js.map