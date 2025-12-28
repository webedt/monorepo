/**
 * Discover Command
 * Scans the repository for tasks (TODOs, SPEC items, code analysis)
 */

import { Command } from 'commander';
import * as path from 'path';
import {
  TodoScannerService,
  SpecReaderService,
  getGitHubCredentials,
} from '@webedt/shared';

import type { DiscoveredTask } from '@webedt/shared';

export const discoverCommand = new Command('discover')
  .description('Discover tasks from TODOs, SPEC.md, and code analysis')
  .option('--dry-run', 'Show discovered tasks without creating issues')
  .option('--todos-only', 'Only scan for TODO/FIXME comments')
  .option('--root <path>', 'Repository root directory', process.cwd())
  .action(async (options) => {
    const rootDir = path.resolve(options.root);

    console.log('\nDiscovering tasks in:', rootDir);
    console.log('='.repeat(60));

    const allTasks: DiscoveredTask[] = [];

    // 1. Scan for TODOs
    console.log('\n1. Scanning for TODO/FIXME/HACK comments...');
    const todoScanner = new TodoScannerService();
    const todos = await todoScanner.scan(rootDir);
    console.log(`   Found ${todos.length} TODO comments`);
    allTasks.push(...todos);

    if (!options.todosOnly) {
      // 2. Parse SPEC.md
      console.log('\n2. Parsing .aidev/SPEC.md...');
      const specReader = new SpecReaderService();
      const specTasks = await specReader.getUnimplementedTasks(rootDir);
      console.log(`   Found ${specTasks.length} unimplemented features`);

      // Convert spec tasks to discovered tasks format
      for (const spec of specTasks) {
        allTasks.push({
          type: 'spec',
          file: '.aidev/SPEC.md',
          line: 0,
          text: `${spec.feature}: ${spec.description}`,
          priority: 'medium',
        });
      }

      // 3. Code analysis (requires Claude auth)
      console.log('\n3. Code analysis...');
      const credentials = getGitHubCredentials({});

      if (!credentials) {
        console.log('   Skipped: No GitHub token available');
      } else {
        // TODO: Implement code analysis when ClaudeWebClient is available
        console.log('   Skipped: Claude analysis not yet implemented');
      }
    }

    // Display results
    console.log('\n' + '='.repeat(60));
    console.log(`Total tasks discovered: ${allTasks.length}`);
    console.log('='.repeat(60));

    if (allTasks.length === 0) {
      console.log('\nNo tasks found!');
      return;
    }

    // Group by priority
    const byPriority = {
      critical: allTasks.filter((t) => t.priority === 'critical'),
      high: allTasks.filter((t) => t.priority === 'high'),
      medium: allTasks.filter((t) => t.priority === 'medium'),
      low: allTasks.filter((t) => t.priority === 'low'),
    };

    for (const [priority, tasks] of Object.entries(byPriority)) {
      if (tasks.length === 0) continue;

      console.log(`\n${priority.toUpperCase()} Priority (${tasks.length}):`);
      console.log('-'.repeat(40));

      for (const task of tasks.slice(0, 10)) {
        const location = task.line > 0 ? `${task.file}:${task.line}` : task.file;
        console.log(`  [${task.type.toUpperCase()}] ${location}`);
        console.log(`    ${task.text.slice(0, 80)}${task.text.length > 80 ? '...' : ''}`);
      }

      if (tasks.length > 10) {
        console.log(`  ... and ${tasks.length - 10} more`);
      }
    }

    if (options.dryRun) {
      console.log('\n[Dry run] No issues created.');
    } else {
      console.log('\nTo sync these tasks to GitHub Projects, run:');
      console.log('  auto-task sync --project <number>');
    }
  });
