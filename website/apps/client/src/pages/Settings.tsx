import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { githubApi, userApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

// Pre-defined voice command keywords that cannot be deleted
const DEFAULT_KEYWORDS = ['over', 'submit', 'enter', 'period'];

export default function Settings() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [claudeAuthJson, setClaudeAuthJson] = useState('');
  const [claudeError, setClaudeError] = useState('');
  const [imageResizeDimension, setImageResizeDimension] = useState(user?.imageResizeMaxDimension || 1024);
  const [displayName, setDisplayName] = useState(user?.displayName || '');

  // Voice command keywords state
  const [voiceKeywords, setVoiceKeywords] = useState<string[]>(user?.voiceCommandKeywords || []);
  const [newKeyword, setNewKeyword] = useState('');
  const [isKeywordDropdownOpen, setIsKeywordDropdownOpen] = useState(false);
  const keywordDropdownRef = useRef<HTMLDivElement>(null);

  // Format token expiration time
  const formatTokenExpiration = (expiresAt: number) => {
    const date = new Date(expiresAt);
    return date.toLocaleString();
  };

  // Check token expiration status
  const getExpirationStatus = (expiresAt: number) => {
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    const fiveMinutes = 5 * 60 * 1000;
    const oneHour = 60 * 60 * 1000;

    if (timeUntilExpiry <= 0) {
      return { text: 'Expired', color: 'text-error', urgent: true };
    } else if (timeUntilExpiry <= fiveMinutes) {
      return { text: 'Expiring very soon', color: 'text-warning', urgent: true };
    } else if (timeUntilExpiry <= oneHour) {
      return { text: 'Expiring soon', color: 'text-warning', urgent: false };
    } else {
      return { text: 'Active', color: 'text-success', urgent: false };
    }
  };

  const refreshUserSession = async () => {
    try {
      const response = await authApi.getSession();
      setUser(response.data.user);
    } catch (error) {
      console.error('Failed to refresh session:', error);
    }
  };

  // Refresh user data when page loads (for OAuth redirects)
  useEffect(() => {
    refreshUserSession();
  }, []);

  // Update local state when user changes
  useEffect(() => {
    if (user?.imageResizeMaxDimension) {
      setImageResizeDimension(user.imageResizeMaxDimension);
    }
  }, [user?.imageResizeMaxDimension]);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
  }, [user?.displayName]);

  useEffect(() => {
    setVoiceKeywords(user?.voiceCommandKeywords || []);
  }, [user?.voiceCommandKeywords]);

  // Close keyword dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (keywordDropdownRef.current && !keywordDropdownRef.current.contains(event.target as Node)) {
        setIsKeywordDropdownOpen(false);
      }
    };

    if (isKeywordDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isKeywordDropdownOpen]);

  const disconnectGitHub = useMutation({
    mutationFn: githubApi.disconnect,
    onSuccess: async () => {
      await refreshUserSession();
      alert('GitHub disconnected successfully');
    },
    onError: (error) => {
      alert(`Failed to disconnect GitHub: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const saveClaudeAuth = useMutation({
    mutationFn: userApi.updateClaudeAuth,
    onSuccess: async () => {
      await refreshUserSession();
      setClaudeAuthJson('');
      alert('Claude authentication saved successfully');
    },
    onError: (error) => {
      setClaudeError(error instanceof Error ? error.message : 'Failed to save Claude auth');
    },
  });

  const removeClaudeAuth = useMutation({
    mutationFn: userApi.removeClaudeAuth,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Claude authentication removed successfully');
    },
    onError: (error) => {
      alert(`Failed to remove Claude authentication: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const updateImageResizeSetting = useMutation({
    mutationFn: userApi.updateImageResizeSetting,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Image resize setting updated successfully');
    },
    onError: (error) => {
      alert(`Failed to update image resize setting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const updateDisplayName = useMutation({
    mutationFn: userApi.updateDisplayName,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Display name updated successfully');
    },
    onError: (error) => {
      alert(`Failed to update display name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const updateVoiceKeywords = useMutation({
    mutationFn: userApi.updateVoiceCommandKeywords,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Voice command keywords updated successfully');
    },
    onError: (error) => {
      alert(`Failed to update voice command keywords: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  // Helper functions for voice command keywords
  const isDefaultKeyword = (keyword: string) => DEFAULT_KEYWORDS.includes(keyword.toLowerCase());

  const addKeyword = (keyword: string) => {
    const normalized = keyword.trim().toLowerCase();
    if (normalized && !voiceKeywords.includes(normalized)) {
      setVoiceKeywords([...voiceKeywords, normalized]);
    }
    setNewKeyword('');
    setIsKeywordDropdownOpen(false);
  };

  const removeKeyword = (keyword: string) => {
    if (!isDefaultKeyword(keyword)) {
      setVoiceKeywords(voiceKeywords.filter(k => k !== keyword));
    }
  };

  const availableDefaultKeywords = DEFAULT_KEYWORDS.filter(k => !voiceKeywords.includes(k));

  const handleClaudeAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaudeError('');

    try {
      const parsed = JSON.parse(claudeAuthJson);
      // Just validate it's valid JSON - send entire object to backend
      saveClaudeAuth.mutate(parsed);
    } catch (error) {
      setClaudeError('Invalid JSON format');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-base-content mb-8">Settings</h1>

      <div className="space-y-6">
        {/* Account Info */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title">Account</h2>
            <div className="space-y-2">
              <p className="text-sm text-base-content/70">
                <span className="font-medium">Email:</span> {user?.email}
              </p>
              <p className="text-sm text-base-content/70">
                <span className="font-medium">User ID:</span> {user?.id}
              </p>
            </div>
          </div>
        </div>

        {/* Display Name */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title mb-2">Display Name</h2>
            <div className="space-y-4">
              <p className="text-sm text-base-content/70">
                Set a custom display name that will be shown in your profile and chat messages. If not set, your email will be displayed.
              </p>
              <div className="form-control w-full max-w-md">
                <label className="label">
                  <span className="label-text">Display Name</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your display name"
                  className="input input-bordered w-full"
                  maxLength={100}
                />
                <label className="label">
                  <span className="label-text-alt text-base-content/60">
                    {displayName.length}/100 characters
                  </span>
                </label>
              </div>
              <button
                onClick={() => updateDisplayName.mutate(displayName)}
                disabled={updateDisplayName.isPending || displayName === (user?.displayName || '')}
                className="btn btn-primary"
              >
                {updateDisplayName.isPending ? 'Saving...' : 'Save Display Name'}
              </button>
            </div>
          </div>
        </div>

        {/* GitHub Integration */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title">
              GitHub Integration
            </h2>

            {user?.githubAccessToken ? (
              <div className="space-y-4">
                <div className="alert alert-success">
                  <svg
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm">
                    GitHub connected (ID: {user.githubId})
                  </span>
                  <button
                    onClick={() => disconnectGitHub.mutate()}
                    disabled={disconnectGitHub.isPending}
                    className="btn btn-sm btn-error"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-base-content/70">
                  Connect your GitHub account to access repositories and enable automatic commits.
                </p>
                <button
                  onClick={githubApi.connect}
                  className="btn btn-neutral"
                >
                  <svg className="mr-2 h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  Connect GitHub
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Claude Authentication */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title">
              Claude Authentication
            </h2>

            {user?.claudeAuth ? (
              <div className="space-y-4">
                <div className="alert alert-success">
                  <svg
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm">
                    Claude credentials configured
                  </span>
                  <button
                    onClick={() => removeClaudeAuth.mutate()}
                    disabled={removeClaudeAuth.isPending}
                    className="btn btn-sm btn-error"
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-base-content/70">
                    Subscription: {user.claudeAuth.subscriptionType} | Rate Limit:{' '}
                    {user.claudeAuth.rateLimitTier}
                  </p>
                  {user.claudeAuth.expiresAt && (
                    <div className="text-xs">
                      <span className="text-base-content/70">Access Token: </span>
                      <span className={getExpirationStatus(user.claudeAuth.expiresAt).color}>
                        {getExpirationStatus(user.claudeAuth.expiresAt).text}
                      </span>
                      <span className="text-base-content/70">
                        {' '}
                        (expires {formatTokenExpiration(user.claudeAuth.expiresAt)})
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-base-content/70">
                  Paste the entire contents of your Claude credentials JSON file from ai-coding-worker.
                  The system will automatically extract the authentication details.
                </p>

                <form onSubmit={handleClaudeAuthSubmit} className="space-y-4">
                  <div>
                    <label className="label">
                      <span className="label-text">Claude Auth JSON (paste the entire file contents)</span>
                    </label>
                    <textarea
                      value={claudeAuthJson}
                      onChange={(e) => setClaudeAuthJson(e.target.value)}
                      placeholder='{"claudeAiOauth":{"accessToken":"...","refreshToken":"...","expiresAt":123456789,"scopes":[...],"subscriptionType":"...","rateLimitTier":"..."}}'
                      rows={8}
                      className="textarea textarea-bordered w-full font-mono text-xs"
                    />
                    {claudeError && (
                      <label className="label">
                        <span className="label-text-alt text-error">{claudeError}</span>
                      </label>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                  >
                    Save Claude Credentials
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Image Resize Settings */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title mb-2">Image Resize Settings</h2>

            <div className="space-y-6">
              <p className="text-sm text-base-content/70 leading-relaxed">
                Configure the maximum dimension for pasted and uploaded images. Images will be automatically resized to fit within this size while maintaining their aspect ratio.
              </p>

              <div className="divider my-4"></div>

              <div className="form-control w-full">
                <div className="mb-3">
                  <span className="font-medium text-base text-base-content">Maximum Image Dimension</span>
                </div>
                <select
                  value={imageResizeDimension}
                  onChange={(e) => setImageResizeDimension(Number(e.target.value))}
                  className="select select-bordered w-full max-w-md"
                >
                  <option value={512}>512 x 512</option>
                  <option value={1024}>1024 x 1024 (default)</option>
                  <option value={2048}>2048 x 2048</option>
                  <option value={4096}>4096 x 4096</option>
                  <option value={8000}>8000 x 8000 (max)</option>
                </select>
                <div className="mt-2">
                  <span className="text-sm text-base-content/60">
                    Smaller sizes reduce upload time and bandwidth usage
                  </span>
                </div>
              </div>

              <div className="flex justify-start pt-2">
                <button
                  onClick={() => updateImageResizeSetting.mutate(imageResizeDimension)}
                  disabled={updateImageResizeSetting.isPending || imageResizeDimension === user?.imageResizeMaxDimension}
                  className="btn btn-primary min-w-[140px]"
                >
                  {updateImageResizeSetting.isPending ? 'Saving...' : 'Save Setting'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Voice Command Keywords */}
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title mb-2">Voice Command Keywords</h2>

            <div className="space-y-6">
              <p className="text-sm text-base-content/70 leading-relaxed">
                Configure keywords that will automatically submit your voice input when spoken at the end of your message. For example, saying "update the readme file over" will submit "update the readme file" as your request.
              </p>

              <div className="divider my-4"></div>

              {/* Selected Keywords Display */}
              <div className="form-control w-full">
                <div className="mb-3">
                  <span className="font-medium text-base text-base-content">Active Keywords</span>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[2.5rem] p-3 bg-base-200 rounded-lg">
                  {voiceKeywords.length === 0 ? (
                    <span className="text-sm text-base-content/50">No keywords selected. Add keywords below to enable voice auto-submit.</span>
                  ) : (
                    voiceKeywords.map((keyword) => (
                      <span
                        key={keyword}
                        className={`badge gap-1 ${isDefaultKeyword(keyword) ? 'badge-primary' : 'badge-secondary'}`}
                      >
                        {keyword}
                        {!isDefaultKeyword(keyword) && (
                          <button
                            type="button"
                            onClick={() => removeKeyword(keyword)}
                            className="hover:text-error"
                            title="Remove keyword"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </div>
                <div className="mt-2">
                  <span className="text-sm text-base-content/60">
                    Pre-defined keywords (highlighted) cannot be removed
                  </span>
                </div>
              </div>

              {/* Add Keywords Section */}
              <div className="form-control w-full max-w-md" ref={keywordDropdownRef}>
                <div className="mb-3">
                  <span className="font-medium text-base text-base-content">Add Keywords</span>
                </div>

                {/* Dropdown for default keywords */}
                {availableDefaultKeywords.length > 0 && (
                  <div className="relative mb-3">
                    <button
                      type="button"
                      onClick={() => setIsKeywordDropdownOpen(!isKeywordDropdownOpen)}
                      className="btn btn-outline w-full justify-between"
                    >
                      Select from suggested keywords
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isKeywordDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1 w-full bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
                        {availableDefaultKeywords.map((keyword) => (
                          <button
                            key={keyword}
                            type="button"
                            onClick={() => addKeyword(keyword)}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-base-200"
                          >
                            {keyword}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Custom keyword input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newKeyword.trim()) {
                        e.preventDefault();
                        addKeyword(newKeyword);
                      }
                    }}
                    placeholder="Add custom keyword..."
                    className="input input-bordered flex-1"
                    maxLength={30}
                  />
                  <button
                    type="button"
                    onClick={() => addKeyword(newKeyword)}
                    disabled={!newKeyword.trim() || voiceKeywords.includes(newKeyword.trim().toLowerCase())}
                    className="btn btn-ghost btn-square"
                    title="Add keyword"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                <div className="mt-2">
                  <span className="text-sm text-base-content/60">
                    Press Enter or click + to add a custom keyword
                  </span>
                </div>
              </div>

              <div className="flex justify-start pt-2">
                <button
                  onClick={() => updateVoiceKeywords.mutate(voiceKeywords)}
                  disabled={updateVoiceKeywords.isPending || JSON.stringify(voiceKeywords) === JSON.stringify(user?.voiceCommandKeywords || [])}
                  className="btn btn-primary min-w-[140px]"
                >
                  {updateVoiceKeywords.isPending ? 'Saving...' : 'Save Keywords'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
