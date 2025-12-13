declare module '@anthropic-ai/claude-agent-sdk' {
  export interface QueryOptions {
    cwd?: string;
    allowedTools?: string[];
    permissionMode?: 'bypassPermissions' | 'default';
    maxTurns?: number;
    abortController?: AbortController;
  }

  export interface SDKMessage {
    type: string;
    subtype?: string;
    [key: string]: unknown;
  }

  export function query(options: {
    prompt: string;
    options?: QueryOptions;
  }): AsyncIterable<SDKMessage>;
}
