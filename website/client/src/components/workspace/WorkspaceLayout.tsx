import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';

interface WorkspaceLayoutProps {
  children: React.ReactNode;
}

/**
 * Layout wrapper for workspace pages (/github/:owner/:repo/:branch/:page).
 * Provides navigation between workspace pages while maintaining branch context.
 */
export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const workspace = useWorkspaceParams();
  const location = useLocation();
  const navigate = useNavigate();

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Invalid Workspace URL</h2>
          <p className="text-base-content/70 mb-4">
            Please select a repository and branch from the workspace page.
          </p>
          <button
            onClick={() => navigate('/workspace')}
            className="btn btn-primary"
          >
            Go to Workspace
          </button>
        </div>
      </div>
    );
  }

  const { owner, repo, branch } = workspace;
  const basePath = `/github/${owner}/${repo}/${encodeURIComponent(branch)}`;

  // Navigation items for workspace
  const navItems = [
    { path: 'code', label: 'Code', icon: 'code' },
    { path: 'images', label: 'Images', icon: 'images' },
    { path: 'sounds', label: 'Sounds', icon: 'sounds' },
    { path: 'scenes', label: 'Scenes', icon: 'scenes' },
    { path: 'chat', label: 'Chat', icon: 'chat' },
    { path: 'preview', label: 'Preview', icon: 'preview' },
  ];

  const getIcon = (icon: string) => {
    switch (icon) {
      case 'code':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
          </svg>
        );
      case 'images':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/>
          </svg>
        );
      case 'sounds':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
          </svg>
        );
      case 'scenes':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
          </svg>
        );
      case 'chat':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
          </svg>
        );
      case 'preview':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
          </svg>
        );
      default:
        return null;
    }
  };

  const isActive = (path: string) => {
    return location.pathname.endsWith(`/${path}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Workspace Navigation Bar */}
      <div className="bg-base-100 border-b border-base-300 px-4 py-2">
        <div className="flex items-center justify-between">
          {/* Left: Page navigation */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => (
              isActive(item.path) ? (
                <button
                  key={item.path}
                  disabled
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded transition-colors bg-primary/10 text-primary cursor-not-allowed"
                >
                  {getIcon(item.icon)}
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              ) : (
                <Link
                  key={item.path}
                  to={`${basePath}/${item.path}`}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded transition-colors text-base-content/70 hover:bg-base-200"
                >
                  {getIcon(item.icon)}
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              )
            ))}
          </div>

          {/* Right: GitHub link */}
          <a
            href={`https://github.com/${owner}/${repo}/tree/${branch}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-base-content/60 hover:text-base-content/80 transition-colors"
            title="View on GitHub"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <span className="hidden md:inline">Open in GitHub</span>
          </a>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  );
}
