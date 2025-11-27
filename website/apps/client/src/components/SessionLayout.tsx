import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuthStore, useRepoStore } from '@/lib/store';
import { authApi, sessionsApi, githubApi } from '@/lib/api';
import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import ThemeSelector from './ThemeSelector';
import MobileMenu from './MobileMenu';
import { VERSION, VERSION_TIMESTAMP, VERSION_SHA } from '@/version';
import type { GitHubRepository } from '@webedt/shared';

interface SessionLayoutProps {
  selectedRepo?: string;
  baseBranch?: string;
  branch?: string;
  onRepoChange?: (repo: string) => void;
  onBaseBranchChange?: (branch: string) => void;
  repositories?: GitHubRepository[];
  isLoadingRepos?: boolean;
  isLocked?: boolean;
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
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Fetch session data when sessionId exists and no props provided
  const { data: sessionData } = useQuery({
    queryKey: ['session-for-layout', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.get(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new' && !selectedRepoProp,
  });

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
      to: '/new-session',
      label: 'New',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    },
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
      label: 'Images and Animations',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/></svg>,
      disabled: location.pathname.includes('/images')
    },
    {
      to: sessionId ? `/session/${sessionId}/sound` : '/quick-setup/sound',
      label: 'Sound and Music',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>,
      disabled: location.pathname.includes('/sound')
    },
    {
      to: sessionId ? `/session/${sessionId}/scene-editor` : '/quick-setup/scene',
      label: 'Scene and Object Editor',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/></svg>,
      disabled: location.pathname.includes('/scene-editor')
    },
    {
      to: sessionId ? `/session/${sessionId}/preview` : '/quick-setup/preview',
      label: 'Preview',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>,
      disabled: location.pathname.includes('/preview')
    }
  ];

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
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
                <Link to="/" className="font-semibold text-lg leading-tight">WebEDT</Link>
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
              </div>
            </div>

            {/* Center - Logo (mobile) & Navigation Items (desktop) */}
            <div className="flex-1 flex items-center justify-center">
              {/* Logo - Mobile Only (Centered) */}
              <div className="md:hidden flex flex-col items-center justify-center py-2">
                <Link to="/" className="font-semibold text-lg leading-tight">WebEDT</Link>
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
              </div>

              {/* Navigation Items - Desktop Only */}
              <div className="hidden md:flex items-center gap-1">
                <Link
                  to="/new-session"
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                  New
                </Link>

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
                    Images and Animations
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/images` : '/quick-setup/images'}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/>
                    </svg>
                    Images and Animations
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
                    Sound and Music
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/sound` : '/quick-setup/sound'}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
                    </svg>
                    Sound and Music
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
                    Scene and Object Editor
                  </button>
                ) : (
                  <Link
                    to={sessionId ? `/session/${sessionId}/scene-editor` : '/quick-setup/scene'}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
                    </svg>
                    Scene and Object Editor
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
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                    </svg>
                    Preview
                  </Link>
                )}
              </div>
            </div>

            {/* Right side - Theme, User menu */}
            <div className="flex items-center gap-3">
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
                      to="/"
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

                    {/* New Session link */}
                    <Link
                      to="/new-session"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-base-content hover:bg-base-200 transition-colors"
                    >
                      ➕ New Session
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

      {/* Second Bar - Repository Controls / Connection Status */}
      <div className="bg-base-100 border-b border-base-300">
        <div className="px-4 h-12 flex items-center justify-center gap-4">
          {hasRepository ? (
            <>
              {isLocked ? (
                <>
                  {/* Connection indicator when locked */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
                      <span className="text-xs font-medium text-base-content/50">Connected</span>
                    </div>
                  </div>

                  {/* Read-only repository info when locked */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-base-content/70">Repository:</span>
                    <span className="text-sm text-base-content">
                      {repositories.find((repo: GitHubRepository) => repo.cloneUrl === selectedRepo)?.fullName || selectedRepo}
                    </span>
                  </div>

                  {/* Read-only base branch when locked */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-base-content/70">Base Branch:</span>
                    <span className="text-sm text-base-content">{baseBranch}</span>
                  </div>

                  {/* Read-only branch when locked */}
                  {branch && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-base-content/70">Branch:</span>
                      <span className="text-sm text-base-content">{branch}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Editable repository controls when not locked */}
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

                  {/* Base Branch */}
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
                </>
              )}
            </>
          ) : (
            <>
              {/* Show offline or no repository status */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  {isLocked ? (
                    <>
                      {/* Grey dot when session is active but missing repository (offline/local state) */}
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-400"></div>
                      <span className="text-xs font-medium text-base-content/50">Offline</span>
                    </>
                  ) : (
                    <>
                      {/* Grey dot for setup pages, new session, sessions list, quick-setup, etc. */}
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-400"></div>
                      <span className="text-xs font-medium text-base-content/50">Offline</span>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}
