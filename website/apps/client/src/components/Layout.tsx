import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, useRepoStore } from '@/lib/store';
import { authApi } from '@/lib/api';
import { useState, useRef, useEffect } from 'react';
import ThemeSelector from './ThemeSelector';
import MobileMenu from './MobileMenu';
import { VERSION, VERSION_TIMESTAMP, VERSION_SHA } from '@/version';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  disabled?: boolean;
  isActive?: boolean;
}

export default function Layout() {
  const { user, isAuthenticated, clearUser } = useAuthStore();
  const { selectedRepo, baseBranch, isLocked } = useRepoStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showVersionDetails, setShowVersionDetails] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Check if connected to a repository
  const isConnected = !!selectedRepo && isLocked;

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
    return <Outlet />;
  }

  // Get user initials for avatar
  const userInitials = user?.displayName
    ? user.displayName.substring(0, 2).toUpperCase()
    : user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : '??';

  // Detect if we're in editor mode (on /sessions or /session/*)
  const isEditorMode = location.pathname === '/sessions' ||
                       location.pathname.startsWith('/session/') ||
                       location.pathname === '/new-session' ||
                       location.pathname.startsWith('/quick-setup/');

  // Store mode navigation items
  const storeNavItems: NavItem[] = [
    {
      to: '/',
      label: 'Store',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z"/></svg>,
      isActive: location.pathname === '/'
    },
    {
      to: '/library',
      label: 'Library',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/></svg>,
      isActive: location.pathname.startsWith('/library')
    },
    {
      to: '/community',
      label: 'Community',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>,
      isActive: location.pathname.startsWith('/community')
    }
  ];

  // Editor mode navigation items
  const editorNavItems: NavItem[] = [
    {
      to: '/new-session',
      label: 'New',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>,
      disabled: location.pathname === '/new-session',
      isActive: location.pathname === '/new-session'
    },
    {
      to: '/sessions',
      label: 'Sessions',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h8v8H3v-8zm0-10h8v8H3V3zm10 0h8v8h-8V3zm0 10h8v8h-8v-8z"/></svg>,
      isActive: location.pathname === '/sessions'
    },
    {
      to: '/quick-setup/chat',
      label: 'Chat',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>,
      isActive: location.pathname === '/quick-setup/chat'
    },
    {
      to: '/quick-setup/code',
      label: 'Code',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>,
      isActive: location.pathname === '/quick-setup/code'
    },
    {
      to: '/quick-setup/images',
      label: 'Images and Animations',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/></svg>,
      isActive: location.pathname === '/quick-setup/images'
    },
    {
      to: '/quick-setup/sound',
      label: 'Sound and Music',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>,
      isActive: location.pathname === '/quick-setup/sound'
    },
    {
      to: '/quick-setup/scene',
      label: 'Scene and Object Editor',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/></svg>,
      isActive: location.pathname === '/quick-setup/scene'
    },
    {
      to: '/quick-setup/preview',
      label: 'Preview',
      icon: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>,
      isActive: location.pathname === '/quick-setup/preview'
    }
  ];

  // Use appropriate navigation items based on mode
  const navItems = isEditorMode ? editorNavItems : storeNavItems;

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      {/* Mobile Menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        navItems={navItems}
        title={isEditorMode ? 'Editor' : 'The Hub'}
        isEditorMode={isEditorMode}
      />

      {/* Top Navigation Bar - Sticky Header */}
      <header className="sticky top-0 z-50">
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
                {navItems.map((item) => (
                  item.disabled ? (
                    <button
                      key={item.to}
                      disabled
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ) : (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded transition-colors ${
                        item.isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-base-content/70 hover:bg-base-200'
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  )
                ))}
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
                    {/* User info - non-clickable */}
                    <div className="px-4 py-2 text-sm border-b border-base-300">
                      {user?.displayName ? (
                        <>
                          <div className="font-medium text-base-content">{user.displayName}</div>
                          <div className="text-xs text-base-content/60 mt-0.5">{user.email}</div>
                        </>
                      ) : (
                        <div className="text-base-content/70">📧 {user?.email}</div>
                      )}
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

      {/* Second Bar - Status Indicator (shown when connected or in editor mode) */}
      {(isEditorMode || isConnected) && (
        <div className="bg-base-100 border-b border-base-300">
          <div className="px-4 h-12 flex items-center justify-center gap-4">
            {isConnected ? (
              /* Show connection details when connected */
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
                  <span className="text-xs font-medium text-base-content/50">Connected</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-base-content/70">Repository:</span>
                  <span className="text-sm text-base-content">{selectedRepo}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-base-content/70">Base Branch:</span>
                  <span className="text-sm text-base-content">{baseBranch}</span>
                </div>
              </div>
            ) : (
              /* Show offline status when not connected */
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-400"></div>
                  <span className="text-xs font-medium text-base-content/50">Offline</span>
                </div>
                <span className="text-xs text-base-content/40">- Select a tool below to connect</span>
              </div>
            )}
          </div>
        </div>
      )}
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
