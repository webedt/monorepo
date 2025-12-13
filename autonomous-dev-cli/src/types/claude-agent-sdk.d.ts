declare module '@anthropic-ai/claude-agent-sdk' {
  export interface QueryOptions {
    cwd?: string;
    allowedTools?: string[];
    tools?: string[] | { type: 'preset'; preset: 'claude_code' };
    permissionMode?: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' | 'dontAsk';
    allowDangerouslySkipPermissions?: boolean;
    maxTurns?: number;
    abortController?: AbortController;
    model?: string;
    systemPrompt?: string;
    resume?: string;
  }

  export interface SDKMessageContent {
    type: string;
    text?: string;
    [key: string]: unknown;
  }

  export interface SDKAssistantMessage {
    content?: SDKMessageContent[];
    model?: string;
    [key: string]: unknown;
  }

  export interface SDKMessage {
    type: string;
    subtype?: string;
    session_id?: string;
    message?: SDKAssistantMessage;
    is_error?: boolean;
    [key: string]: unknown;
  }

  export function query(options: {
    prompt: string | AsyncIterable<unknown>;
    options?: QueryOptions;
  }): AsyncIterable<SDKMessage>;
}
