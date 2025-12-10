import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
import { useEmbedded } from '@/contexts/EmbeddedContext';
import { githubApi, sessionsApi, storageWorkerApi } from '@/lib/api';

type ViewMode = 'waveform' | 'properties';

// File types for filtering
type SoundFileType = 'audio' | 'midi' | 'project';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  icon?: string;
  fileType?: SoundFileType;
}

interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
}

interface SoundSession {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  sessionId?: string;
}

interface PreSelectedSettings {
  repositoryUrl?: string;
  baseBranch?: string;
}

// Selection state for clipping
interface AudioSelection {
  start: number; // in seconds
  end: number; // in seconds
}

// File extensions for different asset types
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'aac', 'flac', 'm4a', 'webm', 'aiff', 'aif'];
const MIDI_PATTERNS = ['.midi', '.mid'];
const PROJECT_PATTERNS = ['.soundproject.json', '.audio.json'];

// Helper to determine file type
const getSoundFileType = (filename: string): SoundFileType | null => {
  const lowerName = filename.toLowerCase();

  // Check for project patterns first (more specific)
  if (PROJECT_PATTERNS.some(pattern => lowerName.endsWith(pattern))) {
    return 'project';
  }

  // Check for MIDI patterns
  if (MIDI_PATTERNS.some(pattern => lowerName.endsWith(pattern))) {
    return 'midi';
  }

  // Check for audio extensions
  const ext = lowerName.split('.').pop();
  if (ext && AUDIO_EXTENSIONS.includes(ext)) {
    return 'audio';
  }

  return null;
};

// Helper to get file icon based on type
const getFileIcon = (filename: string, fileType?: SoundFileType): string => {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (fileType === 'project') return '📋';
  if (fileType === 'midi') return '🎹';

  // Audio icons based on extension
  const iconMap: Record<string, string> = {
    wav: '🔊',
    mp3: '🎵',
    ogg: '🎵',
    aac: '🎵',
    flac: '🎵',
    m4a: '🎵',
    webm: '🎵',
    aiff: '🔊',
    aif: '🔊',
  };

  return iconMap[ext || ''] || '🎵';
};

// Helper to recursively remove empty folders from the tree (no longer used - keeping all folders)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const removeEmptyFolders = (nodes: FileNode[]): FileNode[] => {
  return nodes
    .map(node => {
      if (node.type === 'folder' && node.children) {
        const cleanedChildren = removeEmptyFolders(node.children);
        return { ...node, children: cleanedChildren };
      }
      return node;
    })
    .filter(node => {
      if (node.type === 'file') return true;
      return node.children && node.children.length > 0;
    });
};

// Transform storage-worker files to our filtered TreeNode format for sound
const transformStorageFilesForSound = (
  files: { path: string; size: number; type: 'file' | 'directory' }[],
  filterMode: SoundFileType | 'all',
  repoName?: string
): FileNode[] => {
  const root: FileNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Build the prefix to strip: workspace/ and optionally the repo name folder
  // This prevents showing the root folder (e.g., "hello-world") when it's the repo itself
  const prefixToStrip = repoName ? `workspace/${repoName}/` : 'workspace/';
  const altPrefixToStrip = 'workspace/'; // Fallback for files directly in workspace/

  // Filter to only include files under workspace/ and strip the prefix
  // Also filter out .git directories and their contents
  const workspaceFiles = files
    .filter(f => f.path.startsWith('workspace/'))
    .filter(f => {
      // Exclude .git folder and anything inside it
      const pathWithoutPrefix = f.path.replace(/^workspace\//, '');
      const parts = pathWithoutPrefix.split('/');
      return !parts.some(part => part === '.git');
    })
    .map(f => {
      // Strip the full prefix (workspace/repoName/) if it matches, otherwise just workspace/
      let newPath = f.path;
      if (repoName && f.path.startsWith(prefixToStrip)) {
        newPath = f.path.slice(prefixToStrip.length);
      } else if (f.path.startsWith(altPrefixToStrip)) {
        newPath = f.path.slice(altPrefixToStrip.length);
        // If there's a repoName and the path starts with it, strip that too
        if (repoName && (newPath === repoName || newPath.startsWith(repoName + '/'))) {
          newPath = newPath === repoName ? '' : newPath.slice(repoName.length + 1);
        }
      }
      return {
        ...f,
        path: newPath,
      };
    })
    .filter(f => f.path !== ''); // Filter out empty paths (the repo root directory itself)

  // Sort items: directories first, then alphabetically
  const sortedItems = [...workspaceFiles].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.path.localeCompare(b.path);
  });

  // First pass: identify all files and their types
  const fileTypes = new Map<string, SoundFileType>();
  for (const item of sortedItems) {
    if (item.type === 'file') {
      const fileType = getSoundFileType(item.path.split('/').pop() || '');
      if (fileType) {
        fileTypes.set(item.path, fileType);
      }
    }
  }

  // Build the tree structure
  for (const item of sortedItems) {
    const pathParts = item.path.split('/');
    let currentLevel = root;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const currentPath = pathParts.slice(0, i + 1).join('/');
      const isLastPart = i === pathParts.length - 1;

      if (isLastPart) {
        if (item.type === 'file') {
          const fileType = fileTypes.get(item.path);

          // Filter by mode - only include matching sound files
          if (!fileType) continue;
          if (filterMode !== 'all') {
            if (filterMode === 'audio' && fileType !== 'audio') continue;
            if (filterMode === 'midi' && fileType !== 'midi') continue;
            if (filterMode === 'project' && fileType !== 'project') continue;
          }

          currentLevel.children!.push({
            name: part,
            path: currentPath,
            type: 'file',
            icon: getFileIcon(part, fileType),
            fileType,
          });
        } else {
          const existing = currentLevel.children!.find(
            c => c.type === 'folder' && c.name === part
          );
          if (!existing) {
            currentLevel.children!.push({
              name: part,
              path: currentPath,
              type: 'folder',
              children: [],
            });
          }
        }
      } else {
        let folder = currentLevel.children!.find(
          c => c.type === 'folder' && c.name === part
        ) as FileNode | undefined;

        if (!folder) {
          folder = { name: part, path: currentPath, type: 'folder', children: [] };
          currentLevel.children!.push(folder);
        }

        currentLevel = folder;
      }
    }
  }

  // Return all folders (including empty ones) so users can navigate the full directory structure
  return root.children || [];
};

