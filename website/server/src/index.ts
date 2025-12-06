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
const INTERNAL_API_URL = process.env.INTERNAL_API_URL;

if (!INTERNAL_API_URL) {
  console.error('ERROR: INTERNAL_API_URL environment variable is required');
  process.exit(1);
}

// CORS configuration
const ALLOWED_ORIGINS = NODE_ENV === 'production'
  ? ['https://webedt.etdofresh.com', 'https://github.etdofresh.com']
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

// Define which API routes are allowed to be proxied (whitelist)
// This controls what the public can access - internal-only routes are blocked
const ALLOWED_API_ROUTES = [
  '/api/auth',           // Authentication
  '/api/user',           // User settings
  '/api/sessions',       // Session management (public endpoints)
  '/api/github',         // GitHub OAuth & repos
  '/api/execute',        // AI execution
  '/api/resume',         // Session replay
  '/api/transcribe',     // Audio transcription
  '/api/admin',          // Admin (requires admin auth anyway)
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

// Proxy middleware for /api routes
const apiProxyOptions: Options = {
  target: INTERNAL_API_URL,
  changeOrigin: true,
  // Preserve the full path including /api prefix
  pathRewrite: (path, req) => '/api' + path,
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
      // Log proxied requests in development
      if (NODE_ENV === 'development') {
        console.log(`[Proxy] ${req.method} ${req.url} -> ${INTERNAL_API_URL}${req.url}`);
      }
    },
  },
};

// API proxy with route filtering
app.use('/api', (req, res, next) => {
  const fullPath = '/api' + req.path;

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
}, createProxyMiddleware(apiProxyOptions));

// Allow read-only storage file access (for viewing images, etc.)
// GET /api/storage/sessions/:sessionPath/files/* is allowed
app.use('/api/storage/sessions/:sessionPath/files', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
  } else {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Only GET requests allowed for file access'
    });
  }
}, createProxyMiddleware(apiProxyOptions));

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
