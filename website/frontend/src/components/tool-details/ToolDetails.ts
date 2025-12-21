/**
 * ToolDetails Component
 *
 * Expandable details component for displaying tool usage with results.
 * Uses native HTML <details> element for expand/collapse functionality.
 */

import { Component, type ComponentOptions } from '../base';
import './tool-details.css';

export interface ToolResult {
  tool_use_result?: {
    // Read tool
    file?: { content?: string; numLines?: number };
    // Bash tool
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    // Edit tool
    filePath?: string;
    oldString?: string;
    newString?: string;
    structuredPatch?: Array<{ lines?: string[] }>;
    // Write tool / Task tool - content can be string or array
    content?: string | any;
    // Grep/Glob tool
    numFiles?: number;
    filenames?: string[];
    // TodoWrite tool
    newTodos?: Array<{ content: string; status: string; activeForm?: string }>;
    // Task tool
    status?: string;
    agentId?: string;
    totalDurationMs?: number;
    totalToolUseCount?: number;
    totalTokens?: number;
    // General
    durationMs?: number;
  };
  content?: string | any;
  is_error?: boolean;
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input?: Record<string, any>;
}

export interface ToolDetailsOptions extends ComponentOptions {
  tool: ToolUseBlock;
  result?: ToolResult;
  showTimestamp?: boolean;
  timestamp?: Date;
  defaultOpen?: boolean;
}

// Tool-specific emojis
const TOOL_EMOJIS: Record<string, string> = {
  Read: '📖',
  Bash: '💻',
  Edit: '📝',
  Write: '✏️',
  Grep: '🔍',
  Glob: '📂',
  TodoWrite: '📋',
  Task: '🤖',
  WebFetch: '🌐',
  WebSearch: '🔎',
  AskUserQuestion: '❓',
  default: '🔨',
};

// Subagent type emojis for Task tool
const SUBAGENT_EMOJIS: Record<string, string> = {
  Explore: '🔭',
  Plan: '📐',
  'general-purpose': '🤖',
  'claude-code-guide': '📚',
};

// Todo status emojis
const TODO_STATUS_EMOJIS: Record<string, string> = {
  pending: '⬜',
  in_progress: '🔄',
  completed: '✅',
};

export class ToolDetails extends Component<HTMLDetailsElement> {
  private tool: ToolUseBlock;
  private result?: ToolResult;
  private showTimestamp: boolean;
  private timestamp?: Date;

  constructor(options: ToolDetailsOptions) {
    super('details', {
      className: `tool-details tool-${options.tool.name.toLowerCase()}`,
      ...options
    });

    this.tool = options.tool;
    this.result = options.result;
    this.showTimestamp = options.showTimestamp ?? false;
    this.timestamp = options.timestamp;

    if (options.defaultOpen) {
      this.element.open = true;
    }

    this.render();
  }

  /**
   * Update the tool result (for streaming updates)
   */
  updateResult(result: ToolResult): this {
    this.result = result;
    this.render();
    return this;
  }

  /**
   * Check if this tool matches a given tool_use_id
   */
  matchesToolId(toolId: string): boolean {
    return this.tool.id === toolId;
  }

  render(): this {
    const emoji = TOOL_EMOJIS[this.tool.name] || TOOL_EMOJIS.default;
    const time = this.timestamp?.toLocaleTimeString() || '';
    const isWaiting = !this.result;

    // Build summary content based on tool type
    const summaryContent = this.renderSummary(emoji, time, isWaiting);
    const detailsContent = this.renderDetails(isWaiting);

    this.element.innerHTML = `
      <summary class="tool-summary">
        ${this.showTimestamp && time ? `<span class="tool-timestamp">${time}</span>` : ''}
        <span class="tool-arrow">▶</span>
        ${summaryContent}
      </summary>
      <div class="tool-content">
        ${detailsContent}
      </div>
    `;

    return this;
  }