// Format time as mm:ss.ms
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
};

// Props for split view support
interface SoundContentProps {
  sessionId?: string;
  isEmbedded?: boolean;
}

export function SoundContent({ sessionId: sessionIdProp }: SoundContentProps = {}) {
  const { sessionId: sessionIdParam } = useParams<{ sessionId?: string }>();
  const sessionId = sessionIdProp ?? sessionIdParam;
  const location = useLocation();
  const navigate = useNavigate();
  useQueryClient(); // Keep for potential future use

  // Get pre-selected settings from navigation state
  const preSelectedSettings = (location.state as { preSelectedSettings?: PreSelectedSettings } | null)?.preSelectedSettings;
  const hasInitializedFromPreSelected = useRef(false);

  // Sound session state
  const [soundSession, setSoundSession] = useState<SoundSession | null>(null);
  const [_isInitializing, setIsInitializing] = useState(false);
  const [_initError, setInitError] = useState<string | null>(null);

  // Editor state
  const [viewMode, setViewMode] = useState<ViewMode>('waveform');
  const [filterMode, setFilterMode] = useState<SoundFileType | 'all'>('all');
  const [showExplorer, setShowExplorer] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; fileType?: SoundFileType } | null>(null);

  // Audio state
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(70);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Selection state for clipping
  const [selection, setSelection] = useState<AudioSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<number | null>(null);

  // Waveform canvas
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);

  // Web Audio API refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playStartTimeRef = useRef<number>(0);
  const playOffsetRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Zoom and pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState(0);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Undo/Redo history
  const [audioHistory, setAudioHistory] = useState<AudioBuffer[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Fetch existing session if sessionId is provided
  const { data: existingSessionData, isLoading: isLoadingExistingSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId,
  });

  // Set sound session from existing session data
  useEffect(() => {
    if (existingSessionData?.data) {
      const session = existingSessionData.data;
      if (session.repositoryOwner && session.repositoryName && session.branch) {
        setSoundSession({
          owner: session.repositoryOwner,
          repo: session.repositoryName,
          branch: session.branch,
          baseBranch: session.baseBranch || 'main',
          sessionId: session.id,
        });
      }
    }
  }, [existingSessionData]);

  // Fetch user's GitHub repos (only when no existing session)
  const { data: reposData, isLoading: _isLoadingRepos } = useQuery({
    queryKey: ['github-repos'],
    queryFn: githubApi.getRepos,
    enabled: !sessionId && !soundSession,
  });

  const repos: GitHubRepo[] = reposData?.data || [];

  // Auto-initialize from pre-selected settings
  useEffect(() => {
    if (
      preSelectedSettings?.repositoryUrl &&
      repos.length > 0 &&
      !hasInitializedFromPreSelected.current &&
      !soundSession &&
      !sessionId
    ) {
      hasInitializedFromPreSelected.current = true;
      const matchingRepo = repos.find(r => r.cloneUrl === preSelectedSettings.repositoryUrl);
      if (matchingRepo) {
        initializeSoundSession(matchingRepo, preSelectedSettings.baseBranch);
      }
    }
  }, [preSelectedSettings, repos, soundSession, sessionId]);

  // Create branch mutation
  const createBranchMutation = useMutation({
    mutationFn: async ({ owner, repo, branchName, baseBranch }: {
      owner: string;
      repo: string;
      branchName: string;
      baseBranch: string;
    }) => {
      return githubApi.createBranch(owner, repo, { branchName, baseBranch });
    },
  });

  // Initialize Sound session when repo is selected
  const initializeSoundSession = async (repo: GitHubRepo, selectedBranch?: string) => {
    setIsInitializing(true);
    setInitError(null);

    try {
      const [owner, repoName] = repo.fullName.split('/');
      const baseBranch = selectedBranch || repo.defaultBranch;
      const branchName = `sound-${Date.now()}`;

      // Create a new branch
      await createBranchMutation.mutateAsync({
        owner,
        repo: repoName,
        branchName,
        baseBranch,
      });

      // Create a code session in the database
      // Note: createCodeSession already clones the repo and uploads to storage
      const sessionResponse = await sessionsApi.createCodeSession({
        title: `Sound: ${repo.name}`,
        repositoryUrl: repo.cloneUrl,
        repositoryOwner: owner,
        repositoryName: repoName,
        baseBranch,
        branch: branchName,
      });

      const dbSessionId = sessionResponse.data.sessionId;

      setSoundSession({
        owner,
        repo: repoName,
        branch: branchName,
        baseBranch,
        sessionId: dbSessionId,
      });

      // Navigate to the session URL
      navigate(`/session/${dbSessionId}/sound`, { replace: true });

      // Expand root folders by default
      setExpandedFolders(new Set());
    } catch (error) {
      console.error('[Sound] Failed to initialize session:', error);
      setInitError(error instanceof Error ? error.message : 'Failed to initialize session');
    } finally {
      setIsInitializing(false);
    }
  };

  // Fetch file tree from storage-worker
  const { data: storageFiles, isLoading: isLoadingTree, refetch: refetchFiles } = useQuery({
    queryKey: ['sound-file-tree', soundSession?.sessionId],
    queryFn: async () => {
      const storageSessionId = soundSession?.sessionId;
      if (!storageSessionId) return [];

      try {
        const files = await storageWorkerApi.listFiles(storageSessionId);
        return files;
      } catch (error) {
        console.error('[Sound] Failed to fetch files:', error);
        return [];
      }
    },
    enabled: !!soundSession?.sessionId,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // Transform files to tree format
  // Pass the repo name to strip the root folder (e.g., "hello-world") from the tree
  const fileTree = useMemo(() => {
    if (!storageFiles || storageFiles.length === 0) return [];
    return transformStorageFilesForSound(storageFiles, filterMode, soundSession?.repo);
  }, [storageFiles, filterMode, soundSession?.repo]);

  // Initialize Web Audio API
  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      }
    };
  }, []);

  // Update volume when it changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume / 100;
    }
  }, [volume]);

  // Load audio file when selected
  const loadAudioFile = useCallback(async (filePath: string) => {
    if (!soundSession?.sessionId) return;

    setIsLoadingAudio(true);
    setLoadError(null);
    setAudioBuffer(null);
    setSelection(null);
    setCurrentTime(0);
    setAudioHistory([]);
    setHistoryIndex(-1);
    setHasUnsavedChanges(false);

    try {
      // Build storage path: workspace/<repoName>/<path>
      // The path parameter has the repo name stripped for display, so we need to add it back
      const storagePath = soundSession.repo
        ? `workspace/${soundSession.repo}/${filePath}`
        : `workspace/${filePath}`;

      // Get the file blob
      const blob = await storageWorkerApi.getFileBlob(soundSession.sessionId, storagePath);
      if (!blob) {
        throw new Error('Failed to load audio file');
      }

      // Decode audio data
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = audioContextRef.current;
      if (!audioCtx) {
        throw new Error('Audio context not available');
      }

      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      setAudioBuffer(decodedBuffer);
      setDuration(decodedBuffer.duration);

      // Initialize history with original buffer
      setAudioHistory([decodedBuffer]);
      setHistoryIndex(0);

    } catch (error) {
      console.error('[Sound] Failed to load audio:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load audio');
    } finally {
      setIsLoadingAudio(false);
    }
  }, [soundSession?.sessionId]);

  // Handle file selection
  const handleFileSelect = useCallback((file: { path: string; name: string; fileType?: SoundFileType }) => {
    setSelectedFile(file);
    if (file.fileType === 'audio') {
      loadAudioFile(file.path);
    }
  }, [loadAudioFile]);

  // Draw waveform on canvas
  useEffect(() => {
    if (!audioBuffer || !waveformCanvasRef.current || !waveformContainerRef.current) return;

    const canvas = waveformCanvasRef.current;
    const container = waveformContainerRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match container
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const width = rect.width;
    const height = rect.height;

    // Clear canvas
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, width, height);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Vertical grid lines (time markers)
    const visibleDuration = duration / zoomLevel;
    const timeStep = visibleDuration > 60 ? 10 : visibleDuration > 10 ? 1 : 0.1;
    const startTime = panOffset * duration;
    const endTime = startTime + visibleDuration;

    for (let t = Math.ceil(startTime / timeStep) * timeStep; t < endTime; t += timeStep) {
      const x = ((t - startTime) / visibleDuration) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Draw time label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px sans-serif';
      ctx.fillText(formatTime(t), x + 2, 12);
    }

    // Horizontal center line
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw waveform
    const channelData = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.floor((channelData.length / zoomLevel) / width);
    const startSample = Math.floor(panOffset * channelData.length);

    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < width; i++) {
      const sampleIndex = startSample + i * samplesPerPixel;
      let min = 1;
      let max = -1;

      for (let j = 0; j < samplesPerPixel && sampleIndex + j < channelData.length; j++) {
        const sample = channelData[sampleIndex + j];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }

      const yMin = ((1 - max) / 2) * height;
      const yMax = ((1 - min) / 2) * height;

      if (i === 0) {
        ctx.moveTo(i, yMin);
      }
      ctx.lineTo(i, yMin);
      ctx.lineTo(i, yMax);
    }

    ctx.stroke();

    // Draw selection region
    if (selection) {
      const selectionStartX = ((selection.start / duration - panOffset) * zoomLevel) * width;
      const selectionEndX = ((selection.end / duration - panOffset) * zoomLevel) * width;

      ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
      ctx.fillRect(selectionStartX, 0, selectionEndX - selectionStartX, height);

      // Selection handles
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(selectionStartX - 2, 0, 4, height);
      ctx.fillRect(selectionEndX - 2, 0, 4, height);
    }

    // Draw playhead
    const playheadX = ((currentTime / duration - panOffset) * zoomLevel) * width;
    if (playheadX >= 0 && playheadX <= width) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }

  }, [audioBuffer, currentTime, duration, selection, zoomLevel, panOffset]);

  // Animation loop for playback
  const updatePlayhead = useCallback(() => {
    if (!isPlaying || !audioContextRef.current) return;

    const elapsed = audioContextRef.current.currentTime - playStartTimeRef.current;
    const newTime = playOffsetRef.current + elapsed * playbackRate;

    if (newTime >= duration) {
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }

    setCurrentTime(newTime);
    animationFrameRef.current = requestAnimationFrame(updatePlayhead);
  }, [isPlaying, duration, playbackRate]);

  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, updatePlayhead]);

  // Play audio
  const play = useCallback(() => {
    if (!audioBuffer || !audioContextRef.current) return;

    // Resume audio context if suspended
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    // Stop any currently playing audio
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
    }

    // Create new source
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;

    // Create gain node for volume control
    const gainNode = audioContextRef.current.createGain();
    gainNode.gain.value = volume / 100;

    source.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);

    sourceNodeRef.current = source;
    gainNodeRef.current = gainNode;

    // Determine start position and duration
    let startOffset = currentTime;
    let playDuration: number | undefined;

    if (selection) {
      startOffset = selection.start;
      playDuration = selection.end - selection.start;
    }

    source.start(0, startOffset, playDuration);
    playStartTimeRef.current = audioContextRef.current.currentTime;
    playOffsetRef.current = startOffset;

    source.onended = () => {
      setIsPlaying(false);
      if (selection) {
        setCurrentTime(selection.start);
      }
    };

    setIsPlaying(true);
  }, [audioBuffer, currentTime, volume, playbackRate, selection]);

  // Pause audio
  const pause = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
    }
    setIsPlaying(false);
  }, []);

  // Stop audio
  const stop = useCallback(() => {
    if (sourceNodeRef.current) {
      sourceNodeRef.current.stop();
      sourceNodeRef.current.disconnect();
    }
    setIsPlaying(false);
    setCurrentTime(selection?.start || 0);
  }, [selection]);

  // Handle waveform click for seeking
  const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioBuffer || !waveformContainerRef.current) return;

    const rect = waveformContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickRatio = x / rect.width;
    const visibleDuration = duration / zoomLevel;
    const startTime = panOffset * duration;
    const clickTime = startTime + clickRatio * visibleDuration;

    setCurrentTime(Math.max(0, Math.min(clickTime, duration)));
  }, [audioBuffer, duration, zoomLevel, panOffset]);

  // Handle waveform mouse down for selection
  const handleWaveformMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioBuffer || !waveformContainerRef.current || e.button !== 0) return;

    // If shift is held, start selection
    if (e.shiftKey) {
      const rect = waveformContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickRatio = x / rect.width;
      const visibleDuration = duration / zoomLevel;
      const startTime = panOffset * duration;
      const clickTime = startTime + clickRatio * visibleDuration;

      setIsSelecting(true);
      selectionStartRef.current = clickTime;
      setSelection({ start: clickTime, end: clickTime });
    } else {
      // Clear selection and seek
      setSelection(null);
      handleWaveformClick(e);
    }
  }, [audioBuffer, duration, zoomLevel, panOffset, handleWaveformClick]);

  // Handle waveform mouse move for selection
  const handleWaveformMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || selectionStartRef.current === null || !waveformContainerRef.current) return;

    const rect = waveformContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickRatio = Math.max(0, Math.min(1, x / rect.width));
    const visibleDuration = duration / zoomLevel;
    const startTime = panOffset * duration;
    const currentTimePos = startTime + clickRatio * visibleDuration;

    const selStart = Math.min(selectionStartRef.current, currentTimePos);
    const selEnd = Math.max(selectionStartRef.current, currentTimePos);

    setSelection({
      start: Math.max(0, selStart),
      end: Math.min(duration, selEnd),
    });
  }, [isSelecting, duration, zoomLevel, panOffset]);

  // Handle waveform mouse up
  const handleWaveformMouseUp = useCallback(() => {
    setIsSelecting(false);
    selectionStartRef.current = null;
  }, []);

  // Add to history
  const addToHistory = useCallback((buffer: AudioBuffer) => {
    setAudioHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(buffer);
      // Keep history manageable
      if (newHistory.length > 20) {
        newHistory.shift();
        return newHistory;
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 19));
    setHasUnsavedChanges(true);
  }, [historyIndex]);

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setAudioBuffer(audioHistory[historyIndex - 1]);
      setDuration(audioHistory[historyIndex - 1].duration);
    }
  }, [historyIndex, audioHistory]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < audioHistory.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setAudioBuffer(audioHistory[historyIndex + 1]);
      setDuration(audioHistory[historyIndex + 1].duration);
    }
  }, [historyIndex, audioHistory]);

  // Clip/Trim to selection
  const clipToSelection = useCallback(() => {
    if (!audioBuffer || !selection || !audioContextRef.current) return;

    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(selection.start * sampleRate);
    const endSample = Math.floor(selection.end * sampleRate);
    const newLength = endSample - startSample;

    if (newLength <= 0) return;

    // Create new buffer
    const newBuffer = audioContextRef.current.createBuffer(
      audioBuffer.numberOfChannels,
      newLength,
      sampleRate
    );

    // Copy selected region to new buffer
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < newLength; i++) {
        targetData[i] = sourceData[startSample + i];
      }
    }

    setAudioBuffer(newBuffer);
    setDuration(newBuffer.duration);
    setCurrentTime(0);
    setSelection(null);
    addToHistory(newBuffer);
  }, [audioBuffer, selection, addToHistory]);

  // Delete selection
  const deleteSelection = useCallback(() => {
    if (!audioBuffer || !selection || !audioContextRef.current) return;

    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(selection.start * sampleRate);
    const endSample = Math.floor(selection.end * sampleRate);
    const originalLength = audioBuffer.length;
    const deleteLength = endSample - startSample;
    const newLength = originalLength - deleteLength;

    if (newLength <= 0) return;

    // Create new buffer
    const newBuffer = audioContextRef.current.createBuffer(
      audioBuffer.numberOfChannels,
      newLength,
      sampleRate
    );

    // Copy non-selected regions to new buffer
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      // Copy before selection
      for (let i = 0; i < startSample; i++) {
        targetData[i] = sourceData[i];
      }

      // Copy after selection
      for (let i = endSample; i < originalLength; i++) {
        targetData[i - deleteLength] = sourceData[i];
      }
    }

    setAudioBuffer(newBuffer);
    setDuration(newBuffer.duration);
    setCurrentTime(selection.start);
    setSelection(null);
    addToHistory(newBuffer);
  }, [audioBuffer, selection, addToHistory]);

  // Normalize audio
  const normalizeAudio = useCallback(() => {
    if (!audioBuffer || !audioContextRef.current) return;

    // Find peak amplitude
    let peak = 0;
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }

    if (peak === 0) return;

    const gain = 1 / peak;

    // Create new buffer with normalized audio
    const newBuffer = audioContextRef.current.createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < sourceData.length; i++) {
        targetData[i] = sourceData[i] * gain;
      }
    }

    setAudioBuffer(newBuffer);
    addToHistory(newBuffer);
  }, [audioBuffer, addToHistory]);

  // Fade in
  const fadeIn = useCallback(() => {
    if (!audioBuffer || !audioContextRef.current) return;

    const startSample = selection ? Math.floor(selection.start * audioBuffer.sampleRate) : 0;
    const endSample = selection ? Math.floor(selection.end * audioBuffer.sampleRate) : audioBuffer.length;
    const fadeLength = endSample - startSample;

    const newBuffer = audioContextRef.current.createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < sourceData.length; i++) {
        if (i >= startSample && i < endSample) {
          const fadePosition = (i - startSample) / fadeLength;
          targetData[i] = sourceData[i] * fadePosition;
        } else {
          targetData[i] = sourceData[i];
        }
      }
    }

    setAudioBuffer(newBuffer);
    addToHistory(newBuffer);
  }, [audioBuffer, selection, addToHistory]);

  // Fade out
  const fadeOut = useCallback(() => {
    if (!audioBuffer || !audioContextRef.current) return;

    const startSample = selection ? Math.floor(selection.start * audioBuffer.sampleRate) : 0;
    const endSample = selection ? Math.floor(selection.end * audioBuffer.sampleRate) : audioBuffer.length;
    const fadeLength = endSample - startSample;

    const newBuffer = audioContextRef.current.createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < sourceData.length; i++) {
        if (i >= startSample && i < endSample) {
          const fadePosition = 1 - (i - startSample) / fadeLength;
          targetData[i] = sourceData[i] * fadePosition;
        } else {
          targetData[i] = sourceData[i];
        }
      }
    }

    setAudioBuffer(newBuffer);
    addToHistory(newBuffer);
  }, [audioBuffer, selection, addToHistory]);

  // Reverse audio
  const reverseAudio = useCallback(() => {
    if (!audioBuffer || !audioContextRef.current) return;

    const startSample = selection ? Math.floor(selection.start * audioBuffer.sampleRate) : 0;
    const endSample = selection ? Math.floor(selection.end * audioBuffer.sampleRate) : audioBuffer.length;

    const newBuffer = audioContextRef.current.createBuffer(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const targetData = newBuffer.getChannelData(channel);

      for (let i = 0; i < sourceData.length; i++) {
        if (i >= startSample && i < endSample) {
          const reverseIndex = endSample - 1 - (i - startSample);
          targetData[i] = sourceData[reverseIndex];
        } else {
          targetData[i] = sourceData[i];
        }
      }
    }

    setAudioBuffer(newBuffer);
    addToHistory(newBuffer);
  }, [audioBuffer, selection, addToHistory]);

  // Save audio file
  const saveAudioFile = useCallback(async () => {
    if (!audioBuffer || !selectedFile || !soundSession?.sessionId) return;

    setIsSaving(true);

    try {
      // Convert AudioBuffer to WAV blob
      const wavBlob = audioBufferToWav(audioBuffer);

      // Build storage path: workspace/<repoName>/<path>
      const storagePath = soundSession.repo
        ? `workspace/${soundSession.repo}/${selectedFile.path}`
        : `workspace/${selectedFile.path}`;

      // Save to storage
      const success = await storageWorkerApi.writeFile(
        soundSession.sessionId,
        storagePath,
        wavBlob
      );

      if (success) {
        setHasUnsavedChanges(false);
        await refetchFiles();
      } else {
        throw new Error('Failed to save file');
      }
    } catch (error) {
      console.error('[Sound] Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [audioBuffer, selectedFile, soundSession?.sessionId, soundSession?.repo, refetchFiles]);

  // Toggle folder expansion
  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space: Play/Pause
      if (e.code === 'Space' && !e.target?.toString().includes('Input')) {
        e.preventDefault();
        if (isPlaying) {
          pause();
        } else {
          play();
        }
      }

      // Ctrl+Z: Undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      // Ctrl+Shift+Z or Ctrl+Y: Redo
      if ((e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) {
        e.preventDefault();
        redo();
      }

      // Ctrl+S: Save
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveAudioFile();
      }

      // Delete: Delete selection
      if (e.key === 'Delete' && selection) {
        e.preventDefault();
        deleteSelection();
      }

      // Escape: Clear selection
      if (e.key === 'Escape') {
        setSelection(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, play, pause, undo, redo, saveAudioFile, selection, deleteSelection]);

  // Render file tree recursively
  const renderFileTree = (nodes: FileNode[], depth = 0): React.ReactNode => {
    return nodes.map(node => {
      const isExpanded = expandedFolders.has(node.path);
      const isSelected = selectedFile?.path === node.path;

      if (node.type === 'folder') {
        return (
          <div key={node.path}>
            <div
              className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-base-content/10 rounded`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              onClick={() => toggleFolder(node.path)}
            >
              <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
              <span className="text-sm">📁</span>
              <span className="text-sm truncate">{node.name}</span>
            </div>
            {isExpanded && node.children && (
              <div>{renderFileTree(node.children, depth + 1)}</div>
            )}
          </div>
        );
      }

      return (
        <div
          key={node.path}
          className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-base-content/10 rounded ${
            isSelected ? 'bg-primary/20 text-primary' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 20}px` }}
          onClick={() => handleFileSelect({ path: node.path, name: node.name, fileType: node.fileType })}
        >
          <span className="text-sm">{node.icon}</span>
          <span className="text-sm truncate">{node.name}</span>
        </div>
      );
    });
  };

  // Loading state for session initialization
  if (isLoadingExistingSession) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1a1d2e]">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary mb-4"></div>
          <p className="text-base-content/70">Loading session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#1a1d2e]">
      {/* Top Toolbar */}
      <div className="flex items-center gap-2 px-4 h-14 bg-[#252836] border-b border-[#2d3142]">
        {/* Toggle Explorer */}
        <button
          onClick={() => setShowExplorer(!showExplorer)}
          className={`p-2 rounded ${showExplorer ? 'bg-primary/20 text-primary' : 'hover:bg-base-content/10'}`}
          title="Toggle file explorer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>

        <div className="w-px h-6 bg-base-content/20" />

        {/* Filter dropdown */}
        <select
          className="select select-sm bg-base-content/10 border-none"
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as SoundFileType | 'all')}
        >
          <option value="all">All Files</option>
          <option value="audio">Audio Only</option>
          <option value="midi">MIDI Only</option>
          <option value="project">Projects</option>
        </select>

        <div className="w-px h-6 bg-base-content/20" />

        {/* Edit operations */}
        <button
          className="p-2 hover:bg-base-content/10 rounded disabled:opacity-50"
          title="Undo (Ctrl+Z)"
          onClick={undo}
          disabled={historyIndex <= 0}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
        <button
          className="p-2 hover:bg-base-content/10 rounded disabled:opacity-50"
          title="Redo (Ctrl+Shift+Z)"
          onClick={redo}
          disabled={historyIndex >= audioHistory.length - 1}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
          </svg>
        </button>

        <div className="w-px h-6 bg-base-content/20" />

        <button
          className="p-2 hover:bg-base-content/10 rounded disabled:opacity-50"
          title="Clip to selection"
          onClick={clipToSelection}
          disabled={!selection}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
          </svg>
        </button>
        <button
          className="p-2 hover:bg-base-content/10 rounded disabled:opacity-50"
          title="Delete selection"
          onClick={deleteSelection}
          disabled={!selection}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>

        <div className="w-px h-6 bg-base-content/20" />

        <button
          className="p-2 hover:bg-base-content/10 rounded disabled:opacity-50"
          title="Fade In"
          onClick={fadeIn}
          disabled={!audioBuffer}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 12L22 4V20L2 12Z" opacity="0.3" />
            <path d="M2 12L12 8V16L2 12Z" />
          </svg>
        </button>
        <button
          className="p-2 hover:bg-base-content/10 rounded disabled:opacity-50"
          title="Fade Out"
          onClick={fadeOut}
          disabled={!audioBuffer}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22 12L2 4V20L22 12Z" opacity="0.3" />
            <path d="M22 12L12 8V16L22 12Z" />
          </svg>
        </button>
        <button
          className="p-2 hover:bg-base-content/10 rounded disabled:opacity-50"
          title="Normalize"
          onClick={normalizeAudio}
          disabled={!audioBuffer}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </button>
        <button
          className="p-2 hover:bg-base-content/10 rounded disabled:opacity-50"
          title="Reverse"
          onClick={reverseAudio}
          disabled={!audioBuffer}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </button>

        <div className="flex-1" />

        {/* Zoom controls */}
        <button
          className="p-2 hover:bg-base-content/10 rounded"
          title="Zoom In"
          onClick={() => setZoomLevel(z => Math.min(z * 1.5, 100))}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>
        <button
          className="p-2 hover:bg-base-content/10 rounded"
          title="Zoom Out"
          onClick={() => setZoomLevel(z => Math.max(z / 1.5, 1))}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
          </svg>
        </button>
        <button
          className="p-2 hover:bg-base-content/10 rounded"
          title="Fit to view"
          onClick={() => { setZoomLevel(1); setPanOffset(0); }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>

        <div className="w-px h-6 bg-base-content/20" />

        {/* Volume Control */}
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
          </svg>
          <input
            type="range"
            className="w-24 range range-xs range-primary"
            min="0"
            max="100"
            value={volume}
            onChange={(e) => setVolume(parseInt(e.target.value))}
          />
          <span className="text-xs w-8">{volume}%</span>
        </div>

        <div className="w-px h-6 bg-base-content/20" />

        {/* Save button */}
        <button
          className={`btn btn-sm ${hasUnsavedChanges ? 'btn-primary' : 'btn-ghost'}`}
          onClick={saveAudioFile}
          disabled={!audioBuffer || isSaving || !hasUnsavedChanges}
        >
          {isSaving ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save
            </>
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Explorer */}
        {showExplorer && (
          <div className="w-64 bg-[#252836] border-r border-[#2d3142] flex flex-col">
            <div className="p-3 border-b border-[#2d3142]">
              <h3 className="text-sm font-bold text-base-content/50">FILES</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {isLoadingTree ? (
                <div className="flex items-center justify-center py-4">
                  <div className="loading loading-spinner loading-sm"></div>
                </div>
              ) : fileTree.length === 0 ? (
                <div className="text-center py-4 text-base-content/50 text-sm">
                  No sound files found
                </div>
              ) : (
                renderFileTree(fileTree)
              )}
            </div>
          </div>
        )}

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col">
          {!selectedFile ? (
            <div className="flex-1 flex items-center justify-center text-base-content/50">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <p>Select a sound file to edit</p>
                <p className="text-xs mt-2">Supports: WAV, MP3, OGG, AAC, FLAC, M4A</p>
              </div>
            </div>
          ) : isLoadingAudio ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="loading loading-spinner loading-lg text-primary mb-4"></div>
                <p className="text-base-content/70">Loading audio...</p>
              </div>
            </div>
          ) : loadError ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="alert alert-error max-w-md">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{loadError}</span>
              </div>
            </div>
          ) : audioBuffer ? (
            <>
              {/* File info bar */}
              <div className="px-4 py-2 bg-[#252836] border-b border-[#2d3142] flex items-center gap-4 text-sm">
                <span className="font-medium">{selectedFile.name}</span>
                <span className="text-base-content/50">|</span>
                <span className="text-base-content/70">{audioBuffer.numberOfChannels} ch</span>
                <span className="text-base-content/50">|</span>
                <span className="text-base-content/70">{audioBuffer.sampleRate} Hz</span>
                <span className="text-base-content/50">|</span>
                <span className="text-base-content/70">{formatTime(duration)}</span>
                {selection && (
                  <>
                    <span className="text-base-content/50">|</span>
                    <span className="text-primary">
                      Selection: {formatTime(selection.start)} - {formatTime(selection.end)}
                      ({formatTime(selection.end - selection.start)})
                    </span>
                  </>
                )}
                {hasUnsavedChanges && (
                  <span className="text-warning ml-auto">● Unsaved changes</span>
                )}
              </div>

              {/* Waveform Display */}
              <div
                ref={waveformContainerRef}
                className="flex-1 bg-[#0f1117] m-4 rounded-lg border border-[#2d3142] overflow-hidden cursor-crosshair"
              >
                <canvas
                  ref={waveformCanvasRef}
                  className="w-full h-full"
                  onMouseDown={handleWaveformMouseDown}
                  onMouseMove={handleWaveformMouseMove}
                  onMouseUp={handleWaveformMouseUp}
                  onMouseLeave={handleWaveformMouseUp}
                />
              </div>

              {/* Time display */}
              <div className="px-4 py-2 flex items-center justify-between text-sm font-mono bg-[#252836] border-t border-[#2d3142]">
                <span>{formatTime(currentTime)}</span>
                <span className="text-base-content/50">
                  Shift+Click and drag to select region
                </span>
                <span>{formatTime(duration)}</span>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-base-content/50">
              <p>Unable to display this file type</p>
            </div>
          )}
        </div>

        {/* Properties Panel */}
        {audioBuffer && viewMode === 'properties' && (
          <div className="w-80 bg-[#252836] border-l border-[#2d3142] p-6 overflow-y-auto">
            <h3 className="text-sm font-bold text-base-content/50 mb-4">PROPERTIES</h3>

            {/* Playback Rate */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm">Playback Speed</label>
                <span className="text-sm text-base-content/70">{playbackRate.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                className="w-full range range-sm range-primary"
                min="0.25"
                max="2"
                step="0.05"
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
              />
            </div>

            {/* Audio Info */}
            <div className="mb-6 p-3 bg-[#1a1d2e] rounded-lg">
              <h4 className="text-sm font-semibold mb-3">Audio Info</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/70">Channels</span>
                  <span>{audioBuffer.numberOfChannels}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Sample Rate</span>
                  <span>{audioBuffer.sampleRate} Hz</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Duration</span>
                  <span>{formatTime(audioBuffer.duration)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/70">Samples</span>
                  <span>{audioBuffer.length.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="flex items-center justify-center gap-4 px-4 h-20 bg-[#252836] border-t border-[#2d3142]">
        {/* Transport controls */}
        <button
          className="w-10 h-10 rounded-full bg-base-content/20 hover:bg-base-content/30 flex items-center justify-center"
          onClick={stop}
          title="Stop"
        >
          <div className="w-4 h-4 bg-white" />
        </button>

        <button
          className="w-14 h-14 rounded-full bg-primary hover:bg-primary/80 flex items-center justify-center"
          onClick={isPlaying ? pause : play}
          disabled={!audioBuffer}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          className={`w-10 h-10 rounded-full flex items-center justify-center ${
            selection ? 'bg-primary/30 text-primary' : 'bg-base-content/20 hover:bg-base-content/30'
          }`}
          onClick={() => setSelection(null)}
          title="Clear selection"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </button>

        {/* Progress bar */}
        <div className="flex-1 max-w-xl mx-4">
          <input
            type="range"
            className="w-full range range-sm range-primary"
            min="0"
            max={duration || 1}
            step="0.01"
            value={currentTime}
            onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
          />
        </div>

        {/* View mode toggle */}
        <button
          className={`p-2 rounded ${viewMode === 'properties' ? 'bg-primary/20 text-primary' : 'hover:bg-base-content/10'}`}
          onClick={() => setViewMode(viewMode === 'waveform' ? 'properties' : 'waveform')}
          title="Toggle properties panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Helper function to convert AudioBuffer to WAV blob
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write audio data
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

interface SoundProps {
  isEmbedded?: boolean;
}

export default function Sound({ isEmbedded: isEmbeddedProp = false }: SoundProps) {
  // Check if we're embedded via context (from split view) or prop
  const { isEmbedded: isEmbeddedContext } = useEmbedded();
  const isEmbedded = isEmbeddedProp || isEmbeddedContext;

  // Wrap content conditionally - when embedded, skip SessionLayout wrapper
  const Wrapper = isEmbedded ?
    ({ children }: { children: React.ReactNode }) => <div className="h-full flex flex-col overflow-hidden bg-base-200">{children}</div> :
    ({ children }: { children: React.ReactNode }) => (
      <SessionLayout>
        {children}
      </SessionLayout>
    );

  return (
    <Wrapper>
      <SoundContent isEmbedded={isEmbedded} />
    </Wrapper>
  );
}
