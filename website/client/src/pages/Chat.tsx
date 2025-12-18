import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi, githubApi, getApiBaseUrl } from '@/lib/api';
import type { GitHubPullRequest } from '@/shared';
import { useEventSource } from '@/hooks/useEventSource';
import { useBrowserNotification, playNotificationSound, getNotificationPrefs } from '@/hooks/useBrowserNotification';
import { useAuthStore, useRepoStore, useWorkerStore } from '@/lib/store';
import ChatInput, { type ChatInputRef, type ImageAttachment } from '@/components/ChatInput';
import { ImageViewer } from '@/components/ImageViewer';
import SessionLayout from '@/components/SessionLayout';
import { FormattedEventList, type RawEvent } from '@/components/FormattedEvent';
import type { Message, GitHubRepository, ChatSession, ChatVerbosityLevel } from '@/shared';


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

// Helper to convert raw SSE events from database to displayable messages
// SIMPLIFIED: Just display raw JSON for all events - no custom formatting
function convertEventToMessage(event: DbEvent, sessionId: string, _verbosityLevel?: ChatVerbosityLevel): Message | null {
  const eventType = event.eventType;
  const data = event.eventData;

  // Skip if data is undefined or null
  if (!data) {
    return null;
  }

  // Skip control events that don't need to be displayed in formatted view
  if (eventType === 'connected' || eventType === 'completed' || eventType === 'heartbeat') {
    return null;
  }

  // Skip events that are handled by FormattedEvent in the raw view
  // These don't need to clutter the formatted chat view
  if (eventType === 'env_manager_log' || eventType === 'system' || eventType === 'title_generation') {
    return null;
  }

  // Format content based on event type for cleaner display
  let content: string;
  switch (eventType) {
    case 'message':
      content = data.message || JSON.stringify(data);
      break;
    case 'session_name':
      content = `Session: ${data.sessionName}`;
      break;
    case 'session_created':
      content = data.remoteWebUrl ? `Session created: ${data.remoteWebUrl}` : 'Session created';
      break;
    case 'user':
      // Skip user events - they're handled as user messages
      return null;
    case 'assistant':
      // Skip assistant events - they're handled as assistant messages
      return null;
    case 'result':
      content = data.result || 'Task completed';
      break;
    case 'error':
      content = `Error: ${data.message || data.error || JSON.stringify(data)}`;
      break;
    default:
      // For unknown types, show a brief summary
      content = `[${eventType}] ${typeof data === 'string' ? data : ''}`;
  }

  return {
    id: event.id,
    chatSessionId: sessionId,
    type: 'system',
    content,
    timestamp: new Date(event.timestamp),
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
  const isInitialSessionLoadRef = useRef(false); // Track initial session load to skip scroll preservation
  const wasStreamingRef = useRef(false); // Track if we were streaming, to preserve scroll when stream ends
  const shouldAutoScrollDuringStreamRef = useRef(true); // Track if we should auto-scroll during active streaming
  const pendingUserMessagesRef = useRef<Message[]>([]); // Track user messages added locally but not yet in DB
  const [_lastRequest, setLastRequest] = useState<{
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
  // Raw JSON view toggle - persisted to localStorage
  const [showRawJson, setShowRawJson] = useState<boolean>(() => {
    try {
      return localStorage.getItem('chatShowRawJson') === 'true';
    } catch {
      return false;
    }
  });
  // Store raw events for the raw JSON view (separate from formatted messages)
  const [rawEvents, setRawEvents] = useState<RawEvent[]>([]);

  // Event type filter - which event types to show in formatted view
  const [eventFilters, setEventFilters] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('chatEventFilters');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    // Default: show all
    return {
      user: true,
      assistant: true,
      result: true,
      thinking: true,
      message: true,
      system: true,
      connected: true,
      env_manager_log: true,
      tool_use: true,
      tool_result: true,
      tool_progress: true,
      completed: true,
      error: true,
      title_generation: true,
      session_name: true,
      session_created: true,
    };
  });
  const [prSuccess, setPrSuccess] = useState<string | null>(null);
  const [autoPrProgress, setAutoPrProgress] = useState<string | null>(null);
  const [copyChatSuccess, setCopyChatSuccess] = useState(false);

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

  // Browser notification and sound for session completion
  const { showSessionCompletedNotification } = useBrowserNotification();

  // Persist showRawJson to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('chatShowRawJson', showRawJson ? 'true' : 'false');
    } catch {
      // Ignore localStorage errors
    }
  }, [showRawJson]);

  // Persist eventFilters to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('chatEventFilters', JSON.stringify(eventFilters));
    } catch {
      // Ignore localStorage errors
    }
  }, [eventFilters]);

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
    // DEBUG: Disable polling entirely
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // Load user messages from messages table (user-submitted messages)
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['session-messages', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.getMessages(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new',
    // DEBUG: Disable polling entirely
    refetchInterval: false,
    refetchOnWindowFocus: false,
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
    // DEBUG: Disable polling entirely to prevent state interference
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // Log events query state changes
  useEffect(() => {
    console.log(`[Chat] Events query state: sessionId=${sessionId}, loading=${eventsLoading}, error=${eventsError}, eventsCount=${eventsData?.data?.events?.length || 0}`);
  }, [sessionId, eventsLoading, eventsError, eventsErrorObj, eventsData]);

  const session: ChatSession | undefined = sessionDetailsData?.data;

  // DEBUG: Disabled entire session status sync to prevent automatic state changes
  // This was causing reconnection loops and state interference during debugging
  useEffect(() => {
    console.log('[Chat] DEBUG: Session status sync useEffect - DISABLED. Status:', session?.status);
    // if (session?.status === 'running' || session?.status === 'pending') {
    //   // Set isExecuting=true for running/pending sessions to show Processing panel
    //   // This handles the case when users navigate back to an in-progress session
    //   if (!isExecuting) {
    //     console.log('[Chat] Syncing isExecuting with session status:', session.status);
    //     setIsExecuting(true);
    //     // Also sync the global worker store to keep stop/interrupt button working
    //     if (currentSessionId) {
    //       workerStore.startExecution(currentSessionId);
    //       console.log('[Chat] Synced worker store for running session:', currentSessionId);
    //     }
    //   }

    //   // If we don't have an active stream, try to connect to the live stream
    //   // This allows users to see live events when they return to a running session
    //   if (!streamUrl && currentSessionId && !isReconnecting) {
    //     console.log('[Chat] Attempting to connect to live stream for running session:', currentSessionId);
    //     setIsReconnecting(true); // Mark as reconnection attempt
    //     const reconnectStreamUrl = sessionsApi.getStreamUrl(currentSessionId);
    //     setStreamMethod('GET'); // Stream endpoint uses GET
    //     setStreamBody(null);
    //     setStreamUrl(reconnectStreamUrl);
    //   }
    // } else if (session?.status === 'completed' || session?.status === 'error') {
    //   // DEBUG: Disabled all state changes on session completion
    //   console.log('[Chat] DEBUG: Session status changed to', session?.status, '- NOT clearing state');
    //   // if (isExecuting) {
    //   //   console.log('[Chat] Session completed, setting isExecuting to false');
    //   //   setIsExecuting(false);
    //   //   setStreamUrl(null); // Also clear streamUrl to ensure consistent state
    //   //   setIsReconnecting(false); // Clear reconnection flag
    //   //   // Also clear the global worker store
    //   //   workerStore.stopExecution();
    //   //   console.log('[Chat] Cleared worker store for completed/errored session');
    //   //   // Refetch events to ensure we have all stored events from the database
    //   //   refetchEvents();
    //   //   console.log('[Chat] Triggered events refetch after session completion');
    //   // }
    // }
  }, [session?.status, isExecuting, currentSessionId, streamUrl, isReconnecting, refetchEvents]);

  // Load current session details to check if locked
  const { data: currentSessionData } = useQuery({
    queryKey: ['currentSession', currentSessionId],
    queryFn: async () => {
      if (!currentSessionId) return null;
      const response = await fetch(`${getApiBaseUrl()}/api/sessions/${currentSessionId}`, {
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

  // Copy entire chat to clipboard
  const handleCopyChat = async () => {
    try {
      const visibleMessages = messages.filter((message) =>
        shouldShowMessage(message, user?.chatVerbosityLevel || 'verbose')
      );

      const formattedChat = visibleMessages
        .map((message) => {
          const timestamp = new Date(message.timestamp).toLocaleString();
          const sender =
            message.type === 'user'
              ? user?.displayName || user?.email || 'User'
              : message.type === 'assistant'
              ? message.model ? `Claude (${message.model})` : 'Claude'
              : message.type === 'error'
              ? 'Error'
              : 'System';
          return `[${timestamp}] ${sender}:\n${message.content}`;
        })
        .join('\n\n---\n\n');

      await navigator.clipboard.writeText(formattedChat);
      setCopyChatSuccess(true);
      setTimeout(() => setCopyChatSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy chat:', err);
    }
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

      // Invalidate sessions cache since the session was soft-deleted
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'deleted'] });

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

    // Populate rawEvents from database events for the raw JSON view
    // This ensures raw events are available when returning to a session
    if (dbEvents.length > 0) {
      setRawEvents(dbEvents.map(event => ({
        eventType: event.eventType,
        data: event.eventData,
        timestamp: new Date(event.timestamp)
      })));
    }

    // Debug logging - use primitive values for production visibility
    console.log(`[Chat] Merging messages: sessionId=${sessionId}, rawMessagesCount=${messagesData?.data?.messages?.length || 0}, filteredDbMessagesCount=${dbMessages.length}, rawEventsCount=${dbEvents.length}`);

    const eventMessages = dbEvents
      .map((event) => convertEventToMessage(event, sessionId, user?.chatVerbosityLevel))
      .filter((msg): msg is Message => msg !== null);

    console.log(`[Chat] Converted events to messages: eventMessagesCount=${eventMessages.length}`);

    // Filter out pending user messages that now appear in DB
    // A pending message is considered "synced" if there's a DB message with matching content
    // within a reasonable time window (5 seconds)
    const pendingMessages = pendingUserMessagesRef.current.filter((pending) => {
      const matchingDbMessage = dbMessages.find((db) => {
        if (db.type !== 'user') return false;
        const contentMatch = db.content === pending.content;
        const timeDiff = Math.abs(new Date(db.timestamp).getTime() - new Date(pending.timestamp).getTime());
        const timeMatch = timeDiff < 5000; // Within 5 seconds
        return contentMatch && timeMatch;
      });
      return !matchingDbMessage; // Keep if NOT found in DB
    });
    pendingUserMessagesRef.current = pendingMessages;

    console.log(`[Chat] Pending user messages: ${pendingMessages.length}`);

    // Merge DB messages, event messages, and any remaining pending user messages
    const allMessages = [...dbMessages, ...eventMessages, ...pendingMessages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    console.log(`[Chat] Final merged messages: totalCount=${allMessages.length}, dbMessagesCount=${dbMessages.length}, eventMessagesCount=${eventMessages.length}, pendingCount=${pendingMessages.length}`);

    // Preserve scroll position when updating messages from database
    // This prevents the chat from jumping to top when queries are refetched after completion
    // BUT skip this during initial session load - we want to scroll to bottom in that case
    const container = messagesContainerRef.current;
    const savedScrollTop = container?.scrollTop ?? 0;
    const savedScrollHeight = container?.scrollHeight ?? 0;
    const clientHeight = container?.clientHeight ?? 0;

    // Calculate if user was near bottom before the update
    // This is more reliable than using isNearBottomRef which may be stale
    const wasNearBottom = savedScrollHeight - savedScrollTop - clientHeight < 150;

    // Check if we just finished streaming - in that case, we should stay at the bottom
    // regardless of the scroll position calculation (which might be incorrect during transition)
    // NOTE: We capture the value but DON'T clear the ref yet - we clear it inside the RAF
    // to ensure that if the merge effect runs multiple times before RAF executes,
    // each run will still see wasStreamingRef.current = true and scroll to bottom
    const wasStreaming = wasStreamingRef.current;
    if (wasStreaming) {
      console.log('[Chat] Stream ended, will scroll to bottom');
    }

    // Preserve scroll if not initial load AND either:
    // 1. User was not near bottom (preserve their scroll position), OR
    // 2. User was near bottom (we'll scroll to bottom after the update)
    const shouldPreserveScroll = !isInitialSessionLoadRef.current && savedScrollTop > 0;

    setMessages(allMessages);

    // Restore scroll position after React re-renders
    if (container && !isInitialSessionLoadRef.current) {
      requestAnimationFrame(() => {
        if (wasStreaming || wasNearBottom) {
          // User was streaming or near bottom, scroll to the new bottom
          // Use 'instant' to avoid visual lag when stream ends
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
          // Update isNearBottomRef since we're now at bottom
          isNearBottomRef.current = true;
          // NOW clear the streaming flag, after the scroll has been applied
          // This ensures that if the merge effect runs again before this RAF,
          // it will still scroll to bottom
          if (wasStreaming) {
            wasStreamingRef.current = false;
          }
        } else if (shouldPreserveScroll) {
          // User was scrolled up, preserve their position
          container.scrollTop = savedScrollTop;
        }
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
      const wasNearBottom = isNearBottomRef.current;
      isNearBottomRef.current = distanceFromBottom < 150;

      // If user manually scrolls away from bottom during streaming, disable auto-scroll
      // This allows users to read previous messages without being pulled to bottom
      if (isExecuting && wasNearBottom && !isNearBottomRef.current) {
        shouldAutoScrollDuringStreamRef.current = false;
        console.log('[Chat] User scrolled away during streaming, disabling auto-scroll');
      }
      // If user scrolls back to bottom during streaming, re-enable auto-scroll
      else if (isExecuting && !wasNearBottom && isNearBottomRef.current) {
        shouldAutoScrollDuringStreamRef.current = true;
        console.log('[Chat] User scrolled back to bottom during streaming, enabling auto-scroll');
      }

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
  }, [messages.length, isExecuting]); // Re-attach when messages change or execution state changes

  // Smart auto-scroll: only scroll to bottom when messages change AND user is near bottom
  // Note: During streaming, new messages are added via setMessages in the SSE handler,
  // which triggers this effect. After stream completion, messages are updated via the
  // merge effect which handles its own scrolling - we use isNearBottomRef to coordinate.
  useEffect(() => {
    // During active streaming, use the captured scroll position from when streaming started
    // This prevents "falling behind" during rapid message updates
    if (isExecuting && shouldAutoScrollDuringStreamRef.current && !isInitialSessionLoadRef.current) {
      // Use instant scroll during streaming for better performance with rapid updates
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      return;
    }

    // For non-streaming updates, only auto-scroll if user is near the bottom
    // Using 'smooth' behavior gives a nice UX for normal interactions
    if (isNearBottomRef.current && !isInitialSessionLoadRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isExecuting]);

  // Scroll to bottom when entering a session (e.g., from My Sessions page)
  // This ensures users see the latest messages when opening an existing session
  useEffect(() => {
    // Only trigger when sessionId changes to a valid session (not 'new')
    if (sessionId && sessionId !== 'new' && sessionId !== previousSessionIdRef.current) {
      previousSessionIdRef.current = sessionId;
      // Mark that we're doing initial session load - this prevents scroll position preservation
      // from fighting with our scroll-to-bottom behavior
      isInitialSessionLoadRef.current = true;
      // NOTE: We intentionally do NOT clear wasStreamingRef here!
      // When navigating from /session/new to /session/{id} after stream completes,
      // wasStreamingRef should remain true so the merge effect scrolls to bottom.
      // The flag will be cleared after the merge effect's scroll happens.
    } else if (!sessionId || sessionId === 'new') {
      // Reset when navigating to new session page
      previousSessionIdRef.current = undefined;
      isInitialSessionLoadRef.current = false;
      // Only clear streaming flag when starting a completely new session
      wasStreamingRef.current = false;
    }
  }, [sessionId]);

  // Scroll to bottom after messages load during initial session entry
  // This is separate from the sessionId change detection to ensure messages are actually loaded
  // We wait for both messagesLoading and eventsLoading to be false to ensure all data has been fetched
  useEffect(() => {
    if (isInitialSessionLoadRef.current && messages.length > 0 && !eventsLoading && !messagesLoading) {
      // Messages have loaded and both queries are complete, scroll to bottom
      const scrollToBottom = () => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
          // Reset isNearBottomRef since we're now at the bottom
          isNearBottomRef.current = true;
        }
        // Clear the flag after scrolling - subsequent message updates won't trigger this
        isInitialSessionLoadRef.current = false;
      };

      // Use double requestAnimationFrame to ensure DOM has fully rendered all messages
      // First rAF waits for React to commit, second ensures layout is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      });
    }
  }, [messages.length, eventsLoading, messagesLoading]);

  // Reset state when navigating to new chat (sessionId becomes undefined)
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setRawEvents([]); // Clear raw events for new session
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
      pendingUserMessagesRef.current = []; // Clear pending messages for new session
      wasStreamingRef.current = false; // Clear streaming flag for new session
      shouldAutoScrollDuringStreamRef.current = true; // Reset auto-scroll flag for new session

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

      // Add user's preferred provider
      const provider = user?.preferredProvider || 'claude';
      if (provider) {
        params.provider = provider;
      }

      // Always use POST
      setStreamMethod('POST');
      setStreamBody(params);

      // Use execute-remote endpoint for claude-remote provider
      const executeUrl = provider === 'claude-remote'
        ? `${getApiBaseUrl()}/api/execute-remote`
        : `${getApiBaseUrl()}/api/execute`;
      setStreamUrl(executeUrl);

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
        // Refetch events from database to ensure we have all events
        // This is critical because:
        // 1. Events polling is disabled while isExecuting=true
        // 2. Replayed events are skipped to avoid duplicates
        // 3. But new events might have been generated between initial fetch and replay
        // By refetching here, we get a complete snapshot of all events
        refetchEvents();
        return;
      }

      // Skip replayed events that we already have (de-duplicate)
      // Replayed events were already fetched from the database and converted to messages
      // in the merge effect, so we don't need to process them again
      if (data?._replayed) {
        workerStore.recordHeartbeat();
        return; // Skip replayed events - they're already displayed from the database query
      }

      // Skip if data is undefined or null
      if (!data) {
        console.log('Skipping event with no data:', event);
        return;
      }

      // Capture title and branch from title_generation events for UI display
      // Note: Backend now saves the title to DB immediately when generated
      if (data.type === 'title_generation' && data.status === 'success' && currentSessionId) {
        // Capture generated title for UI (but don't overwrite user-edited title)
        if (data.title && !hasUserEditedTitleRef.current) {
          console.log('[Chat] Captured title from title_generation:', data.title);
          autoGeneratedTitleRef.current = data.title;
          // Title is saved by backend - no need to call API
        }
        // Branch name captured for UI display only
        // Backend saves the actual branch with ID suffix
        if (data.branch_name) {
          console.log('[Chat] Captured branch from title_generation:', data.branch_name);
          // Branch is saved by backend - no need to call API
        }
      }

      // Capture title from session_name events for UI display
      // Note: Backend now saves the title to DB immediately when generated, so we only update the local ref here
      if (data.type === 'session_name' && data.sessionName && currentSessionId && !hasUserEditedTitleRef.current) {
        console.log('[Chat] Captured title from session_name:', data.sessionName);
        autoGeneratedTitleRef.current = data.sessionName;
        // Title is saved by backend in progress callback - no need to call API
      }

      // Extract actual branch name with ID from session events
      // The actual branch (with ID suffix like 'claude/fix-bug-XYZ123') appears in:
      // 1. env_manager_log args containing '--append-system-prompt' with branch name
      // 2. Git output showing commit/push to the branch
      // Note: Events can come in two formats:
      //   - Flat format (new): { type: 'env_manager_log', data: {...} }
      //   - Wrapped format (old): { type: 'raw_event', rawEvent: { type: 'env_manager_log', data: {...} } }
      if (currentSessionId) {
        // Handle both flat and wrapped event formats
        const eventType = data.type === 'raw_event' ? data.rawEvent?.type : data.type;
        const eventData = data.type === 'raw_event' ? data.rawEvent?.data : data.data;
        const toolUseResult = data.type === 'raw_event' ? data.rawEvent?.tool_use_result : data.tool_use_result;

        // Check for branch in env_manager_log args (earliest source)
        if (eventType === 'env_manager_log' && eventData?.extra?.args) {
          const args = eventData.extra.args;
          const appendPromptIndex = args.findIndex((arg: string) => arg === '--append-system-prompt');
          if (appendPromptIndex !== -1 && args[appendPromptIndex + 1]) {
            const promptText = args[appendPromptIndex + 1];
            // Extract branch from "Develop on branch `claude/xxx-XXXXX`" pattern
            const branchMatch = promptText.match(/Develop on branch `([^`]+)`/);
            if (branchMatch) {
              const actualBranch = branchMatch[1];
              console.log('[Chat] Extracted actual branch from env_manager_log:', actualBranch);
              updateMutation.mutate({ id: currentSessionId, branch: actualBranch });
            }
          }
        }

        // Check for branch in git commit/push output (backup source)
        if (toolUseResult?.stdout) {
          const stdout = toolUseResult.stdout;
          // Match git commit output: "[branch-name hash]"
          const commitMatch = stdout.match(/^\[([^\s\]]+)\s+[a-f0-9]+\]/m);
          if (commitMatch && commitMatch[1].startsWith('claude/')) {
            const actualBranch = commitMatch[1];
            console.log('[Chat] Extracted actual branch from git commit:', actualBranch);
            updateMutation.mutate({ id: currentSessionId, branch: actualBranch });
          }
          // Match git push output: "branch 'xxx' set up to track" or "* [new branch] xxx -> xxx"
          const pushMatch = stdout.match(/branch '([^']+)' set up to track/);
          if (pushMatch && pushMatch[1].startsWith('claude/')) {
            const actualBranch = pushMatch[1];
            console.log('[Chat] Extracted actual branch from git push:', actualBranch);
            updateMutation.mutate({ id: currentSessionId, branch: actualBranch });
          }
        }
      }

      // Store raw event for the raw JSON view
      setRawEvents((prev) => [
        ...prev,
        { eventType, data, timestamp: new Date() },
      ]);

      // Also add as a formatted message for the normal view
      const rawJsonContent = `**[${eventType}]**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
      messageIdCounter.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: 'system',
          content: rawJsonContent,
          timestamp: new Date(),
        },
      ]);
      workerStore.recordHeartbeat();
    },
    onConnected: () => {
      setIsExecuting(true);
      // Mark stream as active in global store
      workerStore.setActiveStream(true);
      // Track that we're now streaming - used to preserve scroll when stream ends
      wasStreamingRef.current = true;
      // Capture if user is near bottom when streaming starts - if they are, we'll auto-scroll during streaming
      shouldAutoScrollDuringStreamRef.current = isNearBottomRef.current;
      console.log('[Chat] SSE stream connected, shouldAutoScrollDuringStream:', shouldAutoScrollDuringStreamRef.current);
      // Clear reconnection flag on successful connection
      if (isReconnecting) {
        console.log('[Chat] Reconnection successful, now receiving live events');
        setIsReconnecting(false);
      }
      console.log('[Chat] SSE stream connected, worker store updated');
    },
    onCompleted: (data) => {
      console.log('[Chat] onCompleted called. Data:', JSON.stringify(data, null, 2));

      // Play notification sound (respects user preferences)
      playNotificationSound();

      // Show browser notification (respects user preferences)
      const prefs = getNotificationPrefs();
      if (prefs.enabled && prefs.onSessionComplete) {
        // Extract repo name from URL (e.g., "https://github.com/owner/repo" -> "repo")
        const repoName = selectedRepo ? selectedRepo.split('/').pop() : undefined;
        showSessionCompletedNotification(data?.websiteSessionId, repoName);
      }

      // Re-enable state changes for proper completion detection
      setIsExecuting(false);
      setStreamUrl(null);
      setIsReconnecting(false);
      workerStore.stopExecution();
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
        // Invalidate sessions list to update sidebar
        queryClient.invalidateQueries({ queryKey: ['sessions'] });

        // Capture branch from completed event and update session
        // This ensures PR buttons appear even if title_generation was missed
        if (data.branch) {
          console.log('[Chat] Captured branch from completed event:', data.branch);
          updateMutation.mutate({ id: data.websiteSessionId, branch: data.branch });
        }

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
      console.log('[Chat] onError called. Error:', error.message);
      setIsExecuting(false);
      setStreamUrl(null);
      workerStore.stopExecution();
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

    // When user submits a message, they're at the bottom of the chat - enable auto-scroll
    shouldAutoScrollDuringStreamRef.current = true;

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

    // Track this as a pending message so it won't be lost when the merge effect runs
    // before the DB has been updated with this message
    pendingUserMessagesRef.current = [...pendingUserMessagesRef.current, userMessage];

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

    // Add user's preferred provider
    const provider = user?.preferredProvider || 'claude';
    if (provider) {
      requestParams.provider = provider;
    }

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
    console.log('[Chat] Using provider:', provider);

    // Always use POST to allow reading error body in response
    setStreamMethod('POST');
    setStreamBody(requestParams);

    // Use execute-remote endpoint for claude-remote provider
    const executeUrl = provider === 'claude-remote'
      ? `${getApiBaseUrl()}/api/execute-remote`
      : `${getApiBaseUrl()}/api/execute`;
    setStreamUrl(executeUrl);

    setInput('');
    setImages([]);

    // Clear draft after successful submission
    if (sessionId && sessionId !== 'new') {
      clearDraft(sessionId);
    }
  };

  // Handle interrupting current job
  const handleInterrupt = async () => {
    if (!currentSessionId) return;

    try {
      // Send abort signal to server
      await fetch(`${getApiBaseUrl()}/api/sessions/${currentSessionId}/abort`, {
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

        // Add user's preferred provider
        const provider = user?.preferredProvider || 'claude';
        if (provider) {
          requestParams.provider = provider;
        }

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

        // Track this as a pending message so it won't be lost when the merge effect runs
        pendingUserMessagesRef.current = [...pendingUserMessagesRef.current, userMessage];

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

        // Enable auto-scroll for queued messages
        shouldAutoScrollDuringStreamRef.current = true;

        // Start worker tracking for queued message
        if (currentSessionId) {
          workerStore.startExecution(currentSessionId);
          console.log('[Chat] Started worker tracking for queued message, session:', currentSessionId);
        }

        setStreamMethod('POST');
        setStreamBody(requestParams);

        // Use execute-remote endpoint for claude-remote provider
        const executeUrl = provider === 'claude-remote'
          ? `${getApiBaseUrl()}/api/execute-remote`
          : `${getApiBaseUrl()}/api/execute`;
        setStreamUrl(executeUrl);
      }, 500);
    }
  }, [isExecuting, messageQueue.length, currentSessionId, sessionId]);

  // Create title actions (Copy Chat, Edit, and Delete buttons) for the title line
  const titleActions = session && messages.length > 0 && (
    <>
      <button
        onClick={handleCopyChat}
        className={`btn btn-ghost btn-xs btn-circle ${copyChatSuccess ? 'text-success' : ''}`}
        title={copyChatSuccess ? 'Copied!' : 'Copy entire chat'}
      >
        {copyChatSuccess ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
          </svg>
        )}
      </button>
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

      {/* Create PR button - show if no open PR exists, not merged, not executing, and auto PR is not in progress */}
      {!existingPr && !mergedPr && !isExecuting && prLoading !== 'auto' && (
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

      {/* Auto PR button - show even if PR exists (backend reuses it), hide when PR already merged, executing, or auto PR in progress */}
      {!mergedPr && !isExecuting && prLoading !== 'auto' && (
        <button
          onClick={handleAutoPR}
          className="btn btn-xs btn-accent"
          disabled={prLoading !== null}
          title="Create PR, merge base branch, and merge PR in one click"
        >
          Auto PR
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
          {/* Toolbar: Filter dropdown and Raw JSON toggle */}
          <div className="flex justify-end items-center gap-2 px-4 py-2 border-b border-base-300 bg-base-200/50">
            {/* Event filter dropdown - only show in formatted view */}
            {!showRawJson && (
              <div className="dropdown dropdown-end">
                <label tabIndex={0} className="btn btn-xs btn-ghost gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Filter
                </label>
                <ul tabIndex={0} className="dropdown-content z-[100] p-2 shadow-lg bg-base-200 rounded-box w-44">
                  {/* All / None inline buttons */}
                  <li className="flex gap-1 mb-1 pb-1 border-b border-base-300">
                    <button
                      className="btn btn-xs btn-ghost flex-1"
                      onClick={() => setEventFilters(prev => {
                        const newFilters = { ...prev };
                        Object.keys(newFilters).forEach(k => newFilters[k] = true);
                        return newFilters;
                      })}
                    >
                      All
                    </button>
                    <span className="text-base-content/30 self-center">/</span>
                    <button
                      className="btn btn-xs btn-ghost flex-1"
                      onClick={() => setEventFilters(prev => {
                        const newFilters = { ...prev };
                        Object.keys(newFilters).forEach(k => newFilters[k] = false);
                        // Always keep core message types visible
                        newFilters.user = true;
                        newFilters.assistant = true;
                        newFilters.result = true;
                        newFilters.error = true;
                        return newFilters;
                      })}
                    >
                      None
                    </button>
                  </li>
                  {/* Event type checkboxes - exclude always-visible types */}
                  {[
                    { key: 'thinking', emoji: '🧠', label: 'Thinking' },
                    { key: 'message', emoji: '💬', label: 'Status' },
                    { key: 'system', emoji: '⚙️', label: 'System' },
                    { key: 'connected', emoji: '🔌', label: 'Connection' },
                    { key: 'env_manager_log', emoji: '🔧', label: 'Env Logs' },
                    { key: 'tool_use', emoji: '🔨', label: 'Tools' },
                    { key: 'completed', emoji: '🏁', label: 'Completed' },
                    { key: 'title_generation', emoji: '✨', label: 'Title' },
                    { key: 'session_name', emoji: '📝', label: 'Session' },
                  ].map(({ key, emoji, label }) => (
                    <li key={key}>
                      <label className="flex items-center gap-2 cursor-pointer px-1 py-0.5">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={eventFilters[key] ?? true}
                          onChange={(e) => setEventFilters(prev => ({ ...prev, [key]: e.target.checked }))}
                        />
                        <span>{emoji}</span>
                        <span className="text-xs">{label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Raw JSON toggle */}
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              className={`btn btn-xs ${showRawJson ? 'btn-primary' : 'btn-ghost'}`}
              title={showRawJson ? 'Switch to formatted view' : 'Switch to raw JSON view'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Raw JSON
            </button>
          </div>

          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 relative">
            {showRawJson ? (
              /* Raw JSON stream view - clean JSON objects only */
              <div className="max-w-4xl mx-auto font-mono text-xs">
                {rawEvents.length === 0 ? (
                  <div className="text-center text-base-content/50 py-8 font-sans">
                    No events yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rawEvents.map((event, index) => (
                      <pre key={index} className="bg-base-300 p-3 rounded-lg overflow-auto whitespace-pre-wrap break-words">
                        {JSON.stringify({ eventType: event.eventType, data: event.data }, null, 2)}
                      </pre>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Normal formatted view - uses FormattedEvent for rawEvents */
              <div className="max-w-4xl mx-auto space-y-1">
                {rawEvents.length === 0 ? (
                  <div className="text-center text-base-content/50 py-8">
                    No events yet.
                  </div>
                ) : (
                  <FormattedEventList events={rawEvents} filters={eventFilters} />
                )}

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
            )}

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
