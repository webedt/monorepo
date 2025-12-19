#!/usr/bin/env node

/**
 * WebEDT Process Orchestrator
 *
 * Starts all services as separate processes:
 * - website/server (port 3000) - public facing, serves React + proxies API
 * - internal-api-server (port 3001) - internal API with Claude Remote Sessions
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// Configuration from environment
const WEBSITE_PORT = process.env.WEBSITE_PORT || '3000';
const API_PORT = process.env.API_PORT || '3001';

// Process tracking
const processes = new Map();
let isShuttingDown = false;

/**
 * Start a service as a child process
 */
function startService(name, cwd, env = {}) {
  console.log(`[Orchestrator] Starting ${name}...`);

  const proc = spawn('node', ['dist/index.js'], {
    cwd: path.join(ROOT_DIR, cwd),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Forward stdout with prefix
  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) console.log(`[${name}] ${line}`);
    });
  });

  // Forward stderr with prefix
  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) console.error(`[${name}] ${line}`);
    });
  });

  // Handle exit
  proc.on('exit', (code, signal) => {
    console.log(`[Orchestrator] ${name} exited (code: ${code}, signal: ${signal})`);
    processes.delete(name);

    if (!isShuttingDown) {
      console.log(`[Orchestrator] Restarting ${name} in 2 seconds...`);
      setTimeout(() => startService(name, cwd, env), 2000);
    }
  });

  proc.on('error', (err) => {
    console.error(`[Orchestrator] ${name} error:`, err);
  });

  processes.set(name, proc);
  return proc;
}

/**
 * Graceful shutdown
 */
function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Orchestrator] ${signal} received, shutting down...`);

  for (const [name, proc] of processes) {
    console.log(`[Orchestrator] Stopping ${name}...`);
    proc.kill('SIGTERM');
  }

  // Force exit after timeout
  setTimeout(() => {
    console.log('[Orchestrator] Force exiting...');
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Main startup
 */
async function main() {
  console.log('='.repeat(60));
  console.log('WebEDT Process Orchestrator');
  console.log('='.repeat(60));
  console.log(`Website:    http://localhost:${WEBSITE_PORT}`);
  console.log(`API:        http://localhost:${API_PORT}`);
  console.log('='.repeat(60));
  console.log('');

  // Start internal-api-server first (others may depend on it)
  startService('api', 'internal-api-server', { PORT: API_PORT });

  // Wait a bit for API to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Start website server
  startService('website', 'website/server', {
    PORT: WEBSITE_PORT,
    INTERNAL_API_URL: `http://localhost:${API_PORT}`
  });

  console.log('');
  console.log('[Orchestrator] All services started');
  console.log('[Orchestrator] Press Ctrl+C to stop');
}

main().catch(err => {
  console.error('[Orchestrator] Fatal error:', err);
  process.exit(1);
});
