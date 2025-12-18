import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuthStore, useRepoStore, useSessionLastPageStore, type SessionPageName } from '@/lib/store';
import { authApi, sessionsApi, githubApi } from '@/lib/api';
import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import ThemeSelector from './ThemeSelector';
import MobileMenu from './MobileMenu';
import SessionsSidebar from './SessionsSidebar';
import { VERSION, VERSION_TIMESTAMP, VERSION_SHA, GITHUB_REPO_URL } from '@/version';
import type { GitHubRepository } from '@/shared';
import { truncateSessionName } from '@/lib/utils';
import { TAGLINES } from '@/constants/taglines';

// Helper to extract page name from pathname
function extractPageFromPath(pathname: string): SessionPageName | null {
  if (pathname.includes('/code')) return 'code';
  if (pathname.includes('/images')) return 'images';
  if (pathname.includes('/sound')) return 'sound';
  if (pathname.includes('/scene-editor')) return 'scene-editor';
  if (pathname.includes('/preview')) return 'preview';
  if (pathname.includes('/chat') || pathname.match(/\/session\/[^/]+$/)) return 'chat';
  return null;
}

// Helper to detect mobile devices
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

interface SessionLayoutProps {
  selectedRepo?: string;
  baseBranch?: string;
  branch?: string;
  onRepoChange?: (repo: string) => void;
  onBaseBranchChange?: (branch: string) => void;
  repositories?: GitHubRepository[];
  isLoadingRepos?: boolean;
  isLocked?: boolean;
  titleActions?: React.ReactNode; // Edit and Delete buttons for title line
  prActions?: React.ReactNode; // PR buttons for branch line
  session?: any; // Session data passed from parent to avoid stale data
  isMaximized?: boolean; // When true, hide header and sidebar for full reading mode
  children: React.ReactNode;
}

