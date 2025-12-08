import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi, githubApi, API_BASE_URL } from '@/lib/api';
import type { GitHubPullRequest } from '@/shared';
import { useEventSource } from '@/hooks/useEventSource';
import { useBrowserNotification, getNotificationPrefs } from '@/hooks/useBrowserNotification';
import { useAuthStore, useRepoStore, useWorkerStore } from '@/lib/store';
import ChatInput, { type ChatInputRef, type ImageAttachment } from '@/components/ChatInput';
import { ImageViewer } from '@/components/ImageViewer';
import { ChatMessage } from '@/components/ChatMessage';
import SessionLayout from '@/components/SessionLayout';
import type { Message, GitHubRepository, ChatSession, ChatVerbosityLevel } from '@/shared';

// Helper to render text with clickable links
function LinkifyText({ text, className }: { text: string; className?: string }) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-info underline hover:text-info-content"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

// Database event type
interface DbEvent {
  id: number;
  chatSessionId: string;
  eventType: string;
  eventData: any;
  timestamp: Date;
}

// Draft message type
interface DraftMessage {
  input: string;
  images: ImageAttachment[];
  timestamp: number;
}

// Local storage helpers for draft messages
const DRAFT_STORAGE_KEY = 'chatDrafts';

function saveDraft(sessionId: string, input: string, images: ImageAttachment[]) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '{}');
    drafts[sessionId] = {
      input,
      images,
      timestamp: Date.now(),
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.error('Failed to save draft:', error);
  }
}

function loadDraft(sessionId: string): DraftMessage | null {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '{}');
    return drafts[sessionId] || null;
  } catch (error) {
    console.error('Failed to load draft:', error);
    return null;
  }
}

function clearDraft(sessionId: string) {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '{}');
    delete drafts[sessionId];
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch (error) {
    console.error('Failed to clear draft:', error);
  }
}

// Helper to format source indicator
// Only shows source labels in verbose mode
function formatSourceLabel(source?: string, verbosityLevel?: ChatVerbosityLevel): string {
  // Only show source prefixes in verbose mode
  if (verbosityLevel !== 'verbose') return '';
  if (!source) return '';
  const sourceMap: Record<string, string> = {
    'github-worker': '[github-worker]',
    'ai-coding-worker': '[ai-coding-worker]',
    'storage-worker': '[storage-worker]',
    'claude-agent-sdk': '[claude]',
    'codex-sdk': '[codex]',
  };
  return sourceMap[source] || `[${source}]`;
}

// Helper to convert raw SSE events from database to displayable messages
function convertEventToMessage(event: DbEvent, sessionId: string, verbosityLevel?: ChatVerbosityLevel): Message | null {
  const eventType = event.eventType;
  const data = event.eventData;

  let content: string | null = null;
  let messageType: 'assistant' | 'system' = 'assistant';
  let eventLabel = '';
  let model: string | undefined = undefined;
  let source: string | undefined = data?.source;

  // Debug: log every event conversion attempt
  console.log('[convertEventToMessage] Processing event:', {
    eventType,
    dataType: data?.type,
    hasData: !!data,
    hasDataData: !!data?.data
  });

  // Skip if data is undefined or null
  if (!data) {
    console.log('[convertEventToMessage] Skipping - no data');
    return null;
  }

  // Handle git commit and pull progress events
  // These events may have nested data structure: { data: { message: "..." }, type: "...", timestamp: "..." }
  // Note: Emojis are now embedded in the message by ai-coding-worker's emojiMapper
  if (eventType === 'commit_progress') {
    const message = data.data?.message || data.message;
    content = typeof data === 'string' ? data : (message || JSON.stringify(data));
    messageType = 'system';
  } else if (eventType === 'github_pull_progress') {
    const message = data.data?.message || data.message;
    content = typeof data === 'string' ? data : (message || JSON.stringify(data));
    messageType = 'system';
  }
  // Extract content from different event types
  else if (data.type === 'message' && data.message) {
    content = data.message;
    messageType = 'system';
  } else if (data.type === 'session_name' && data.sessionName) {
    // Use message from backend (has emoji from emojiMapper) or construct our own
    content = data.message || `📝 Session: ${data.sessionName}`;
    messageType = 'system';
  } else if (data.type === 'assistant_message' && data.data) {
    const msgData = data.data;

    // Extract model information if present (check both locations)
    if (data.model) {
      model = data.model;
    } else if (msgData.type === 'assistant' && msgData.message?.model) {
      model = msgData.message.model;
    }

    // Handle assistant message with Claude response
    if (msgData.type === 'assistant' && msgData.message?.content) {
      const contentBlocks = msgData.message.content;
      if (Array.isArray(contentBlocks)) {
        // First check for tool_use blocks to show file operations
        const toolUseBlocks = contentBlocks.filter((block: any) => block.type === 'tool_use');
        if (toolUseBlocks.length > 0) {
          // Create status messages for file operations
          const toolMessages: string[] = [];
          for (const toolBlock of toolUseBlocks) {
            const toolName = toolBlock.name;
            const toolInput = toolBlock.input || {};

            if (toolName === 'Read') {
              // Prefer relative_path (added by backend) over file_path
              const displayPath = toolInput.relative_path || toolInput.file_path || 'unknown file';
              toolMessages.push(`📖 Reading: ${displayPath}`);
            } else if (toolName === 'Write') {
              const displayPath = toolInput.relative_path || toolInput.file_path || 'unknown file';
              toolMessages.push(`📝 Writing: ${displayPath}`);
            } else if (toolName === 'Edit') {
              const displayPath = toolInput.relative_path || toolInput.file_path || 'unknown file';
              toolMessages.push(`✏️ Editing: ${displayPath}`);
            } else if (toolName === 'Grep') {
              const pattern = toolInput.pattern || '';
              toolMessages.push(`🔍 Searching for: "${pattern}"`);
            } else if (toolName === 'Glob') {
              const pattern = toolInput.pattern || '';
              toolMessages.push(`📁 Finding files: ${pattern}`);
            } else if (toolName === 'Bash') {
              const cmd = toolInput.command || '';
              const shortCmd = cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd;
              toolMessages.push(`⚡ Running: ${shortCmd}`);
            } else if (toolName === 'WebFetch') {
              const url = toolInput.url || '';
              toolMessages.push(`🌐 Fetching: ${url}`);
            } else if (toolName === 'WebSearch') {
              const query = toolInput.query || '';
              toolMessages.push(`🔎 Searching web: "${query}"`);
            } else if (toolName === 'Task') {
              const desc = toolInput.description || 'subtask';
              toolMessages.push(`🤖 Launching agent: ${desc}`);
            }
          }

          if (toolMessages.length > 0) {
            content = toolMessages.join('\n');
            messageType = 'system';
            // Add source label if present (only in verbose mode)
            const toolSourceLabel = formatSourceLabel(source, verbosityLevel);
            const toolFinalContent = toolSourceLabel ? `${toolSourceLabel} ${content}` : content;
            return {
              id: event.id,
              chatSessionId: sessionId,
              type: messageType,
              content: toolFinalContent,
              timestamp: new Date(event.timestamp),
              model,
            };
          }
        }

        // If no tool_use, extract text content as before
        const textParts = contentBlocks
          .filter((block: any) => block.type === 'text' && block.text)
          .map((block: any) => block.text);
        if (textParts.length > 0) {
          content = textParts.join('\n');
          eventLabel = '🤖';
        }
      }
    }
    // Skip result type - content already displayed from assistant message
    else if (msgData.type === 'result') {
      return null;
    }
    // Skip system init messages
    else if (msgData.type === 'system' && msgData.subtype === 'init') {
      return null;
    }
  }
  // Fallback to direct fields - treat as system status messages
  else if (typeof data === 'string') {
    content = data;
    messageType = 'system';
  } else if (data.message) {
    content = data.message;
    messageType = 'system';
  } else if (data.content) {
    if (Array.isArray(data.content)) {
      const textBlocks = data.content
        .filter((block: any) => block.type === 'text' && block.text)
        .map((block: any) => block.text);
      if (textBlocks.length > 0) {
        content = textBlocks.join('\n');
        messageType = 'system';
      }
    } else if (typeof data.content === 'string') {
      content = data.content;
      messageType = 'system';
    }
  } else if (data.text) {
    content = data.text;
    messageType = 'system';
  } else if (data.result) {
    content = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
    messageType = 'system';
  }

  // Skip if no meaningful content
  if (!content) {
    console.log('[convertEventToMessage] Skipping - no content extracted', { eventType, dataType: data?.type });
    return null;
  }

  // Add source label and event label if present (source label only in verbose mode)
  const sourceLabel = formatSourceLabel(source, verbosityLevel);
  let finalContent = content;
  if (sourceLabel || eventLabel) {
    const prefix = [sourceLabel, eventLabel].filter(Boolean).join(' ');
    finalContent = `${prefix} ${content}`;
  }

  console.log('[convertEventToMessage] Returning message:', { eventType, contentLength: finalContent.length, messageType });

  return {
    id: event.id,
    chatSessionId: sessionId,
    type: messageType,
    content: finalContent,
    timestamp: new Date(event.timestamp),
    model,
  };
}

