import { useState } from 'react';
import { ExpandableText, ExpandableJson } from './ExpandableContent';

// Raw event type for formatted view
interface RawEvent {
  eventType: string;
  data: any;
  timestamp: Date;
}

// Event emoji and color mapping for formatted raw view
function getEventStyle(type: string): { emoji: string; color: string; label: string } {
  const styles: Record<string, { emoji: string; color: string; label: string }> = {
    connected: { emoji: '🔌', color: 'text-success', label: 'Connected' },
    message: { emoji: '💬', color: 'text-info', label: 'Message' },
    title_generation: { emoji: '✨', color: 'text-warning', label: 'Title Generation' },
    session_created: { emoji: '🎉', color: 'text-success', label: 'Session Created' },
    session_name: { emoji: '📝', color: 'text-primary', label: 'Session Name' },
    env_manager_log: { emoji: '🔧', color: 'text-base-content/60', label: 'Environment' },
    system: { emoji: '⚙️', color: 'text-base-content/70', label: 'System Init' },
    user: { emoji: '👤', color: 'text-primary', label: 'User' },
    assistant: { emoji: '🤖', color: 'text-secondary', label: 'Assistant' },
    tool_use: { emoji: '🔨', color: 'text-accent', label: 'Tool Use' },
    tool_result: { emoji: '📤', color: 'text-accent/80', label: 'Tool Result' },
    tool_progress: { emoji: '⏳', color: 'text-warning/70', label: 'Tool Progress' },
    result: { emoji: '✅', color: 'text-success', label: 'Result' },
    completed: { emoji: '🏁', color: 'text-success', label: 'Completed' },
    error: { emoji: '❌', color: 'text-error', label: 'Error' },
  };
  return styles[type] || { emoji: '📦', color: 'text-base-content/50', label: type };
}

