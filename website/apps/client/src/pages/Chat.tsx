import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi, githubApi, API_BASE_URL } from '@/lib/api';
import type { GitHubPullRequest } from '@webedt/shared';
import { useEventSource } from '@/hooks/useEventSource';
import { useAuthStore, useRepoStore } from '@/lib/store';
import ChatInput, { type ChatInputRef, type ImageAttachment } from '@/components/ChatInput';
import { ImageViewer } from '@/components/ImageViewer';
import { ChatMessage } from '@/components/ChatMessage';
import SessionLayout from '@/components/SessionLayout';
import type { Message, GitHubRepository, ChatSession } from '@webedt/shared';

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

// Helper to convert raw SSE events from database to displayable messages
function convertEventToMessage(event: DbEvent, sessionId: string): Message | null {
  const eventType = event.eventType;
  const data = event.eventData;

  let content: string | null = null;
  let messageType: 'assistant' | 'system' = 'assistant';
  let eventLabel = '';

  // Skip if data is undefined or null
  if (!data) {
    return null;
  }

  // Handle git commit and pull progress events
  // These events may have nested data structure: { data: { message: "..." }, type: "...", timestamp: "..." }
  if (eventType === 'commit_progress') {
    const message = data.data?.message || data.message;
    content = typeof data === 'string' ? data : (message || JSON.stringify(data));
    eventLabel = '📤';
    messageType = 'system';
  } else if (eventType === 'github_pull_progress') {
    const message = data.data?.message || data.message;
    content = typeof data === 'string' ? data : (message || JSON.stringify(data));
    eventLabel = '⬇️';
    messageType = 'system';
  }
  // Extract content from different event types
  else if (data.type === 'message' && data.message) {
    content = data.message;
    eventLabel = '💬';
    messageType = 'system';
  } else if (data.type === 'session_name' && data.sessionName) {
    content = `Session: ${data.sessionName}`;
    eventLabel = '📝';
    messageType = 'system';
  } else if (data.type === 'assistant_message' && data.data) {
    const msgData = data.data;

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
              const filePath = toolInput.file_path || 'unknown file';
              const fileName = filePath.split('/').pop() || filePath;
              toolMessages.push(`📖 Reading: ${fileName}`);
            } else if (toolName === 'Write') {
              const filePath = toolInput.file_path || 'unknown file';
              const fileName = filePath.split('/').pop() || filePath;
              toolMessages.push(`📝 Writing: ${fileName}`);
            } else if (toolName === 'Edit') {
              const filePath = toolInput.file_path || 'unknown file';
              const fileName = filePath.split('/').pop() || filePath;
              toolMessages.push(`✏️ Editing: ${fileName}`);
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
            return {
              id: event.id,
              chatSessionId: sessionId,
              type: messageType,
              content: content,
              timestamp: new Date(event.timestamp),
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
    return null;
  }

  // Add event label if present (inline emoji before message)
  const finalContent = eventLabel ? `${eventLabel} ${content}` : content;

  return {
    id: event.id,
    chatSessionId: sessionId,
    type: messageType,
    content: finalContent,
    timestamp: new Date(event.timestamp),
  };
}

export default function Chat() {
  const { sessionId } = useParams();
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [deletingSession, setDeletingSession] = useState(false);
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
  const prevMessagesLengthRef = useRef(0);
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

  // Message queue and interruption state
  const [messageQueue, setMessageQueue] = useState<Array<{
    input: string;
    images: ImageAttachment[];
  }>>([]);
  const [pendingMessage, setPendingMessage] = useState<{
    input: string;
    images: ImageAttachment[];
  } | null>(null);
  const [showInterruptDialog, setShowInterruptDialog] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get repo store actions
  const repoStore = useRepoStore();

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
  const { data: eventsData } = useQuery({
    queryKey: ['session-events', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.getEvents(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new',
    // Poll every 2 seconds if session is running or pending, but NOT while SSE stream is active
    // This prevents duplicate messages from both SSE and polling
    refetchInterval: () => {
      // Don't poll while SSE stream is active to avoid duplicates
      if (isExecuting) return false;

      const session = sessionDetailsData?.data;
      return session?.status === 'running' || session?.status === 'pending' ? 2000 : false;
    },
  });

  const session: ChatSession | undefined = sessionDetailsData?.data;

  // Sync isExecuting with session status when returning to a running session
  useEffect(() => {
    if (session?.status === 'running' || session?.status === 'pending') {
      if (!isExecuting) {
        console.log('[Chat] Syncing isExecuting with session status:', session.status);
        setIsExecuting(true);
      }
    } else if (session?.status === 'completed' || session?.status === 'error') {
      if (isExecuting) {
        console.log('[Chat] Session completed, setting isExecuting to false');
        setIsExecuting(false);
      }
    }
  }, [session?.status]);

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
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      sessionsApi.update(id, title),
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

  const handleAutoPR = async () => {
    if (!session?.repositoryOwner || !session?.repositoryName || !session?.branch || !session?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('auto');
    setPrError(null);
    setPrSuccess(null);

    try {
      const response = await githubApi.autoPR(
        session.repositoryOwner,
        session.repositoryName,
        session.branch,
        {
          base: session.baseBranch,
          title: session.userRequest || `Merge ${session.branch} into ${session.baseBranch}`,
        }
      );
      setPrSuccess(`Auto PR completed! PR #${response.data.pr?.number} merged successfully.`);

      // Add message to chat history
      const autoPrMessageContent = `🚀 Auto PR completed!\n\nPR #${response.data.pr?.number} created and merged into ${session.baseBranch}\n\n${response.data.pr?.htmlUrl}`;
      messageIdCounter.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: 'system',
          content: autoPrMessageContent,
          timestamp: new Date(),
        },
      ]);

      // Persist message to database
      if (sessionId && sessionId !== 'new') {
        try {
          await sessionsApi.createMessage(sessionId, 'system', autoPrMessageContent);
        } catch (err) {
          console.error('Failed to persist Auto PR message to database:', err);
        }
      }

      refetchPr();
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to complete Auto PR';
      if (errorMsg.includes('conflict')) {
        setPrError('Merge conflict detected. Please resolve conflicts manually.');
      } else {
        setPrError(errorMsg);
      }
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
    setDeletingSession(true);
  };

  const confirmDelete = () => {
    if (sessionId && sessionId !== 'new') {
      deleteMutation.mutate(sessionId);
    }
  };

  const cancelDelete = () => {
    setDeletingSession(false);
  };

  // Handle Enter key in delete modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (deletingSession && e.key === 'Enter' && !deleteMutation.isPending) {
        e.preventDefault();
        confirmDelete();
      }
    };

    if (deletingSession) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [deletingSession, deleteMutation.isPending]);

  // Merge user messages with converted events
  useEffect(() => {
    if (!sessionId) return;

    // Get user messages from the messages table (type: 'user')
    const userMessages: Message[] = messagesData?.data?.messages?.filter(
      (m: Message) => m.type === 'user'
    ) || [];

    // Convert raw events to displayable messages
    const dbEvents: DbEvent[] = eventsData?.data?.events || [];
    const eventMessages = dbEvents
      .map((event) => convertEventToMessage(event, sessionId))
      .filter((msg): msg is Message => msg !== null);

    // Merge and sort by timestamp
    const allMessages = [...userMessages, ...eventMessages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    setMessages(allMessages);
  }, [eventsData, messagesData, sessionId]);

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

  // Smart auto-scroll: only scroll to bottom when new messages arrive and user is near bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Check if user is near the bottom (within 100px)
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    // Check if this is a new message (not just loading existing ones)
    const hasNewMessage = messages.length > prevMessagesLengthRef.current;

    // Only auto-scroll if user is near bottom or if it's a new message being added
    if (isNearBottom || hasNewMessage) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    // Update the previous length
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Reset state when navigating to new chat (sessionId becomes undefined)
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setInput('');
      setImages([]);
      setSelectedRepo('');
      setIsExecuting(false);
      setStreamUrl(null);
      setEditingTitle(false);
      setEditTitle('');
      setDeletingSession(false);
      setCurrentSessionId(null);
      setIsLocked(false);
      setLastRequest(null);
      messageIdCounter.current = 0;
      autoGeneratedTitleRef.current = null;
      hasUserEditedTitleRef.current = false;
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

  const { isConnected } = useEventSource(streamUrl, {
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

      // Extract content from various possible locations
      let content: string | null = null;
      let messageType: 'assistant' | 'system' = 'assistant';
      let eventLabel = '';

      // Skip if data is undefined or null
      if (!data) {
        console.log('Skipping event with no data:', event);
        return;
      }

      // Handle git commit and pull progress events
      // These events may have nested data structure: { data: { message: "..." }, type: "...", timestamp: "..." }
      if (eventType === 'commit_progress') {
        const message = data.data?.message || data.message;
        content = typeof data === 'string' ? data : (message || JSON.stringify(data));
        eventLabel = '📤';
        messageType = 'system';
      } else if (eventType === 'github_pull_progress') {
        const message = data.data?.message || data.message;
        content = typeof data === 'string' ? data : (message || JSON.stringify(data));
        eventLabel = '⬇️';
        messageType = 'system';
      }
      // Extract content from different event types (matching server-side logic)
      else if (data.type === 'message' && data.message) {
        content = data.message;
        eventLabel = '💬';
        messageType = 'system';
      } else if (data.type === 'session_name' && data.sessionName) {
        // Session name - auto-save if not manually edited
        const newTitle = data.sessionName;
        content = `Session: ${newTitle}`;
        eventLabel = '📝';
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
      } else if (data.type === 'assistant_message' && data.data) {
        const msgData = data.data;

        // Handle assistant message with Claude response
        if (msgData.type === 'assistant' && msgData.message?.content) {
          const contentBlocks = msgData.message.content;
          if (Array.isArray(contentBlocks)) {
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

      // Add event label if present (inline emoji before message)
      const finalContent = eventLabel ? `${eventLabel} ${content}` : content;

      messageIdCounter.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + messageIdCounter.current,
          chatSessionId: sessionId && sessionId !== 'new' ? sessionId : '',
          type: messageType,
          content: finalContent,
          timestamp: new Date(),
        },
      ]);
    },
    onConnected: () => {
      setIsExecuting(true);
    },
    onCompleted: (data) => {
      setIsExecuting(false);
      setStreamUrl(null);
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

    // If a job is currently executing, show interrupt/queue dialog
    if (isExecuting) {
      setPendingMessage({
        input: input.trim(),
        images: [...images],
      });
      setShowInterruptDialog(true);
      return;
    }

    // Set executing state immediately to prevent duplicate submissions
    setIsExecuting(true);

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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      setIsExecuting(false);
      setStreamUrl(null);
      setShowInterruptDialog(false);

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

      // Process queued message if exists
      if (messageQueue.length > 0) {
        const nextMessage = messageQueue[0];
        setMessageQueue(messageQueue.slice(1));

        // Submit the queued message
        setTimeout(() => {
          setInput(nextMessage.input);
          setImages(nextMessage.images);
          handleSubmit(new Event('submit') as any);
        }, 500);
      } else if (pendingMessage) {
        // Submit the pending message
        const pending = pendingMessage;
        setPendingMessage(null);
        setTimeout(() => {
          setInput(pending.input);
          setImages(pending.images);
          handleSubmit(new Event('submit') as any);
        }, 500);
      }
    } catch (error) {
      console.error('Failed to interrupt job:', error);
      alert('Failed to interrupt the current job. Please try again.');
    }
  };

  // Handle queueing a message
  const handleQueue = () => {
    if (pendingMessage) {
      setMessageQueue([...messageQueue, pendingMessage]);
      setPendingMessage(null);
      setShowInterruptDialog(false);

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

      {/* Auto PR button - hide when PR already merged */}
      {!existingPr && !mergedPr && (
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
    >
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
          />
        </div>
      ) : (
        /* Messages area with bottom input panel */
        <>
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4">
            <div className="max-w-4xl mx-auto space-y-4">
              {messages.map((message) => (
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

              {isConnected && isExecuting && (
                <div className="flex justify-start">
                  <div className="bg-base-100 border border-base-300 rounded-lg px-4 py-2">
                    <div className="flex items-center space-x-3">
                      <span className="loading loading-spinner loading-sm text-primary"></span>
                      <div className="flex flex-col">
                        <span className="text-sm text-base-content/70">Processing...</span>
                        {selectedRepo && (
                          <div className="flex items-center gap-2 mt-1">
                            {baseBranch && (
                              <span className="text-xs text-base-content/50">
                                📂 Parent: <span className="font-medium">{baseBranch}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Queue status indicator */}
              {messageQueue.length > 0 && (
                <div className="flex justify-center">
                  <div className="alert alert-info inline-flex items-center gap-2 py-2 px-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <span className="text-xs">
                      {messageQueue.length} message{messageQueue.length > 1 ? 's' : ''} queued
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input panel at bottom when messages exist */}
          <div className="bg-base-100 border-t border-base-300 p-6 flex-shrink-0">
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
            />
          </div>
        </>
      )}

      {/* Delete confirmation modal */}
      {deletingSession && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">
              Delete Session
            </h3>
            <p className="text-sm text-base-content/70 mb-6">
              Are you sure you want to delete this session? This action cannot be undone and will
              delete all messages in this session.
            </p>
            <div className="modal-action">
              <button
                onClick={cancelDelete}
                className="btn btn-ghost"
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="btn btn-error"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
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

      {/* Interrupt/Queue Dialog */}
      {showInterruptDialog && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">
              Job in Progress
            </h3>
            <p className="text-sm text-base-content/70 mb-6">
              An AI job is currently running. What would you like to do with your new message?
            </p>
            <div className="space-y-4">
              <div className="alert alert-info">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div className="text-sm">
                  <p><strong>Interrupt:</strong> Stop the current job and start your new request immediately</p>
                  <p><strong>Queue:</strong> Wait for the current job to finish, then run your message</p>
                </div>
              </div>
              {messageQueue.length > 0 && (
                <div className="text-xs text-base-content/60">
                  {messageQueue.length} message{messageQueue.length > 1 ? 's' : ''} already in queue
                </div>
              )}
            </div>
            <div className="modal-action">
              <button
                onClick={() => {
                  setShowInterruptDialog(false);
                  setPendingMessage(null);
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={handleQueue}
                className="btn btn-primary"
              >
                📋 Queue Message
              </button>
              <button
                onClick={handleInterrupt}
                className="btn btn-warning"
              >
                ⚠️ Interrupt & Run Now
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </SessionLayout>
  );
}