// Helper to determine if a message should be shown based on verbosity level
function shouldShowMessage(message: Message, verbosityLevel: ChatVerbosityLevel): boolean {
  // Always show user, assistant, and error messages
  if (message.type !== 'system') {
    return true;
  }

  // If verbose, show everything
  if (verbosityLevel === 'verbose') {
    return true;
  }

  // For minimal, hide all system messages
  if (verbosityLevel === 'minimal') {
    return false;
  }

  // For 'normal' level, show key milestones but hide tool operations
  const content = message.content;

  // Tool operation patterns (hide these at normal level)
  // Note: Source prefixes (like [claude], [ai-coding-worker]) are only added in verbose mode,
  // so we don't need to check for them here - they won't exist in normal mode messages
  const toolOperationPatterns = [
    /^📖 Reading:/,      // Read operations
    /^📝 Writing:/,      // Write operations (not session name)
    /^✏️ Editing:/,      // Edit operations
    /^🔍 Searching for:/, // Grep searches
    /^📁 Finding files:/, // Glob file finding
    /^⚡ Running:/,      // Bash commands
    /^🌐 Fetching:/,     // Web fetches
    /^🔎 Searching web:/, // Web searches
    /^🤖 Launching agent:/, // Task/agent operations
  ];

  // Check if it matches a tool operation pattern
  for (const pattern of toolOperationPatterns) {
    if (pattern.test(content)) {
      return false;
    }
  }

  // Show everything else (session name, branch creation, commit progress, etc.)
  return true;
}

// Props for split view support
interface ChatProps {
  sessionId?: string;
  /** When true, renders without SessionLayout wrapper (for split view) */
  isEmbedded?: boolean;
}

