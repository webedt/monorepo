import { defineConfig } from 'vite';
import { resolve } from 'path';

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '3000', 10);
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '3001', 10);

export default defineConfig({
  // Use relative paths so the app works at any path prefix
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: FRONTEND_PORT,
    host: true,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        // Disable timeout for SSE connections
        timeout: 0,
        proxyTimeout: 0,
        // SSE-specific configuration to prevent buffering and timeouts
        configure: (proxy) => {
          // Disable socket timeout for long-running SSE connections
          proxy.on('proxyReq', (proxyReq, req) => {
            // Set headers for SSE endpoints to prevent buffering
            if (req.url?.includes('/stream') || req.headers.accept?.includes('text/event-stream')) {
              proxyReq.setHeader('Accept', 'text/event-stream');
              proxyReq.setHeader('Cache-Control', 'no-cache');
              proxyReq.setHeader('Connection', 'keep-alive');
              // Disable socket timeout
              if (proxyReq.socket) {
                proxyReq.socket.setTimeout(0);
              }
            }
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // Disable buffering for SSE responses
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              res.setHeader('X-Accel-Buffering', 'no');
              res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
              res.setHeader('Connection', 'keep-alive');
              // Disable socket timeout on response
              if (res.socket) {
                res.socket.setTimeout(0);
              }
            }
          });
        },
      },
    },
  },
  preview: {
    port: FRONTEND_PORT,
    host: true,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        timeout: 0,
        // SSE-specific configuration
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.includes('/stream') || req.headers.accept?.includes('text/event-stream')) {
              proxyReq.setHeader('Accept', 'text/event-stream');
              proxyReq.setHeader('Cache-Control', 'no-cache');
              proxyReq.setHeader('Connection', 'keep-alive');
              if (proxyReq.socket) {
                proxyReq.socket.setTimeout(0);
              }
            }
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              res.setHeader('X-Accel-Buffering', 'no');
              res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
              res.setHeader('Connection', 'keep-alive');
              if (res.socket) {
                res.socket.setTimeout(0);
              }
            }
          });
        },
      },
    },
  },
});
