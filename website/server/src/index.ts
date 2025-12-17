import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configuration
const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:3001';

if (!INTERNAL_API_URL) {
  console.error('ERROR: INTERNAL_API_URL environment variable is required');
  process.exit(1);
}

// CORS configuration
const ALLOWED_ORIGINS = NODE_ENV === 'production'
  ? ['https://webedt.etdofresh.com']
  : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));

// Health check endpoint (not proxied)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'website-server',
    timestamp: new Date().toISOString(),
  });
});

// JSON body parser for API routes
// This is needed so we can re-stream the body to the proxy
// Without this, http-proxy-middleware doesn't forward POST bodies correctly
// for path-prefixed routes like /github/owner/repo/branch/api/*
app.use('/github/:owner/:repo/:branch/api', express.json({ limit: '10mb' }));
app.use('/:segment1/:segment2/:segment3/api', express.json({ limit: '10mb' }));
app.use('/api', express.json({ limit: '10mb' }));

// Define which API routes are allowed to be proxied (whitelist)
// This controls what the public can access - internal-only routes are blocked
const ALLOWED_API_ROUTES = [
  '/api/auth',           // Authentication
  '/api/user',           // User settings
  '/api/sessions',       // Session management (public endpoints)
  '/api/github',         // GitHub OAuth & repos
  '/api/execute',        // AI execution (local worker)
  '/api/execute-remote', // AI execution (Claude Remote Sessions API)
  '/api/resume',         // Session replay
  '/api/transcribe',     // Audio transcription
  '/api/admin',          // Admin (requires admin auth anyway)
  '/api/storage',        // Storage operations (file listing, read, write, delete)
];

// Block internal-only routes explicitly
const BLOCKED_ROUTES = [
  '/api/storage/sessions/*/upload',      // Only ai-worker should upload
  '/api/storage/sessions/*/download',    // Only ai-worker should download tarballs
  '/api/storage/sessions/bulk-delete',   // Internal batch operations
  '/api/sessions/*/worker-status',       // Only ai-worker reports status
];

// Check if a path matches a blocked route pattern
function isBlockedRoute(path: string): boolean {
  return BLOCKED_ROUTES.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$');
    return regex.test(path);
  });
}

// Check if a path matches an allowed route
function isAllowedRoute(path: string): boolean {
  return ALLOWED_API_ROUTES.some(route => path.startsWith(route));
}

// Extract owner/repo/branch prefix from a URL path for cookie scoping
// Patterns:
//   /github/owner/repo/branch/...  (preview via /github prefix) -> /github/owner/repo/branch
//   /owner/repo/branch/...         (standard path-based) -> /owner/repo/branch
// This ensures cookies are scoped to the specific preview branch
function getOwnerRepoBranchPath(urlPath: string): string {
  const segments = urlPath.split('/').filter(Boolean);

  // Check for /github/ prefix pattern: /github/owner/repo/branch/
  if (segments[0] === 'github' && segments.length >= 4) {
    return `/${segments[0]}/${segments[1]}/${segments[2]}/${segments[3]}`;
  }
  // Standard path-based deployment: /owner/repo/branch/
  if (segments.length >= 3) {
    return `/${segments[0]}/${segments[1]}/${segments[2]}`;
  }
  // Fallback for root deployment (2 segments): /owner/repo
  if (segments.length >= 2) {
    return `/${segments[0]}/${segments[1]}`;
  }
  return '/';
}

