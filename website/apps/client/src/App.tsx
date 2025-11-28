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
import Library from '@/pages/Library';
import Community from '@/pages/Community';
import Sessions from '@/pages/Sessions';
import Trash from '@/pages/Trash';
import Chat from '@/pages/Chat';
import NewSession from '@/pages/NewSession';
import QuickChatSetup from '@/pages/QuickChatSetup';
import QuickSessionSetup from '@/pages/QuickSessionSetup';
import Settings from '@/pages/Settings';
import UserAdministration from '@/pages/UserAdministration';
import Code from '@/pages/Code';
import Images from '@/pages/Images';
import Sound from '@/pages/Sound';
import SceneEditor from '@/pages/SceneEditor';
import Preview from '@/pages/Preview';
import ItemPage from '@/pages/ItemPage';
import LibraryItemPage from '@/pages/LibraryItemPage';

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
    store: '/',
    library: '/library',
    community: '/community',
    sessions: '/sessions',
  };

  // If user has a default landing page set and it's not 'store', redirect
  if (user?.defaultLandingPage && user.defaultLandingPage !== 'store') {
    const redirectPath = landingPageRoutes[user.defaultLandingPage];
    if (redirectPath) {
      return <Navigate to={redirectPath} replace />;
    }
  }

  // Otherwise show the Dashboard (Store)
  return <Dashboard />;
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
    // Example: https://github.etdofresh.com/webedt/website/branch/ -> /webedt/website/branch
    // Monorepo: https://github.etdofresh.com/webedt/monorepo/website/branch/ -> /webedt/monorepo/website/branch
    const pathname = window.location.pathname;

    // Check if we're in a path-based deployment (3+ path segments)
    const pathSegments = pathname.split('/').filter(Boolean);
    if (pathSegments.length >= 3 && !['login', 'register', 'session', 'sessions', 'trash', 'settings', 'admin', 'new-session', 'code', 'images', 'sound', 'scene-editor', 'preview', 'library', 'community', 'item'].includes(pathSegments[0])) {
      // Check for monorepo pattern: /owner/repo/website/branch/
      if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
        return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
      }
      // Standard format: /owner/repo/branch/...
      return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
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
              path="/sessions"
              element={
                <ProtectedRoute>
                  <Sessions />
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
              path="/new-session"
              element={
                <ProtectedRoute>
                  <NewSession />
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
                  <QuickSessionSetup />
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
              path="/item/:id"
              element={
                <ProtectedRoute>
                  <ItemPage />
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

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
