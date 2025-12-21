import { useState, useCallback, useMemo, useRef } from 'react';
import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';
import { useGitHubFiles, TreeNode } from '@/hooks/useGitHubFiles';
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout';

// Audio file extensions
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'webm', 'opus'];

// Helper to check if a file is an audio file
const isAudioFile = (path: string): boolean => {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? AUDIO_EXTENSIONS.includes(ext) : false;
};

// Helper to collect all audio files from tree
const collectAudioFiles = (nodes: TreeNode[], result: TreeNode[] = []): TreeNode[] => {
  for (const node of nodes) {
    if (node.type === 'file' && isAudioFile(node.path)) {
      result.push(node);
    } else if (node.type === 'folder') {
      collectAudioFiles(node.children, result);
    }
  }
  return result;
};

// Format file size
const formatSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Get audio icon based on extension
const getAudioIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    mp3: '🎵',
    wav: '🔊',
    ogg: '🎧',
    flac: '💿',
    aac: '🎼',
    m4a: '🎤',
    webm: '🎬',
    opus: '🎙️',
  };
  return iconMap[ext || ''] || '🎵';
};

interface AudioPlayerProps {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  onClose: () => void;
}

function AudioPlayer({ owner, repo, branch, path, onClose }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path}`;
  const filename = path.split('/').pop() || path;

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-base-200">
      <div className="h-10 px-4 flex items-center justify-between border-b border-base-300 bg-base-100">
        <span className="text-sm font-medium truncate">{filename}</span>
        <button onClick={onClose} className="btn btn-ghost btn-xs">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Audio element */}
          <audio
            ref={audioRef}
            src={rawUrl}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError(true)}
          />

          {error ? (
            <div className="text-center text-error">
              <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <p>Failed to load audio</p>
              <p className="text-sm text-base-content/60 mt-1">The file may be too large or unsupported</p>
            </div>
          ) : (
            <>
              {/* Waveform visualization placeholder */}
              <div className="bg-base-300 rounded-lg h-24 mb-6 flex items-center justify-center">
                <svg className="w-full h-16 text-primary/30" viewBox="0 0 200 40">
                  <path
                    d="M0,20 L5,15 L10,25 L15,10 L20,30 L25,5 L30,35 L35,12 L40,28 L45,8 L50,32 L55,15 L60,25 L65,10 L70,30 L75,5 L80,35 L85,12 L90,28 L95,8 L100,20 L105,15 L110,25 L115,10 L120,30 L125,5 L130,35 L135,12 L140,28 L145,8 L150,32 L155,15 L160,25 L165,10 L170,30 L175,5 L180,35 L185,12 L190,28 L195,8 L200,20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </div>

              {/* Progress bar */}
              <div className="mb-4">
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  className="range range-primary range-sm w-full"
                />
                <div className="flex justify-between text-xs text-base-content/60 mt-1">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-4">
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  if (audioRef.current) audioRef.current.currentTime -= 10;
                }}>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12.5 3C17.15 3 21.08 6.03 22.47 10.22L20.1 11C19.05 7.81 16.04 5.5 12.5 5.5C10.54 5.5 8.77 6.22 7.38 7.38L10 10H3V3L5.6 5.6C7.45 4 9.85 3 12.5 3M10 12V22H8V14H6V12H10M18 14V20C18 21.11 17.11 22 16 22H14C12.9 22 12 21.1 12 20V14C12 12.9 12.9 12 14 12H16C17.11 12 18 12.9 18 14M14 14V20H16V14H14Z"/>
                  </svg>
                </button>

                <button
                  onClick={togglePlay}
                  className="btn btn-primary btn-circle btn-lg"
                >
                  {isPlaying ? (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14,19H18V5H14M6,19H10V5H6V19Z"/>
                    </svg>
                  ) : (
                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8,5.14V19.14L19,12.14L8,5.14Z"/>
                    </svg>
                  )}
                </button>

                <button className="btn btn-ghost btn-sm" onClick={() => {
                  if (audioRef.current) audioRef.current.currentTime += 10;
                }}>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.5 3C6.85 3 2.92 6.03 1.53 10.22L3.9 11C4.95 7.81 7.96 5.5 11.5 5.5C13.46 5.5 15.23 6.22 16.62 7.38L14 10H21V3L18.4 5.6C16.55 4 14.15 3 11.5 3M10 12V22H8V14H6V12H10M18 14V20C18 21.11 17.11 22 16 22H14C12.9 22 12 21.1 12 20V14C12 12.9 12.9 12 14 12H16C17.11 12 18 12.9 18 14M14 14V20H16V14H14Z"/>
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="p-4 bg-base-100 border-t border-base-300">
        <p className="text-xs text-base-content/60 truncate">
          Path: {path}
        </p>
        <a
          href={rawUrl}
          download={filename}
          className="btn btn-sm btn-outline mt-2"
        >
          Download
        </a>
      </div>
    </div>
  );
}

/**
 * Workspace Sounds - Live workspace mode for managing audio files.
 * Uses GitHub API directly for file operations.
 */
export default function WorkspaceSounds() {
  const workspace = useWorkspaceParams();
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null);

  const { owner, repo, branch } = workspace || { owner: '', repo: '', branch: '' };

  const {
    tree,
    isLoadingTree,
    treeError,
    refetchTree,
  } = useGitHubFiles({
    owner,
    repo,
    branch,
    enabled: !!workspace,
  });

  // Collect all audio files from the tree
  const audioFiles = useMemo(() => collectAudioFiles(tree), [tree]);

  const handleSelectAudio = useCallback((path: string) => {
    setSelectedAudio(path === selectedAudio ? null : path);
  }, [selectedAudio]);

  if (!workspace) {
    return null;
  }

  return (
    <WorkspaceLayout>
      <div className="flex h-full">
        {/* Audio List */}
        <div className={`flex-1 flex flex-col min-w-0 ${selectedAudio ? 'w-1/2' : 'w-full'}`}>
          {/* Header */}
          <div className="h-10 px-4 flex items-center justify-between border-b border-base-300 bg-base-100">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Sounds</span>
              <span className="badge badge-sm">{audioFiles.length}</span>
            </div>
            <button
              onClick={() => refetchTree()}
              className="btn btn-ghost btn-xs"
              title="Refresh"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {isLoadingTree ? (
              <div className="flex items-center justify-center h-full">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : treeError ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-error">
                  <p>Failed to load audio files</p>
                  <button onClick={() => refetchTree()} className="btn btn-sm btn-ghost mt-2">
                    Retry
                  </button>
                </div>
              </div>
            ) : audioFiles.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-base-content/60">
                  <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                  </svg>
                  <p>No audio files found in this repository</p>
                  <p className="text-sm mt-1">Upload audio files to see them here</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-base-200">
                {audioFiles.map((file) => {
                  const filename = file.path.split('/').pop() || file.path;
                  const folder = file.path.replace(filename, '').replace(/\/$/, '') || '/';
                  const isSelected = selectedAudio === file.path;

                  return (
                    <button
                      key={file.path}
                      onClick={() => handleSelectAudio(file.path)}
                      className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-base-200'
                      }`}
                    >
                      <span className="text-2xl">{getAudioIcon(filename)}</span>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium truncate">{filename}</p>
                        <p className="text-xs text-base-content/60 truncate">{folder}</p>
                      </div>
                      {file.type === 'file' && file.size && (
                        <span className="text-xs text-base-content/50">
                          {formatSize(file.size)}
                        </span>
                      )}
                      <svg
                        className={`w-5 h-5 flex-shrink-0 ${isSelected ? 'text-primary' : 'text-base-content/30'}`}
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8,5.14V19.14L19,12.14L8,5.14Z"/>
                      </svg>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Audio Player Panel */}
        {selectedAudio && (
          <div className="w-1/2 border-l border-base-300">
            <AudioPlayer
              owner={owner}
              repo={repo}
              branch={branch}
              path={selectedAudio}
              onClose={() => setSelectedAudio(null)}
            />
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}
