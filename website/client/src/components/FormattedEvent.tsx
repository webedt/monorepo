import { useState } from 'react';
import { ExpandableJson, ExpandableThinking } from './ExpandableContent';
import { MarkdownRenderer } from './MarkdownRenderer';

// Image preview modal component
function ImagePreviewModal({
  src,
  alt,
  onClose
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className="relative max-w-[90vw] max-h-[90vh]">
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white text-xl transition-colors"
          aria-label="Close preview"
        >
          ✕
        </button>
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
        />
      </div>
    </div>
  );
}

// Content block types for structured multimodal content
interface TextBlock {
  type: 'text';
  text: string;
}

interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

type ContentBlock = TextBlock | ImageBlock;

// Helper to parse message content - handles both array and JSON string formats
function parseContent(content: unknown): ContentBlock[] | null {
  // Already an array
  if (Array.isArray(content)) {
    return content as ContentBlock[];
  }

  // JSON string that might contain an array
  if (typeof content === 'string' && content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed as ContentBlock[];
      }
    } catch {
      // Not valid JSON
    }
  }

  return null;
}

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

// Helper to build a map of tool_use_id -> tool_result content
function buildToolResultMap(events: RawEvent[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const event of events) {
    // Check for tool_result in message.content array (user events with tool results)
    const content = event.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          // Store the result content and any tool_use_result data
          map.set(block.tool_use_id, {
            content: block.content,
            is_error: block.is_error,
            tool_use_result: event.tool_use_result
          });
        }
      }
    }
  }
  return map;
}

// Helper to check if an event is a tool_result-only user event (should be hidden when paired with tool_use)
function isToolResultOnlyEvent(event: RawEvent): boolean {
  if (event.type !== 'user') return false;
  const content = event.message?.content;
  if (!Array.isArray(content)) return false;
  return content.length > 0 && content.every((block: any) => block.type === 'tool_result');
}