  private renderSummary(emoji: string, _time: string, _isWaiting: boolean): string {
    const result = this.result?.tool_use_result;
    const durationMs = result?.durationMs;
    const durationStr = durationMs !== undefined ? `(${durationMs}ms)` : '';

    switch (this.tool.name) {
      case 'Read': {
        const filePath = this.tool.input?.file_path || 'unknown';
        const numLines = result?.file?.numLines;
        const linesStr = numLines ? `(${numLines} lines)` : '';
        return `
          <span>${emoji} Read:</span>
          <span class="tool-param tool-file">${this.escapeHtml(filePath)}</span>
          ${linesStr ? `<span class="tool-meta">${linesStr}</span>` : ''}
          ${durationStr ? `<span class="tool-duration">${durationStr}</span>` : ''}
        `;
      }

      case 'Bash': {
        const command = this.tool.input?.command || '';
        const displayCommand = command.length > 80 ? command.substring(0, 80) + '...' : command;
        const exitCode = result?.exitCode;
        const exitStr = exitCode !== undefined && exitCode !== 0 ? `<span class="tool-error">(exit ${exitCode})</span>` : '';
        return `
          <span>${emoji} Bash:</span>
          <span class="tool-param tool-command">${this.escapeHtml(displayCommand)}</span>
          ${exitStr}
          ${durationStr ? `<span class="tool-duration">${durationStr}</span>` : ''}
        `;
      }

      case 'Edit': {
        const filePath = this.tool.input?.file_path || result?.filePath || 'unknown';
        return `
          <span>${emoji} Edit:</span>
          <span class="tool-param tool-file-edit">${this.escapeHtml(filePath)}</span>
          ${durationStr ? `<span class="tool-duration">${durationStr}</span>` : ''}
        `;
      }

      case 'Write': {
        const filePath = this.tool.input?.file_path || result?.filePath || 'unknown';
        const content = this.tool.input?.content || result?.content || '';
        const lineCount = content ? content.split('\n').length : null;
        const linesStr = lineCount ? `(${lineCount} lines)` : '';
        return `
          <span>${emoji} Write:</span>
          <span class="tool-param tool-file-write">${this.escapeHtml(filePath)}</span>
          ${linesStr ? `<span class="tool-meta">${linesStr}</span>` : ''}
          ${durationStr ? `<span class="tool-duration">${durationStr}</span>` : ''}
        `;
      }

      case 'Grep': {
        const pattern = this.tool.input?.pattern || '';
        const path = this.tool.input?.path;
        const fileType = this.tool.input?.type;
        const glob = this.tool.input?.glob;
        const numFiles = result?.numFiles;
        return `
          <span>${emoji} Grep:</span>
          <span class="tool-param tool-pattern">${this.escapeHtml(pattern)}</span>
          ${path && path !== 'cwd' ? `<span class="tool-meta">in ${this.escapeHtml(path)}</span>` : ''}
          ${fileType ? `<span class="tool-meta">in *.${fileType}</span>` : ''}
          ${glob ? `<span class="tool-meta">(${this.escapeHtml(glob)})</span>` : ''}
          ${numFiles !== undefined ? `<span class="tool-meta">(${numFiles} files)</span>` : ''}
          ${durationStr ? `<span class="tool-duration">${durationStr}</span>` : ''}
        `;
      }

      case 'Glob': {
        const pattern = this.tool.input?.pattern || '';
        const path = this.tool.input?.path;
        const numFiles = result?.numFiles;
        return `
          <span>${emoji} Glob:</span>
          <span class="tool-param tool-pattern-glob">${this.escapeHtml(pattern)}</span>
          ${path ? `<span class="tool-meta">in ${this.escapeHtml(path)}</span>` : ''}
          ${numFiles !== undefined ? `<span class="tool-meta">(${numFiles} files)</span>` : ''}
          ${durationStr ? `<span class="tool-duration">${durationStr}</span>` : ''}
        `;
      }

      case 'TodoWrite': {
        const inputTodos = this.tool.input?.todos || [];
        const newTodos = result?.newTodos || inputTodos;
        return `
          <span>${emoji} TodoWrite:</span>
          <span class="tool-meta">(${newTodos.length} items)</span>
        `;
      }

      case 'Task': {
        const description = this.tool.input?.description || 'Task';
        const subagentType = this.tool.input?.subagent_type || 'general';
        const status = result?.status;
        const totalDurationMs = result?.totalDurationMs;
        const subEmoji = SUBAGENT_EMOJIS[subagentType] || '🤖';
        return `
          <span>${subEmoji} Task:</span>
          <span class="tool-param tool-task">${this.escapeHtml(description)}</span>
          <span class="tool-meta">(${subagentType})</span>
          ${status ? `<span class="tool-status tool-status-${status}">[${status}]</span>` : ''}
          ${totalDurationMs !== undefined ? `<span class="tool-duration">(${(totalDurationMs / 1000).toFixed(1)}s)</span>` : ''}
        `;
      }

      default:
        return `<span>${emoji} ${this.tool.name}</span>`;
    }
  }