// Proxy middleware for /api routes
const apiProxyOptions: Options = {
  target: INTERNAL_API_URL,
  changeOrigin: true,
  // Cookie handling for session persistence
  cookieDomainRewrite: '',  // Remove domain restriction so cookies work across proxy
  // Preserve the full path including /api prefix
  // Handle both direct /api/... paths and path-prefixed /github/owner/repo/branch/api/... paths
  pathRewrite: (path, req) => {
    // Log the incoming path for debugging
    console.log(`[Proxy pathRewrite] Received path: ${path}, req.url: ${req.url}`);

    // Extract the /api/... portion from the path, stripping any prefix
    // This handles:
    //   /api/auth/session -> /api/auth/session
    //   /github/owner/repo/branch/api/auth/session -> /api/auth/session
    //   /owner/repo/branch/api/auth/session -> /api/auth/session
    const apiMatch = path.match(/\/api(\/.*)?$/);
    if (apiMatch) {
      const rewrittenPath = apiMatch[0];
      console.log(`[Proxy pathRewrite] Rewritten to: ${rewrittenPath}`);
      return rewrittenPath;
    }

    // Fallback: if path starts with /api, return as-is; otherwise prepend /api
    const rewrittenPath = path.startsWith('/api') ? path : '/api' + path;
    console.log(`[Proxy pathRewrite] Rewritten to: ${rewrittenPath}`);
    return rewrittenPath;
  },
  // Handle proxy errors
  on: {
    error: (err, req, res) => {
      console.error('[Proxy Error]', err.message);
      if (res && 'writeHead' in res) {
        (res as any).writeHead(502, { 'Content-Type': 'application/json' });
        (res as any).end(JSON.stringify({ error: 'Proxy error', message: err.message }));
      }
    },
    proxyReq: (proxyReq, req) => {
      // Forward cookies from the original request
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }

      // Re-stream the body if it was parsed by express.json()
      // This is necessary because express.json() consumes the body stream
      // and http-proxy-middleware needs the body to be written to proxyReq
      const body = (req as express.Request).body;
      if (body && Object.keys(body).length > 0) {
        const bodyData = JSON.stringify(body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }

      // Log proxied requests (always, for debugging)
      console.log(`[Proxy proxyReq] ${req.method} ${req.url} -> ${INTERNAL_API_URL}${proxyReq.path}`);
    },
    proxyRes: (proxyRes, req, res) => {
      // Rewrite cookie path based on the Referer to scope cookies to owner/repo/branch
      // This ensures auth cookies work correctly in preview deployments
      const setCookie = proxyRes.headers['set-cookie'];
      if (setCookie) {
        const referer = req.headers.referer || req.headers.origin || '';
        let cookiePath = '/';

        try {
          if (referer) {
            const refererUrl = new URL(referer);
            cookiePath = getOwnerRepoBranchPath(refererUrl.pathname);
          }
        } catch (e) {
          // If referer parsing fails, fall back to root
          console.log('[Proxy] Failed to parse referer for cookie path:', referer);
        }

        // Rewrite the Path in each Set-Cookie header
        const rewrittenCookies = setCookie.map(cookie => {
          // Replace Path=/... with our computed path
          // Regex matches Path= followed by / and any non-semicolon chars (or end of string)
          // Using a single regex to avoid double-replacement issues
          return cookie.replace(/Path=\/[^;]*/gi, `Path=${cookiePath}`);
        });

        proxyRes.headers['set-cookie'] = rewrittenCookies;
        console.log(`[Proxy] Set-Cookie rewritten for ${req.url} with path=${cookiePath}:`, rewrittenCookies);
      }
    },
  },
};

// Helper function to handle API proxy requests with route filtering
function handleApiProxy(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Extract just the /api/... part from the path (handles both direct and prefixed paths)
  const originalUrl = req.originalUrl;
  const apiMatch = originalUrl.match(/\/api(\/[^?]*)?/);
  const fullPath = apiMatch ? apiMatch[0] : '/api' + req.path;

  // Log ALL API requests for debugging (temporarily enabled in production)
  console.log(`[API Request] ${req.method} ${fullPath} (originalUrl: ${originalUrl})`);

  // Block internal-only routes
  if (isBlockedRoute(fullPath)) {
    console.log(`[Blocked] ${req.method} ${fullPath}`);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'This endpoint is not accessible from the public API'
    });
  }

  // Check if route is in whitelist
  if (!isAllowedRoute(fullPath)) {
    console.log(`[Not Allowed] ${req.method} ${fullPath}`);
    return res.status(404).json({
      error: 'Not Found',
      message: 'Endpoint not found'
    });
  }

  // Proxy the request
  next();
}

// Path-prefixed API routes: /github/:owner/:repo/:branch/api/*
// This handles preview deployments where the app is served at a path prefix
app.use('/github/:owner/:repo/:branch/api', handleApiProxy, createProxyMiddleware(apiProxyOptions));

// Standard owner/repo/branch pattern: /:owner/:repo/:branch/api/*
// Note: This is a catch-all for 3-segment prefixes, placed after /github to avoid conflicts
app.use('/:segment1/:segment2/:segment3/api', (req, res, next) => {
  // Skip if segment1 is 'github' (handled above) or if it looks like an app route
  const segment1 = req.params.segment1;
  if (segment1 === 'github' || segment1 === 'api') {
    return next('route');
  }
  handleApiProxy(req, res, next);
}, createProxyMiddleware(apiProxyOptions));

// Direct API routes: /api/*
app.use('/api', handleApiProxy, createProxyMiddleware(apiProxyOptions));

// Serve static files from the client build
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('Website Server (API Facade)');
  console.log('='.repeat(60));
  console.log(`Port: ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Internal API: ${INTERNAL_API_URL}`);
  console.log(`Client dist: ${clientDistPath}`);
  console.log('');
  console.log('Allowed API routes:');
  ALLOWED_API_ROUTES.forEach(route => console.log(`  ${route}/*`));
  console.log('');
  console.log('Blocked routes (internal only):');
  BLOCKED_ROUTES.forEach(route => console.log(`  ${route}`));
  console.log('='.repeat(60));
});
