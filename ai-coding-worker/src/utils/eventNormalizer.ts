/**
 * Event Normalizer - Unified event format for multi-provider support
 *
 * This utility provides a consistent event format regardless of which
 * AI provider (Claude, Codex, etc.) is being used. The frontend receives
 * the same event structure, making provider switching seamless.
 */

import type { ProviderStreamEvent } from '../providers/BaseProvider';

/**
 * Normalized event types that all providers map to
 */
export type NormalizedEventType =
  | 'init'           // Session/thread initialized
  | 'message'        // Text message from assistant
  | 'tool_call'      // Tool/function being called
  | 'tool_result'    // Tool/function result
  | 'turn_started'   // New turn/interaction started
  | 'turn_completed' // Turn/interaction completed
  | 'error'          // Error occurred
  | 'complete'       // Execution completed
  | 'system';        // System message

/**
 * Unified event format for all providers
 */
export interface NormalizedEvent {
  type: NormalizedEventType;
  provider: 'claude' | 'codex' | 'unknown';
  timestamp: string;
  sessionId?: string;
  content?: {
    text?: string;
    parts?: Array<{ type: string; text?: string; [key: string]: any }>;
  };
  tool?: {
    id: string;
    name: string;
    input?: any;
    output?: any;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: {
    code?: string;
    message: string;
  };
  metadata?: Record<string, any>;
}

/**
 * Event Normalizer class for converting provider-specific events
 * to a unified format
 */
export class EventNormalizer {
  /**
   * Convert Claude SDK event to normalized format
   */
  static normalizeClaudeEvent(event: any, sessionId?: string): NormalizedEvent {
    const timestamp = new Date().toISOString();

    // Handle system events
    if (event.type === 'system') {
      if (event.subtype === 'init') {
        return {
          type: 'init',
          provider: 'claude',
          timestamp,
          sessionId: event.session_id || sessionId,
          content: { text: 'Claude session initialized' },
          metadata: { subtype: event.subtype }
        };
      }
      return {
        type: 'system',
        provider: 'claude',
        timestamp,
        sessionId,
        content: { text: event.message || 'System event' },
        metadata: { subtype: event.subtype }
      };
    }

    // Handle assistant messages
    if (event.type === 'assistant') {
      const message = event.message || event;
      const content = message.content || [];

      // Check for tool use
      const toolUse = content.find((c: any) => c.type === 'tool_use');
      if (toolUse) {
        return {
          type: 'tool_call',
          provider: 'claude',
          timestamp,
          sessionId,
          tool: {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input
          }
        };
      }

      // Check for tool result
      const toolResult = content.find((c: any) => c.type === 'tool_result');
      if (toolResult) {
        return {
          type: 'tool_result',
          provider: 'claude',
          timestamp,
          sessionId,
          tool: {
            id: toolResult.tool_use_id,
            name: 'unknown',
            output: toolResult.content
          }
        };
      }

      // Regular text message
      const textContent = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');

      return {
        type: 'message',
        provider: 'claude',
        timestamp,
        sessionId,
        content: {
          text: textContent,
          parts: content
        }
      };
    }

    // Handle result events
    if (event.type === 'result') {
      if (event.is_error) {
        return {
          type: 'error',
          provider: 'claude',
          timestamp,
          sessionId,
          error: {
            message: event.error_message || 'Unknown error'
          }
        };
      }
      return {
        type: 'complete',
        provider: 'claude',
        timestamp,
        sessionId,
        usage: event.usage,
        metadata: { duration_ms: event.duration_ms }
      };
    }

    // Default: return as system event
    return {
      type: 'system',
      provider: 'claude',
      timestamp,
      sessionId,
      metadata: event
    };
  }

  /**
   * Convert Codex SDK event to normalized format
   */
  static normalizeCodexEvent(event: any, sessionId?: string): NormalizedEvent {
    const timestamp = new Date().toISOString();

    switch (event.type) {
      case 'thread.started':
        return {
          type: 'init',
          provider: 'codex',
          timestamp,
          sessionId: event.threadId || sessionId,
          content: { text: 'Codex thread started' }
        };

      case 'turn.started':
        return {
          type: 'turn_started',
          provider: 'codex',
          timestamp,
          sessionId,
          content: { text: 'Processing turn...' }
        };

      case 'turn.completed':
        return {
          type: 'turn_completed',
          provider: 'codex',
          timestamp,
          sessionId,
          usage: event.usage
        };

      case 'message':
      case 'agent_message':
        return {
          type: 'message',
          provider: 'codex',
          timestamp,
          sessionId,
          content: {
            text: event.content || event.message || ''
          }
        };

      case 'function_call':
      case 'tool_call':
      case 'command_execution':
        return {
          type: 'tool_call',
          provider: 'codex',
          timestamp,
          sessionId,
          tool: {
            id: event.id || `tool-${Date.now()}`,
            name: event.name || event.command || event.tool || 'unknown',
            input: event.arguments || event.args || event.input
          }
        };

      case 'function_call_output':
      case 'tool_result':
      case 'command_result':
        return {
          type: 'tool_result',
          provider: 'codex',
          timestamp,
          sessionId,
          tool: {
            id: event.call_id || event.id || `tool-${Date.now()}`,
            name: 'unknown',
            output: event.output || event.result
          }
        };

      case 'item.completed':
        return this.normalizeCodexItemCompleted(event, sessionId);

      case 'error':
        return {
          type: 'error',
          provider: 'codex',
          timestamp,
          sessionId,
          error: {
            message: event.message || event.error || 'Unknown error'
          }
        };

      default:
        return {
          type: 'system',
          provider: 'codex',
          timestamp,
          sessionId,
          metadata: event
        };
    }
  }

  /**
   * Handle Codex item.completed events
   */
  private static normalizeCodexItemCompleted(event: any, sessionId?: string): NormalizedEvent {
    const timestamp = new Date().toISOString();
    const item = event.item || event;

    if (item.type === 'message' || item.content) {
      return {
        type: 'message',
        provider: 'codex',
        timestamp,
        sessionId,
        content: {
          text: typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
        }
      };
    }

    if (item.type === 'function_call' || item.type === 'tool_use') {
      return {
        type: 'tool_call',
        provider: 'codex',
        timestamp,
        sessionId,
        tool: {
          id: item.id || `tool-${Date.now()}`,
          name: item.name || item.function?.name || 'unknown',
          input: item.arguments || item.function?.arguments || item.input
        }
      };
    }

    if (item.type === 'function_call_output' || item.type === 'tool_result') {
      return {
        type: 'tool_result',
        provider: 'codex',
        timestamp,
        sessionId,
        tool: {
          id: item.call_id || item.id || `tool-${Date.now()}`,
          name: 'unknown',
          output: item.output
        }
      };
    }

    return {
      type: 'system',
      provider: 'codex',
      timestamp,
      sessionId,
      metadata: { item }
    };
  }

  /**
   * Convert normalized event back to ProviderStreamEvent format
   * for compatibility with existing SSE streaming
   */
  static toProviderStreamEvent(normalized: NormalizedEvent): ProviderStreamEvent {
    return {
      type: 'assistant_message',
      data: {
        type: normalized.type === 'message' ? 'assistant' : 'system',
        subtype: normalized.type,
        message: normalized.content,
        tool: normalized.tool,
        error: normalized.error,
        usage: normalized.usage,
        ...normalized.metadata
      }
    };
  }
}

export default EventNormalizer;
