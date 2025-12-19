import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';
import { authApi } from '@/lib/api';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import Store from '@/pages/Store';
import Library from '@/pages/Library';
import Community from '@/pages/Community';
import Agents from '@/pages/Agents';
import Trash from '@/pages/Trash';
import Chat from '@/pages/Chat';
import QuickChatSetup from '@/pages/QuickChatSetup';
import QuickAgentSetup from '@/pages/QuickAgentSetup';
import Settings from '@/pages/Settings';
import UserAdministration from '@/pages/UserAdministration';
import AdminLogs from '@/pages/AdminLogs';
import Code from '@/pages/Code';
import Images from '@/pages/Images';
import Sound from '@/pages/Sound';
import SceneEditor from '@/pages/SceneEditor';
import Preview from '@/pages/Preview';
import ItemPage from '@/pages/ItemPage';
import LibraryItemPage from '@/pages/LibraryItemPage';
import StoreItemDetail from '@/pages/StoreItemDetail';
import SplitViewRouter from '@/components/SplitViewRouter';
import ImageEditor from '@/pages/editor/ImageEditor';
import Workspace from '@/pages/Workspace';
import {
  WorkspaceCode,
  WorkspaceImages,
  WorkspaceSounds,
  WorkspaceScenes,
  WorkspaceChat,
  WorkspacePreview,
} from '@/pages/workspace';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Component to handle default landing page routing
function DefaultRoute() {
  const user = useAuthStore((state) => state.user);

  // Map landing page values to routes
  const landingPageRoutes: Record<string, string> = {
    dashboard: '/dashboard',
    store: '/store',
    library: '/library',
    community: '/community',
    sessions: '/agents', // Keep 'sessions' key for backwards compat, redirect to /agents
    agents: '/agents',
  };

  // If user has a default landing page set, redirect to it
  if (user?.defaultLandingPage) {
    const redirectPath = landingPageRoutes[user.defaultLandingPage];
    if (redirectPath) {
      return <Navigate to={redirectPath} replace />;
    }
  }

  // Default to store if no landing page is set
  return <Navigate to="/store" replace />;
}

