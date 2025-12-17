#!/usr/bin/env node

/**
 * Pre-dev script - automatically starts local PostgreSQL if needed
 *
 * Checks:
 * 1. If .env exists and DATABASE_URL contains localhost
 * 2. Starts webedt-postgres Docker container if not running
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const ROOT_DIR = join(__dirname, '..');

const ENV_FILE = join(ROOT_DIR, '.env');
const CONTAINER_NAME = 'webedt-postgres';

function log(msg) {
  console.log(`[predev] ${msg}`);
}

function checkEnvFile() {
  if (!existsSync(ENV_FILE)) {
    log('.env file not found - skipping local DB setup');
    log('Create .env with DATABASE_URL to enable local PostgreSQL');
    return null;
  }

  const envContent = readFileSync(ENV_FILE, 'utf-8');
  const match = envContent.match(/DATABASE_URL=([^\n\r]*)/);

  if (!match) {
    log('DATABASE_URL not found in .env - skipping local DB setup');
    return null;
  }

  return match[1].trim();
}

function isLocalDatabase(url) {
  return url.includes('localhost') || url.includes('127.0.0.1');
}

function isContainerRunning() {
  try {
    const result = execSync(`docker ps --filter "name=${CONTAINER_NAME}" --format "{{.Names}}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}

function containerExists() {
  try {
    const result = execSync(`docker ps -a --filter "name=${CONTAINER_NAME}" --format "{{.Names}}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}

function startContainer() {
  try {
    if (containerExists()) {
      log(`Starting existing ${CONTAINER_NAME} container...`);
      execSync(`docker start ${CONTAINER_NAME}`, { stdio: 'inherit' });
    } else {
      log(`Creating and starting ${CONTAINER_NAME} container...`);
      execSync(
        `docker run -d --name ${CONTAINER_NAME} -p 5432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=webedt postgres:15`,
        { stdio: 'inherit' }
      );
    }
    log('PostgreSQL container started successfully');

    // Wait a moment for PostgreSQL to be ready
    log('Waiting for PostgreSQL to be ready...');
    execSync('sleep 2 || timeout /t 2 >nul', { stdio: 'pipe', shell: true });

    return true;
  } catch (error) {
    log(`Failed to start container: ${error.message}`);
    return false;
  }
}

function main() {
  console.log('');
  log('Checking local development environment...');

  const databaseUrl = checkEnvFile();

  if (!databaseUrl) {
    console.log('');
    return;
  }

  if (!isLocalDatabase(databaseUrl)) {
    log('DATABASE_URL points to remote database - skipping local DB setup');
    console.log('');
    return;
  }

  log('Local DATABASE_URL detected');

  if (isContainerRunning()) {
    log(`${CONTAINER_NAME} is already running`);
    console.log('');
    return;
  }

  startContainer();
  console.log('');
}

main();
