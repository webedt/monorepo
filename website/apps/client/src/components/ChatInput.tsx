import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { GitHubRepository, User } from '@webedt/shared';
import { githubApi } from '@/lib/api';

export interface ImageAttachment {
  id: string;
  data: string; // base64 data
  mediaType: string;
  fileName: string;
}

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  images: ImageAttachment[];
  setImages: (images: ImageAttachment[]) => void;
  onSubmit: (e: React.FormEvent) => void;
  isExecuting: boolean;
  selectedRepo: string;
  setSelectedRepo: (value: string) => void;
  baseBranch?: string;
  setBaseBranch?: (value: string) => void;
  repositories: GitHubRepository[];
  isLoadingRepos: boolean;
  isLocked: boolean;
  user: User | null;
  centered?: boolean;
  hideRepoSelection?: boolean;
}

export interface ChatInputRef {
  focus: () => void;
}

const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(({
  input,
  setInput,
  images,
  setImages,
  onSubmit,
  isExecuting,
  selectedRepo,
  setSelectedRepo,
  baseBranch = 'main',
  setBaseBranch,
  repositories,
  isLoadingRepos,
  isLocked,
  user,
  centered = false,
  hideRepoSelection = false,
}, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const mediaRecorderRef = useRef<any>(null); // Stores Web Speech API recognition instance
  const inputRef = useRef(input); // Ref to track current input value for speech recognition
  const voiceKeywordsRef = useRef<string[]>([]); // Ref to track current voice keywords (avoids stale closure)
  const keepRecordingRef = useRef(false); // Track if we want to keep recording after onend
  const hasGithubAuth = !!user?.githubAccessToken;
  const hasClaudeAuth = !!user?.claudeAuth;

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);

  // Keep inputRef in sync with input prop
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  // Keep voiceKeywordsRef in sync with user's voice command keywords
  useEffect(() => {
    voiceKeywordsRef.current = user?.voiceCommandKeywords || [];
    console.log('[Voice] Keywords updated:', voiceKeywordsRef.current);
  }, [user?.voiceCommandKeywords]);

  // Repository search state
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);

  // Branch selector state
  const [branchSearchQuery, setBranchSearchQuery] = useState('');
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  // Sort repositories alphabetically by fullName
  const sortedRepositories = [...repositories].sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );

  // Filter repositories based on fuzzy search with space-separated terms
  const filteredRepositories = sortedRepositories.filter((repo) => {
    if (!repoSearchQuery.trim()) return true;

    const searchTerms = repoSearchQuery.toLowerCase().trim().split(/\s+/);
    const repoName = repo.fullName.toLowerCase();

    // Check if all search terms match
    return searchTerms.every(term => repoName.includes(term));
  });

  // Filter branches based on fuzzy search with space-separated terms
  const filteredBranches = branches.filter((branchName) => {
    if (!branchSearchQuery.trim()) return true;

    const searchTerms = branchSearchQuery.toLowerCase().trim().split(/\s+/);
    const branch = branchName.toLowerCase();

    // Check if all search terms match
    return searchTerms.every(term => branch.includes(term));
  });

  // Helper function to resize image to max dimensions while maintaining aspect ratio
  const resizeImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Use user's preference or default to 1024
      const maxDimension = user?.imageResizeMaxDimension || 1024;

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions while maintaining aspect ratio
        if (width > maxDimension || height > maxDimension) {
          const aspectRatio = width / height;

          if (width > height) {
            width = maxDimension;
            height = width / aspectRatio;
          } else {
            height = maxDimension;
            width = height * aspectRatio;
          }
        }

        // Set canvas dimensions and draw resized image
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Convert canvas to blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob from canvas'));
            }
          },
          file.type || 'image/png',
          0.95 // Quality for JPEG
        );
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  // Helper function to convert file to base64
  const fileToBase64 = async (file: File): Promise<string> => {
    // Resize the image first
    const resizedBlob = await resizeImage(file);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(resizedBlob);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data:image/png;base64, prefix to get just the base64 data
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: ImageAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        try {
          const base64Data = await fileToBase64(file);
          newImages.push({
            id: `${Date.now()}-${i}`,
            data: base64Data,
            mediaType: file.type,
            fileName: file.name,
          });
        } catch (error) {
          console.error('Failed to read file:', error);
        }
      }
    }

    setImages([...images, ...newImages]);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle paste event
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const newImages: ImageAttachment[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Prevent pasting the image as text
        const file = item.getAsFile();
        if (file) {
          try {
            const base64Data = await fileToBase64(file);
            newImages.push({
              id: `${Date.now()}-${i}`,
              data: base64Data,
              mediaType: file.type,
              fileName: `pasted-image-${Date.now()}.png`,
            });
          } catch (error) {
            console.error('Failed to read pasted image:', error);
          }
        }
      }
    }

    if (newImages.length > 0) {
      setImages([...images, ...newImages]);
    }
  };

  // Remove an image
  const removeImage = (id: string) => {
    setImages(images.filter(img => img.id !== id));
  };

  // Start voice recording
  const startRecording = async () => {
    try {
      // Use Web Speech API directly for simpler UX
      // (If OpenAI API key is configured on server, we could detect and use MediaRecorder instead)
      await startWebSpeechRecording();
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Failed to start voice input. Please ensure microphone permissions are granted.');
    }
  };

  // Stop voice recording
  const stopRecording = () => {
    stopWebSpeechRecording();
  };

  // Start Web Speech API recording directly
  const startWebSpeechRecording = async () => {
    return new Promise<void>((resolve, reject) => {
      // Check if Web Speech API is available
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        alert('Speech recognition is not supported in this browser.');
        reject(new Error('Speech recognition not supported'));
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true; // Keep listening until manually stopped
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        console.log('Voice input started - speak now...');
        keepRecordingRef.current = true;
        setIsRecording(true);
        resolve();
      };

      recognition.onresult = (event: any) => {
        // Collect only NEW transcripts since last onresult event
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript + ' ';
          }
        }

        if (transcript.trim()) {
          // Use inputRef.current to get the latest input value (avoids stale closure)
          const currentInput = inputRef.current;
          let newTranscript = transcript.trim();
          let shouldAutoSubmit = false;

          // Check for voice command keywords at the end of the transcript
          // Use voiceKeywordsRef to get latest keywords (avoids stale closure)
          const keywords = voiceKeywordsRef.current;
          console.log('[Voice] Checking transcript:', newTranscript);
          console.log('[Voice] Active keywords:', keywords);

          if (keywords.length > 0) {
            const lowerTranscript = newTranscript.toLowerCase();
            for (const keyword of keywords) {
              // Check if transcript ends with the keyword (with optional trailing punctuation)
              const keywordPattern = new RegExp(`\\b${keyword}[.!?,;:\\s]*$`, 'i');
              console.log('[Voice] Testing keyword:', keyword, 'Pattern:', keywordPattern, 'Match:', keywordPattern.test(lowerTranscript));
              if (keywordPattern.test(lowerTranscript)) {
                // Remove the keyword from the end of the transcript
                newTranscript = newTranscript.replace(keywordPattern, '').trim();
                shouldAutoSubmit = true;
                console.log('[Voice] Keyword matched! Will auto-submit. New transcript:', newTranscript);
                break;
              }
            }
          }

          const newText = currentInput ? `${currentInput}\n${newTranscript}` : newTranscript;
          setInput(newText);

          // Auto-submit if keyword was detected (keep recording active)
          if (shouldAutoSubmit && newText.trim()) {
            // Trigger submit after a brief delay to ensure state is updated
            // Note: We intentionally do NOT stop recording - user can continue speaking
            setTimeout(() => {
              // Use the form ref to submit, or find the submit button
              const submitBtn = formRef.current?.querySelector('button[type="submit"]') as HTMLButtonElement;
              if (submitBtn) {
                console.log('[Voice] Clicking submit button (recording continues)');
                submitBtn.click();
                // Clear inputRef after submit so next speech segment starts fresh
                // This prevents concatenation with previous submitted text
                inputRef.current = '';
              } else {
                console.log('[Voice] No submit button found, trying form dispatch');
                formRef.current?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                inputRef.current = '';
              }
            }, 150);
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          alert(`Speech recognition error: ${event.error}`);
        }
        setIsRecording(false);
        mediaRecorderRef.current = null;
      };

      recognition.onend = () => {
        console.log('Voice input ended, keepRecording:', keepRecordingRef.current);
        // If we want to keep recording (auto-submit mode), restart recognition
        if (keepRecordingRef.current && mediaRecorderRef.current) {
          console.log('Restarting recognition to keep recording active...');
          try {
            recognition.start();
            // Don't set isRecording to false - we're continuing
            return;
          } catch (error) {
            console.error('Failed to restart recognition:', error);
          }
        }
        setIsRecording(false);
        mediaRecorderRef.current = null;
      };

      // Store recognition instance so we can stop it later
      mediaRecorderRef.current = recognition as any;

      // Start recognition
      try {
        recognition.start();
      } catch (error) {
        console.error('Failed to start speech recognition:', error);
        alert('Failed to start speech recognition. Please try again.');
        reject(error);
      }
    });
  };

  // Stop Web Speech API recording
  const stopWebSpeechRecording = () => {
    const recognition = mediaRecorderRef.current as any;
    if (recognition && recognition.stop) {
      // Set flag to false so onend doesn't restart recording
      keepRecordingRef.current = false;
      try {
        recognition.stop();
      } catch (error) {
        console.error('Error stopping recognition:', error);
      }
      setIsRecording(false);
    }
  };

  // Toggle recording on/off
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Fetch branches for the selected repository
  const fetchBranches = async () => {
    if (!selectedRepo) return;

    // Parse owner and repo from the clone URL
    // Example: https://github.com/owner/repo.git
    const match = selectedRepo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return;

    const [, owner, repo] = match;

    setIsLoadingBranches(true);
    try {
      const response = await githubApi.getBranches(owner, repo);
      const branchNames = response.data.map((b: any) => b.name);
      setBranches(branchNames);
      setIsBranchDropdownOpen(true);
    } catch (error) {
      console.error('Failed to fetch branches:', error);
      alert('Failed to fetch branches. Please try again.');
    } finally {
      setIsLoadingBranches(false);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (isRepoDropdownOpen && !target.closest('.repo-dropdown')) {
        setIsRepoDropdownOpen(false);
        setRepoSearchQuery('');
      }

      if (isBranchDropdownOpen && !target.closest('.branch-dropdown')) {
        setIsBranchDropdownOpen(false);
        setBranchSearchQuery('');
      }
    };

    if (isRepoDropdownOpen || isBranchDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isRepoDropdownOpen, isBranchDropdownOpen]);

  // Expose focus method to parent component
  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  return (
    <form ref={formRef} onSubmit={onSubmit} className={centered ? 'w-full max-w-3xl' : 'max-w-4xl mx-auto w-full'}>
      {/* Image previews */}
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((image) => (
            <div key={image.id} className="relative group">
              <img
                src={`data:${image.mediaType};base64,${image.data}`}
                alt={image.fileName}
                className="h-20 w-20 object-cover rounded-lg border border-base-300"
              />
              <button
                type="button"
                onClick={() => removeImage(image.id)}
                className="absolute -top-2 -right-2 bg-error text-error-content rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove image"
              >
                ×
              </button>
              <div className="text-xs text-base-content/70 mt-1 max-w-[80px] truncate">
                {image.fileName}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Multi-line input with controls and submit button inside */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          placeholder="Describe what you want to code... (paste images, use voice input, or attach files)"
          rows={centered ? 6 : 4}
          className={`textarea textarea-bordered w-full shadow-lg resize-none pr-36 p-4 pb-16 ${centered ? 'text-lg' : 'text-base'}`}
          disabled={isExecuting || !user?.claudeAuth}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Shift+Enter → always insert new line (default behavior)
              if (e.shiftKey) {
                return;
              }

              // Cmd/Ctrl+Enter → always submit
              if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                onSubmit(e);
                return;
              }

              // Plain Enter → submit only if cursor is at the end
              const textarea = e.currentTarget as HTMLTextAreaElement;
              const cursorPos = textarea.selectionStart;
              const textLength = textarea.value.length;

              if (cursorPos === textLength) {
                e.preventDefault();
                onSubmit(e);
              }
              // Otherwise, allow default behavior (insert new line)
            }
          }}
        />

        {/* Controls inside the box */}
        <div className="absolute bottom-3 left-3 right-14 flex flex-wrap gap-2 items-center">
          {!hideRepoSelection && hasGithubAuth && (
            <>
              {isLoadingRepos ? (
                /* Skeleton loading state */
                <>
                  <div className="skeleton h-6 w-32"></div>
                  <div className="skeleton h-6 w-24"></div>
                  <div className="skeleton h-4 w-28"></div>
                </>
              ) : repositories.length > 0 ? (
                /* Actual controls or labels */
                <>
                  {isExecuting || isLocked ? (
                    /* Show as text labels when executing or locked */
                    <>
                      <span className="badge badge-ghost text-xs">
                        {selectedRepo
                          ? sortedRepositories.find((r) => r.cloneUrl === selectedRepo)?.fullName ||
                            'No repository'
                          : 'No repository'}
                      </span>
                      {baseBranch && (
                        <span className="badge badge-ghost text-xs">
                          {baseBranch}
                        </span>
                      )}
                    </>
                  ) : (
                    /* Show as editable controls when not executing and not locked */
                    <>
                      {/* Custom dropdown with search */}
                      <div className="relative repo-dropdown">
                        <button
                          type="button"
                          onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
                          className="btn btn-sm btn-outline normal-case h-7 min-h-0 px-3"
                          disabled={isExecuting || isLocked}
                        >
                          {selectedRepo
                            ? sortedRepositories.find((r) => r.cloneUrl === selectedRepo)?.fullName ||
                              'No repository'
                            : 'No repository'}
                          <svg className="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {isRepoDropdownOpen && (
                          <div className="absolute bottom-full left-0 mb-2 w-64 max-h-80 bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
                            {/* Search input */}
                            <div className="p-2 sticky top-0 bg-base-100 border-b border-base-300">
                              <input
                                type="text"
                                placeholder="Search repositories..."
                                value={repoSearchQuery}
                                onChange={(e) => setRepoSearchQuery(e.target.value)}
                                className="input input-bordered input-xs w-full"
                                autoFocus
                              />
                            </div>
                            {/* Repository list */}
                            <div className="overflow-y-auto max-h-64">
                              {/* No repository option */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setSelectedRepo('');
                                  setIsRepoDropdownOpen(false);
                                  setRepoSearchQuery('');
                                }}
                                className={`w-full text-left px-4 py-2 text-sm hover:bg-base-200 ${!selectedRepo ? 'bg-primary/10 font-semibold' : ''}`}
                              >
                                No repository
                              </button>
                              {/* Filtered repositories */}
                              {filteredRepositories.length > 0 ? (
                                filteredRepositories.map((repo) => (
                                  <button
                                    key={repo.id}
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setSelectedRepo(repo.cloneUrl);
                                      setIsRepoDropdownOpen(false);
                                      setRepoSearchQuery('');
                                    }}
                                    className={`w-full text-left px-4 py-2 text-sm hover:bg-base-200 ${selectedRepo === repo.cloneUrl ? 'bg-primary/10 font-semibold' : ''}`}
                                  >
                                    {repo.fullName}
                                  </button>
                                ))
                              ) : (
                                <div className="p-4 text-xs text-base-content/50 text-center">
                                  No repositories found
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Only show branch inputs when repository is selected */}
                      {selectedRepo && (
                        <>
                          {/* Base Branch */}
                          <div className="relative branch-dropdown">
                            <button
                              type="button"
                              onClick={() => {
                                if (!isBranchDropdownOpen && branches.length === 0) {
                                  fetchBranches();
                                } else {
                                  setIsBranchDropdownOpen(!isBranchDropdownOpen);
                                }
                              }}
                              disabled={isExecuting || isLocked || isLoadingBranches}
                              className="btn btn-sm btn-outline normal-case h-7 min-h-0 px-3"
                              title="Select base branch"
                            >
                              <span className="text-xs text-base-content/70 font-medium mr-1">Base Branch:</span>
                              {isLoadingBranches ? (
                                <>
                                  <span className="loading loading-spinner loading-xs"></span>
                                </>
                              ) : (
                                <>
                                  {baseBranch || 'main'}
                                  <svg className="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </>
                              )}
                            </button>
                            {isBranchDropdownOpen && (
                              <div className="absolute bottom-full left-0 mb-2 w-64 max-h-80 bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
                                {/* Search input */}
                                <div className="p-2 sticky top-0 bg-base-100 border-b border-base-300">
                                  <input
                                    type="text"
                                    placeholder="Search branches..."
                                    value={branchSearchQuery}
                                    onChange={(e) => setBranchSearchQuery(e.target.value)}
                                    className="input input-bordered input-xs w-full"
                                    autoFocus
                                  />
                                </div>
                                {/* Branch list */}
                                <div className="overflow-y-auto max-h-64">
                                  {filteredBranches.length > 0 ? (
                                    filteredBranches.map((branchName) => (
                                      <button
                                        key={branchName}
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setBaseBranch?.(branchName);
                                          setIsBranchDropdownOpen(false);
                                          setBranchSearchQuery('');
                                        }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-base-200 ${baseBranch === branchName ? 'bg-primary/10 font-semibold' : ''}`}
                                      >
                                        {branchName}
                                      </button>
                                    ))
                                  ) : (
                                    <div className="p-4 text-xs text-base-content/50 text-center">
                                      {branches.length === 0 ? 'No branches loaded' : 'No branches found'}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : null}
            </>
          )}

          {/* Status indicators - show if not configured */}
          {(!hasGithubAuth || !hasClaudeAuth) && (
            <div className="flex items-center gap-2 text-xs">
              {!hasGithubAuth && (
                <Link
                  to="/settings"
                  className="badge badge-warning gap-1"
                  title="GitHub integration required for repository features"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                  </svg>
                  <span>Connect GitHub</span>
                </Link>
              )}
              {!hasClaudeAuth && (
                <Link
                  to="/settings"
                  className="badge badge-warning gap-1"
                  title="Claude credentials required to use this service"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Add Credentials</span>
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Voice, Image attach, and Submit buttons inside textarea */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Microphone button */}
          <button
            type="button"
            onClick={toggleRecording}
            disabled={isExecuting || !user?.claudeAuth}
            className={`flex items-center justify-center w-10 h-10 rounded-full shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white focus:ring-red-400 animate-pulse'
                : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 focus:ring-gray-400'
            }`}
            title={
              isRecording
                ? 'Tap to stop recording'
                : 'Tap to start voice input'
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
            >
              {isRecording ? (
                /* Stop icon when recording */
                <rect x="6" y="6" width="12" height="12" rx="2" />
              ) : (
                /* Microphone icon when not recording */
                <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
              )}
              {!isRecording && (
                <>
                  <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
                </>
              )}
            </svg>
          </button>

          {/* Attach image button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isExecuting || !user?.claudeAuth}
            className="btn btn-circle btn-ghost"
            title="Attach image"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Submit button */}
          <button
            type="submit"
            disabled={isExecuting || (!input.trim() && images.length === 0) || !user?.claudeAuth}
            className="btn btn-primary btn-circle"
            title="Send message (Enter at end, Cmd/Ctrl+Enter, or click)"
          >
            {isExecuting ? (
              <span className="loading loading-spinner loading-sm"></span>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </form>
  );
});

ChatInput.displayName = 'ChatInput';

export default ChatInput;