// Format a raw event for display - with expandable content
export function FormattedEvent({ event }: { event: RawEvent }) {
  const style = getEventStyle(event.eventType);
  const time = event.timestamp.toLocaleTimeString();
  const data = event.data || {};
  const [showAllTools, setShowAllTools] = useState(false);

  // Extract meaningful content based on event type
  const renderContent = () => {
    switch (event.eventType) {
      case 'connected':
        return (
          <span className="text-sm">
            Provider: <span className="font-mono text-xs bg-base-300 px-1 rounded">{data.provider || 'unknown'}</span>
          </span>
        );

      case 'message':
        return (
          <div>
            <span className="badge badge-sm badge-outline mr-2">{data.stage}</span>
            <span className="text-sm">{data.message}</span>
          </div>
        );

      case 'title_generation':
        return (
          <div className="text-sm">
            <span className={`badge badge-sm mr-2 ${data.status === 'success' ? 'badge-success' : data.status === 'skipped' ? 'badge-ghost' : data.status === 'trying' ? 'badge-warning' : 'badge-error'}`}>
              {data.status}
            </span>
            <span className="font-mono text-xs">{data.method}</span>
            {data.title && <span className="ml-2 text-success">→ "{data.title}"</span>}
          </div>
        );

      case 'session_created':
        return (
          <div className="text-sm space-y-1">
            {data.remoteWebUrl && (
              <a href={data.remoteWebUrl} target="_blank" rel="noopener noreferrer" className="link link-primary text-xs">
                {data.remoteWebUrl}
              </a>
            )}
          </div>
        );

      case 'session_name':
        return <span className="text-sm font-medium">{data.sessionName}</span>;

      case 'env_manager_log':
        return (
          <div className="text-sm">
            <span className={`badge badge-xs mr-2 ${data.data?.level === 'error' ? 'badge-error' : data.data?.level === 'info' ? 'badge-info' : 'badge-ghost'}`}>
              {data.data?.level || 'log'}
            </span>
            <span className="opacity-80">{data.data?.content || data.data?.message || JSON.stringify(data.data)}</span>
          </div>
        );

      case 'system':
        return (
          <div className="text-xs space-y-1">
            <div><span className="opacity-50">cwd:</span> <span className="font-mono">{data.cwd}</span></div>
            <div><span className="opacity-50">model:</span> <span className="font-mono">{data.model}</span></div>
            <div className="flex flex-wrap gap-1">
              {(showAllTools ? data.tools : data.tools?.slice(0, 8))?.map((tool: string) => (
                <span key={tool} className="badge badge-xs badge-outline">{tool}</span>
              ))}
              {data.tools?.length > 8 && (
                <button
                  onClick={() => setShowAllTools(prev => !prev)}
                  className="badge badge-xs badge-ghost cursor-pointer hover:badge-primary"
                >
                  {showAllTools ? 'show less' : `+${data.tools.length - 8}`}
                </button>
              )}
            </div>
            <ExpandableJson data={data} summary="View full system init" />
          </div>
        );

      case 'user': {
        const userContent = typeof data.message?.content === 'string'
          ? data.message.content
          : JSON.stringify(data.message?.content);
        return (
          <div className="text-sm">
            {data.isReplay && <span className="badge badge-xs badge-ghost mr-2">replay</span>}
            <div className="whitespace-pre-wrap">
              <ExpandableText text={userContent || ''} maxLength={200} />
            </div>
          </div>
        );
      }

      case 'assistant': {
        const content = data.message?.content;
        if (!content) return null;
        return (
          <div className="text-sm space-y-1">
            {content.map((block: any, i: number) => {
              if (block.type === 'thinking') {
                return (
                  <div key={`thinking-${i}`} className="text-xs opacity-60 italic whitespace-pre-wrap">
                    💭 <ExpandableText text={block.thinking || ''} maxLength={100} />
                  </div>
                );
              }
              if (block.type === 'text') {
                return (
                  <div key={`text-${i}`} className="whitespace-pre-wrap">
                    <ExpandableText text={block.text || ''} maxLength={300} />
                  </div>
                );
              }
              if (block.type === 'tool_use') {
                const inputStr = JSON.stringify(block.input);
                const isLongInput = inputStr.length > 100;
                return (
                  <div key={`tool-${i}`} className="font-mono text-xs bg-base-300 p-2 rounded">
                    <span className="text-accent">{block.name}</span>
                    {isLongInput ? (
                      <details className="inline-block ml-1">
                        <summary className="cursor-pointer opacity-50 hover:opacity-100">
                          ({inputStr.substring(0, 60)}...)
                        </summary>
                        <pre className="mt-1 p-2 bg-base-200 rounded overflow-auto max-h-96 text-xs whitespace-pre-wrap">
                          {JSON.stringify(block.input, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="opacity-50 ml-1">({inputStr})</span>
                    )}
                  </div>
                );
              }
              if (block.type === 'tool_result') {
                const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                return (
                  <details key={`result-${i}`} className="text-xs">
                    <summary className="cursor-pointer opacity-50 hover:opacity-100 text-accent/80">
                      📤 tool_result {block.is_error && <span className="badge badge-xs badge-error ml-1">error</span>}
                    </summary>
                    <pre className="mt-1 p-2 bg-base-300 rounded overflow-auto max-h-96">
                      {resultContent}
                    </pre>
                  </details>
                );
              }
              return null;
            })}
          </div>
        );
      }

      case 'tool_progress':
        return (
          <span className="text-sm opacity-70">
            <span className="font-mono">{data.tool_name}</span> — {data.elapsed_time_seconds}s elapsed
          </span>
        );

      case 'result':
        return (
          <div className="text-sm space-y-1">
            <div><ExpandableText text={data.result || ''} maxLength={200} /></div>
            {data.total_cost_usd && (
              <div className="text-xs opacity-60">
                💰 ${data.total_cost_usd.toFixed(4)} • {data.num_turns} turns • {(data.duration_ms / 1000).toFixed(1)}s
              </div>
            )}
            <ExpandableJson data={data} summary="View full result data" />
          </div>
        );

      case 'completed':
        return (
          <div className="text-sm">
            {data.branch && <span className="badge badge-sm badge-success mr-2">{data.branch}</span>}
            {data.totalCost && <span className="text-xs opacity-60">💰 ${data.totalCost.toFixed(4)}</span>}
            <ExpandableJson data={data} summary="View completion data" />
          </div>
        );

      case 'control_response':
        return <ExpandableJson data={data} summary="View JSON" />;

      default:
        // For unknown types, show a collapsible JSON
        return <ExpandableJson data={data} summary="View JSON" />;
    }
  };

  return (
    <div className="border-l-2 border-base-300 pl-3 py-2 hover:bg-base-200/30 transition-colors">
      <div className="flex items-center gap-2 text-xs opacity-60 mb-1">
        <span className="font-mono">{time}</span>
        <span className={`font-medium ${style.color}`}>
          {style.emoji} {style.label}
        </span>
      </div>
      <div className={style.color}>
        {renderContent()}
      </div>
    </div>
  );
}

export type { RawEvent };
