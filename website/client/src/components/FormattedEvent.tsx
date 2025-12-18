import { ExpandableText, ExpandableJson } from './ExpandableContent';

// Raw event type for formatted view
interface RawEvent {
  eventType: string;
  data: any;
  timestamp: Date;
}

// Helper to extract text content from assistant message
function getAssistantTextContent(data: any): string {
  const content = data?.message?.content;
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
  if (event.eventType !== 'assistant') return false;

  // Find the next result event after this assistant
  const resultEvent = events.slice(currentIndex + 1).find(e => e.eventType === 'result');
  if (!resultEvent) return false;

  // Check if there are any other assistant events between this one and the result
  const eventsAfter = events.slice(currentIndex + 1);
  const nextAssistantIndex = eventsAfter.findIndex(e => e.eventType === 'assistant');
  const resultIndex = eventsAfter.findIndex(e => e.eventType === 'result');

  // If there's another assistant before the result, don't skip this one
  if (nextAssistantIndex !== -1 && nextAssistantIndex < resultIndex) return false;

  // Compare the text content
  const assistantText = getAssistantTextContent(event.data);
  const resultText = (resultEvent.data?.result || '').trim();

  return assistantText === resultText;
}

// Component to render a list of events with deduplication
export function FormattedEventList({ events }: { events: RawEvent[] }) {
  return (
    <>
      {events.map((event, index) => {
        // Skip assistant messages that are duplicated in the result
        if (shouldSkipAssistant(events, index)) {
          return null;
        }
        return <FormattedEvent key={index} event={event} />;
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

// Get a brief summary for status events (one line)
function getStatusSummary(eventType: string, data: any): string {
  switch (eventType) {
    case 'connected':
      return data.provider || 'unknown';
    case 'message':
      return data.message || '';
    case 'title_generation':
      return data.title ? `"${data.title}"` : data.method || '';
    case 'session_created':
      return 'Session started';
    case 'session_name':
      return data.sessionName || '';
    case 'env_manager_log':
      return data.data?.content || data.data?.message || '';
    case 'system':
      return `${data.model || 'unknown model'} • ${data.tools?.length || 0} tools`;
    case 'tool_progress':
      return `${data.tool_name} (${data.elapsed_time_seconds}s)`;
    case 'result':
      return data.result?.substring(0, 80) || 'Completed';
    case 'completed':
      return data.branch ? `Branch: ${data.branch}` : 'Done';
    case 'error':
      return data.message || data.error || 'Error occurred';
    default:
      return '';
  }
}

// Format a raw event for display
export function FormattedEvent({ event }: { event: RawEvent }) {
  const emoji = getEventEmoji(event.eventType);
  const time = event.timestamp.toLocaleTimeString();
  const data = event.data || {};

  // User and Assistant get special chat bubble treatment
  if (event.eventType === 'user') {
    const userContent = typeof data.message?.content === 'string'
      ? data.message.content
      : JSON.stringify(data.message?.content);

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

  if (event.eventType === 'assistant') {
    const content = data.message?.content;
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
    const thinkingBlocks = content.filter((block: any) => block.type === 'thinking');
    const textBlocks = content.filter((block: any) => block.type === 'text');
    const toolBlocks = content.filter((block: any) => block.type === 'tool_use');

    // If no blocks found, render nothing
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
            {toolBlocks.map((block: any, i: number) => (
              <details key={`tool-${i}`} className="text-xs opacity-60">
                <summary className="cursor-pointer hover:opacity-100">
                  🔨 {block.name}
                </summary>
                <pre className="mt-1 p-2 bg-base-300 rounded overflow-auto max-h-48 text-xs">
                  {JSON.stringify(block.input, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Result event - blue bubble like assistant messages
  if (event.eventType === 'result') {
    return (
      <div className="flex justify-start my-2">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)' }}>
          <div className="text-sm whitespace-pre-wrap">
            <ExpandableText text={data.result || ''} maxLength={500} />
          </div>
          {data.total_cost_usd && (
            <div className="text-xs opacity-50 mt-1">
              ${data.total_cost_usd.toFixed(4)} • {data.num_turns} turns • {(data.duration_ms / 1000).toFixed(1)}s
            </div>
          )}
          <div className="text-xs opacity-40 mt-1">{time}</div>
        </div>
      </div>
    );
  }

  // All other events: single line with expandable details
  const summary = getStatusSummary(event.eventType, data);
  const hasDetails = ['system', 'env_manager_log', 'completed', 'error'].includes(event.eventType)
    || (event.eventType === 'env_manager_log' && data.data?.extra?.args);

  // Render expandable details content
  const renderDetails = () => {
    switch (event.eventType) {
      case 'system':
        return (
          <div className="text-xs space-y-1 mt-2 pl-4 border-l border-base-300">
            <div><span className="opacity-50">cwd:</span> {data.cwd}</div>
            <div><span className="opacity-50">model:</span> {data.model}</div>
            {data.claude_code_version && <div><span className="opacity-50">version:</span> {data.claude_code_version}</div>}
            {data.permissionMode && <div><span className="opacity-50">permissions:</span> {data.permissionMode}</div>}
            {data.tools?.length > 0 && (
              <details>
                <summary className="cursor-pointer opacity-50 hover:opacity-100">Tools ({data.tools.length})</summary>
                <div className="mt-1 flex flex-wrap gap-1">
                  {data.tools.map((tool: string) => (
                    <span key={tool} className="badge badge-xs badge-outline">{tool}</span>
                  ))}
                </div>
              </details>
            )}
            {data.mcp_servers?.length > 0 && (
              <details>
                <summary className="cursor-pointer opacity-50 hover:opacity-100">MCP Servers ({data.mcp_servers.length})</summary>
                <div className="mt-1 flex flex-wrap gap-1">
                  {data.mcp_servers.map((server: { name: string }) => (
                    <span key={server.name} className="badge badge-xs badge-outline">{server.name}</span>
                  ))}
                </div>
              </details>
            )}
            <ExpandableJson data={data} summary="View raw data" />
          </div>
        );

      case 'env_manager_log': {
        const args = data.data?.extra?.args as string[] | undefined;
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
            <ExpandableJson data={data} summary="View raw data" />
          </div>
        );
      }

      case 'completed':
      case 'error':
        return (
          <div className="text-xs mt-2 pl-4 border-l border-base-300">
            <ExpandableJson data={data} summary="View details" />
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
