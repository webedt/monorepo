import { AEventFormatter } from './AEventFormatter.js';

import type { FormattedEvent } from './AEventFormatter.js';

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface MessageContent {
  content?: string | ContentBlock[];
}

export class EventFormatter extends AEventFormatter {
  formatEvent(event: Record<string, unknown>): string {
    const type = (event.type as string) || 'unknown';
    const timestamp = new Date().toISOString().slice(11, 19);

    switch (type) {
      case 'env_manager_log': {
        const data = event.data as { category?: string; content?: string; level?: string } | undefined;
        const content = data?.content || '(no content)';
        return `[${timestamp}] ENV: ${content}`;
      }
      case 'system': {
        const version = (event as { claude_code_version?: string }).claude_code_version || '?';
        const model = (event as { model?: string }).model || '?';
        const cwd = (event as { cwd?: string }).cwd || '?';
        return `[${timestamp}] SYSTEM: v${version} | ${model} | ${cwd}`;
      }
      case 'user': {
        const preview = this.getMessagePreview(event);
        if (preview === null) return '';
        return `[${timestamp}] USER: ${preview}`;
      }
      case 'assistant': {
        const lines = this.getMessageLines(event);
        return lines.map(line => `[${timestamp}] ${line}`).join('\n');
      }
      case 'tool_use': {
        const toolName = (event as { tool_name?: string }).tool_name || 'unknown';
        return `[${timestamp}] TOOL: ${toolName}`;
      }
      case 'tool_result':
        return `[${timestamp}] RESULT: (tool completed)`;
      case 'result': {
        const cost = (event as { total_cost_usd?: number }).total_cost_usd;
        const duration = (event as { duration_ms?: number }).duration_ms;
        const numTurns = (event as { num_turns?: number }).num_turns;
        return `[${timestamp}] RESULT: $${cost?.toFixed(4) || '?'} | ${Math.round((duration || 0) / 1000)}s | ${numTurns || '?'} turns`;
      }
      default:
        return `[${timestamp}] ${type.toUpperCase()}:`;
    }
  }

  getMessageLines(event: Record<string, unknown>): string[] {
    const message = (event as { message?: MessageContent }).message;
    if (!message?.content) return ['ASSISTANT: (no content)'];

    if (typeof message.content === 'string') {
      return [`ASSISTANT: ${message.content.slice(0, 80).replace(/\n/g, ' ')}`];
    }

    const lines: string[] = [];

    for (const block of message.content) {
      if (block.type === 'thinking' && block.thinking) {
        const preview = block.thinking.slice(0, 70).replace(/\n/g, ' ');
        lines.push(`THINKING: ${preview}${block.thinking.length > 70 ? '...' : ''}`);
      }
    }

    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        const preview = block.text.slice(0, 70).replace(/\n/g, ' ');
        lines.push(`ASSISTANT: ${preview}${block.text.length > 70 ? '...' : ''}`);
      }
    }

    for (const block of message.content) {
      if (block.type === 'tool_use') {
        const name = block.name || 'unknown';
        const input = block.input || {};
        const filePath = input.file_path as string | undefined;
        const pattern = input.pattern as string | undefined;
        const command = input.command as string | undefined;
        let detail = '';
        if (filePath) {
          detail = filePath;
        } else if (pattern) {
          detail = pattern;
        } else if (command) {
          detail = command.slice(0, 40) + (command.length > 40 ? '...' : '');
        }
        lines.push(`TOOL_USE: ${name}${detail ? `: ${detail}` : ''}`);
      }
    }

    return lines.length > 0 ? lines : ['ASSISTANT: (no content)'];
  }

  getMessagePreview(event: Record<string, unknown>): string | null {
    const message = (event as { message?: MessageContent }).message;
    if (!message?.content) return '(no content)';

    if (typeof message.content === 'string') {
      return message.content.slice(0, 80).replace(/\n/g, ' ');
    }

    const textBlock = message.content.find(b => b.type === 'text');
    if (textBlock?.text) {
      return textBlock.text.slice(0, 80).replace(/\n/g, ' ');
    }

    const toolResults = message.content.filter(b => b.type === 'tool_result');
    if (toolResults.length > 0) {
      return null;
    }

    return '(no text)';
  }

  formatEventMultiline(event: Record<string, unknown>): FormattedEvent {
    const type = (event.type as string) || 'unknown';

    if (type === 'user') {
      const preview = this.getMessagePreview(event);
      if (preview === null) {
        return { lines: [], skip: true };
      }
    }

    const formatted = this.formatEvent(event);
    if (formatted === '') {
      return { lines: [], skip: true };
    }

    return {
      lines: formatted.split('\n'),
      skip: false,
    };
  }
}

export const eventFormatter = new EventFormatter();
