import { ExpandableText, ExpandableJson } from './ExpandableContent';

// Raw event type for formatted view - now uses type directly instead of eventType wrapper
interface RawEvent {
  type: string;
  timestamp: Date;
  [key: string]: any; // Allow other properties from the raw event
}

// Helper to extract text content from assistant message
function getAssistantTextContent(event: RawEvent): string {
  const content = event?.message?.content;
  if (!content || !Array.isArray(content)) return '';

  return content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text || '')
    .join('\n')
    .trim();
}

// Helper to check if last assistant message matches result
function shouldSkipAssistant(events: RawEvent[], currentIndex: number): boolean {
  const event = events[currentIndex];
  if (event.type !== 'assistant') return false;

  // Find the next result event after this assistant
  const resultEvent = events.slice(currentIndex + 1).find(e => e.type === 'result');
  if (!resultEvent) return false;

  // Check if there are any other assistant events between this one and the result
  const eventsAfter = events.slice(currentIndex + 1);
  const nextAssistantIndex = eventsAfter.findIndex(e => e.type === 'assistant');
  const resultIndex = eventsAfter.findIndex(e => e.type === 'result');

  // If there's another assistant before the result, don't skip this one
  if (nextAssistantIndex !== -1 && nextAssistantIndex < resultIndex) return false;

  // Compare the text content
  const assistantText = getAssistantTextContent(event);
  const resultText = (resultEvent?.result || '').trim();

  return assistantText === resultText;
}

// Component to render a list of events with deduplication and filtering
export function FormattedEventList({
  events,
  filters = {}
}: {
  events: RawEvent[];
  filters?: Record<string, boolean>;
}) {
  return (
    <>
      {events.map((event, index) => {
        // Skip assistant messages that are duplicated in the result
        if (shouldSkipAssistant(events, index)) {
          return null;
        }

        // Apply filters - type is now directly on the event
        const eventType = event.type;

        // Check if this event type is filtered out
        if (filters[eventType] === false) {
          return null;
        }

        // Special handling for thinking blocks - they're inside assistant events
        // but we want to filter them separately
        if (eventType === 'assistant' && filters.thinking === false) {
          // Check if this assistant event has thinking blocks
          const content = event.message?.content;
          if (Array.isArray(content)) {
            const hasOnlyThinking = content.every((block: any) => block.type === 'thinking');
            if (hasOnlyThinking) {
              return null;
            }
          }
        }

        return <FormattedEvent key={index} event={event} filters={filters} />;
      })}
    </>
  );
}

// Event emoji mapping
function getEventEmoji(type: string): string {
  const emojis: Record<string, string> = {
    connected: '🔌',
    message: '💬',
    title_generation: '✨',
    session_created: '🎉',
    session_name: '📝',
    env_manager_log: '🔧',
    system: '⚙️',
    user: '👤',
    assistant: '🤖',
    tool_use: '🔨',
    tool_result: '📤',
    tool_progress: '⏳',
    result: '✅',
    completed: '🏁',
    error: '❌',
  };
  return emojis[type] || '📦';
}

// Helper to safely stringify a value for display
function safeString(value: any, maxLength = 200): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // For objects/arrays, stringify them
  try {
    const str = JSON.stringify(value);
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  } catch {
    return '[complex object]';
  }
}

// Get a brief summary for status events (one line)
// Now takes the raw event directly (with type and other properties at top level)
function getStatusSummary(eventType: string, event: any): string {
  switch (eventType) {
    case 'connected':
      return safeString(event.provider) || 'unknown';
    case 'message':
      return safeString(event.message);
    case 'title_generation':
      return event.title ? `"${safeString(event.title)}"` : safeString(event.method);
    case 'session_created':
      return 'Session started';
    case 'session_name':
      return safeString(event.sessionName);
    case 'env_manager_log':
      return safeString(event.data?.content) || safeString(event.data?.message);
    case 'system':
      return `${safeString(event.model) || 'unknown model'} • ${event.tools?.length || 0} tools`;
    case 'tool_use':
      return safeString(event.name) || safeString(event.tool_name) || 'tool';
    case 'tool_result': {
      // Tool results can have various formats - try to extract meaningful content
      const content = event.content;
      if (typeof content === 'string') {
        return content.substring(0, 80) + (content.length > 80 ? '...' : '');
      }
      if (Array.isArray(content)) {
        // Handle array of content blocks (like text blocks)
        const textBlock = content.find((block: any) => block.type === 'text');
        if (textBlock?.text) {
          return textBlock.text.substring(0, 80) + (textBlock.text.length > 80 ? '...' : '');
        }
      }
      return safeString(event.tool_use_id) || 'result';
    }
    case 'tool_progress':
      return `${safeString(event.tool_name)} (${event.elapsed_time_seconds}s)`;
    case 'result':
      return safeString(event.result)?.substring(0, 80) || 'Completed';
    case 'completed':
      return event.branch ? `Branch: ${safeString(event.branch)}` : 'Done';
    case 'error':
      return safeString(event.message) || safeString(event.error) || 'Error occurred';
    default:
      // For any unhandled event types, try to extract something meaningful
      if (event.message) return safeString(event.message);
      if (event.content) return safeString(event.content);
      if (event.text) return safeString(event.text);
      return '';
  }
}