export default function Chat({ sessionId: sessionIdProp, isEmbedded = false }: ChatProps = {}) {
  const { sessionId: sessionIdParam } = useParams();
  const sessionId = sessionIdProp ?? sessionIdParam;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [isExecuting, setIsExecuting] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamMethod, setStreamMethod] = useState<'GET' | 'POST'>('GET');
  const [streamBody, setStreamBody] = useState<any>(null);
  const [isReconnecting, setIsReconnecting] = useState(false); // Track reconnection attempts
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    if (!sessionId || sessionId === 'new') return null;
    return sessionId;
  });
  const [isLocked, setIsLocked] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageIdCounter = useRef(0);
  const autoGeneratedTitleRef = useRef<string | null>(null);
  const hasUserEditedTitleRef = useRef(false);
  const chatInputRef = useRef<ChatInputRef>(null);
  const isNearBottomRef = useRef(true); // Track if user is near bottom for smart auto-scroll
  const previousSessionIdRef = useRef<string | undefined>(undefined); // Track session changes for initial scroll
  const [lastRequest, setLastRequest] = useState<{
    input: string;
    selectedRepo: string;
    baseBranch: string;
  } | null>(null);
  const [viewingImage, setViewingImage] = useState<{
    data: string;
    mediaType: string;
    fileName: string;
  } | null>(null);
  const [prLoading, setPrLoading] = useState<'create' | 'auto' | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [prSuccess, setPrSuccess] = useState<string | null>(null);
  const [autoPrProgress, setAutoPrProgress] = useState<string | null>(null);

  // Scroll button visibility states
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [showScrollToPresent, setShowScrollToPresent] = useState(false);

  // Message queue and interruption state
  const [messageQueue, setMessageQueue] = useState<Array<{
    input: string;
    images: ImageAttachment[];
  }>>([]);

  // Get repo store actions
  const repoStore = useRepoStore();

  // Get worker store for robust execution tracking
  const workerStore = useWorkerStore();

  // Browser notification for session completion
  const { permission: notificationPermission, requestPermission, showSessionCompletedNotification } = useBrowserNotification();

  // Sync local state with global store
  useEffect(() => {
    repoStore.setSelectedRepo(selectedRepo);
  }, [selectedRepo]);

  useEffect(() => {
    repoStore.setBaseBranch(baseBranch);
  }, [baseBranch]);

  useEffect(() => {
    repoStore.setIsLocked(isLocked);
  }, [isLocked]);

  // ============================================================================
  // WORKER STATE SYNCHRONIZATION
  // ============================================================================
  // Keep local isExecuting in sync with global worker store
  // The global store is the source of truth - it persists across navigation
  // ============================================================================

  // On mount, check if worker store says we're executing for this session
  useEffect(() => {
    const effectiveSessionId = currentSessionId || (sessionId !== 'new' ? sessionId : null);
    if (effectiveSessionId) {
      const isWorkerExecuting = workerStore.isExecuting(effectiveSessionId);
      if (isWorkerExecuting && !isExecuting) {
        console.log('[Chat] Restoring isExecuting from worker store for session:', effectiveSessionId);
        setIsExecuting(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, sessionId]);

  // When local isExecuting changes, sync to global store
  useEffect(() => {
    const effectiveSessionId = currentSessionId || (sessionId !== 'new' ? sessionId : null);

    if (isExecuting && effectiveSessionId) {
      // Make sure global store knows we're executing
      if (!workerStore.isExecuting(effectiveSessionId)) {
        workerStore.startExecution(effectiveSessionId);
      }
    } else if (!isExecuting) {
      // If we stopped executing, clear global store (only if it matches our session)
      if (effectiveSessionId && workerStore.executingSessionId === effectiveSessionId) {
        workerStore.stopExecution();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExecuting, currentSessionId, sessionId]);

  // Load draft message when session changes
  useEffect(() => {
    if (sessionId && sessionId !== 'new') {
      const draft = loadDraft(sessionId);
      if (draft) {
        // Only restore if input is empty (avoid overwriting)
        if (!input && images.length === 0) {
          setInput(draft.input);
          setImages(draft.images);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Auto-focus input when entering/navigating to chat session
  useEffect(() => {
    // Small delay to ensure DOM is fully rendered
    const timeoutId = setTimeout(() => {
      chatInputRef.current?.focus();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [sessionId]);

  // Save draft with debounce when input or images change
  useEffect(() => {
    if (!sessionId || sessionId === 'new') return;

    const timeoutId = setTimeout(() => {
      // Only save if there's content to save
      if (input.trim() || images.length > 0) {
        saveDraft(sessionId, input, images);
      } else {
        // Clear draft if both are empty
        clearDraft(sessionId);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [input, images, sessionId]);

  // Load session details first to check status
  const { data: sessionDetailsData } = useQuery({
    queryKey: ['session-details', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.get(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new',
    // Poll every 2 seconds if session is running or pending
    refetchInterval: (query) => {
      const session = query.state.data?.data;
      return session?.status === 'running' || session?.status === 'pending' ? 2000 : false;
    },
  });

  // Load user messages from messages table (user-submitted messages)
  const { data: messagesData } = useQuery({
    queryKey: ['session-messages', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.getMessages(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new',
    refetchInterval: () => {
      if (isExecuting) return false;
      const session = sessionDetailsData?.data;
      return session?.status === 'running' || session?.status === 'pending' ? 2000 : false;
    },
  });

  // Load existing session events if sessionId provided (raw SSE events for replay)
  const { data: eventsData, refetch: refetchEvents, isLoading: eventsLoading, isError: eventsError, error: eventsErrorObj } = useQuery({
    queryKey: ['session-events', sessionId],
    queryFn: async () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      console.log('[Chat] Fetching events for session:', sessionId);
      const result = await sessionsApi.getEvents(sessionId);
      console.log(`[Chat] Events API response: sessionId=${sessionId}, success=${result?.success}, eventsCount=${result?.data?.events?.length}, total=${result?.data?.total}`);
      return result;
    },
    enabled: !!sessionId && sessionId !== 'new',
    // Don't use cached data - always fetch fresh on mount
    staleTime: 0,
    // Poll every 2 seconds if session is running or pending, but NOT while SSE stream is active
    // This prevents duplicate messages from both SSE and polling
    refetchInterval: () => {
      // Don't poll while SSE stream is active to avoid duplicates
      if (isExecuting) return false;

      const session = sessionDetailsData?.data;
      return session?.status === 'running' || session?.status === 'pending' ? 2000 : false;
    },
  });

  // Log events query state changes
  useEffect(() => {
    console.log(`[Chat] Events query state: sessionId=${sessionId}, loading=${eventsLoading}, error=${eventsError}, eventsCount=${eventsData?.data?.events?.length || 0}`);
  }, [sessionId, eventsLoading, eventsError, eventsErrorObj, eventsData]);

  const session: ChatSession | undefined = sessionDetailsData?.data;

  // Sync isExecuting with session status when returning to a running session
  // When returning to a running/pending session, show the Processing panel AND connect to live stream
  // This gives users visual feedback that the session is still processing and shows live events
  useEffect(() => {
    if (session?.status === 'running' || session?.status === 'pending') {
      // Set isExecuting=true for running/pending sessions to show Processing panel
      // This handles the case when users navigate back to an in-progress session
      if (!isExecuting) {
        console.log('[Chat] Syncing isExecuting with session status:', session.status);
        setIsExecuting(true);
        // Also sync the global worker store to keep stop/interrupt button working
        if (currentSessionId) {
          workerStore.startExecution(currentSessionId);
          console.log('[Chat] Synced worker store for running session:', currentSessionId);
        }
      }

      // If we don't have an active stream, try to connect to the live stream
      // This allows users to see live events when they return to a running session
      if (!streamUrl && currentSessionId && !isReconnecting) {
        console.log('[Chat] Attempting to connect to live stream for running session:', currentSessionId);
        setIsReconnecting(true); // Mark as reconnection attempt
        const reconnectStreamUrl = sessionsApi.getStreamUrl(currentSessionId);
        setStreamMethod('GET'); // Stream endpoint uses GET
        setStreamBody(null);
        setStreamUrl(reconnectStreamUrl);
      }
    } else if (session?.status === 'completed' || session?.status === 'error') {
      // Reset isExecuting when session is completed/errored
      // Previously we checked `!streamUrl` to avoid race conditions, but this caused
      // the processing indicator to get stuck if the stream ended without properly
      // clearing state. Now we always clear isExecuting and also clear streamUrl
      // to ensure consistent state cleanup.
      if (isExecuting) {
        console.log('[Chat] Session completed, setting isExecuting to false');
        setIsExecuting(false);
        setStreamUrl(null); // Also clear streamUrl to ensure consistent state
        setIsReconnecting(false); // Clear reconnection flag
        // Also clear the global worker store
        workerStore.stopExecution();
        console.log('[Chat] Cleared worker store for completed/errored session');
        // Refetch events to ensure we have all stored events from the database
        refetchEvents();
        console.log('[Chat] Triggered events refetch after session completion');
      }
    }
  }, [session?.status, isExecuting, currentSessionId, streamUrl, isReconnecting, refetchEvents]);

  // Load current session details to check if locked
  const { data: currentSessionData } = useQuery({
    queryKey: ['currentSession', currentSessionId],
    queryFn: async () => {
      if (!currentSessionId) return null;
      const response = await fetch(`${API_BASE_URL}/api/sessions/${currentSessionId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch session');
      return response.json();
    },
    enabled: !!currentSessionId,
  });

  // Load repositories
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: githubApi.getRepos,
    enabled: !!user?.githubAccessToken,
  });

  const repositories: GitHubRepository[] = reposData?.data || [];

  const updateMutation = useMutation({
    mutationFn: ({ id, title, branch }: { id: string; title?: string; branch?: string }) =>
      sessionsApi.update(id, { userRequest: title, branch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-details', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-for-layout', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setEditingTitle(false);
      setEditTitle('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sessionsApi.delete(id),
    onSuccess: () => {
      navigate('/sessions');
    },
  });

  // Query to check for existing PR
  const { data: prData, refetch: refetchPr } = useQuery({
    queryKey: ['pr', session?.repositoryOwner, session?.repositoryName, session?.branch],
    queryFn: async () => {
      if (!session?.repositoryOwner || !session?.repositoryName || !session?.branch) {
        return null;
      }
      const response = await githubApi.getPulls(
        session.repositoryOwner,
        session.repositoryName,
        session.branch,
        session.baseBranch || undefined
      );
      return response.data as GitHubPullRequest[];
    },
    enabled: !!session?.repositoryOwner && !!session?.repositoryName && !!session?.branch,
    refetchOnWindowFocus: false,
  });

  const existingPr = prData?.find((pr: GitHubPullRequest) => pr.state === 'open');
  const mergedPr = prData?.find((pr: GitHubPullRequest) => pr.merged === true);

  const handleCreatePR = async () => {
    if (!session?.repositoryOwner || !session?.repositoryName || !session?.branch || !session?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('create');
    setPrError(null);
    setPrSuccess(null);

    try {
      const response = await githubApi.createPull(
        session.repositoryOwner,
        session.repositoryName,
        {
          title: session.userRequest || `Merge ${session.branch} into ${session.baseBranch}`,
          head: session.branch,
          base: session.baseBranch,
        }
      );
      setPrSuccess(`PR #${response.data.number} created successfully!`);

      // Add message to chat history
      const prMessageContent = `🔀 Pull Request #${response.data.number} created\n\n${response.data.htmlUrl}`;
      messageIdCounter.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: 'system',
          content: prMessageContent,
          timestamp: new Date(),
        },
      ]);

      // Persist message to database
      if (sessionId && sessionId !== 'new') {
        try {
          await sessionsApi.createMessage(sessionId, 'system', prMessageContent);
        } catch (err) {
          console.error('Failed to persist PR message to database:', err);
        }
      }

      refetchPr();
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to create PR';
      setPrError(errorMsg);
    } finally {
      setPrLoading(null);
    }
  };

  const handleViewPR = () => {
    if (existingPr?.htmlUrl) {
      window.open(existingPr.htmlUrl, '_blank');
    }
  };

  const handleScrollToTop = () => {
    messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleScrollToPresent = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleAutoPR = async () => {
    if (!session?.repositoryOwner || !session?.repositoryName || !session?.branch || !session?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('auto');
    setPrError(null);
    setPrSuccess(null);
    setAutoPrProgress('Starting Auto PR...');

    // Add initial progress message to chat
    const startMessageId = Date.now();
    messageIdCounter.current += 1;
    setMessages((prev) => [
      ...prev,
      {
        id: startMessageId,
        chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
        type: 'system',
        content: '🔄 **Auto PR in progress...**\n\nStarting Auto PR process...',
        timestamp: new Date(),
      },
    ]);

    try {
      const response = await githubApi.autoPR(
        session.repositoryOwner,
        session.repositoryName,
        session.branch,
        {
          base: session.baseBranch,
          title: session.userRequest || `Merge ${session.branch} into ${session.baseBranch}`,
          sessionId: sessionId && sessionId !== 'new' ? sessionId : undefined,
        }
      );

      const results = response.data;

      // Build progress summary
      let progressSteps = '✅ **Auto PR completed successfully!**\n\n';
      progressSteps += `**Steps completed:**\n`;
      progressSteps += `1. ${results.pr ? `✓ Found/created PR #${results.pr.number}` : '✓ Checked PR status'}\n`;
      progressSteps += `2. ✓ ${results.mergeBase?.message || 'Updated branch with base'}\n`;
      progressSteps += `3. ✓ Waited for PR to become mergeable\n`;
      progressSteps += `4. ✓ Merged PR #${results.pr?.number} into ${session.baseBranch}\n`;
      if (sessionId && sessionId !== 'new') {
        progressSteps += `5. ✓ Session moved to trash\n`;
      }
      progressSteps += `\n[View PR #${results.pr?.number}](${results.pr?.htmlUrl})`;

      setPrSuccess(`Auto PR completed! PR #${response.data.pr?.number} merged successfully.`);
      setAutoPrProgress(null);

      // Update the progress message in chat with final results
      setMessages((prev) =>
        prev.map(msg =>
          msg.id === startMessageId
            ? { ...msg, content: progressSteps }
            : msg
        )
      );

      // Persist final message to database
      if (sessionId && sessionId !== 'new') {
        try {
          await sessionsApi.createMessage(sessionId, 'system', progressSteps);
        } catch (err) {
          console.error('Failed to persist Auto PR message to database:', err);
        }
      }

      refetchPr();

      // If session was soft-deleted, redirect to sessions list after a short delay
      if (sessionId && sessionId !== 'new') {
        setTimeout(() => {
          navigate('/');
        }, 2000);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to complete Auto PR';

      // Update progress message with error
      let errorDetails = `❌ **Auto PR failed**\n\n`;
      if (errorMsg.includes('conflict')) {
        errorDetails += 'Merge conflict detected. Please resolve conflicts manually.';
        setPrError('Merge conflict detected. Please resolve conflicts manually.');
      } else if (errorMsg.includes('Timeout')) {
        errorDetails += 'Timeout waiting for PR to become mergeable. The PR may have been created but requires manual review.';
        setPrError(errorMsg);
      } else {
        errorDetails += `Error: ${errorMsg}`;
        setPrError(errorMsg);
      }

      setMessages((prev) =>
        prev.map(msg =>
          msg.id === startMessageId
            ? { ...msg, content: errorDetails }
            : msg
        )
      );

      setAutoPrProgress(null);
      refetchPr();
    } finally {
      setPrLoading(null);
    }
  };

  const handleEditTitle = () => {
    if (session) {
      setEditTitle(session.userRequest);
      setEditingTitle(true);
    }
  };

  const handleSaveTitle = () => {
    if (sessionId && sessionId !== 'new' && editTitle.trim()) {
      hasUserEditedTitleRef.current = true;
      updateMutation.mutate({ id: sessionId, title: editTitle.trim() });
    }
  };

  const handleCancelEdit = () => {
    setEditingTitle(false);
    setEditTitle('');
  };

  const handleDeleteSession = () => {
    if (sessionId && sessionId !== 'new') {
      deleteMutation.mutate(sessionId);
    }
  };

  // Merge database messages with converted events
  useEffect(() => {
    if (!sessionId) return;

    // Get messages from the messages table (user messages and system messages from code operations)
    const dbMessages: Message[] = messagesData?.data?.messages?.filter(
      (m: Message) => m.type === 'user' || m.type === 'system'
    ) || [];

    // Convert raw events to displayable messages
    const dbEvents: DbEvent[] = eventsData?.data?.events || [];

    // Debug logging - use primitive values for production visibility
    console.log(`[Chat] Merging messages: sessionId=${sessionId}, rawMessagesCount=${messagesData?.data?.messages?.length || 0}, filteredDbMessagesCount=${dbMessages.length}, rawEventsCount=${dbEvents.length}`);

    const eventMessages = dbEvents
      .map((event) => convertEventToMessage(event, sessionId, user?.chatVerbosityLevel))
      .filter((msg): msg is Message => msg !== null);

    console.log(`[Chat] Converted events to messages: eventMessagesCount=${eventMessages.length}`);

    // Merge and sort by timestamp
    const allMessages = [...dbMessages, ...eventMessages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    console.log(`[Chat] Final merged messages: totalCount=${allMessages.length}, dbMessagesCount=${dbMessages.length}, eventMessagesCount=${eventMessages.length}`);

    // Preserve scroll position when updating messages from database
    // This prevents the chat from jumping to top when queries are refetched after completion
    const container = messagesContainerRef.current;
    const savedScrollTop = container?.scrollTop ?? 0;

    setMessages(allMessages);

    // Restore scroll position after React re-renders
    if (container && savedScrollTop > 0) {
      requestAnimationFrame(() => {
        container.scrollTop = savedScrollTop;
      });
    }
  }, [eventsData, messagesData, sessionId, user?.chatVerbosityLevel]);

  // Update locked state and repository settings when session data changes
  useEffect(() => {
    if (currentSessionData?.data) {
      // Set lock state from database
      if (currentSessionData.data.locked) {
        setIsLocked(true);
      }

      // Always populate repository settings from session data when available
      // This ensures the second bar shows values even before the session is locked
      if (currentSessionData.data.repositoryUrl) {
        setSelectedRepo(currentSessionData.data.repositoryUrl);
      }
      if (currentSessionData.data.baseBranch) {
        setBaseBranch(currentSessionData.data.baseBranch);
      }
    }
  }, [currentSessionData]);

  // Auto-lock repository controls when messages exist (active session)
  // This ensures controls are only editable on the NewSession page
  useEffect(() => {
    if (messages.length > 0 && !isLocked) {
      console.log('[Chat] Auto-locking repository controls - active session with messages');
      setIsLocked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]); // Only depend on messages.length to prevent re-render loops

  // Load last selected repo from localStorage when repositories are loaded (only once)
  const [hasLoadedFromStorage, setHasLoadedFromStorage] = useState(false);
  useEffect(() => {
    // Only load from localStorage if session is not locked and hasn't been loaded yet
    if (repositories.length > 0 && !hasLoadedFromStorage && !isLocked) {
      const lastSelectedRepo = localStorage.getItem('lastSelectedRepo');
      if (lastSelectedRepo) {
        // Verify the repo still exists in the list
        const repoExists = repositories.some(repo => repo.cloneUrl === lastSelectedRepo);
        if (repoExists) {
          setSelectedRepo(lastSelectedRepo);
        }
      }
      setHasLoadedFromStorage(true);
    }
  }, [repositories, hasLoadedFromStorage, isLocked]);

  // Save selected repo to localStorage whenever it changes (including clearing)
  useEffect(() => {
    if (hasLoadedFromStorage && !isLocked) {
      if (selectedRepo) {
        localStorage.setItem('lastSelectedRepo', selectedRepo);
      } else {
        localStorage.removeItem('lastSelectedRepo');
      }
    }
  }, [selectedRepo, hasLoadedFromStorage, isLocked]);

  // Handle scroll position detection for scroll buttons
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const scrollPosition = scrollTop;
      const maxScroll = scrollHeight - clientHeight;
      const distanceFromBottom = maxScroll - scrollPosition;

      // Track if user is near bottom (within 150px) for smart auto-scroll
      isNearBottomRef.current = distanceFromBottom < 150;

      // At bottom or closer to bottom -> show "scroll to top"
      // At top or closer to top -> show "scroll to bottom"
      const closerToBottom = scrollPosition >= distanceFromBottom;

      if (closerToBottom) {
        // At/near bottom - show scroll to top
        setShowScrollToTop(true);
        setShowScrollToPresent(false);
      } else if (!closerToBottom) {
        // At/near top - show scroll to bottom/present
        setShowScrollToTop(false);
        setShowScrollToPresent(true);
      } else {
        // Hide both (shouldn't reach here)
        setShowScrollToTop(false);
        setShowScrollToPresent(false);
      }
    };

    // Initial check
    handleScroll();

    // Add scroll listener
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages.length]); // Re-attach when messages change

  // Smart auto-scroll: only scroll to bottom when messages change AND user is near bottom
  useEffect(() => {
    // Only auto-scroll if user is near the bottom - respect their scroll position
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Scroll to bottom when entering a session (e.g., from My Sessions page)
  // This ensures users see the latest messages when opening an existing session
  useEffect(() => {
    // Only trigger when sessionId changes to a valid session (not 'new')
    if (sessionId && sessionId !== 'new' && sessionId !== previousSessionIdRef.current) {
      previousSessionIdRef.current = sessionId;

      // Wait for messages to load, then scroll to bottom
      // Use a small delay to ensure the DOM has updated with messages
      const scrollToBottom = () => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
          // Reset isNearBottomRef since we're now at the bottom
          isNearBottomRef.current = true;
        }
      };

      // Try scrolling after a short delay to allow messages to render
      setTimeout(scrollToBottom, 100);
    } else if (!sessionId || sessionId === 'new') {
      // Reset when navigating to new session page
      previousSessionIdRef.current = undefined;
    }
  }, [sessionId, messages.length]); // Also depend on messages.length to scroll after messages load

  // Reset state when navigating to new chat (sessionId becomes undefined)
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setInput('');
      setImages([]);
      setSelectedRepo('');
      // NOTE: We intentionally do NOT reset isExecuting here
      // The global worker store tracks execution state across navigation
      // and will restore it when the user returns to the executing session
      setStreamUrl(null);
      setEditingTitle(false);
      setEditTitle('');
      setCurrentSessionId(null);
      setIsLocked(false);
      setLastRequest(null);
      messageIdCounter.current = 0;
      autoGeneratedTitleRef.current = null;
      hasUserEditedTitleRef.current = false;

      // Reset local isExecuting only if there's no active worker in global store
      // This prevents losing track of executing workers during navigation
      if (!workerStore.executingSessionId) {
        setIsExecuting(false);
      } else {
        console.log('[Chat] Navigating away but worker still executing:', workerStore.executingSessionId);
      }
    }
  }, [sessionId]);



  // Handle pre-selected settings from NewSession hub
  useEffect(() => {
    const state = location.state as any;

    // Check for pre-selected settings from NewSession hub
    if (state?.preSelectedSettings && !currentSessionId) {
      const { repositoryUrl, baseBranch: preSelectedBaseBranch, locked } = state.preSelectedSettings;

      console.log('[Chat] Loading pre-selected settings:', state.preSelectedSettings);

      if (repositoryUrl) {
        setSelectedRepo(repositoryUrl);
      }

      if (preSelectedBaseBranch) {
        setBaseBranch(preSelectedBaseBranch);
      }

      if (locked) {
        setIsLocked(true);
      }

      // Clear the navigation state to prevent re-applying
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }

    // Check if we came from Dashboard with stream params (old behavior for backward compatibility)
    if (state?.startStream && state?.streamParams && !streamUrl) {
      console.log('[Chat] Auto-starting stream from navigation state:', state.streamParams);

      // Filter out github/repository parameters if we're resuming an existing session
      let params = { ...state.streamParams };
      if (currentSessionId || (sessionId && sessionId !== 'new')) {
        // Remove github-related parameters when resuming
        delete params.github;
        delete params.repositoryUrl;
        delete params.baseBranch;
        delete params.autoCommit;

        // Add websiteSessionId for resuming
        params.websiteSessionId = currentSessionId || sessionId;
        console.log('[Chat] Filtered params for resuming session:', params);
      }

      // Always use POST
      setStreamMethod('POST');
      setStreamBody(params);
      setStreamUrl(`${API_BASE_URL}/api/execute`);

      setIsExecuting(true);

      // Clear the navigation state to prevent re-triggering
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, streamUrl, navigate, location.pathname, currentSessionId]);

  // Reset title edit tracking when switching to a different session
  useEffect(() => {
    if (sessionId) {
      autoGeneratedTitleRef.current = null;
      hasUserEditedTitleRef.current = false;
    }
  }, [sessionId]);

  const { disconnect: disconnectStream } = useEventSource(streamUrl, {
    method: streamMethod,
    body: streamBody,
    onMessage: (event) => {
      // Log all events to see what we're receiving
      console.log('Received SSE event:', event);
      console.log('Full event data structure:', JSON.stringify(event, null, 2));

      const { eventType, data } = event;

      // Handle session-created event - update URL to the actual session ID
      if (eventType === 'session-created' && data?.websiteSessionId) {
        console.log('[Chat] Session created with ID:', data.websiteSessionId);
        setCurrentSessionId(data.websiteSessionId);

        // Navigate to the actual session URL if we're on /session/new
        if (!sessionId || sessionId === 'new') {
          console.log('[Chat] Navigating to session:', data.websiteSessionId);
          // Preserve the section path (e.g., /session/new/chat -> /session/{id}/chat)
          const currentPath = location.pathname;
          const section = currentPath.split('/').pop(); // Get the last segment
          const targetPath = section && section !== 'new'
            ? `/session/${data.websiteSessionId}/${section}`
            : `/session/${data.websiteSessionId}/chat`;
          navigate(targetPath, { replace: true });
        }

        // Don't display this as a message
        return;
      }

      // Skip system events (but NOT commit_progress or github_pull_progress)
      if (eventType === 'connected' || eventType === 'completed') {
        return;
      }

      // Handle heartbeat events - just record activity, don't display
      if (eventType === 'heartbeat') {
        workerStore.recordHeartbeat();
        return;
      }

      // Handle replay markers from reconnection
      if (data?.type === 'replay_start') {
        console.log('[Chat] Starting event replay, total events:', data.totalEvents);
        // Show a system message that we're replaying
        if (data.totalEvents > 0) {
          messageIdCounter.current += 1;
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + messageIdCounter.current,
              chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
              type: 'system',
              content: `📜 Replaying ${data.totalEvents} previous events...`,
              timestamp: new Date(),
            },
          ]);
        }
        return;
      }
      if (data?.type === 'replay_end') {
        console.log('[Chat] Replay complete, now receiving live events');
        return;
      }

      // Skip replayed events that we already have (de-duplicate)
      if (data?._replayed) {
        // For replayed events, don't create duplicate messages
        // The message content was already processed, just update the display
        workerStore.recordHeartbeat();
        // Continue processing to add the message to the list
      }

      // Extract content from various possible locations
      let content: string | null = null;
      let messageType: 'assistant' | 'system' = 'assistant';
      let eventLabel = '';
      let model: string | undefined = undefined;
      const source: string | undefined = data?.source;

      // Skip if data is undefined or null
      if (!data) {
        console.log('Skipping event with no data:', event);
        return;
      }

      // Handle git commit and pull progress events
      // These events may have nested data structure: { data: { message: "..." }, type: "...", timestamp: "..." }
      // Note: Emojis are now embedded in the message by ai-coding-worker's emojiMapper
      if (eventType === 'commit_progress') {
        const message = data.data?.message || data.message;
        content = typeof data === 'string' ? data : (message || JSON.stringify(data));
        messageType = 'system';
      } else if (eventType === 'github_pull_progress') {
        const message = data.data?.message || data.message;
        content = typeof data === 'string' ? data : (message || JSON.stringify(data));
        messageType = 'system';
      }
      // Extract content from different event types (matching server-side logic)
      else if (data.type === 'message' && data.message) {
        content = data.message;
        messageType = 'system';
      } else if (data.type === 'session_name' && data.sessionName) {
        // Session name - auto-save if not manually edited
        const newTitle = data.sessionName;
        // Use message from backend (has emoji from emojiMapper) or construct our own
        content = data.message || `📝 Session: ${newTitle}`;
        messageType = 'system';

        // Auto-update the session title if:
        // 1. User hasn't manually edited the title
        // 2. Current title is the default "Resumed session" OR matches a previous auto-generated title
        if (sessionId && session && !hasUserEditedTitleRef.current) {
          const currentTitle = session.userRequest;
          const isDefaultTitle = currentTitle === 'Resumed session';
          const isPreviousAutoTitle = autoGeneratedTitleRef.current && currentTitle === autoGeneratedTitleRef.current;

          if (isDefaultTitle || isPreviousAutoTitle || !autoGeneratedTitleRef.current) {
            console.log('[Chat] Auto-updating session title to:', newTitle);
            autoGeneratedTitleRef.current = newTitle;
            if (sessionId !== 'new') {
              updateMutation.mutate({ id: sessionId, title: newTitle });
            }
          }
        }
      } else if (data.type === 'branch_created' && data.branchName) {
        // Branch created - update session with the new branch name
        const newBranch = data.branchName;
        // Use message from backend (has emoji from emojiMapper) or construct our own
        content = data.message || `🌿 Branch created: ${newBranch}`;
        messageType = 'system';

        // Update the session's branch in the database
        if (sessionId && sessionId !== 'new') {
          console.log('[Chat] Updating session branch to:', newBranch);
          updateMutation.mutate({ id: sessionId, branch: newBranch });
        }
      } else if (data.type === 'assistant_message' && data.data) {
        const msgData = data.data;

        // Extract model information if present (check both locations)
        if (data.model) {
          model = data.model;
        } else if (msgData.type === 'assistant' && msgData.message?.model) {
          model = msgData.message.model;
        }

        // Handle assistant message with Claude response
        if (msgData.type === 'assistant' && msgData.message?.content) {
          const contentBlocks = msgData.message.content;
          if (Array.isArray(contentBlocks)) {
            // First check for tool_use blocks to show file operations
            const toolUseBlocks = contentBlocks.filter((block: any) => block.type === 'tool_use');
            if (toolUseBlocks.length > 0) {
              // Create status messages for file operations
              const toolMessages: string[] = [];
              for (const toolBlock of toolUseBlocks) {
                const toolName = toolBlock.name;
                const toolInput = toolBlock.input || {};

                if (toolName === 'Read') {
                  // Prefer relative_path (added by backend) over file_path
                  const displayPath = toolInput.relative_path || toolInput.file_path || 'unknown file';
                  toolMessages.push(`📖 Reading: ${displayPath}`);
                } else if (toolName === 'Write') {
                  const displayPath = toolInput.relative_path || toolInput.file_path || 'unknown file';
                  toolMessages.push(`📝 Writing: ${displayPath}`);
                } else if (toolName === 'Edit') {
                  const displayPath = toolInput.relative_path || toolInput.file_path || 'unknown file';
                  toolMessages.push(`✏️ Editing: ${displayPath}`);
                } else if (toolName === 'Grep') {
                  const pattern = toolInput.pattern || '';
                  toolMessages.push(`🔍 Searching for: "${pattern}"`);
                } else if (toolName === 'Glob') {
                  const pattern = toolInput.pattern || '';
                  toolMessages.push(`📁 Finding files: ${pattern}`);
                } else if (toolName === 'Bash') {
                  const cmd = toolInput.command || '';
                  const shortCmd = cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd;
                  toolMessages.push(`⚡ Running: ${shortCmd}`);
                } else if (toolName === 'WebFetch') {
                  const url = toolInput.url || '';
                  toolMessages.push(`🌐 Fetching: ${url}`);
                } else if (toolName === 'WebSearch') {
                  const query = toolInput.query || '';
                  toolMessages.push(`🔎 Searching web: "${query}"`);
                } else if (toolName === 'Task') {
                  const desc = toolInput.description || 'subtask';
                  toolMessages.push(`🤖 Launching agent: ${desc}`);
                }
              }

              if (toolMessages.length > 0) {
                const toolContent = toolMessages.join('\n');
                // Add source label if present
                const toolSourceLabel = formatSourceLabel(source);
                const toolFinalContent = toolSourceLabel ? `${toolSourceLabel} ${toolContent}` : toolContent;
                // Create and add the tool message immediately
                messageIdCounter.current += 1;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: Date.now() + messageIdCounter.current,
                    chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
                    type: 'system',
                    content: toolFinalContent,
                    timestamp: new Date(),
                    model,
                  },
                ]);
                // Don't return here - continue to process text blocks if any
              }
            }

            // Then extract text content as before
            const textParts = contentBlocks
              .filter((block: any) => block.type === 'text' && block.text)
              .map((block: any) => block.text);
            if (textParts.length > 0) {
              content = textParts.join('\n');
              eventLabel = '🤖';
            } else {
              // If we already showed tool messages, skip showing empty text
              return;
            }
          }
        }
        // Skip result type - content already displayed from assistant message
        else if (msgData.type === 'result') {
          console.log('[Chat] Skipping result message (already displayed from assistant message)');
          return;
        }
        // Skip system init messages
        else if (msgData.type === 'system' && msgData.subtype === 'init') {
          console.log('[Chat] Skipping system init message');
          return;
        }
      }
      // Fallback to direct fields - treat as system status messages
      else if (typeof data === 'string') {
        content = data;
        messageType = 'system';
      } else if (data.message) {
        content = data.message;
        messageType = 'system';
      } else if (data.content) {
        if (Array.isArray(data.content)) {
          const textBlocks = data.content
            .filter((block: any) => block.type === 'text' && block.text)
            .map((block: any) => block.text);
          if (textBlocks.length > 0) {
            content = textBlocks.join('\n');
            messageType = 'system';
          }
        } else if (typeof data.content === 'string') {
          content = data.content;
          messageType = 'system';
        }
      } else if (data.text) {
        content = data.text;
        messageType = 'system';
      } else if (data.result) {
        content = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
        messageType = 'system';
      }

      // Skip if no meaningful content
      if (!content) {
        console.log('Skipping event with no content:', event);
        console.log('Data keys:', typeof data === 'object' ? Object.keys(data) : typeof data);
        return;
      }

      // Add source label and event label if present
      const sourceLabel = formatSourceLabel(source);
      let finalContent = content;
      if (sourceLabel || eventLabel) {
        const prefix = [sourceLabel, eventLabel].filter(Boolean).join(' ');
        finalContent = `${prefix} ${content}`;
      }

      messageIdCounter.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: messageType,
          content: finalContent,
          timestamp: new Date(),
          model,
        },
      ]);
      // Record heartbeat for every message received (keeps worker state fresh)
      workerStore.recordHeartbeat();
    },
    onConnected: () => {
      setIsExecuting(true);
      // Mark stream as active in global store
      workerStore.setActiveStream(true);
      // Clear reconnection flag on successful connection
      if (isReconnecting) {
        console.log('[Chat] Reconnection successful, now receiving live events');
        setIsReconnecting(false);
      }
      console.log('[Chat] SSE stream connected, worker store updated');
    },
    onCompleted: (data) => {
      setIsExecuting(false);
      setStreamUrl(null);
      setIsReconnecting(false); // Clear reconnection flag
      // Clear global worker state
      workerStore.stopExecution();
      console.log('[Chat] SSE stream completed, worker store cleared');

      // Show browser notification if enabled (only when tab is not focused)
      const notificationPrefs = getNotificationPrefs();
      if (notificationPrefs.enabled && notificationPrefs.onSessionComplete) {
        const repoName = session?.repositoryName
          ? `${session.repositoryOwner}/${session.repositoryName}`
          : selectedRepo || undefined;

        // If permission not yet requested, request it now (on first session completion)
        if (notificationPermission === 'default') {
          requestPermission().then((perm) => {
            if (perm === 'granted') {
              showSessionCompletedNotification(data?.websiteSessionId, repoName);
            }
          });
        } else {
          showSessionCompletedNotification(data?.websiteSessionId, repoName);
        }
      }

      // Capture session ID from completion event
      if (data?.websiteSessionId) {
        console.log('[Chat] Execution completed, setting currentSessionId:', data.websiteSessionId);
        setCurrentSessionId(data.websiteSessionId);
        // Lock the fields after first submission completes
        // This prevents users from changing repo/branch after a session has started
        if (!isLocked && selectedRepo) {
          console.log('[Chat] Locking fields after first submission');
          setIsLocked(true);
        }
        // Invalidate queries to refetch session data and messages from database
        // This syncs the final state after SSE stream completes
        queryClient.invalidateQueries({ queryKey: ['currentSession', data.websiteSessionId] });
        queryClient.invalidateQueries({ queryKey: ['session', String(data.websiteSessionId)] });

        // Scroll to bottom only if user is near the bottom - respect their scroll position
        // Use multiple timeouts to handle query invalidation re-renders
        const scrollToBottomIfNear = () => {
          if (isNearBottomRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
        };
        setTimeout(scrollToBottomIfNear, 100);
        setTimeout(scrollToBottomIfNear, 500);
        setTimeout(scrollToBottomIfNear, 1000);

        // Navigate to the session URL if not already there
        if (!sessionId || sessionId !== data.websiteSessionId) {
          console.log('[Chat] Navigating to session:', data.websiteSessionId);
          // Preserve the section path (e.g., /session/new/chat -> /session/{id}/chat)
          const currentPath = location.pathname;
          const section = currentPath.split('/').pop(); // Get the last segment
          const targetPath = section && section !== 'new' && section !== data.websiteSessionId
            ? `/session/${data.websiteSessionId}/${section}`
            : `/session/${data.websiteSessionId}/chat`;
          navigate(targetPath, { replace: true });
        }
      }
      // Refocus input after processing completes (with delay to ensure DOM updates)
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 100);
    },
    onError: (error) => {
      console.error('Stream error:', error);

      // If this was a reconnection attempt, don't show an error to the user
      // The polling mechanism will continue to work
      if (isReconnecting) {
        console.log('[Chat] Reconnection failed, falling back to polling');
        setIsReconnecting(false);
        setStreamUrl(null);
        // Don't clear isExecuting - let the session status polling handle that
        // Don't show error message to user for reconnection failures
        return;
      }

      messageIdCounter.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: 'error',
          content: error.message,
          timestamp: new Date(),
        },
      ]);
      setIsExecuting(false);
      setStreamUrl(null);
      // Clear global worker state on error
      workerStore.stopExecution();
      console.log('[Chat] SSE stream error, worker store cleared');

      // Refocus input after error (with delay to ensure DOM updates)
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 100);
    },
    autoReconnect: false, // Disable auto-reconnect to prevent infinite loops
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() && images.length === 0) return;

    // If a job is currently executing, queue the message
    if (isExecuting) {
      const newMessage = {
        input: input.trim(),
        images: [...images],
      };
      setMessageQueue([...messageQueue, newMessage]);

      // Clear input
      setInput('');
      setImages([]);

      // Show confirmation
      messageIdCounter.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: 'system',
          content: `📋 Message queued (${messageQueue.length + 1} in queue)`,
          timestamp: new Date(),
        },
      ]);
      return;
    }

    // Set executing state immediately to prevent duplicate submissions
    setIsExecuting(true);

    // Start execution in global worker store (for the session we're about to use)
    const targetSessionId = currentSessionId || 'pending-new-session';
    workerStore.startExecution(targetSessionId);
    console.log('[Chat] Started execution tracking for session:', targetSessionId);

    // Save last request for retry functionality
    setLastRequest({
      input: input.trim(),
      selectedRepo,
      baseBranch,
    });

    // Add user message
    messageIdCounter.current += 1;
    const userMessage: Message = {
      id: Date.now() + messageIdCounter.current,
      chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
      type: 'user',
      content: input.trim() || (images.length > 0 ? `[${images.length} image${images.length > 1 ? 's' : ''} attached]` : ''),
      images: images.length > 0 ? images : undefined,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);

    // Build userRequest - either string or content blocks
    let userRequestParam: string | any[];

    if (images.length > 0) {
      // Create content blocks for multimodal request
      const contentBlocks: any[] = [];

      // Add text block if there's text
      if (input.trim()) {
        contentBlocks.push({
          type: 'text',
          text: input.trim(),
        });
      }

      // Add image blocks
      images.forEach((image) => {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mediaType,
            data: image.data,
          },
        });
      });

      userRequestParam = contentBlocks;
    } else {
      userRequestParam = input.trim();
    }

    // Build request parameters
    const requestParams: any = {
      userRequest: userRequestParam,
    };

    if (currentSessionId) {
      requestParams.websiteSessionId = currentSessionId;
      console.log('[Chat] Continuing existing session:', currentSessionId);
    }

    // Only send repository parameters for new sessions (not resuming)
    if (!currentSessionId) {
      console.log('[Chat] New session - sending repository parameters');

      if (selectedRepo) {
        requestParams.github = {
          repoUrl: selectedRepo,
          branch: baseBranch || 'main',
        };
      }
    } else {
      console.log('[Chat] Resuming existing session:', currentSessionId);
      // When resuming, repository is already in the session workspace
    }

    // Debug: Log the exact parameters being sent
    console.log('[Chat] Final request parameters:', JSON.stringify(requestParams, null, 2));
    console.log('[Chat] Parameters being sent:', Object.keys(requestParams));

    // Always use POST to allow reading error body in response
    setStreamMethod('POST');
    setStreamBody(requestParams);
    setStreamUrl(`${API_BASE_URL}/api/execute`);

    setInput('');
    setImages([]);

    // Clear draft after successful submission
    if (sessionId && sessionId !== 'new') {
      clearDraft(sessionId);
    }
  };

  const handleRetry = () => {
    if (!lastRequest || isExecuting) return;

    // Add user message for retry
    messageIdCounter.current += 1;
    const userMessage: Message = {
      id: Date.now() + messageIdCounter.current,
      chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
      type: 'user',
      content: lastRequest.input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);

    // Build request body with saved request data
    const requestParams: any = {
      userRequest: lastRequest.input,
    };

    if (currentSessionId) {
      requestParams.websiteSessionId = currentSessionId;
      console.log('[Chat] Retrying with existing session:', currentSessionId);
    }

    // Only send repository parameters for new sessions (not resuming)
    if (!currentSessionId) {
      if (lastRequest.selectedRepo) {
        requestParams.repositoryUrl = lastRequest.selectedRepo;
      }

      if (lastRequest.baseBranch) {
        requestParams.baseBranch = lastRequest.baseBranch;
      }

      // Auto-commit is now always enabled
      requestParams.autoCommit = true;
    } else {
      // When resuming, repository is already in the session workspace
      console.log('[Chat] Retrying resumed session - repository already in workspace');
    }

    // Always use POST
    setStreamMethod('POST');
    setStreamBody(requestParams);
    setStreamUrl(`${API_BASE_URL}/api/execute`);
  };

  // Handle interrupting current job
  const handleInterrupt = async () => {
    if (!currentSessionId) return;

    try {
      // Send abort signal to server
      await fetch(`${API_BASE_URL}/api/sessions/${currentSessionId}/abort`, {
        method: 'POST',
        credentials: 'include',
      });

      // Cancel the ongoing stream
      disconnectStream();

      setIsExecuting(false);
      setStreamUrl(null);

      // Clear global worker state on interrupt
      workerStore.stopExecution();
      console.log('[Chat] Job interrupted, worker store cleared');

      // Add system message about interruption
      messageIdCounter.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: 'system',
          content: '⚠️ Job interrupted by user',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Failed to interrupt job:', error);
      alert('Failed to interrupt the current job. Please try again.');
    }
  };


  // Process the next message in the queue
  useEffect(() => {
    if (!isExecuting && messageQueue.length > 0) {
      const nextMessage = messageQueue[0];
      setMessageQueue((prev) => prev.slice(1));

      // Create a synthetic form event
      setTimeout(() => {
        // Build request parameters directly instead of relying on state
        const requestParams: any = {
          userRequest: nextMessage.input,
        };

        if (currentSessionId) {
          requestParams.websiteSessionId = currentSessionId;
        }

        // Add user message
        messageIdCounter.current += 1;
        const userMessage: Message = {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: 'user',
          content: nextMessage.input || (nextMessage.images.length > 0 ? `[${nextMessage.images.length} image${nextMessage.images.length > 1 ? 's' : ''} attached]` : ''),
          images: nextMessage.images.length > 0 ? nextMessage.images : undefined,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);

        // Handle images in request if present
        if (nextMessage.images.length > 0) {
          const contentBlocks: any[] = [];
          if (nextMessage.input) {
            contentBlocks.push({ type: 'text', text: nextMessage.input });
          }
          nextMessage.images.forEach((image) => {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType,
                data: image.data,
              },
            });
          });
          requestParams.userRequest = contentBlocks;
        }

        // Set executing state and start stream
        setIsExecuting(true);

        // Start worker tracking for queued message
        if (currentSessionId) {
          workerStore.startExecution(currentSessionId);
          console.log('[Chat] Started worker tracking for queued message, session:', currentSessionId);
        }

        setStreamMethod('POST');
        setStreamBody(requestParams);
        setStreamUrl(`${API_BASE_URL}/api/execute`);
      }, 500);
    }
  }, [isExecuting, messageQueue.length, currentSessionId, sessionId]);

  // Create title actions (Edit and Delete buttons) for the title line
  const titleActions = session && messages.length > 0 && (
    <>
      <button
        onClick={handleEditTitle}
        className="btn btn-ghost btn-xs btn-circle"
        title="Edit session title"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
      </button>
      <button
        onClick={handleDeleteSession}
        className="btn btn-ghost btn-xs btn-circle text-error"
        title="Delete session"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </>
  );

  // Create PR actions for the branch line
  const prActions = session && messages.length > 0 && session.branch && session.baseBranch && session.repositoryOwner && session.repositoryName && (
    <>
      {/* View PR button - show only if PR is open */}
      {existingPr && (
        <button
          onClick={handleViewPR}
          className="btn btn-xs btn-info"
          title={`View open PR #${existingPr.number}`}
        >
          View PR #{existingPr.number}
        </button>
      )}

      {/* PR Merged button - show when PR was already merged */}
      {!existingPr && mergedPr && (
        <button
          onClick={() => window.open(mergedPr.htmlUrl, '_blank')}
          className="btn btn-xs btn-success"
          title={`PR #${mergedPr.number} was merged`}
        >
          PR #{mergedPr.number} Merged
        </button>
      )}

      {/* Create PR button - show if no open PR exists and not merged */}
      {!existingPr && !mergedPr && (
        <button
          onClick={handleCreatePR}
          className="btn btn-xs btn-primary"
          disabled={prLoading !== null}
          title="Create a pull request"
        >
          {prLoading === 'create' ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            'Create PR'
          )}
        </button>
      )}

      {/* Auto PR button - show even if PR exists (backend reuses it), hide when PR already merged */}
      {!mergedPr && (
        <button
          onClick={handleAutoPR}
          className="btn btn-xs btn-accent"
          disabled={prLoading !== null}
          title="Create PR, merge base branch, and merge PR in one click"
        >
          {prLoading === 'auto' ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            'Auto PR'
          )}
        </button>
      )}
    </>
  );

  // The actual content to render
  const content = (
      <div className="flex flex-col flex-1 overflow-hidden">
      {/* Alerts/Warnings Area - only show for existing sessions with messages */}
      {messages.length > 0 && (
        <div className="bg-base-100 border-b border-base-300 p-4 flex-shrink-0">
          <div className="max-w-7xl mx-auto space-y-2">
            {/* Title editing mode */}
            {editingTitle && session && (
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="flex-1 input input-bordered input-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                />
                <button
                  onClick={handleSaveTitle}
                  className="btn btn-success btn-sm"
                  disabled={updateMutation.isPending}
                >
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Deleted session banner */}
            {session?.deletedAt && (
              <div className="alert alert-warning">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <div className="flex-1">
                  <span className="text-sm font-medium">This session is in the trash</span>
                  <span className="text-sm ml-2 opacity-70">
                    (Deleted {new Date(session.deletedAt).toLocaleDateString()})
                  </span>
                </div>
                <button
                  onClick={() => {
                    sessionsApi.restoreBulk([session.id]).then(() => {
                      queryClient.invalidateQueries({ queryKey: ['session-details', sessionId] });
                      queryClient.invalidateQueries({ queryKey: ['sessions'] });
                      queryClient.invalidateQueries({ queryKey: ['sessions', 'deleted'] });
                    });
                  }}
                  className="btn btn-success btn-sm"
                >
                  Restore
                </button>
              </div>
            )}

            {!user?.githubAccessToken && (
              <div className="alert alert-warning">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                <span className="text-sm">
                  Connect GitHub in settings to work with repositories
                </span>
              </div>
            )}

            {!user?.claudeAuth && (
              <div className="alert alert-error">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span className="text-sm">
                  Add Claude credentials in settings to use the AI assistant
                </span>
              </div>
            )}

            {/* PR Status Messages */}
            {autoPrProgress && (
              <div className="alert alert-info">
                <span className="loading loading-spinner loading-sm"></span>
                <span className="text-sm font-semibold">{autoPrProgress}</span>
              </div>
            )}

            {prSuccess && (
              <div className="alert alert-success">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm">{prSuccess}</span>
                <button onClick={() => setPrSuccess(null)} className="btn btn-ghost btn-xs">Dismiss</button>
              </div>
            )}

            {prError && (
              <div className="alert alert-error">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm">{prError}</span>
                <button onClick={() => setPrError(null)} className="btn btn-ghost btn-xs">Dismiss</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages or Centered Input */}
      {messages.length === 0 ? (
        /* Centered input for new session */
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          {/* Auth warnings for centered view */}
          {(!user?.githubAccessToken || !user?.claudeAuth) && (
            <div className="mb-6 space-y-2 max-w-2xl w-full">
              {!user?.githubAccessToken && (
                <div className="alert alert-warning">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  <span className="text-sm">
                    Connect GitHub in settings to work with repositories
                  </span>
                </div>
              )}

              {!user?.claudeAuth && (
                <div className="alert alert-error">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <span className="text-sm">
                    Add Claude credentials in settings to use the AI assistant
                  </span>
                </div>
              )}
            </div>
          )}

          <ChatInput
            key="centered-input"
            ref={chatInputRef}
            input={input}
            setInput={setInput}
            images={images}
            setImages={setImages}
            onSubmit={handleSubmit}
            isExecuting={isExecuting}
            selectedRepo={selectedRepo}
            setSelectedRepo={setSelectedRepo}
            baseBranch={baseBranch}
            setBaseBranch={setBaseBranch}
            repositories={repositories}
            isLoadingRepos={isLoadingRepos}
            isLocked={isLocked}
            user={user}
            centered={true}
            hideRepoSelection={true}
            onInterrupt={handleInterrupt}
          />
        </div>
      ) : (
        /* Messages area with bottom input panel */
        <>
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 relative">
            <div className="max-w-4xl mx-auto space-y-4">
              {messages
                .filter((message) => shouldShowMessage(message, user?.chatVerbosityLevel || 'verbose'))
                .map((message) => (
                message.type === 'system' ? (
                  // Compact inline status update - no panel, faint text, inline timestamp
                  <div key={message.id} className="text-xs text-base-content/40 py-0.5">
                    <span className="opacity-60">{new Date(message.timestamp).toLocaleTimeString()}</span>
                    <span className="mx-2">•</span>
                    <LinkifyText text={message.content} className="opacity-80" />
                  </div>
                ) : (
                  <ChatMessage
                    key={message.id}
                    message={{ ...message, images: message.images ?? undefined }}
                    userName={user?.displayName || user?.email}
                    onImageClick={setViewingImage}
                    onRetry={handleRetry}
                    showRetry={message.type === 'error' && !!lastRequest && !isExecuting}
                  />
                )
              ))}

              {isExecuting && (
                <div className="flex justify-start">
                  <div className="bg-base-100 border border-base-300 rounded-lg px-4 py-2">
                    <div className="flex items-center space-x-3">
                      <span className="loading loading-spinner loading-sm text-primary"></span>
                      <div className="flex flex-col">
                        <span className="text-sm text-base-content/70">Processing...</span>
                        {selectedRepo && session?.branch && (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-base-content/50">
                              📂 <span className="font-medium">{session.branch}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Queue status indicator */}
              {messageQueue.length > 0 && (
                <div className="flex justify-center my-4">
                  <div className="bg-info/10 border border-info/30 rounded-lg inline-flex flex-col items-stretch gap-3 py-4 px-5 max-w-3xl w-full mx-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-info/20">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-info shrink-0 w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                      <span className="text-sm font-semibold text-info">
                        {messageQueue.length} message{messageQueue.length > 1 ? 's' : ''} queued
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {messageQueue.map((queuedMsg, index) => (
                        <div key={index} className="flex items-center gap-3 bg-base-200/50 hover:bg-base-200 rounded-lg px-4 py-3 group transition-colors">
                          <span className="text-sm font-mono font-semibold text-info min-w-[2rem]">
                            {index + 1}.
                          </span>
                          <span className="text-sm flex-1 line-clamp-2 break-words" title={queuedMsg.input}>
                            {queuedMsg.input || `[${queuedMsg.images.length} image${queuedMsg.images.length > 1 ? 's' : ''}]`}
                          </span>
                          {queuedMsg.images.length > 0 && queuedMsg.input && (
                            <span className="text-sm font-medium opacity-70 shrink-0">
                              +{queuedMsg.images.length} 🖼️
                            </span>
                          )}
                          <button
                            onClick={() => {
                              setMessageQueue((prev) => prev.filter((_, i) => i !== index));
                            }}
                            className="btn btn-ghost btn-sm btn-circle shrink-0 hover:btn-error transition-all"
                            title="Remove from queue"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Floating scroll buttons */}
            {showScrollToTop && (
              <button
                onClick={handleScrollToTop}
                className="fixed bottom-24 right-8 btn btn-circle btn-primary shadow-lg z-10 hover:scale-110 transition-transform"
                title="Scroll to top"
                aria-label="Scroll to top"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 10l7-7m0 0l7 7m-7-7v18"
                  />
                </svg>
              </button>
            )}

            {showScrollToPresent && (
              <button
                onClick={handleScrollToPresent}
                className="fixed bottom-24 right-8 btn btn-circle btn-accent shadow-lg z-10 hover:scale-110 transition-transform"
                title="Scroll to present"
                aria-label="Scroll to present (latest messages)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Input panel at bottom when messages exist */}
          <div className="bg-base-100 border-t border-base-300 p-6 flex-shrink-0">
            {session?.deletedAt ? (
              <div className="text-center text-base-content/50 py-2">
                <span className="text-sm">This session is in the trash. Restore it to continue chatting.</span>
              </div>
            ) : (
              <ChatInput
                key="bottom-input"
                ref={chatInputRef}
                input={input}
                setInput={setInput}
                images={images}
                setImages={setImages}
                onSubmit={handleSubmit}
                isExecuting={isExecuting}
                selectedRepo={selectedRepo}
                setSelectedRepo={setSelectedRepo}
                baseBranch={baseBranch}
                setBaseBranch={setBaseBranch}
                repositories={repositories}
                isLoadingRepos={isLoadingRepos}
                isLocked={isLocked}
                user={user}
                centered={false}
                hideRepoSelection={true}
                onInterrupt={handleInterrupt}
              />
            )}
          </div>
        </>
      )}

      {/* Image Viewer Modal */}
      {viewingImage && (
        <ImageViewer
          imageData={viewingImage.data}
          mediaType={viewingImage.mediaType}
          fileName={viewingImage.fileName}
          onClose={() => setViewingImage(null)}
        />
      )}
      </div>
  );

  // When embedded in split view, render without SessionLayout wrapper
  if (isEmbedded) {
    return content;
  }

  // Normal rendering with SessionLayout
  return (
    <SessionLayout
      selectedRepo={selectedRepo}
      baseBranch={baseBranch}
      branch={session?.branch ?? undefined}
      onRepoChange={setSelectedRepo}
      onBaseBranchChange={setBaseBranch}
      repositories={repositories}
      isLoadingRepos={isLoadingRepos}
      isLocked={isLocked}
      titleActions={titleActions}
      prActions={prActions}
      session={session}
    >
      {content}
    </SessionLayout>
  );
}