export default function SessionLayout({
  selectedRepo: selectedRepoProp,
  baseBranch: baseBranchProp,
  branch: branchProp,
  onRepoChange,
  onBaseBranchChange,
  repositories: repositoriesProp,
  isLoadingRepos: isLoadingReposProp,
  isLocked: isLockedProp,
  titleActions,
  prActions,
  session: sessionProp,
  isMaximized = false,
  children,
}: SessionLayoutProps) {
  const { user, isAuthenticated, clearUser } = useAuthStore();
  const repoStore = useRepoStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showVersionDetails, setShowVersionDetails] = useState(false);
  const [splitMenuOpen, setSplitMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const splitMenuRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [branchExpanded, setBranchExpanded] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);

  // Tagline state - starts with random tagline, can be clicked to change
  const [taglineIndex, setTaglineIndex] = useState(() => Math.floor(Math.random() * TAGLINES.length));
  const tagline = TAGLINES[taglineIndex];

  // Function to pick a random tagline
  const nextTagline = () => {
    setTaglineIndex(() => Math.floor(Math.random() * TAGLINES.length));
  };

  // Fetch session data when sessionId exists and no props provided
  // Use sessionProp if available to avoid stale data during updates
  const { data: sessionDataFromQuery } = useQuery({
    queryKey: ['session-for-layout', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.get(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new' && !sessionProp,
  });

  // Prefer sessionProp over fetched data to ensure real-time updates
  const sessionData = sessionProp ? { data: sessionProp } : sessionDataFromQuery;

  // Fetch repositories when needed
  const { data: reposData, isLoading: isLoadingReposQuery } = useQuery({
    queryKey: ['repos'],
    queryFn: githubApi.getRepos,
    enabled: !!user?.githubAccessToken && !!sessionId && !repositoriesProp,
  });

  // Use data with priority: props > store > session data > defaults
  const selectedRepo = selectedRepoProp ?? (repoStore.selectedRepo || sessionData?.data?.repositoryUrl || '');
  const baseBranch = baseBranchProp ?? (repoStore.baseBranch || sessionData?.data?.baseBranch || 'main');
  const branch = branchProp ?? sessionData?.data?.branch ?? '';
  const repositories = repositoriesProp ?? reposData?.data ?? [];
  const isLoadingRepos = isLoadingReposProp ?? isLoadingReposQuery;
  const isLocked = isLockedProp ?? (repoStore.isLocked || (!!sessionId && !!sessionData?.data));

  const handleLogout = async () => {
    try {
      await authApi.logout();
      clearUser();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Handle preview click - open in new tab on mobile if we have a preview URL
  const handlePreviewClick = (e: React.MouseEvent) => {
    if (isMobileDevice() && previewUrl) {
      e.preventDefault();
      window.open(previewUrl, '_blank');
    }
    // On desktop or when no preview URL, let the Link navigate normally
  };

  // Get short SHA for display
  const getShortSha = () => VERSION_SHA?.substring(0, 7) ?? 'unknown';

  // Format timestamp for display
  const getFormattedTimestamp = () => {
    if (!VERSION_TIMESTAMP) return '';

    const date = new Date(VERSION_TIMESTAMP);
    return date.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    });
  };

  // Extract preview URL from session data
  useEffect(() => {
    if (sessionData?.data) {
      const url = (sessionData.data as any)?.previewUrl || null;
      setPreviewUrl(url);
    }
  }, [sessionData]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [userMenuOpen]);

  // Close split menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (splitMenuRef.current && !splitMenuRef.current.contains(event.target as Node)) {
        setSplitMenuOpen(false);
      }
    };

    if (splitMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [splitMenuOpen]);

  // Track the last visited page for this session
  const { setLastPage } = useSessionLastPageStore();
  useEffect(() => {
    if (sessionId && sessionId !== 'new') {
      const currentPage = extractPageFromPath(location.pathname);
      if (currentPage) {
        setLastPage(sessionId, currentPage);
      }
    }
  }, [sessionId, location.pathname, setLastPage]);

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  const hasRepository = !!selectedRepo;

  // Get user initials for avatar
  const userInitials = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : '??';

  // Navigation items for mobile menu
  const navItems = [
    {
      to: '/sessions',
      label: 'Sessions',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h8v8H3v-8zm0-10h8v8H3V3zm10 0h8v8h-8V3zm0 10h8v8h-8v-8z"/></svg>
    },
    {
      to: sessionId ? `/session/${sessionId}/chat` : '/quick-setup/chat',
      label: 'Chat',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>,
      disabled: location.pathname.includes('/chat') || (!!sessionId && location.pathname === `/session/${sessionId}`)
    },
    {
      to: sessionId ? `/session/${sessionId}/code` : '/quick-setup/code',
      label: 'Code',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>,
      disabled: location.pathname.includes('/code')
    },
    {
      to: sessionId ? `/session/${sessionId}/images` : '/quick-setup/images',
      label: 'Images',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/></svg>,
      disabled: location.pathname.includes('/images')
    },
    {
      to: sessionId ? `/session/${sessionId}/sound` : '/quick-setup/sound',
      label: 'Sounds',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>,
      disabled: location.pathname.includes('/sound')
    },
    {
      to: sessionId ? `/session/${sessionId}/scene-editor` : '/quick-setup/scene',
      label: 'Scenes',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/></svg>,
      disabled: location.pathname.includes('/scene-editor')
    },
    {
      to: sessionId ? `/session/${sessionId}/preview` : '/quick-setup/preview',
      label: 'Preview',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>,
      disabled: location.pathname.includes('/preview'),
      onClick: handlePreviewClick
    },
    // Split view items - only shown when in a session
    ...(sessionId && sessionId !== 'new' ? [
      {
        to: `/session/${sessionId}/code+preview`,
        label: 'Split: Code + Preview',
        icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" /></svg>,
        disabled: location.pathname.includes('/code+preview')
      },
      {
        to: `/session/${sessionId}/images+preview`,
        label: 'Split: Images + Preview',
        icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" /></svg>,
        disabled: location.pathname.includes('/images+preview')
      },
    ] : [])
  ];

  // When maximized, render only the children with minimal wrapper
  if (isMaximized) {
    return (
      <div className="h-screen bg-base-200 flex flex-col">
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen bg-base-200 flex flex-col">
      {/* Mobile Menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        navItems={navItems}
        title="Editor"
        isEditorMode={true}
      />

      {/* Top Navigation Bar - Sticky Header */}
      <header className="sticky top-0 z-[60]">
      <nav className="bg-base-100 border-b border-base-300">
        <div className="px-4">
          <div className="flex items-center h-14">
            {/* Left side - Hamburger (mobile) & Logo (desktop) */}
            <div className="flex items-center">
              {/* Hamburger Menu Button - Mobile Only */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg hover:bg-base-200 transition-colors mr-2"
                aria-label="Toggle menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
                </svg>
              </button>

              {/* Logo - Desktop Only */}
              <div className="hidden md:flex flex-col justify-center py-2">
                <Link
                  to={(() => {
                    const landingPageRoutes: Record<string, string> = {
                      store: '/store',
                      library: '/library',
                      community: '/community',
                      sessions: '/sessions',
                    };
                    return user?.defaultLandingPage ? (landingPageRoutes[user.defaultLandingPage] || '/sessions') : '/sessions';
                  })()}
                  className="font-semibold text-lg leading-tight"
                >
                  WebEDT
                </Link>
                <div
                  className="text-[10px] text-base-content/30 leading-tight italic cursor-pointer hover:text-base-content/40 transition-colors"
                  onClick={nextTagline}
                >
                  {tagline}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowVersionDetails(!showVersionDetails)}
                    className="text-[9px] text-base-content/40 leading-tight cursor-pointer hover:text-base-content/60 text-left"
                  >
                    {showVersionDetails ? (
                      <span>{getShortSha()} [{getFormattedTimestamp()}]</span>
                    ) : (
                      <span>v{VERSION}</span>
                    )}
                  </button>
                  {showVersionDetails && (
                    <a
                      href={GITHUB_REPO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base-content/40 hover:text-base-content/60 transition-colors"
                      aria-label="View on GitHub"
                    >
                      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Center - Logo (mobile) & Navigation Items (desktop) */}
            <div className="flex-1 flex items-center justify-center">
              {/* Logo - Mobile Only (Centered) */}
              <div className="md:hidden flex flex-col items-center justify-center py-2">
                <Link
                  to={(() => {
                    const landingPageRoutes: Record<string, string> = {
                      store: '/store',
                      library: '/library',
                      community: '/community',
                      sessions: '/sessions',
                    };
                    return user?.defaultLandingPage ? (landingPageRoutes[user.defaultLandingPage] || '/sessions') : '/sessions';
                  })()}
                  className="font-semibold text-lg leading-tight"
                >
                  WebEDT
                </Link>
                <div
                  className="text-[10px] text-base-content/30 leading-tight italic cursor-pointer hover:text-base-content/40 transition-colors"
                  onClick={nextTagline}
                >
                  {tagline}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowVersionDetails(!showVersionDetails)}
                    className="text-[9px] text-base-content/40 leading-tight cursor-pointer hover:text-base-content/60"
                  >
                    {showVersionDetails ? (
                      <span>{getShortSha()} [{getFormattedTimestamp()}]</span>
                    ) : (
                      <span>v{VERSION}</span>
                    )}
                  </button>
                  {showVersionDetails && (
                    <a
                      href={GITHUB_REPO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base-content/40 hover:text-base-content/60 transition-colors"
                      aria-label="View on GitHub"
                    >
                      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                      </svg>
                    </a>
                  )}
                </div>
              </div>

              {/* Navigation Items - Desktop Only */}
              <div className="hidden md:flex items-center gap-1">
                <Link
                  to="/sessions"
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 13h8v8H3v-8zm0-10h8v8H3V3zm10 0h8v8h-8V3zm0 10h8v8h-8v-8z"/>
                  </svg>
                  Sessions
                </Link>

                {location.pathname.includes('/chat') || (sessionId && location.pathname === `/session/${sessionId}`) ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
                    </svg>
                    Chat
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/chat` : '/quick-setup/chat'}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
                    </svg>
                    Chat
                  </Link>
                )}

                {location.pathname.includes('/code') ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                    </svg>
                    Code
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/code` : '/quick-setup/code'}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                    </svg>
                    Code
                  </Link>
                )}

                {location.pathname.includes('/images') ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/>
                    </svg>
                    Images
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/images` : '/quick-setup/images'}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/>
                    </svg>
                    Images
                  </Link>
                )}

                {location.pathname.includes('/sound') ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
                    </svg>
                    Sounds
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/sound` : '/quick-setup/sound'}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
                    </svg>
                    Sounds
                  </Link>
                )}

                {location.pathname.includes('/scene-editor') ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
                    </svg>
                    Scenes
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/scene-editor` : '/quick-setup/scene'}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
                    </svg>
                    Scenes
                  </Link>
                )}

                {location.pathname.includes('/preview') ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                    </svg>
                    Preview
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/preview` : '/quick-setup/preview'}
                    onClick={handlePreviewClick}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                    </svg>
                    Preview
                  </Link>
                )}

                {/* Split View Dropdown - only show when in a session */}
                {sessionId && sessionId !== 'new' && (
                  <div className="relative group">
                    <button
                      className="flex items-center gap-1 px-2 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                      title="Split View"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                      </svg>
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    {/* Dropdown menu */}
                    <div className="absolute left-0 top-full mt-1 w-48 bg-base-100 rounded-lg shadow-xl border border-base-300 py-1 z-50 hidden group-hover:block">
                      <div className="px-3 py-1 text-xs text-base-content/50 font-medium">Split with...</div>
                      <Link
                        to={`/session/${sessionId}/code+preview`}
                        className="block px-3 py-2 text-sm hover:bg-base-200 transition-colors"
                      >
                        Code + Preview
                      </Link>
                      <Link
                        to={`/session/${sessionId}/images+preview`}
                        className="block px-3 py-2 text-sm hover:bg-base-200 transition-colors"
                      >
                        Images + Preview
                      </Link>
                      <Link
                        to={`/session/${sessionId}/chat+preview`}
                        className="block px-3 py-2 text-sm hover:bg-base-200 transition-colors"
                      >
                        Chat + Preview
                      </Link>
                      <Link
                        to={`/session/${sessionId}/code+chat`}
                        className="block px-3 py-2 text-sm hover:bg-base-200 transition-colors"
                      >
                        Code + Chat
                      </Link>
                      <Link
                        to={`/session/${sessionId}/images+code`}
                        className="block px-3 py-2 text-sm hover:bg-base-200 transition-colors"
                      >
                        Images + Code
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right side - Mode Toggle, Theme, User menu */}
            <div className="flex items-center gap-3">
              {/* Mode Toggle - Switch to Hub - Desktop Only (inverse of hamburger) */}
              <Link
                to={(() => {
                  const landingPageRoutes: Record<string, string> = {
                    store: '/store',
                    library: '/library',
                    community: '/community',
                    sessions: '/sessions',
                  };
                  return user?.defaultLandingPage ? (landingPageRoutes[user.defaultLandingPage] || '/store') : '/store';
                })()}
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/>
                </svg>
                <span className="hidden sm:inline">The Hub</span>
              </Link>

              <ThemeSelector />

              {/* User Avatar with Dropdown */}
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-content font-semibold text-sm hover:opacity-80 transition-opacity"
                  aria-label="User menu"
                >
                  {userInitials}
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-base-100 rounded-lg shadow-xl border border-base-300 py-2 z-50">
                    {/* User email - non-clickable */}
                    <div className="px-4 py-2 text-sm text-base-content/70 border-b border-base-300">
                      📧 {user?.email}
                    </div>

                    {/* Store link */}
                    <Link
                      to="/store"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-base-content hover:bg-base-200 transition-colors"
                    >
                      🏪 Store
                    </Link>

                    {/* Library link */}
                    <Link
                      to="/library"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-base-content hover:bg-base-200 transition-colors"
                    >
                      📚 Library
                    </Link>

                    {/* My Sessions link */}
                    <Link
                      to="/sessions"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-base-content hover:bg-base-200 transition-colors"
                    >
                      📂 My Sessions
                    </Link>

                    {/* Settings link */}
                    <Link
                      to="/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-base-content hover:bg-base-200 transition-colors"
                    >
                      ⚙️ Settings
                    </Link>

                    {/* Logout */}
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        handleLogout();
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-base-content hover:bg-base-200 transition-colors"
                    >
                      🚪 Log out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Second Bar - Repository Controls / Connection Status - Consolidated Design */}
      <div className="bg-base-100 border-b border-base-300">
        <div className="px-4 py-2">
          {hasRepository && isLocked ? (
            /* Compact two-line layout for active sessions */
            <div className="max-w-7xl mx-auto flex flex-col gap-1">
              {/* Line 1: Page icon + title (left) + edit/delete icons (right) */}
              <div className="flex items-center justify-between gap-4">
                {/* Left: Icon + Title */}
                <button
                  onClick={() => setTitleExpanded(!titleExpanded)}
                  className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-70 transition-opacity cursor-pointer"
                  title={titleExpanded ? "Click to collapse" : "Click to expand full title"}
                >
                  <span className="text-lg">📁</span>
                  <h2 className={`text-sm font-medium text-base-content ${titleExpanded ? '' : 'truncate'}`}>
                    {titleExpanded
                      ? (sessionData?.data?.userRequest || 'Session')
                      : truncateSessionName(sessionData?.data?.userRequest || 'Session', 80)
                    }
                  </h2>
                </button>

                {/* Right: GitHub icon + Edit and Delete icon buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* GitHub icon link */}
                  {selectedRepo && (
                    <a
                      href={(() => {
                        const repoUrl = selectedRepo.replace(/\.git$/, '');
                        const branchPath = branch ? `/tree/${branch}` : `/tree/${baseBranch}`;
                        return `${repoUrl}${branchPath}`;
                      })()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 p-1 hover:bg-base-200 rounded transition-colors"
                      title="View on GitHub"
                    >
                      <svg className="w-4 h-4 text-base-content/70" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                      </svg>
                    </a>
                  )}
                  {/* Dokploy icon link - Admin only */}
                  {user?.isAdmin && (
                    <a
                      href="https://app.dokploy.com/dashboard/project/9DvNEOYn2f8SvGUcR6Q0P/environment/ocNuPm2Kl9T-OAdGWOvSY/services/application/9CEbPLusLFDzj4neaaCPk"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 p-1 hover:bg-base-200 rounded transition-colors"
                      title="View on Dokploy (Admin)"
                    >
                      <svg className="w-4 h-4 text-base-content/70" fill="currentColor" viewBox="0 0 559 446">
                        <path d="M390 56v12c.1 2.3.5 4 1 6a73 73 0 0 0 12 24c2 2.3 5.7 4 7 7 4 3.4 9.6 6.8 14 9 1.7.6 5.7 1.1 7 2 1.9 1.3 2.9 2.3 0 4v1c-.6 1.8-1.9 3.5-3 5q-3 4-7 7c-4.3 3.2-9.5 6.8-15 7h-1q-2 1.6-5 2h-4c-5.2.7-12.9 2.2-18 0h-6c-1.6 0-3-.8-4-1h-3a17 17 0 0 1-6-2h-1c-2.5-.1-4-1.2-6-2l-4-1c-8.4-2-20.3-6.6-27-12h-1c-4.6-1-9.5-4.3-13.7-6.3s-10.5-3-13.3-6.7h-1c-4-1-8.9-3.5-12-6h-1c-6.8-1.6-13.6-6-20-9-6.5-2.8-14.6-5.7-20-10h-1c-7-1.2-15.4-4-22-6h-97c-5.3 4.3-13.7 4.3-18.7 10.3S90.8 101 88 108c-.4 1.5-.8 2.3-1 4-.2 1.6-.8 4-1 5v51c.2 1.2.8 3.2 1 5 .2 2 .5 3.2 1 5a79 79 0 0 0 6 12c.8.7 1.4 2.2 2 3 1.8 2 4.9 3.4 6 6 9.5 8.3 23.5 10.3 33 18h1c5.1 1.2 12 4.8 16 8h1c4 1 8.9 3.5 12 6h1q4.6 1.2 8 4h1c2 .1 2.6 1.3 4 2 1.6.8 2.7.7 4 2h1q2.5.3 4 2h1c3 .7 6.7 2 9 4h1c4.7.8 13.4 3.1 17 6h1c2.5.1 4 1.3 6 2 1.8.4 3 .8 5 1q3 .4 5 1c1.6-.2 2 0 3 1h1q2.5-.5 4 1h1q2.5-.5 4 1h1c2.2-.2 4.5-.3 6 1h1q4-.4 7 1h45c1.2-.2 3.1-1 5-1h6c1.5-.6 2.9-1.3 5-1h1q1.5-1.4 4-1h1q1.5-1.4 4-1h1c2.4-1.3 5-1.6 8-2l5-1c2-.7 3.6-1.6 6-2 4-.7 7.2-1.7 11-3 2.3-1 4.2-2.5 7-3h1q1.5-1.7 4-2h1c1.9-1.5 3.9-2 6-3q2.9-1.6 6-3a95 95 0 0 0 11-5c4.4-2.8 8.9-6 14-8 0 0 .6.2 1 0 1.8-2.8 7-4.8 10-6 0 0 .6.2 1 0 1.5-2.4 5.3-4 8-5 0 0 .6.2 1 0 1.5-2.4 5.3-4 8-5 0 0 .6.2 1 0 1.3-2 3.8-3.1 6-4 0 0 .6.2 1 0 2-3 7.7-5.6 11-7l5-2c6.3-3.8 11.8-9.6 18-14v-1c0-1.9-.4-4.2 0-6-1-4.5-3.9-5.5-7-8h-1c-1.2 0-2.8-.2-4 0-8.9 1.7-16.5 11.3-25.2 14.8-8.8 3.4-16.9 10.7-25.8 14.2h-1c-10.9 10.6-29.2 16-42.7 23.3S343.7 234.6 328 235h-1q-1.5 1.4-4 1h-1q-1.5 1.4-4 1h-1c-1.5 1.3-3.9 1.2-6 1h-1c-1.7 1.3-4.6 1.2-7 1-1 .2-2.4 1-4 1h-5c-6.6 0-13.4.4-20 0-1.9-.1-2.7.3-4-1h-8c-2.8-.2-5.7-1.3-8-2h-2q-5.7.4-10-2h-1q-4.5 0-8-2h-1a10 10 0 0 1-6-2h-1c-5.9-.2-12-3.8-17-6l-4-1c-1.7-.5-2.8-.7-4-2h-1q-2.5-.2-4-2h-1q-3.4-.9-6-3h-1c-3.5-.8-7.3-2.9-10-5h-1c-1.7 0-2.2-.7-3-2h-1c-11.6-2.7-23.2-11.5-34.2-15.8-11-4.2-25.9-9.2-29.8-21.2h4c16.2 0 32.8-1 49 0 1.7.1 3 .8 4 1 2.1.4 3.4-.5 5 1h1c3.6.1 8.4 1.8 11 4h1a45 45 0 0 1 18 8h1q4.6 1.2 8 4h1c4.2 1 8.3 3.4 12 5q3.4 1.2 7 2c5.7 1.3 13 2.3 18 5h1c3.7-.2 7 1.1 10 2h9c1.6 0 3 .8 4 1h32c2.2-1.6 6-1 9-1h1a63 63 0 0 1 22-4 22 22 0 0 1 8-2c1.7-1.4 3.7-1.6 6-2a81 81 0 0 0 12-3c2.3-1 4.2-2.5 7-3h1q1.5-1.7 4-2h1c1.9-1.5 3.6-2.2 6-3l3-1c4.1-2.3 8.4-5.2 13-7 0 0 .6.2 1 0 1.5-2.4 6.3-5 9-6 0 0 .6.2 1 0 5.3-8.1 17.6-12.5 24.8-20.2C439.9 144 445 133 452 126v-1a12 12 0 0 1 2-5c2.1-2.2 8.9-1 12-1q2 .2 4 0c1-.2 2.3-1.2 4-1h1q2.1-1.5 5-2h1q2.1-1.9 5-3s.6.2 1 0c9-9.3 18-15.4 23-28 1.1-2.8 3.5-6.4 4-9 .2-1 .2-3 0-4-1.5-6-12.3-2.4-15.7 2.3S484.7 80 479 80h-7c-7.8 4.3-19.3 5.7-23 16a37 37 0 0 0-22-24c-1.5-.5-2.5-.7-4-1-2.1-.5-3.6-.2-5-2h-1a22 22 0 0 1-12-8c-2-2.9-3.4-6.5-6-9h-1c-3.9-.6-6.1 1-8 4m-181 45h1c2.2-.2 4.5-.3 6 1h1q2.5-.5 4 1h1a33 33 0 0 1 17 7h1c4.4 1 8.2 4.1 12 6 2.1 1 4.1 1.5 6 3h1c4 1 8.9 3.5 12 6h1c4 1 8.9 3.5 12 6h1c4 1 8.9 3.5 12 6h1a61 61 0 0 1 21 10h1c3.5.8 7.3 2.9 10 5h1c6.1 1.4 12.3 5 18 7 1.8.4 3 .8 5 1 1.8.2 3.7.8 5 1q2.5-.5 4 1h6c2.5 0 4 .3 6 1h3q-.7 2.1-3 2a46 46 0 0 1-16 7l-10 3c-2 .8-3.4 1.9-6 2h-1c-2.6 2.1-7.5 3-11 3h-1c-3.1 2.5-10.7 3.5-15 3h-1c-1.5 1.3-3.9 1.2-6 1-1 .2-2.4 1-4 1h-11c-3.8.4-8.3.4-12 0h-9c-2.3 0-4.3-.7-6-1h-3c-1.8 0-2.9-.7-4-1-3.5-.8-7-.7-10-2h-1c-4.1-.7-9.8-1.4-13-4h-1q-4-.6-7-3h-1q-2.5-.2-4-2h-1q-3.4-.9-6-3h-1c-7.2-1.7-13.3-5.9-20.2-8.8-7-2.8-16.2-4.3-22.8-7.2h-11c-14 0-28.9.3-42-1-2.3 0-4.8.3-7 0a6 6 0 0 1-5-5c-1.8-4.8-.4-10.4 0-15 0-4.3-.4-8.7 0-13 .2-3.2 2.2-7.3 4-10q2-3 5-5c2.1-2 5.4-2.3 8-3 15.6-3.9 36.3-1 53-1 5.2 0 12-.5 17 0s12.2-1.8 16 1Z"/>
                        <path d="M162 132v1c1.8 2.9 4.5 5.3 8 6 .3-.2 3.7-.2 4 0 7-1.4 9.2-8.8 7-15v-1a14 14 0 0 0-7-4c-.3.2-3.7.2-4 0-6.5 1.3-8.6 6.8-8 13Z"/>
                        <path d="M465 211h-1c-18.2 14.6-41.2 24.6-60 39-19 14.2-42.7 29.3-66 34l-4 1c-2.4 1-4 2-7 2h-1q-3.5 2-8 2h-1c-1.3 1.2-3 1.1-5 1h-2q-2.6 1.1-6 1h-2c-3 1.2-6.5 1-10 1-6.3.6-13.8.6-20 0-3.4 0-8.4.9-11-1h-1c-2.2.2-4.5.3-6-1h-1c-2 .2-3.7.2-5-1h-1c-7.6.5-16.5-3.4-23-6l-4-1a129 129 0 0 1-36.2-15.8c-10.4-6.6-23.2-12.8-32.5-20.5-9.2-7.7-23.8-12.8-30.3-22.7h-1c-2.3-1.4-4.5-2.7-6-5h-1c-4-2.5-8.5-5.2-12-8h-9a9 9 0 0 0-6 7c.3 3.3 0 6.7 0 10v9c.2 1.6 1 3.8 1 6v3c.2 1 1.2 2.2 1 4v1c1.2 1.2.8 2.2 1 4 .8 6.7 3 12.6 5 19 1.7 4.3 4.2 9.1 5 14v1q1.8 1.5 2 4v1a36 36 0 0 1 5 10c.7 2 1 3 2 5 8 12.7 15.7 25.5 25.8 37.3 10 11.7 20.8 20.6 32.4 30.4 11.7 9.9 28.3 14 39.8 23.3h1q2.5.3 4 2h1c2.8.4 4.8 2 7 3l7 2c5.7 1.3 13 2.3 18 5h1c2.1-.3 3.6.8 5 1h3c2.8.2 5.8 1 8 2h8c2.1 0 4.6.8 6 1h21c1.2-.2 3.2-1 5-1h9c3.3-1 7-2.4 11-2h1c2.7-2.2 7.4-2.4 11-3a55 55 0 0 0 8-2c6.5-2.6 13.9-6.3 21-8h1c8.5-6.8 20.6-9.7 29.2-16.8 8.7-7 18.3-12.8 26.8-20.2 4.4-3.8 9-9 13-13 14.8-14.8 20.7-34.6 33-50v-1q.9-3.4 3-6v-1q.3-2.5 2-4v-1c.5-3.3 2-8.6 4-11v-1q0-3.5 2-6v-1c1.1-6.7 2.4-15 5-21v-1c-.2-2-.2-3.7 1-5v-8c0-5.3-.5-10.8 0-16a14 14 0 0 0-4-6c-1-.5-1.1-.4-2-1h-6q-2.1 1.5-5 2m-6 38c-2.1 13.4-21.2 20.3-31 30-10 9.5-23.7 19-35 27-11.5 8-25.1 19.7-39 23h-1a22 22 0 0 1-10 4h-1a25 25 0 0 1-12 4h-1q-3.5 2-8 2h-1c-1.1 1.1-2.3 1-4 1h-2c-1.2.4-2.2 1-4 1h-2c-1.8.7-3.6 1.3-6 1h-1c-1.2 1.2-2.3 1-4 1h-5c-5.7.6-12.3.8-18 0h-4c-1.9 0-2.7-.6-4-1h-6c-1.9 0-2.7.3-4-1h-1q-2.5.5-4-1h-1c-8.1.5-16.8-3.6-24.2-5.8S210 329.8 204 325h-1c-12.8-5-27.1-15.6-37.7-24.3S138.8 284.2 131 273c-.3-.2-1 0-1 0-5.7-4.4-16.6-10-19-17-.9-2.6-1-5.4-2-8-.8-2.2-2.5-5-2-8a667 667 0 0 0 88 56h1q3.4.9 6 3h1c2.8.4 4.8 2 7 3q5 1.8 10 3l6 2q2.9.6 6 1 3 .4 5 1c1.6-.2 2 0 3 1h1c2-.2 3.7-.2 5 1h1c2.2-.3 3.4.4 5 1h8c1.6 0 3 .9 4 1h40c1.8-1.3 4.6-1.2 7-1h1c1.2-1.2 3.2-1.2 5-1h1c1.2-1.2 3.2-1.2 5-1h1c1.1-1.1 2.3-1 4-1h2c3.5-1.7 6.9-2.3 11-3l4-1c3.4-1.4 7.1-3 11-4 1.5-.4 2.5-.5 4-1 1.4-.7 2-1.9 4-2h1q2.6-2.1 6-3h1c2.5-2 6-3.8 9-5l3-1c1.4-.9 2-2.5 4-3h1q1.4-2.2 4-3h1c7.3-7.7 19-13.2 27.7-19.3 8.8-6.1 18.2-15 28.3-18.7.4-.2 1 0 1 0q3.8-3.9 9-6c1.3 2.5-.5 6.7-1 10m-20 55c-.2.4 0 1 0 1-3.4 9.6-12.7 19-19 27a88 88 0 0 1-12 12 214 214 0 0 1-26.7 20.3c-9.5 5.8-20 14.8-31.3 16.7h-1a22 22 0 0 1-10 4h-1c-3.2 2.6-8.9 3.3-13 4h-1q-1.5 1.4-4 1h-1q-1.5 1.4-4 1h-1c-4.9 2.3-10.5 1-16 2-1 .2-2.5 1-4 1-6.2.4-12.8.3-19 0-1.8 0-3.8-.8-5-1h-4c-1.6 0-3-.9-4-1h-4c-3.9-.3-8.8-1.3-12-3h-1c-3.3-.5-7.5-1-10-3h-1c-3.6-.1-8.4-1.8-11-4h-1c-3.9-.6-8-2.6-11-5h-1c-16.1-3.8-32.2-18.9-45-29a200 200 0 0 1-40-51c17.7 11.5 35 25.5 52 38h1c4 1.6 12.8 5.4 15 9h1c4.6 1 10.4 4.1 14 7h1q2.5.3 4 2h1c3.3.5 8.6 2 11 4h1q3.5 0 6 2h1q2.5-.5 4 1h1q2.5-.5 4 1h1c3.8-.2 7.9 1 11 2h9c1.6 0 3 .8 4 1h32c1.2-.2 3.2-1 5-1h8a139 139 0 0 1 20-4l5-1c2-.7 3.7-1.5 6-2l4-1c1.5-.6 3-1.7 5-2h1q3-2.4 7-3h1q2.6-2.1 6-3h1c11.7-9.4 27.6-14.6 39-25 11.6-10.3 25-18.5 37-28a15 15 0 0 1-5 10Z"/>
                      </svg>
                    </a>
                  )}
                  {titleActions}
                </div>
              </div>

              {/* Line 2: Repository branch info as single pill + PR buttons */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <button
                  onClick={() => setBranchExpanded(!branchExpanded)}
                  className="flex items-center gap-1.5 px-2 py-0.5 bg-base-200 rounded-full max-w-full hover:bg-base-300 transition-colors cursor-pointer"
                  title={branchExpanded ? "Click to collapse" : "Click to expand full branch name"}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0"></div>
                  <span className={`text-base-content/70 ${branchExpanded ? '' : 'truncate'}`}>
                    {repositories.find((repo: GitHubRepository) => repo.cloneUrl === selectedRepo)?.fullName || 'unknown'}/{baseBranch}
                    {branch && (
                      <> → <span className="font-medium">{branchExpanded || branch.length <= 20 ? branch : branch.substring(0, 20) + '…'}</span></>
                    )}
                  </span>
                </button>

                {/* PR action buttons ONLY */}
                {prActions && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {prActions}
                  </div>
                )}
              </div>
            </div>
          ) : hasRepository && !isLocked ? (
            /* Editable controls for new sessions */
            <div className="max-w-7xl mx-auto flex items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-base-content/70">Repository:</span>
                <select
                  value={selectedRepo}
                  onChange={(e) => onRepoChange?.(e.target.value)}
                  disabled={isLoadingRepos}
                  className="select select-sm select-bordered"
                >
                  <option value="">No repository</option>
                  {repositories.map((repo: GitHubRepository) => (
                    <option key={repo.id} value={repo.cloneUrl}>
                      {repo.fullName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-base-content/70">Base Branch:</span>
                <input
                  type="text"
                  value={baseBranch}
                  onChange={(e) => onBaseBranchChange?.(e.target.value)}
                  className="input input-sm input-bordered w-32"
                  placeholder="main"
                />
              </div>
            </div>
          ) : (
            /* Offline/no repository state */
            <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-400"></div>
                <span className="text-xs font-medium text-base-content/50">Offline</span>
              </div>
            </div>
          )}
        </div>
      </div>
      </header>

      {/* Main Content - with sidebar */}
      <div className="flex-1 flex min-h-0">
        {/* Sessions Sidebar - Desktop only */}
        <div className="hidden md:flex">
          <SessionsSidebar />
        </div>
        {/* Main content area */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
