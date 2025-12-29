/**
 * Status Command
 * Shows current auto-task state and statistics
 */

import { Command } from 'commander';
import * as path from 'path';
import { StateManager } from '../state/index.js';

export const statusCommand = new Command('status')
  .description('Show current auto-task status and statistics')
  .option('--root <path>', 'Repository root directory', process.cwd())
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const rootDir = path.resolve(options.root);
    const stateManager = new StateManager(rootDir);
    const state = stateManager.getState();
    const stats = stateManager.getStats();

    if (options.json) {
      console.log(JSON.stringify({ state, stats }, null, 2));
      return;
    }

    console.log('\nAuto-Task Status');
    console.log('='.repeat(60));

    // Config
    const config = state.config;
    if (config.owner && config.repo) {
      console.log(`\nRepository: ${config.owner}/${config.repo}`);
      console.log(`Project: #${config.projectNumber}`);
    } else {
      console.log('\nNo repository configured. Run `auto-task sync` first.');
    }

    // Stats
    console.log('\nTask Statistics:');
    console.log('-'.repeat(40));
    console.log(`  Total tasks: ${stats.total}`);

    if (stats.total > 0) {
      console.log('\n  By Status:');
      for (const [status, count] of Object.entries(stats.byStatus)) {
        const bar = '█'.repeat(Math.min(count, 20));
        console.log(`    ${status.padEnd(12)} ${String(count).padStart(3)} ${bar}`);
      }

      console.log('\n  By Source:');
      for (const [source, count] of Object.entries(stats.bySource)) {
        console.log(`    ${source.padEnd(12)} ${count}`);
      }

      if (stats.errorCount > 0) {
        console.log(`\n  Tasks with errors: ${stats.errorCount}`);
      }
    }

    // Recent activity
    console.log('\nRecent Activity:');
    console.log('-'.repeat(40));

    if (state.lastDiscoveryRun) {
      const ago = timeAgo(new Date(state.lastDiscoveryRun));
      console.log(`  Last discovery: ${ago}`);
    } else {
      console.log('  Last discovery: never');
    }

    if (state.lastDaemonRun) {
      const ago = timeAgo(new Date(state.lastDaemonRun));
      console.log(`  Last daemon run: ${ago}`);
    } else {
      console.log('  Last daemon run: never');
    }

    // Limits
    console.log('\nLimits:');
    console.log('-'.repeat(40));
    console.log(`  Max backlog before throttling: ${config.maxBacklog}`);
    console.log(`  Max ready tasks: ${config.maxReady}`);
    console.log(`  Max in-progress tasks: ${config.maxInProgress}`);

    // Tasks in progress
    const inProgress = stateManager.getTasks('in_progress');
    if (inProgress.length > 0) {
      console.log('\nTasks In Progress:');
      console.log('-'.repeat(40));
      for (const task of inProgress) {
        console.log(`  #${task.issueNumber}: ${task.title.slice(0, 50)}...`);
        if (task.sessionId) {
          console.log(`    Session: ${task.sessionId}`);
        }
      }
    }

    // Tasks in review
    const inReview = stateManager.getTasks('in_review');
    if (inReview.length > 0) {
      console.log('\nTasks In Review:');
      console.log('-'.repeat(40));
      for (const task of inReview) {
        console.log(`  #${task.issueNumber}: ${task.title.slice(0, 50)}...`);
        if (task.prNumber) {
          console.log(`    PR: #${task.prNumber}`);
        }
      }
    }

    // Errors
    const tasksWithErrors = state.tasks.filter((t) => t.errorCount > 0);
    if (tasksWithErrors.length > 0) {
      console.log('\nTasks with Errors:');
      console.log('-'.repeat(40));
      for (const task of tasksWithErrors.slice(0, 5)) {
        console.log(`  #${task.issueNumber}: ${task.title.slice(0, 40)}... (${task.errorCount} errors)`);
        if (task.lastError) {
          console.log(`    Last error: ${task.lastError.slice(0, 60)}...`);
        }
      }
      if (tasksWithErrors.length > 5) {
        console.log(`  ... and ${tasksWithErrors.length - 5} more with errors`);
      }
    }

    console.log('');
  });

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