  private renderDetails(isWaiting: boolean): string {
    if (isWaiting) {
      return this.renderWaiting();
    }

    const result = this.result?.tool_use_result;

    switch (this.tool.name) {
      case 'Read':
        return this.renderReadDetails(result);
      case 'Bash':
        return this.renderBashDetails(result);
      case 'Edit':
        return this.renderEditDetails(result);
      case 'Write':
        return this.renderWriteDetails(result);
      case 'Grep':
        return this.renderGrepDetails(result);
      case 'Glob':
        return this.renderGlobDetails(result);
      case 'TodoWrite':
        return this.renderTodoWriteDetails(result);
      case 'Task':
        return this.renderTaskDetails(result);
      default:
        return this.renderDefaultDetails();
    }
  }

  private renderWaiting(): string {
    const waitingText = this.getWaitingText();
    return `
      <div class="tool-waiting">
        <span class="tool-spinner"></span>
        <span>${waitingText}</span>
      </div>
    `;
  }

  private getWaitingText(): string {
    switch (this.tool.name) {
      case 'Read': return 'Reading file...';
      case 'Bash': return this.tool.input?.description || 'Running command...';
      case 'Edit': return 'Editing file...';
      case 'Write': return 'Writing file...';
      case 'Grep': return 'Searching...';
      case 'Glob': return 'Searching files...';
      case 'TodoWrite': return 'Updating todos...';
      case 'Task': return 'Agent working...';
      default: return 'Running...';
    }
  }

  private renderReadDetails(result: any): string {
    // Content can be in result.file.content (structured) or directly in this.result.content (raw string from Claude)
    const fileContent = result?.file?.content || this.result?.content || null;
    if (fileContent) {
      const content = typeof fileContent === 'string' ? fileContent : JSON.stringify(fileContent, null, 2);
      return `<pre class="tool-output">${this.escapeHtml(content)}</pre>`;
    }
    return `<div class="tool-empty">File is empty or could not be read</div>`;
  }

  private renderBashDetails(result: any): string {
    const command = this.tool.input?.command || '';
    // Output can be in result.stdout (structured) or directly in this.result.content (raw string from Claude)
    const stdout = result?.stdout || this.result?.content || '';
    const stderr = result?.stderr || '';
    const hasFullCommand = command.length > 80;

    let html = '';

    if (hasFullCommand) {
      html += `
        <div class="tool-section">
          <div class="tool-section-label">Full command:</div>
          <pre class="tool-output tool-command-full">${this.escapeHtml(command)}</pre>
        </div>
      `;
    }

    if (stderr) {
      html += `<pre class="tool-output tool-stderr">${this.escapeHtml(stderr)}</pre>`;
    }

    if (stdout) {
      const output = typeof stdout === 'string' ? stdout : JSON.stringify(stdout, null, 2);
      html += `<pre class="tool-output ${this.result?.is_error || stderr ? 'tool-error-output' : ''}">${this.escapeHtml(output)}</pre>`;
    } else if (!stderr) {
      html += `<div class="tool-empty">(no output)</div>`;
    }

    return html;
  }