// Format a raw event for display
export function FormattedEvent({ event, filters = {} }: { event: RawEvent; filters?: Record<string, boolean> }) {
  const eventType = event.type;
  const emoji = getEventEmoji(eventType);
  const time = event.timestamp.toLocaleTimeString();

  // User and Assistant get special chat bubble treatment
  if (eventType === 'user') {
    const userContent = typeof event.message?.content === 'string'
      ? event.message.content
      : JSON.stringify(event.message?.content);

    return (
      <div className="flex justify-end my-2">
        <div className="max-w-[80%] bg-base-300 rounded-2xl rounded-br-sm px-4 py-2">
          <div className="text-sm whitespace-pre-wrap">
            <ExpandableText text={userContent || ''} maxLength={500} />
          </div>
          <div className="text-xs opacity-40 mt-1 text-right">{time}</div>
        </div>
      </div>
    );
  }

  if (eventType === 'assistant') {
    const content = event.message?.content;
    if (!content) return null;

    // Handle string content (simple text response)
    if (typeof content === 'string') {
      return (
        <div className="flex justify-start my-2">
          <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)' }}>
            <div className="text-sm whitespace-pre-wrap">
              <ExpandableText text={content} maxLength={500} />
            </div>
            <div className="text-xs opacity-40 mt-1">{time}</div>
          </div>
        </div>
      );
    }

    // Handle array content
    if (!Array.isArray(content)) return null;

    // Separate thinking, text, and tool blocks
    const thinkingBlocks = filters.thinking !== false
      ? content.filter((block: any) => block.type === 'thinking')
      : [];
    const textBlocks = content.filter((block: any) => block.type === 'text');
    const toolBlocks = filters.tool_use !== false
      ? content.filter((block: any) => block.type === 'tool_use')
      : [];

    // If no blocks found (after filtering), render nothing
    if (thinkingBlocks.length === 0 && textBlocks.length === 0 && toolBlocks.length === 0) {
      return null;
    }

    return (
      <div className="my-1">
        {/* Thinking blocks as status lines with brain emoji */}
        {thinkingBlocks.map((block: any, i: number) => (
          <div key={`thinking-${i}`} className="py-1 text-xs text-base-content/60 flex items-center gap-2">
            <span className="font-mono opacity-50">{time}</span>
            <span>🧠</span>
            <span className="opacity-70 italic">
              <ExpandableText text={block.thinking || ''} maxLength={100} />
            </span>
          </div>
        ))}
        {/* Main assistant message bubble - blue */}
        {textBlocks.length > 0 && (
          <div className="flex justify-start my-1">
            <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)' }}>
              {textBlocks.map((block: any, i: number) => (
                <div key={`text-${i}`} className="text-sm whitespace-pre-wrap">
                  <ExpandableText text={block.text || ''} maxLength={500} />
                </div>
              ))}
              <div className="text-xs opacity-40 mt-1">{time}</div>
            </div>
          </div>
        )}
        {/* Tool use shown as compact inline items */}
        {toolBlocks.length > 0 && (
          <div className="ml-4 mt-1 space-y-1">
            {toolBlocks.map((block: any, i: number) => {
              // Special formatting for Bash tool
              if (block.name === 'Bash') {
                const description = block.input?.description || 'Running command';
                const command = block.input?.command || '';
                return (
                  <div key={`tool-${i}`} className="text-xs opacity-60 hover:opacity-100 font-mono bg-base-300 rounded p-2">
                    <div className="flex items-center gap-1 text-base-content/80">
                      <span>🔨</span>
                      <span className="font-semibold">Bash:</span>
                      <span>{description}</span>
                    </div>
                    <pre className="mt-1 text-base-content/70 overflow-auto whitespace-pre-wrap">{command}</pre>
                  </div>
                );
              }
              // Default formatting for other tools
              return (
                <details key={`tool-${i}`} className="text-xs opacity-60">
                  <summary className="cursor-pointer hover:opacity-100">
                    🔨 {block.name}
                  </summary>
                  <pre className="mt-1 p-2 bg-base-300 rounded overflow-auto max-h-48 text-xs">
                    {JSON.stringify(block.input, null, 2)}
                  </pre>
                </details>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Result event - blue bubble like assistant messages
  if (eventType === 'result') {
    return (
      <div className="flex justify-start my-2">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)' }}>
          <div className="text-sm whitespace-pre-wrap">
            <ExpandableText text={event.result || ''} maxLength={500} />
          </div>
          <div className="text-xs opacity-40 mt-1">
            {time}
            {event.total_cost_usd && ` • $${event.total_cost_usd.toFixed(4)} • ${event.num_turns} turns • ${(event.duration_ms / 1000).toFixed(1)}s`}
          </div>
        </div>
      </div>
    );
  }

  // All other events: single line with expandable details
  const summary = getStatusSummary(eventType, event);
  const hasDetails = ['system', 'env_manager_log', 'completed', 'error'].includes(eventType)
    || (eventType === 'env_manager_log' && event.data?.extra?.args);

  // Render expandable details content
  const renderDetails = () => {
    switch (eventType) {
      case 'system':
        return (
          <div className="text-xs space-y-1 mt-2 pl-4 border-l border-base-300">
            <div><span className="opacity-50">cwd:</span> {event.cwd}</div>
            <div><span className="opacity-50">model:</span> {event.model}</div>
            {event.claude_code_version && <div><span className="opacity-50">version:</span> {event.claude_code_version}</div>}
            {event.permissionMode && <div><span className="opacity-50">permissions:</span> {event.permissionMode}</div>}
            {event.tools?.length > 0 && (
              <details>
                <summary className="cursor-pointer opacity-50 hover:opacity-100">Tools ({event.tools.length})</summary>
                <div className="mt-1 flex flex-wrap gap-1">
                  {event.tools.map((tool: string) => (
                    <span key={tool} className="badge badge-xs badge-outline">{tool}</span>
                  ))}
                </div>
              </details>
            )}
            {event.mcp_servers?.length > 0 && (
              <details>
                <summary className="cursor-pointer opacity-50 hover:opacity-100">MCP Servers ({event.mcp_servers.length})</summary>
                <div className="mt-1 flex flex-wrap gap-1">
                  {event.mcp_servers.map((server: { name: string }) => (
                    <span key={server.name} className="badge badge-xs badge-outline">{server.name}</span>
                  ))}
                </div>
              </details>
            )}
            <ExpandableJson data={event} summary="View raw data" />
          </div>
        );

      case 'env_manager_log': {
        const args = event.data?.extra?.args as string[] | undefined;
        const appendSystemPromptIndex = args?.findIndex((arg: string) => arg === '--append-system-prompt');
        const systemPrompt = appendSystemPromptIndex !== undefined && appendSystemPromptIndex >= 0 && args
          ? args[appendSystemPromptIndex + 1]
          : null;
        const modelIndex = args?.findIndex((arg: string) => arg === '--model');
        const model = modelIndex !== undefined && modelIndex >= 0 && args ? args[modelIndex + 1] : null;

        return (
          <div className="text-xs space-y-1 mt-2 pl-4 border-l border-base-300">
            {model && <div><span className="opacity-50">model:</span> {model}</div>}
            {systemPrompt && (
              <details>
                <summary className="cursor-pointer opacity-50 hover:opacity-100">View system prompt</summary>
                <pre className="mt-1 p-2 bg-base-300 rounded overflow-auto max-h-96 whitespace-pre-wrap text-xs">
                  {systemPrompt}
                </pre>
              </details>
            )}
            <ExpandableJson data={event} summary="View raw data" />
          </div>
        );
      }

      case 'completed':
      case 'error':
        return (
          <div className="text-xs mt-2 pl-4 border-l border-base-300">
            <ExpandableJson data={event} summary="View details" />
          </div>
        );

      default:
        return null;
    }
  };

  // Single line status event
  if (hasDetails) {
    return (
      <details className="py-1 text-xs text-base-content/60">
        <summary className="cursor-pointer hover:text-base-content/80 flex items-center gap-2">
          <span className="font-mono opacity-50">{time}</span>
          <span>{emoji}</span>
          <span className="opacity-70">{summary}</span>
        </summary>
        {renderDetails()}
      </details>
    );
  }

  // Simple one-line status (no expandable details)
  return (
    <div className="py-1 text-xs text-base-content/60 flex items-center gap-2">
      <span className="font-mono opacity-50">{time}</span>
      <span>{emoji}</span>
      <span className="opacity-70">{summary}</span>
    </div>
  );
}

export type { RawEvent };
