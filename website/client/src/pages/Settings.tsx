import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { githubApi, userApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useBrowserNotification, getNotificationPrefs, setNotificationPrefs } from '@/hooks/useBrowserNotification';

// Pre-defined voice command keywords that cannot be deleted
const DEFAULT_KEYWORDS = ['over', 'submit', 'enter', 'period'];

// Tab definitions
type SettingsTab = 'account' | 'connections' | 'ai' | 'preferences';

const TABS: { id: SettingsTab; label: string; icon: JSX.Element }[] = [
  {
    id: 'account',
    label: 'Account',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>
    ),
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M9.01 14H2v2h7.01v3L13 15l-3.99-4v3zm5.98-1v-3H22V8h-7.01V5L11 9l3.99 4z"/>
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI Settings',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/>
      </svg>
    ),
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
    ),
  },
];

export default function Settings() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Get active tab from URL or default to 'account'
  const activeTab = (searchParams.get('tab') as SettingsTab) || 'account';

  // Get origin from URL params (where user came from - 'editor' or 'hub')
  const origin = searchParams.get('from') as 'editor' | 'hub' | null;

  const [claudeAuthJson, setClaudeAuthJson] = useState('');
  const [claudeError, setClaudeError] = useState('');
  const [codexAuthJson, setCodexAuthJson] = useState('');
  const [codexError, setCodexError] = useState('');
  const [geminiAuthJson, setGeminiAuthJson] = useState('');
  const [geminiError, setGeminiError] = useState('');
  const [preferredProvider, setPreferredProvider] = useState<'claude' | 'codex' | 'gemini'>(user?.preferredProvider as any || 'claude');
  const [imageResizeDimension, setImageResizeDimension] = useState(user?.imageResizeMaxDimension || 1024);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [defaultLandingPage, setDefaultLandingPage] = useState<'store' | 'library' | 'community' | 'sessions'>(user?.defaultLandingPage || 'store');
  const [preferredModel, setPreferredModel] = useState(user?.preferredModel || '');
  const [chatVerbosity, setChatVerbosity] = useState<'minimal' | 'normal' | 'verbose'>(user?.chatVerbosityLevel || 'verbose');

  // Voice command keywords state
  const [voiceKeywords, setVoiceKeywords] = useState<string[]>(user?.voiceCommandKeywords || []);
  const [newKeyword, setNewKeyword] = useState('');
  const [isKeywordDropdownOpen, setIsKeywordDropdownOpen] = useState(false);
  const keywordDropdownRef = useRef<HTMLDivElement>(null);

  // Browser notification state
  const { permission, isSupported, requestPermission } = useBrowserNotification();
  const [notificationPrefs, setNotificationPrefsState] = useState(getNotificationPrefs);

  // Handle tab change
  const setActiveTab = (tab: SettingsTab) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab);
    setSearchParams(newParams);
  };

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

  useEffect(() => {
    setDefaultLandingPage(user?.defaultLandingPage || 'store');
  }, [user?.defaultLandingPage]);

  useEffect(() => {
    setPreferredModel(user?.preferredModel || '');
  }, [user?.preferredModel]);

  useEffect(() => {
    setPreferredProvider(user?.preferredProvider || 'claude');
  }, [user?.preferredProvider]);

  useEffect(() => {
    setChatVerbosity(user?.chatVerbosityLevel || 'verbose');
  }, [user?.chatVerbosityLevel]);

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

  const saveCodexAuth = useMutation({
    mutationFn: userApi.updateCodexAuth,
    onSuccess: async () => {
      await refreshUserSession();
      setCodexAuthJson('');
      alert('Codex authentication saved successfully');
    },
    onError: (error) => {
      setCodexError(error instanceof Error ? error.message : 'Failed to save Codex auth');
    },
  });

  const removeCodexAuth = useMutation({
    mutationFn: userApi.removeCodexAuth,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Codex authentication removed successfully');
    },
    onError: (error) => {
      alert(`Failed to remove Codex authentication: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const saveGeminiAuth = useMutation({
    mutationFn: userApi.updateGeminiAuth,
    onSuccess: async () => {
      await refreshUserSession();
      setGeminiAuthJson('');
      alert('Gemini OAuth authentication saved successfully');
    },
    onError: (error) => {
      setGeminiError(error instanceof Error ? error.message : 'Failed to save Gemini auth');
    },
  });

  const removeGeminiAuth = useMutation({
    mutationFn: userApi.removeGeminiAuth,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Gemini authentication removed successfully');
    },
    onError: (error) => {
      alert(`Failed to remove Gemini authentication: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const updatePreferredProviderMutation = useMutation({
    mutationFn: userApi.updatePreferredProvider,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Preferred AI provider updated successfully');
    },
    onError: (error) => {
      alert(`Failed to update preferred provider: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  const updateStopListeningAfterSubmit = useMutation({
    mutationFn: userApi.updateStopListeningAfterSubmit,
    onSuccess: async () => {
      await refreshUserSession();
    },
    onError: (error) => {
      alert(`Failed to update stop listening preference: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const updateDefaultLandingPage = useMutation({
    mutationFn: userApi.updateDefaultLandingPage,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Default landing page updated successfully');
    },
    onError: (error) => {
      alert(`Failed to update default landing page: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const updatePreferredModel = useMutation({
    mutationFn: userApi.updatePreferredModel,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Preferred model updated successfully');
    },
    onError: (error) => {
      alert(`Failed to update preferred model: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const updateChatVerbosity = useMutation({
    mutationFn: userApi.updateChatVerbosity,
    onSuccess: async () => {
      await refreshUserSession();
      alert('Chat verbosity updated successfully');
    },
    onError: (error) => {
      alert(`Failed to update chat verbosity: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  const handleCodexAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodexError('');

    try {
      const parsed = JSON.parse(codexAuthJson);
      // Validate it has either apiKey or accessToken
      if (!parsed.apiKey && !parsed.accessToken) {
        setCodexError('Must include either apiKey or accessToken');
        return;
      }
      saveCodexAuth.mutate(parsed);
    } catch (error) {
      setCodexError('Invalid JSON format');
    }
  };

  const handleGeminiAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeminiError('');

    try {
      const parsed = JSON.parse(geminiAuthJson);
      // Support both camelCase and snake_case (from Gemini CLI)
      const accessToken = parsed.accessToken || parsed.access_token;
      const refreshToken = parsed.refreshToken || parsed.refresh_token;

      if (!accessToken || !refreshToken) {
        setGeminiError('Must include accessToken/access_token and refreshToken/refresh_token. Paste the contents of ~/.gemini/oauth_creds.json');
        return;
      }
      saveGeminiAuth.mutate(parsed);
    } catch (error) {
      setGeminiError('Invalid JSON format. Paste the contents of ~/.gemini/oauth_creds.json');
    }
  };

  // Handle back navigation based on origin
  const handleBack = () => {
    if (origin === 'editor') {
      navigate('/sessions');
    } else {
      navigate('/store');
    }
  };

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'account':
        return (
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
          </div>
        );

      case 'connections':
        return (
          <div className="space-y-6">
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
                      <div className="flex gap-2">
                        <button
                          onClick={githubApi.connect}
                          className="btn btn-sm btn-neutral"
                          title="Update OAuth settings"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Settings
                        </button>
                        <button
                          onClick={() => disconnectGitHub.mutate()}
                          disabled={disconnectGitHub.isPending}
                          className="btn btn-sm btn-error"
                        >
                          Disconnect
                        </button>
                      </div>
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

            {/* Codex Authentication (OpenAI) */}
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title">
                  OpenAI Codex Authentication
                </h2>

                {user?.codexAuth ? (
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
                        Codex credentials configured
                      </span>
                      <button
                        onClick={() => removeCodexAuth.mutate()}
                        disabled={removeCodexAuth.isPending}
                        className="btn btn-sm btn-error"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-base-content/70">
                        Auth Type: {user.codexAuth.apiKey ? 'API Key' : 'OAuth Token'}
                      </p>
                      {user.codexAuth.expiresAt && (
                        <div className="text-xs">
                          <span className="text-base-content/70">Access Token: </span>
                          <span className={getExpirationStatus(user.codexAuth.expiresAt).color}>
                            {getExpirationStatus(user.codexAuth.expiresAt).text}
                          </span>
                          <span className="text-base-content/70">
                            {' '}
                            (expires {formatTokenExpiration(user.codexAuth.expiresAt)})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-base-content/70">
                      Paste your OpenAI Codex credentials JSON. You can use either an API key or OAuth tokens from a ChatGPT subscription.
                    </p>

                    <form onSubmit={handleCodexAuthSubmit} className="space-y-4">
                      <div>
                        <label className="label">
                          <span className="label-text">Codex Auth JSON</span>
                        </label>
                        <textarea
                          value={codexAuthJson}
                          onChange={(e) => setCodexAuthJson(e.target.value)}
                          placeholder='{"apiKey":"sk-..."} or {"accessToken":"...","refreshToken":"...","expiresAt":123456789}'
                          rows={4}
                          className="textarea textarea-bordered w-full font-mono text-xs"
                        />
                        {codexError && (
                          <label className="label">
                            <span className="label-text-alt text-error">{codexError}</span>
                          </label>
                        )}
                      </div>

                      <button
                        type="submit"
                        className="btn btn-primary"
                      >
                        Save Codex Credentials
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>

            {/* Gemini Authentication (Google) */}
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title">
                  Google Gemini Authentication
                </h2>

                {user?.geminiAuth ? (
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
                        Gemini OAuth configured
                      </span>
                      <button
                        onClick={() => removeGeminiAuth.mutate()}
                        disabled={removeGeminiAuth.isPending}
                        className="btn btn-sm btn-error"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-base-content/70">
                        Auth Type: OAuth (Pro model access)
                      </p>
                      {user.geminiAuth.expiresAt && (
                        <div className="text-xs">
                          <span className="text-base-content/70">Access Token: </span>
                          <span className={getExpirationStatus(user.geminiAuth.expiresAt).color}>
                            {getExpirationStatus(user.geminiAuth.expiresAt).text}
                          </span>
                          <span className="text-base-content/70">
                            {' '}
                            (expires {formatTokenExpiration(user.geminiAuth.expiresAt)})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-base-content/70">
                      Gemini requires OAuth authentication for Pro model access. Run <code className="bg-base-200 px-1 rounded">gemini auth login</code> locally, then paste the contents of <code className="bg-base-200 px-1 rounded">~/.gemini/oauth_creds.json</code>.
                    </p>

                    <div className="alert alert-info">
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <div className="text-sm">
                        <p className="font-medium">How to get Gemini credentials:</p>
                        <ol className="list-decimal list-inside mt-1 space-y-1">
                          <li>Install Gemini CLI: <code className="bg-base-200 px-1 rounded">npm install -g @anthropic-ai/gemini-cli</code></li>
                          <li>Run: <code className="bg-base-200 px-1 rounded">gemini auth login</code></li>
                          <li>Complete Google OAuth in browser</li>
                          <li>Copy contents of <code className="bg-base-200 px-1 rounded">~/.gemini/oauth_creds.json</code></li>
                        </ol>
                      </div>
                    </div>

                    <form onSubmit={handleGeminiAuthSubmit} className="space-y-4">
                      <div>
                        <label className="label">
                          <span className="label-text">Gemini OAuth JSON (paste ~/.gemini/oauth_creds.json)</span>
                        </label>
                        <textarea
                          value={geminiAuthJson}
                          onChange={(e) => setGeminiAuthJson(e.target.value)}
                          placeholder='{"access_token":"ya29.xxx","refresh_token":"1//xxx","token_type":"Bearer","expiry_date":1234567890000}'
                          rows={6}
                          className="textarea textarea-bordered w-full font-mono text-xs"
                        />
                        {geminiError && (
                          <label className="label">
                            <span className="label-text-alt text-error">{geminiError}</span>
                          </label>
                        )}
                      </div>

                      <button
                        type="submit"
                        className="btn btn-primary"
                      >
                        Save Gemini Credentials
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'ai':
        return (
          <div className="space-y-6">
            {/* Preferred AI Provider */}
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title mb-2">Preferred AI Provider</h2>

                <div className="space-y-6">
                  <p className="text-sm text-base-content/70 leading-relaxed">
                    Choose your preferred AI provider for coding sessions. Claude (Anthropic), Codex (OpenAI), and Gemini (Google) are supported.
                  </p>

                  <div className="divider my-4"></div>

                  <div className="form-control w-full">
                    <div className="mb-3">
                      <span className="font-medium text-base text-base-content">AI Provider</span>
                    </div>
                    <select
                      value={preferredProvider}
                      onChange={(e) => setPreferredProvider(e.target.value as 'claude' | 'codex' | 'gemini')}
                      className="select select-bordered w-full max-w-md"
                    >
                      <option value="claude">Claude (Anthropic) - Default</option>
                      <option value="codex">Codex (OpenAI)</option>
                      <option value="gemini">Gemini (Google)</option>
                    </select>
                    <div className="mt-2">
                      <span className="text-sm text-base-content/60">
                        {preferredProvider === 'claude' && !user?.claudeAuth && (
                          <span className="text-warning">⚠️ Claude credentials not configured</span>
                        )}
                        {preferredProvider === 'codex' && !user?.codexAuth && (
                          <span className="text-warning">⚠️ Codex credentials not configured</span>
                        )}
                        {preferredProvider === 'gemini' && !user?.geminiAuth && (
                          <span className="text-warning">⚠️ Gemini credentials not configured</span>
                        )}
                        {((preferredProvider === 'claude' && user?.claudeAuth) ||
                          (preferredProvider === 'codex' && user?.codexAuth) ||
                          (preferredProvider === 'gemini' && user?.geminiAuth)) && (
                          <span className="text-success">✓ Credentials configured</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-start pt-2">
                    <button
                      onClick={() => updatePreferredProviderMutation.mutate(preferredProvider)}
                      disabled={updatePreferredProviderMutation.isPending || preferredProvider === user?.preferredProvider}
                      className="btn btn-primary min-w-[140px]"
                    >
                      {updatePreferredProviderMutation.isPending ? 'Saving...' : 'Save Setting'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Preferred Model */}
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title mb-2">Preferred AI Model</h2>

                <div className="space-y-6">
                  <p className="text-sm text-base-content/70 leading-relaxed">
                    Choose your preferred AI model for coding sessions. This setting will be used for all new sessions.
                  </p>

                  <div className="divider my-4"></div>

                  <div className="form-control w-full">
                    <div className="mb-3">
                      <span className="font-medium text-base text-base-content">Model Selection</span>
                    </div>
                    <select
                      value={preferredModel}
                      onChange={(e) => setPreferredModel(e.target.value)}
                      className="select select-bordered w-full max-w-md"
                    >
                      <option value="">Default (empty)</option>
                      <option value="opus">Opus (opus)</option>
                      <option value="sonnet">Sonnet (sonnet)</option>
                    </select>
                    <div className="mt-2">
                      <span className="text-sm text-base-content/60">
                        Default uses the system's automatic model selection
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-start pt-2">
                    <button
                      onClick={() => updatePreferredModel.mutate(preferredModel)}
                      disabled={updatePreferredModel.isPending || preferredModel === (user?.preferredModel || '')}
                      className="btn btn-primary min-w-[140px]"
                    >
                      {updatePreferredModel.isPending ? 'Saving...' : 'Save Setting'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'preferences':
        return (
          <div className="space-y-6">
            {/* Chat Verbosity */}
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title mb-2">Chat Verbosity</h2>

                <div className="space-y-6">
                  <p className="text-sm text-base-content/70 leading-relaxed">
                    Control how much detail is shown during coding sessions. This affects the progress messages displayed while the AI is working.
                  </p>

                  <div className="divider my-4"></div>

                  <div className="form-control w-full">
                    <div className="mb-3">
                      <span className="font-medium text-base text-base-content">Detail Level</span>
                    </div>
                    <select
                      value={chatVerbosity}
                      onChange={(e) => setChatVerbosity(e.target.value as 'minimal' | 'normal' | 'verbose')}
                      className="select select-bordered w-full max-w-md"
                    >
                      <option value="minimal">Minimal - Only show final results and errors</option>
                      <option value="normal">Normal - Show key milestones and status updates</option>
                      <option value="verbose">Verbose - Show all operations (current behavior)</option>
                    </select>
                    <div className="mt-2">
                      <span className="text-sm text-base-content/60">
                        {chatVerbosity === 'minimal' && 'Hides all progress messages, only shows user messages, AI responses, and errors'}
                        {chatVerbosity === 'normal' && 'Shows branch creation, commits, and key status updates, hides individual file operations'}
                        {chatVerbosity === 'verbose' && 'Shows every file read, write, edit, and command execution'}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-start pt-2">
                    <button
                      onClick={() => updateChatVerbosity.mutate(chatVerbosity)}
                      disabled={updateChatVerbosity.isPending || chatVerbosity === user?.chatVerbosityLevel}
                      className="btn btn-primary min-w-[140px]"
                    >
                      {updateChatVerbosity.isPending ? 'Saving...' : 'Save Setting'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Default Landing Page */}
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title mb-2">Default Landing Page</h2>

                <div className="space-y-6">
                  <p className="text-sm text-base-content/70 leading-relaxed">
                    Choose which page to show when you first log in or click the app logo. This becomes your home page.
                  </p>

                  <div className="divider my-4"></div>

                  <div className="form-control w-full">
                    <div className="mb-3">
                      <span className="font-medium text-base text-base-content">Landing Page</span>
                    </div>
                    <select
                      value={defaultLandingPage}
                      onChange={(e) => setDefaultLandingPage(e.target.value as 'store' | 'library' | 'community' | 'sessions')}
                      className="select select-bordered w-full max-w-md"
                    >
                      <option value="store">Store - Browse available items and tools</option>
                      <option value="library">Library - Your purchased items</option>
                      <option value="community">Community - Shared community items</option>
                      <option value="sessions">Sessions - Your coding sessions</option>
                    </select>
                    <div className="mt-2">
                      <span className="text-sm text-base-content/60">
                        You can always navigate between pages using the menu
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-start pt-2">
                    <button
                      onClick={() => updateDefaultLandingPage.mutate(defaultLandingPage)}
                      disabled={updateDefaultLandingPage.isPending || defaultLandingPage === user?.defaultLandingPage}
                      className="btn btn-primary min-w-[140px]"
                    >
                      {updateDefaultLandingPage.isPending ? 'Saving...' : 'Save Setting'}
                    </button>
                  </div>
                </div>
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

            {/* Browser Notifications */}
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title mb-2">Browser Notifications</h2>

                <div className="space-y-6">
                  <p className="text-sm text-base-content/70 leading-relaxed">
                    Get notified when your coding sessions complete. Notifications only appear when the browser tab is not focused.
                  </p>

                  <div className="divider my-4"></div>

                  {/* Permission Status */}
                  <div className="form-control w-full">
                    <div className="mb-3">
                      <span className="font-medium text-base text-base-content">Notification Permission</span>
                    </div>
                    {!isSupported ? (
                      <div className="alert alert-warning">
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm">Your browser does not support notifications</span>
                      </div>
                    ) : permission === 'granted' ? (
                      <div className="alert alert-success">
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm">Notifications are enabled</span>
                      </div>
                    ) : permission === 'denied' ? (
                      <div className="alert alert-error">
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm">Notifications blocked. Please enable them in your browser settings.</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <button
                          onClick={requestPermission}
                          className="btn btn-primary"
                        >
                          <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                          Enable Notifications
                        </button>
                        <span className="text-sm text-base-content/60">
                          Click to allow browser notifications
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Notification Preferences (only show if permission granted) */}
                  {isSupported && permission === 'granted' && (
                    <>
                      <div className="divider my-4"></div>

                      <div className="form-control">
                        <label className="label cursor-pointer justify-start gap-4">
                          <input
                            type="checkbox"
                            checked={notificationPrefs.enabled}
                            onChange={(e) => {
                              const newPrefs = { ...notificationPrefs, enabled: e.target.checked };
                              setNotificationPrefsState(newPrefs);
                              setNotificationPrefs(newPrefs);
                            }}
                            className="checkbox checkbox-primary"
                          />
                          <div>
                            <span className="label-text font-medium">Enable notifications</span>
                            <p className="text-sm text-base-content/60">Master toggle for all browser notifications</p>
                          </div>
                        </label>
                      </div>

                      <div className="form-control">
                        <label className="label cursor-pointer justify-start gap-4">
                          <input
                            type="checkbox"
                            checked={notificationPrefs.onSessionComplete}
                            onChange={(e) => {
                              const newPrefs = { ...notificationPrefs, onSessionComplete: e.target.checked };
                              setNotificationPrefsState(newPrefs);
                              setNotificationPrefs(newPrefs);
                            }}
                            disabled={!notificationPrefs.enabled}
                            className="checkbox checkbox-primary"
                          />
                          <div>
                            <span className={`label-text font-medium ${!notificationPrefs.enabled ? 'opacity-50' : ''}`}>
                              Session completion
                            </span>
                            <p className={`text-sm text-base-content/60 ${!notificationPrefs.enabled ? 'opacity-50' : ''}`}>
                              Notify when a coding session finishes processing
                            </p>
                          </div>
                        </label>
                      </div>
                    </>
                  )}
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

            {/* Stop Listening After Submit */}
            <div className="card bg-base-100 shadow">
              <div className="card-body">
                <h2 className="card-title mb-2">Voice Recording Behavior</h2>
                <div className="form-control">
                  <label className="label cursor-pointer justify-start gap-4">
                    <input
                      type="checkbox"
                      checked={user?.stopListeningAfterSubmit ?? false}
                      onChange={(e) => updateStopListeningAfterSubmit.mutate(e.target.checked)}
                      disabled={updateStopListeningAfterSubmit.isPending}
                      className="checkbox checkbox-primary"
                    />
                    <div className="flex flex-col">
                      <span className="label-text font-medium">Stop listening after voice submission</span>
                      <span className="label-text-alt text-base-content/60">
                        When enabled, the microphone will stop recording after your voice message is submitted
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header with back button */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={handleBack}
          className="btn btn-ghost btn-sm gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to {origin === 'editor' ? 'Sessions' : 'Store'}
        </button>
      </div>

      <h1 className="text-3xl font-bold text-base-content mb-6">Settings</h1>

      {/* Tabs */}
      <div className="tabs tabs-boxed bg-base-100 mb-6 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab gap-2 flex-1 ${activeTab === tab.id ? 'tab-active' : ''}`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {renderTabContent()}
    </div>
  );
}