  private renderEditDetails(result: any): string {
    const structuredPatch = result?.structuredPatch;
    const oldString = this.tool.input?.old_string || result?.oldString || '';
    const newString = this.tool.input?.new_string || result?.newString || '';

    if (structuredPatch && structuredPatch.length > 0) {
      const lines = structuredPatch.flatMap((hunk: any) =>
        (hunk.lines || []).map((line: string) => {
          const isRemoval = line.startsWith('-');
          const isAddition = line.startsWith('+');
          const className = isRemoval ? 'diff-removal' : isAddition ? 'diff-addition' : '';
          return `<span class="${className}">${this.escapeHtml(line)}</span>`;
        })
      ).join('\n');
      return `<pre class="tool-output tool-diff">${lines}</pre>`;
    }

    if (oldString || newString) {
      return `
        <div class="tool-diff-simple">
          <div class="diff-removal-block">
            <span class="diff-prefix">- </span>${this.escapeHtml(oldString)}
          </div>
          <div class="diff-addition-block">
            <span class="diff-prefix">+ </span>${this.escapeHtml(newString)}
          </div>
        </div>
      `;
    }

    return `<div class="tool-empty">Edit completed</div>`;
  }

  private renderWriteDetails(result: any): string {
    const fileContent = this.tool.input?.content || result?.content || null;
    if (fileContent) {
      return `<pre class="tool-output">${this.escapeHtml(fileContent)}</pre>`;
    }
    return `<div class="tool-empty">File written successfully</div>`;
  }

  private renderGrepDetails(result: any): string {
    const filenames = result?.filenames || [];
    const resultContent = this.result?.content;

    // If we have content directly (raw string from Claude), show it
    if (resultContent) {
      const content = typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent, null, 2);
      // If it looks like a file list (newline separated paths), render as file list
      if (typeof resultContent === 'string' && resultContent.includes('\n') && !resultContent.includes(' ')) {
        const files = resultContent.split('\n').filter((f: string) => f.trim());
        if (files.length > 0) {
          const displayFiles = files.slice(0, 50);
          const remaining = files.length - 50;
          return `
            <div class="tool-file-list">
              ${displayFiles.map((file: string) => `<div class="tool-file-item">${this.escapeHtml(file)}</div>`).join('')}
              ${remaining > 0 ? `<div class="tool-meta">...and ${remaining} more files</div>` : ''}
            </div>
          `;
        }
      }
      return `<pre class="tool-output">${this.escapeHtml(content)}</pre>`;
    }

    if (filenames.length > 0) {
      const displayFiles = filenames.slice(0, 50);
      const remaining = filenames.length - 50;
      return `
        <div class="tool-file-list">
          ${displayFiles.map((file: string) => `<div class="tool-file-item">${this.escapeHtml(file)}</div>`).join('')}
          ${remaining > 0 ? `<div class="tool-meta">...and ${remaining} more files</div>` : ''}
        </div>
      `;
    }

