/**
 * TODO Scanner Service
 * Scans source files for TODO, FIXME, HACK comments
 */

import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { logger } from '../utils/logging/logger.js';

import type { DiscoveredTask } from './types.js';
import type { TodoScanOptions } from './types.js';
import type { TaskPriority } from './types.js';
import type { DiscoveredTaskType } from './types.js';

const DEFAULT_PATTERNS = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG'];

const DEFAULT_INCLUDE = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.py',
  '**/*.go',
  '**/*.rs',
  '**/*.java',
  '**/*.rb',
  '**/*.php',
  '**/*.css',
  '**/*.scss',
  '**/*.html',
  '**/*.md',
];

const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/vendor/**',
  '**/__pycache__/**',
  '**/target/**',
  // Documentation files (often contain example TODOs)
  '**/README.md',
  '**/CHANGELOG.md',
  '**/CONTRIBUTING.md',
  '**/LICENSE.md',
  '**/PLAN.md',
  '**/EXAMPLE*.md',
  '**/*.example.*',
  // Test fixtures and snapshots
  '**/__snapshots__/**',
  '**/fixtures/**',
  '**/*.snap',
  // Type definitions and doc files (contain TODOs from upstream or examples)
  '**/*.d.ts',
  '**/*.doc.ts',
  '**/node/**',
  // Old/archived directories
  '**/*-old/**',
  '**/*-backup/**',
  '**/archive/**',
];

export class TodoScannerService {
  async scan(rootDir: string, options?: TodoScanOptions): Promise<DiscoveredTask[]> {
    const patterns = options?.patterns || DEFAULT_PATTERNS;
    const include = options?.include || DEFAULT_INCLUDE;
    const exclude = options?.exclude || DEFAULT_EXCLUDE;

    logger.info('Starting TODO scan', {
      component: 'TodoScannerService',
      rootDir,
      patterns,
    });

    const files = await this.findFiles(rootDir, include, exclude);
    const tasks: DiscoveredTask[] = [];

    for (const file of files) {
      const fileTasks = await this.scanFile(file, rootDir, patterns);
      tasks.push(...fileTasks);
    }

    logger.info('TODO scan complete', {
      component: 'TodoScannerService',
      filesScanned: files.length,
      tasksFound: tasks.length,
    });

    return tasks;
  }

  private async findFiles(
    rootDir: string,
    include: string[],
    exclude: string[]
  ): Promise<string[]> {
    const files = await fg(include, {
      cwd: rootDir,
      ignore: exclude,
      absolute: true,
      onlyFiles: true,
    });

    return files;
  }

  private async scanFile(
    filePath: string,
    rootDir: string,
    patterns: string[]
  ): Promise<DiscoveredTask[]> {
    const tasks: DiscoveredTask[] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const relativePath = path.relative(rootDir, filePath);

      // Build regex pattern: TODO:, TODO(user):, TODO -, etc.
      // Must be preceded by comment markers (// or /* or # or <!-- or *)
      const patternRegex = new RegExp(
        `(?:^\\s*(?:\\/\\/|\\/\\*|#|<!--|\\*)\\s*).*\\b(${patterns.join('|')})\\s*[:(-]?\\s*(.*)$`,
        'i'
      );

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(patternRegex);

        if (match) {
          const rawType = match[1].toLowerCase();
          const text = match[2].trim();

          // Skip empty TODO comments
          if (!text) continue;

          // Normalize type
          let type: DiscoveredTaskType;
          if (rawType === 'bug' || rawType === 'xxx' || rawType === 'fixme') {
            type = 'fixme';
          } else if (rawType === 'hack') {
            type = 'hack';
          } else {
            type = 'todo';
          }

          const priority = this.extractPriority(text, rawType);

          tasks.push({
            type,
            file: relativePath,
            line: i + 1,
            text,
            priority,
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to scan file', {
        component: 'TodoScannerService',
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return tasks;
  }

  private extractPriority(text: string, type: string): TaskPriority {
    const lowerText = text.toLowerCase();

    // Explicit priority markers
    if (lowerText.includes('[critical]') || lowerText.includes('(critical)')) {
      return 'critical';
    }
    if (lowerText.includes('[high]') || lowerText.includes('(high)') || lowerText.includes('!important')) {
      return 'high';
    }
    if (lowerText.includes('[low]') || lowerText.includes('(low)')) {
      return 'low';
    }

    // Type-based defaults
    if (type === 'fixme' || type === 'bug' || type === 'xxx') {
      return 'high';
    }
    if (type === 'hack') {
      return 'medium';
    }

    // Keyword-based priority
    if (lowerText.includes('security') || lowerText.includes('vulnerability')) {
      return 'critical';
    }
    if (lowerText.includes('urgent') || lowerText.includes('asap')) {
      return 'high';
    }
    if (lowerText.includes('later') || lowerText.includes('someday') || lowerText.includes('nice to have')) {
      return 'low';
    }

    return 'medium';
  }
}