function App() {
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    // Check if user is already authenticated
    authApi
      .getSession()
      .then((response) => {
        setUser(response.data.user);
      })
      .catch(() => {
        // User not authenticated
        setUser(null);
      });
  }, [setUser]);

  // Detect base path for React Router
  // In development: BASE_URL is './'
  // In production with Strip Path: we need to detect the actual path from the URL
  const getBasename = () => {
    // If BASE_URL is set to something other than './' or '/', use it
    const viteBase = import.meta.env.BASE_URL;
    if (viteBase && viteBase !== './' && viteBase !== '/') {
      return viteBase;
    }

    // Detect from current pathname for path-based routing
    // Patterns:
    //   /github/owner/repo/branch/...  (preview via /github prefix)
    //   /owner/repo/branch/...         (standard path-based)
    //   /owner/repo/website/branch/... (monorepo website folder)
    const pathname = window.location.pathname;
    const pathSegments = pathname.split('/').filter(Boolean);

    // App routes that should not be treated as path-based deployment prefixes
    // Note: 'github' is included because /github/:owner/:repo/:branch/* are workspace routes
    const appRoutes = ['login', 'register', 'session', 'sessions', 'agents', 'trash', 'settings', 'admin',
                       'code', 'images', 'sound', 'scene-editor', 'preview', 'library', 'community',
                       'item', 'store', 'quick-setup', 'dashboard', 'landing', 'editor', 'image-editor', 'workspace', 'github'];

    if (pathSegments.length >= 1 && !appRoutes.includes(pathSegments[0])) {
      // Check for /github/ prefix pattern: /github/owner/repo/branch/
      if (pathSegments[0] === 'github' && pathSegments.length >= 4) {
        return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
      }
      // Check for monorepo pattern: /owner/repo/website/branch/
      if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
        return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
      }
      // Standard format: /owner/repo/branch/...
      if (pathSegments.length >= 3) {
        return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
      }
    }

    return '/';
  };

  const basename = getBasename();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route element={<Layout />}>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DefaultRoute />
                </ProtectedRoute>
              }
            />
            <Route
              path="/landing"
              element={
                <ProtectedRoute>
                  <DefaultRoute />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/store"
              element={
                <ProtectedRoute>
                  <Store />
                </ProtectedRoute>
              }
            />
            <Route
              path="/library"
              element={
                <ProtectedRoute>
                  <Library />
                </ProtectedRoute>
              }
            />
            <Route
              path="/library/:id"
              element={
                <ProtectedRoute>
                  <LibraryItemPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/community"
              element={
                <ProtectedRoute>
                  <Community />
                </ProtectedRoute>
              }
            />
            <Route
              path="/agents"
              element={
                <ProtectedRoute>
                  <Agents />
                </ProtectedRoute>
              }
            />
            {/* Redirect /sessions to /agents for backwards compatibility */}
            <Route
              path="/sessions"
              element={<Navigate to="/agents" replace />}
            />
            <Route
              path="/editor/sessions"
              element={<Navigate to="/agents" replace />}
            />
            <Route
              path="/editor/agents"
              element={
                <ProtectedRoute>
                  <Agents />
                </ProtectedRoute>
              }
            />
            <Route
              path="/trash"
              element={
                <ProtectedRoute>
                  <Trash />
                </ProtectedRoute>
              }
            />
            <Route
              path="/workspace"
              element={
                <ProtectedRoute>
                  <Workspace />
                </ProtectedRoute>
              }
            />
            <Route
              path="/quick-setup/chat"
              element={
                <ProtectedRoute>
                  <QuickChatSetup />
                </ProtectedRoute>
              }
            />
            <Route
              path="/quick-setup/:activity"
              element={
                <ProtectedRoute>
                  <QuickAgentSetup />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <UserAdministration />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/logs"
              element={
                <ProtectedRoute>
                  <AdminLogs />
                </ProtectedRoute>
              }
            />
            <Route
              path="/item/:id"
              element={
                <ProtectedRoute>
                  <ItemPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/store/:id"
              element={
                <ProtectedRoute>
                  <StoreItemDetail />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Standalone editor routes (wrapped in SessionLayout internally) */}
          <Route
            path="/code"
            element={
              <ProtectedRoute>
                <Code />
              </ProtectedRoute>
            }
          />
          <Route
            path="/images"
            element={
              <ProtectedRoute>
                <Images />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sound"
            element={
              <ProtectedRoute>
                <Sound />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scene-editor"
            element={
              <ProtectedRoute>
                <SceneEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/preview"
            element={
              <ProtectedRoute>
                <Preview />
              </ProtectedRoute>
            }
          />
          <Route
            path="/image-editor"
            element={
              <ProtectedRoute>
                <ImageEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/editor/images"
            element={
              <ProtectedRoute>
                <ImageEditor />
              </ProtectedRoute>
            }
          />

          {/* Session routes use SessionLayout (embedded in Chat component) */}
          <Route
            path="/session"
            element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:sessionId"
            element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:sessionId/chat"
            element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:sessionId/code"
            element={
              <ProtectedRoute>
                <Code />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:sessionId/images"
            element={
              <ProtectedRoute>
                <Images />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:sessionId/sound"
            element={
              <ProtectedRoute>
                <Sound />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:sessionId/scene-editor"
            element={
              <ProtectedRoute>
                <SceneEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:sessionId/preview"
            element={
              <ProtectedRoute>
                <Preview />
              </ProtectedRoute>
            }
          />

          {/* Split view routes - e.g., /session/:id/code+preview */}
          <Route
            path="/session/:sessionId/:pages"
            element={
              <ProtectedRoute>
                <SplitViewRouter />
              </ProtectedRoute>
            }
          />

          {/* Live Workspace routes - /github/:owner/:repo/:branch/:page */}
          <Route
            path="/github/:owner/:repo/:branch/code"
            element={
              <ProtectedRoute>
                <WorkspaceCode />
              </ProtectedRoute>
            }
          />
          <Route
            path="/github/:owner/:repo/:branch/images"
            element={
              <ProtectedRoute>
                <WorkspaceImages />
              </ProtectedRoute>
            }
          />
          <Route
            path="/github/:owner/:repo/:branch/sounds"
            element={
              <ProtectedRoute>
                <WorkspaceSounds />
              </ProtectedRoute>
            }
          />
          <Route
            path="/github/:owner/:repo/:branch/scenes"
            element={
              <ProtectedRoute>
                <WorkspaceScenes />
              </ProtectedRoute>
            }
          />
          <Route
            path="/github/:owner/:repo/:branch/chat"
            element={
              <ProtectedRoute>
                <WorkspaceChat />
              </ProtectedRoute>
            }
          />
          <Route
            path="/github/:owner/:repo/:branch/preview"
            element={
              <ProtectedRoute>
                <WorkspacePreview />
              </ProtectedRoute>
            }
          />
          {/* Default workspace route redirects to code */}
          <Route
            path="/github/:owner/:repo/:branch"
            element={<Navigate to="code" replace />}
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