    return `<div class="tool-empty">No matches found</div>`;
  }

  private renderGlobDetails(result: any): string {
    const filenames = result?.filenames || [];
    const resultContent = this.result?.content;

    // If we have content directly (raw string from Claude), parse as file list
    if (resultContent && typeof resultContent === 'string') {
      const files = resultContent.split('\n').filter((f: string) => f.trim());
      if (files.length > 0) {
        const displayFiles = files.slice(0, 50);
        const remaining = files.length - 50;
        return `
          <div class="tool-file-list">
            ${displayFiles.map((file: string) => `<div class="tool-file-item">${this.escapeHtml(file)}</div>`).join('')}
            ${remaining > 0 ? `<div class="tool-meta">...and ${remaining} more files</div>` : ''}
          </div>
        `;
      }
    }

    if (filenames.length > 0) {
      const displayFiles = filenames.slice(0, 50);
      const remaining = filenames.length - 50;
      return `
        <div class="tool-file-list">
          ${displayFiles.map((file: string) => `<div class="tool-file-item">${this.escapeHtml(file)}</div>`).join('')}
          ${remaining > 0 ? `<div class="tool-meta">...and ${remaining} more files</div>` : ''}
        </div>
      `;
    }

    return `<div class="tool-empty">No files matched</div>`;
  }

  private renderTodoWriteDetails(result: any): string {
    const inputTodos = this.tool.input?.todos || [];
    const newTodos = result?.newTodos || inputTodos;

    if (newTodos.length > 0) {
      return `
        <div class="tool-todo-list">
          ${newTodos.map((todo: { content: string; status: string }) => {
            const emoji = TODO_STATUS_EMOJIS[todo.status] || '⬜';
            const statusClass = todo.status === 'completed' ? 'todo-completed' :
                               todo.status === 'in_progress' ? 'todo-in-progress' : '';
            return `
              <div class="tool-todo-item ${statusClass}">
                <span class="todo-emoji">${emoji}</span>
                <span class="todo-content">${this.escapeHtml(todo.content)}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    return `<div class="tool-empty">No todos</div>`;
  }

  private renderTaskDetails(result: any): string {
    const prompt = this.tool.input?.prompt || '';
    const agentId = result?.agentId;
    const totalToolUseCount = result?.totalToolUseCount;
    const totalTokens = result?.totalTokens;
    const content = result?.content;

    let html = '';

    if (agentId) {
      html += `<div class="tool-meta">Agent: ${agentId}</div>`;
    }

    if (totalToolUseCount !== undefined && totalTokens !== undefined) {
      html += `<div class="tool-meta">${totalToolUseCount} tool calls • ${totalTokens.toLocaleString()} tokens</div>`;
    }

    if (prompt) {
      html += `
        <details class="tool-nested-details">
          <summary class="tool-nested-summary">View prompt</summary>
          <pre class="tool-output tool-prompt">${this.escapeHtml(prompt)}</pre>
        </details>
      `;
    }

    if (content && Array.isArray(content) && content.length > 0) {
      const filteredContent = content.filter((item: { type: string; text?: string }) =>
        !(item.type === 'text' && item.text && prompt && item.text.trim() === prompt.trim())
      );

      if (filteredContent.length > 0) {
        const textContent = filteredContent
          .filter((item: { type: string }) => item.type === 'text')
          .map((item: { text?: string }) => item.text || '')
          .join('\n');

        if (textContent) {
          html += `
            <div class="tool-section tool-section-bordered">
              <div class="tool-section-label">Result:</div>
              <pre class="tool-output">${this.escapeHtml(textContent)}</pre>
            </div>
          `;
        }
      }
    }

    return html || `<div class="tool-empty">Task completed</div>`;
  }

  private renderDefaultDetails(): string {
    const input = this.tool.input;
    const resultContent = this.result?.content;

    let html = '';

    if (input) {
      html += `
        <div class="tool-section">
          <div class="tool-section-label">Input:</div>
          <pre class="tool-output">${this.escapeHtml(JSON.stringify(input, null, 2))}</pre>
        </div>
      `;
    }

    if (resultContent) {
      const content = typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent, null, 2);
      html += `
        <div class="tool-section tool-section-bordered">
          <div class="tool-section-label">Result:</div>
          <pre class="tool-output">${this.escapeHtml(content)}</pre>
        </div>
      `;
    }

    return html || `<div class="tool-empty">Tool completed</div>`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