// Component to render a list of events with deduplication and filtering
export function FormattedEventList({
  events,
  filters = {},
  showTimestamps = true
}: {
  events: RawEvent[];
  filters?: Record<string, boolean>;
  showTimestamps?: boolean;
}) {
  // Build map of tool results for pairing with tool uses
  const toolResultMap = buildToolResultMap(events);

  return (
    <>
      {events.map((event, index) => {
        // Skip assistant messages that are duplicated in the result
        if (shouldSkipAssistant(events, index)) {
          return null;
        }

        // Skip tool_result-only user events (they'll be shown inline with tool_use)
        if (isToolResultOnlyEvent(event)) {
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

        return <FormattedEvent key={index} event={event} filters={filters} toolResultMap={toolResultMap} showTimestamps={showTimestamps} />;
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
export function FormattedEvent({ event, filters = {}, toolResultMap, showTimestamps = true }: { event: RawEvent; filters?: Record<string, boolean>; toolResultMap?: Map<string, any>; showTimestamps?: boolean }) {
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const eventType = event.type;
  const emoji = getEventEmoji(eventType);
  const time = event.timestamp.toLocaleTimeString();

  // User and Assistant get special chat bubble treatment
  if (eventType === 'user') {
    const rawContent = event.message?.content;

    // Try to parse as array of content blocks (handles both array and JSON string)
    const contentBlocks = parseContent(rawContent);

    if (contentBlocks) {
      // Successfully parsed as content blocks - extract text and images
      const textBlocks = contentBlocks.filter((block): block is TextBlock => block.type === 'text');
      const imageBlocks = contentBlocks.filter((block): block is ImageBlock => block.type === 'image');
      const textContent = textBlocks.map(block => block.text || '').join('\n').trim();

      return (
        <>
          {previewImage && (
            <ImagePreviewModal
              src={previewImage.src}
              alt={previewImage.alt}
              onClose={() => setPreviewImage(null)}
            />
          )}
          <div className="flex justify-end my-2">
            <div className="max-w-[80%] bg-base-300 rounded-2xl rounded-br-sm px-4 py-2">
              {textContent && (
                <div className="text-sm">
                  <MarkdownRenderer content={textContent} />
                </div>
              )}
              {imageBlocks.length > 0 && (
                <div className={`flex flex-wrap gap-2 ${textContent ? 'mt-2' : ''}`}>
                  {imageBlocks.map((block, i) => {
                    const source = block.source;
                    if (source?.type === 'base64' && source?.data && source?.media_type) {
                      const imgSrc = `data:${source.media_type};base64,${source.data}`;
                      return (
                        <img
                          key={i}
                          src={imgSrc}
                          alt="User uploaded image"
                          className="max-w-full max-h-64 rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setPreviewImage({ src: imgSrc, alt: 'User uploaded image' })}
                        />
                      );
                    }
                    if (source?.type === 'url' && source?.url) {
                      return (
                        <img
                          key={i}
                          src={source.url}
                          alt="User uploaded image"
                          className="max-w-full max-h-64 rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setPreviewImage({ src: source.url!, alt: 'User uploaded image' })}
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              )}
              {showTimestamps && <div className="text-xs opacity-40 mt-1 text-right">{time}</div>}
            </div>
          </div>
        </>
      );
    }

    // Handle plain string content (not a JSON array)
    if (typeof rawContent === 'string') {
      return (
        <div className="flex justify-end my-2">
          <div className="max-w-[80%] bg-base-300 rounded-2xl rounded-br-sm px-4 py-2">
            <div className="text-sm">
              <MarkdownRenderer content={rawContent} />
            </div>
            {showTimestamps && <div className="text-xs opacity-40 mt-1 text-right">{time}</div>}
          </div>
        </div>
      );
    }

    // Fallback for unknown content types
    return (
      <div className="flex justify-end my-2">
        <div className="max-w-[80%] bg-base-300 rounded-2xl rounded-br-sm px-4 py-2">
          <div className="text-sm">
            <MarkdownRenderer content={rawContent ? JSON.stringify(rawContent) : ''} />
          </div>
          {showTimestamps && <div className="text-xs opacity-40 mt-1 text-right">{time}</div>}
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
            <div className="text-sm">
              <MarkdownRenderer content={content} />
            </div>
            {showTimestamps && <div className="text-xs opacity-40 mt-1">{time}</div>}
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
        {/* Thinking blocks as status lines with brain emoji - truncated with expand option */}
        {thinkingBlocks.map((block: any, i: number) => (
          <div key={`thinking-${i}`} className="py-1 text-xs text-base-content/60 flex items-start gap-2">
            {showTimestamps && <span className="font-mono opacity-50 shrink-0">{time}</span>}
            <span className="shrink-0">🧠</span>
            <ExpandableThinking text={block.thinking || ''} maxLength={256} />
          </div>
        ))}
        {/* Main assistant message bubble - blue */}
        {textBlocks.length > 0 && (
          <div className="flex justify-start my-1">
            <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)' }}>
              {textBlocks.map((block: any, i: number) => (
                <div key={`text-${i}`} className="text-sm">
                  <MarkdownRenderer content={block.text || ''} />
                </div>
              ))}
              {showTimestamps && <div className="text-xs opacity-40 mt-1">{time}</div>}
            </div>
          </div>
        )}
        {/* Tool use shown as compact inline items */}
        {toolBlocks.length > 0 && (
          <div className="mt-1 space-y-1">
            {toolBlocks.map((block: any, i: number) => {
              // Special formatting for Read tool
              if (block.name === 'Read') {
                const toolResult = toolResultMap?.get(block.id);
                const fileContent = toolResult?.tool_use_result?.file?.content || null;
                const numLines = toolResult?.tool_use_result?.file?.numLines || null;
                const durationMs = toolResult?.tool_use_result?.durationMs;
                const isWaiting = !toolResult;

                return (
                  <details key={`tool-${i}`} className="text-xs text-base-content/60">
                    <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                      <span className="text-base-content/50">▶</span>
                      <span>📖 Read:</span>
                      <span className="font-mono text-blue-400">{block.input?.file_path || 'unknown'}</span>
                      {numLines && <span className="opacity-50">({numLines} lines)</span>}
                      {durationMs !== undefined && <span className="opacity-40">({durationMs}ms)</span>}
                    </summary>
                    <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-96 text-xs">
                      {isWaiting ? (
                        <div className="flex items-center gap-2 text-base-content/50">
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>Reading file...</span>
                        </div>
                      ) : fileContent ? (
                        <pre className="whitespace-pre-wrap">{fileContent}</pre>
                      ) : (
                        <div className="opacity-50">File is empty or could not be read</div>
                      )}
                    </div>
                  </details>
                );
              }
              // Special formatting for Bash tool
              if (block.name === 'Bash') {
                const description = block.input?.description || 'Running command';
                const command = block.input?.command || '';
                const toolResult = toolResultMap?.get(block.id);
                const resultContent = toolResult?.tool_use_result?.stdout || toolResult?.content || '';
                const hasError = toolResult?.is_error || toolResult?.tool_use_result?.stderr;
                const stderrContent = toolResult?.tool_use_result?.stderr || '';
                const exitCode = toolResult?.tool_use_result?.exitCode;
                const durationMs = toolResult?.tool_use_result?.durationMs;
                const isWaiting = !toolResult;

                // Truncate command for display if too long
                const displayCommand = command.length > 80 ? command.substring(0, 80) + '...' : command;

                return (
                  <details key={`tool-${i}`} className="text-xs text-base-content/60">
                    <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                      <span className="text-base-content/50">▶</span>
                      <span>💻 Bash:</span>
                      <span className="font-mono text-green-400">{displayCommand}</span>
                      {exitCode !== undefined && exitCode !== 0 && <span className="text-error">(exit {exitCode})</span>}
                      {durationMs !== undefined && <span className="opacity-40">({durationMs}ms)</span>}
                    </summary>
                    <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-96 text-xs">
                      {isWaiting ? (
                        <div className="flex items-center gap-2 text-base-content/50">
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>{description}...</span>
                        </div>
                      ) : (
                        <>
                          {command.length > 80 && (
                            <div className="mb-2 pb-2 border-b border-base-content/10">
                              <div className="opacity-50 mb-1">Full command:</div>
                              <pre className="whitespace-pre-wrap font-mono text-green-400/80">{command}</pre>
                            </div>
                          )}
                          {stderrContent && (
                            <pre className="whitespace-pre-wrap text-error mb-2">{stderrContent}</pre>
                          )}
                          {resultContent ? (
                            <pre className={`whitespace-pre-wrap ${hasError ? 'text-error' : ''}`}>{resultContent}</pre>
                          ) : !stderrContent && (
                            <div className="opacity-50">(no output)</div>
                          )}
                        </>
                      )}
                    </div>
                  </details>
                );
              }
              // Special formatting for Edit tool
              if (block.name === 'Edit') {
                const toolResult = toolResultMap?.get(block.id);
                const filePath = block.input?.file_path || toolResult?.tool_use_result?.filePath || 'unknown';
                const oldString = block.input?.old_string || toolResult?.tool_use_result?.oldString || '';
                const newString = block.input?.new_string || toolResult?.tool_use_result?.newString || '';
                const structuredPatch = toolResult?.tool_use_result?.structuredPatch;
                const durationMs = toolResult?.tool_use_result?.durationMs;
                const isWaiting = !toolResult;

                return (
                  <details key={`tool-${i}`} className="text-xs text-base-content/60">
                    <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                      <span className="text-base-content/50">▶</span>
                      <span>📝 Edit:</span>
                      <span className="font-mono text-yellow-400">{filePath}</span>
                      {durationMs !== undefined && <span className="opacity-40">({durationMs}ms)</span>}
                    </summary>
                    <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-96 text-xs">
                      {isWaiting ? (
                        <div className="flex items-center gap-2 text-base-content/50">
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>Editing file...</span>
                        </div>
                      ) : structuredPatch && structuredPatch.length > 0 ? (
                        <pre className="whitespace-pre-wrap">
                          {structuredPatch.map((hunk: any, hunkIdx: number) => (
                            <span key={hunkIdx}>
                              {hunk.lines?.map((line: string, lineIdx: number) => {
                                const isRemoval = line.startsWith('-');
                                const isAddition = line.startsWith('+');
                                return (
                                  <span
                                    key={lineIdx}
                                    className={isRemoval ? 'text-red-400 bg-red-400/10' : isAddition ? 'text-green-400 bg-green-400/10' : ''}
                                  >
                                    {line}{'\n'}
                                  </span>
                                );
                              })}
                            </span>
                          ))}
                        </pre>
                      ) : oldString || newString ? (
                        <div className="space-y-1">
                          <div className="text-red-400 bg-red-400/10 p-1 rounded">
                            <span className="opacity-50">- </span>{oldString}
                          </div>
                          <div className="text-green-400 bg-green-400/10 p-1 rounded">
                            <span className="opacity-50">+ </span>{newString}
                          </div>
                        </div>
                      ) : (
                        <div className="opacity-50">Edit completed</div>
                      )}
                    </div>
                  </details>
                );
              }
              // Special formatting for Write tool
              if (block.name === 'Write') {
                const toolResult = toolResultMap?.get(block.id);
                const fileContent = block.input?.content || toolResult?.tool_use_result?.content || null;
                const filePath = block.input?.file_path || toolResult?.tool_use_result?.filePath || 'unknown';
                const lineCount = fileContent ? fileContent.split('\n').length : null;
                const durationMs = toolResult?.tool_use_result?.durationMs;
                const isWaiting = !toolResult;

                return (
                  <details key={`tool-${i}`} className="text-xs text-base-content/60">
                    <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                      <span className="text-base-content/50">▶</span>
                      <span>✏️ Write:</span>
                      <span className="font-mono text-green-400">{filePath}</span>
                      {lineCount && <span className="opacity-50">({lineCount} lines)</span>}
                      {durationMs !== undefined && <span className="opacity-40">({durationMs}ms)</span>}
                    </summary>
                    <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-96 text-xs">
                      {isWaiting ? (
                        <div className="flex items-center gap-2 text-base-content/50">
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>Writing file...</span>
                        </div>
                      ) : fileContent ? (
                        <pre className="whitespace-pre-wrap">{fileContent}</pre>
                      ) : (
                        <div className="opacity-50">File written successfully</div>
                      )}
                    </div>
                  </details>
                );
              }
              // Special formatting for Grep tool
              if (block.name === 'Grep') {
                const toolResult = toolResultMap?.get(block.id);
                const pattern = block.input?.pattern || '';
                const path = block.input?.path || 'cwd';
                const fileType = block.input?.type;
                const glob = block.input?.glob;
                const outputMode = block.input?.output_mode || 'files_with_matches';
                const numFiles = toolResult?.tool_use_result?.numFiles;
                const filenames = toolResult?.tool_use_result?.filenames || [];
                const resultContent = toolResult?.content;
                const durationMs = toolResult?.tool_use_result?.durationMs;
                const isWaiting = !toolResult;

                return (
                  <details key={`tool-${i}`} className="text-xs text-base-content/60">
                    <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                      <span className="text-base-content/50">▶</span>
                      <span>🔍 Grep:</span>
                      <span className="font-mono text-purple-400">{pattern}</span>
                      {path && path !== 'cwd' && <span className="opacity-50">in {path}</span>}
                      {fileType && <span className="opacity-50">in *.{fileType}</span>}
                      {glob && <span className="opacity-50">({glob})</span>}
                      {numFiles !== undefined && <span className="opacity-50">({numFiles} files)</span>}
                      {durationMs !== undefined && <span className="opacity-40">({durationMs}ms)</span>}
                    </summary>
                    <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-96 text-xs">
                      {isWaiting ? (
                        <div className="flex items-center gap-2 text-base-content/50">
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>Searching...</span>
                        </div>
                      ) : outputMode === 'content' && resultContent ? (
                        <pre className="whitespace-pre-wrap">{typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent, null, 2)}</pre>
                      ) : filenames.length > 0 ? (
                        <div className="space-y-0.5">
                          {filenames.slice(0, 50).map((file: string, idx: number) => (
                            <div key={idx} className="font-mono text-blue-400/80">{file}</div>
                          ))}
                          {filenames.length > 50 && <div className="opacity-50">...and {filenames.length - 50} more files</div>}
                        </div>
                      ) : (
                        <div className="opacity-50">No matches found</div>
                      )}
                    </div>
                  </details>
                );
              }
              // Special formatting for Glob tool
              if (block.name === 'Glob') {
                const toolResult = toolResultMap?.get(block.id);
                const pattern = block.input?.pattern || '';
                const path = block.input?.path;
                const numFiles = toolResult?.tool_use_result?.numFiles;
                const filenames = toolResult?.tool_use_result?.filenames || [];
                const durationMs = toolResult?.tool_use_result?.durationMs;
                const isWaiting = !toolResult;

                return (
                  <details key={`tool-${i}`} className="text-xs text-base-content/60">
                    <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                      <span className="text-base-content/50">▶</span>
                      <span>📂 Glob:</span>
                      <span className="font-mono text-cyan-400">{pattern}</span>
                      {path && <span className="opacity-50">in {path}</span>}
                      {numFiles !== undefined && <span className="opacity-50">({numFiles} files)</span>}
                      {durationMs !== undefined && <span className="opacity-40">({durationMs}ms)</span>}
                    </summary>
                    <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-96 text-xs">
                      {isWaiting ? (
                        <div className="flex items-center gap-2 text-base-content/50">
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>Searching files...</span>
                        </div>
                      ) : filenames.length > 0 ? (
                        <div className="space-y-0.5">
                          {filenames.slice(0, 50).map((file: string, idx: number) => (
                            <div key={idx} className="font-mono text-blue-400/80">{file}</div>
                          ))}
                          {filenames.length > 50 && <div className="opacity-50">...and {filenames.length - 50} more files</div>}
                        </div>
                      ) : (
                        <div className="opacity-50">No files matched</div>
                      )}
                    </div>
                  </details>
                );
              }
              // Special formatting for TodoWrite tool
              if (block.name === 'TodoWrite') {
                const toolResult = toolResultMap?.get(block.id);
                const inputTodos = block.input?.todos || [];
                const newTodos = toolResult?.tool_use_result?.newTodos || inputTodos;
                const isWaiting = !toolResult;

                const statusEmoji: Record<string, string> = {
                  pending: '⬜',
                  in_progress: '🔄',
                  completed: '✅'
                };

                return (
                  <details key={`tool-${i}`} className="text-xs text-base-content/60">
                    <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                      <span className="text-base-content/50">▶</span>
                      <span>📋 TodoWrite:</span>
                      <span className="opacity-50">({newTodos.length} items)</span>
                    </summary>
                    <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-96 text-xs">
                      {isWaiting ? (
                        <div className="flex items-center gap-2 text-base-content/50">
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>Updating todos...</span>
                        </div>
                      ) : newTodos.length > 0 ? (
                        <div className="space-y-1">
                          {newTodos.map((todo: { content: string; status: string; activeForm?: string }, idx: number) => (
                            <div key={idx} className="flex items-start gap-2">
                              <span>{statusEmoji[todo.status] || '⬜'}</span>
                              <span className={todo.status === 'completed' ? 'line-through opacity-50' : todo.status === 'in_progress' ? 'text-primary' : ''}>
                                {todo.content}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="opacity-50">No todos</div>
                      )}
                    </div>
                  </details>
                );
              }
              // Special formatting for Task tool
              if (block.name === 'Task') {
                const toolResult = toolResultMap?.get(block.id);
                const description = block.input?.description || 'Task';
                const subagentType = block.input?.subagent_type || 'general';
                const prompt = block.input?.prompt || '';
                const status = toolResult?.tool_use_result?.status;
                const agentId = toolResult?.tool_use_result?.agentId;
                const totalDurationMs = toolResult?.tool_use_result?.totalDurationMs;
                const totalToolUseCount = toolResult?.tool_use_result?.totalToolUseCount;
                const totalTokens = toolResult?.tool_use_result?.totalTokens;
                const content = toolResult?.tool_use_result?.content;
                const isWaiting = !toolResult;

                const subagentEmoji: Record<string, string> = {
                  'Explore': '🔭',
                  'Plan': '📐',
                  'general-purpose': '🤖',
                  'claude-code-guide': '📚'
                };

                return (
                  <details key={`tool-${i}`} className="text-xs text-base-content/60">
                    <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                      <span className="text-base-content/50">▶</span>
                      <span>{subagentEmoji[subagentType] || '🤖'} Task:</span>
                      <span className="text-orange-400">{description}</span>
                      <span className="opacity-50">({subagentType})</span>
                      {status && <span className={status === 'completed' ? 'text-success' : 'text-warning'}>[{status}]</span>}
                      {totalDurationMs !== undefined && <span className="opacity-40">({(totalDurationMs / 1000).toFixed(1)}s)</span>}
                    </summary>
                    <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-96 text-xs">
                      {isWaiting ? (
                        <div className="flex items-center gap-2 text-base-content/50">
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>Agent working...</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {agentId && <div className="opacity-50">Agent: {agentId}</div>}
                          {totalToolUseCount !== undefined && totalTokens !== undefined && (
                            <div className="opacity-50">{totalToolUseCount} tool calls • {totalTokens.toLocaleString()} tokens</div>
                          )}
                          {prompt && (
                            <details className="mt-1">
                              <summary className="cursor-pointer opacity-50 hover:opacity-100">View prompt</summary>
                              <pre className="mt-1 p-2 bg-base-200 rounded whitespace-pre-wrap">{prompt}</pre>
                            </details>
                          )}
                          {content && Array.isArray(content) && content.length > 0 && (
                            <div className="mt-2 border-t border-base-content/10 pt-2">
                              <div className="opacity-50 mb-1">Result:</div>
                              {content.map((item: { type: string; text?: string }, idx: number) => (
                                item.type === 'text' && item.text ? (
                                  <pre key={idx} className="whitespace-pre-wrap">{item.text}</pre>
                                ) : null
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                );
              }
              // Default formatting for other tools
              const toolResult = toolResultMap?.get(block.id);
              const isWaiting = !toolResult;
              return (
                <details key={`tool-${i}`} className="text-xs text-base-content/60">
                  <summary className="py-1 cursor-pointer hover:text-base-content/80 list-none flex items-center gap-2">
                    {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
                    <span className="text-base-content/50">▶</span>
                    <span>🔨 {block.name}</span>
                  </summary>
                  <div className="ml-[88px] p-2 bg-base-300 rounded overflow-auto max-h-48 text-xs">
                    {isWaiting ? (
                      <div className="flex items-center gap-2 text-base-content/50">
                        <span className="loading loading-spinner loading-xs"></span>
                        <span>Running...</span>
                      </div>
                    ) : (
                      <>
                        <div className="opacity-50 mb-1">Input:</div>
                        <pre className="whitespace-pre-wrap">{JSON.stringify(block.input, null, 2)}</pre>
                        {toolResult && (
                          <>
                            <div className="opacity-50 mt-2 mb-1 border-t border-base-content/10 pt-2">Result:</div>
                            <pre className="whitespace-pre-wrap">{typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content, null, 2)}</pre>
                          </>
                        )}
                      </>
                    )}
                  </div>
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
          <div className="text-sm">
            <MarkdownRenderer content={event.result || ''} />
          </div>
          <div className="text-xs opacity-40 mt-1">
            {showTimestamps && time}
            {event.total_cost_usd && `${showTimestamps ? ' • ' : ''}$${event.total_cost_usd.toFixed(4)} • ${event.num_turns} turns • ${(event.duration_ms / 1000).toFixed(1)}s`}
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
          {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
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
      {showTimestamps && <span className="font-mono opacity-50">{time}</span>}
      <span>{emoji}</span>
      <span className="opacity-70">{summary}</span>
    </div>
  );
}

export type { RawEvent };
