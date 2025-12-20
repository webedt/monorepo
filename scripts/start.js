#!/usr/bin/env node
/**
 * Production start script
 * Runs both Vite preview server (port 3000) and backend API (port 3001)
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = join(__dirname, '..');

console.log('Starting WebEDT services...');
console.log('');

// Start backend on port 3001
const backend = spawn('node', ['dist/index.js'], {
  cwd: join(appRoot, 'website/backend'),
  stdio: 'inherit',
  env: { ...process.env, PORT: '3001' }
});

// Start Vite preview on port 3000
const frontend = spawn('npx', ['vite', 'preview', '--port', '3000', '--host'], {
  cwd: join(appRoot, 'website/frontend'),
  stdio: 'inherit',
  env: process.env
});

// Handle process termination
const cleanup = () => {
  console.log('Shutting down services...');
  backend.kill();
  frontend.kill();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Handle child process errors
backend.on('error', (err) => {
  console.error('Backend failed to start:', err);
  process.exit(1);
});

frontend.on('error', (err) => {
  console.error('Frontend failed to start:', err);
  process.exit(1);
});

// If either process exits, exit the parent
backend.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Backend exited with code ${code}`);
    frontend.kill();
    process.exit(code || 1);
  }
});

frontend.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Frontend exited with code ${code}`);
    backend.kill();
    process.exit(code || 1);
  }
});

console.log('Frontend (Vite preview): http://localhost:3000');
console.log('Backend (API):           http://localhost:3001');
console.log('');
