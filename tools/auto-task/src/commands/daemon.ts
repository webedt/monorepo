/**
 * Daemon Command
 * Runs continuous task processing loop
 */

import { Command } from 'commander';
import * as path from 'path';
import {
  TodoScannerService,
  SpecReaderService,
  GitHubIssuesService,
  GitHubProjectsService,
  ClaudeWebClient,
  getGitHubCredentials,
  getClaudeCredentials,
} from '@webedt/shared';

import { StateManager } from '../state/index.js';

import type { ClaudeAuth } from '@webedt/shared';
import type { TaskState } from '../state/types.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export const daemonCommand = new Command('daemon')
  .description('Run continuous task processing daemon')
  .requiredOption('--project <number>', 'GitHub Project number', parseInt)
  .option('--owner <owner>', 'Repository owner')
  .option('--repo <repo>', 'Repository name')
  .option('--root <path>', 'Repository root directory', process.cwd())
  .option('--poll-interval <ms>', 'Poll interval in milliseconds', parseInt)
  .option('--once', 'Run once and exit')
  .action(async (options) => {
    const rootDir = path.resolve(options.root);
    const pollInterval = options.pollInterval || POLL_INTERVAL_MS;

    console.log('\nAuto-Task Daemon Starting');
    console.log('='.repeat(60));

    // Get credentials
    const githubCreds = getGitHubCredentials({});
    if (!githubCreds) {
      console.error('Error: GitHub token not found');
      process.exit(1);
    }

    const claudeCreds = await getClaudeCredentials();
    if (!claudeCreds) {
      console.warn('Warning: Claude credentials not found');
      console.warn('Task execution will be disabled');
    }

    // Determine owner/repo
    const { owner, repo } = await getOwnerRepo(rootDir, options);

    console.log(`Repository: ${owner}/${repo}`);
    console.log(`Project: #${options.project}`);
    console.log(`Poll interval: ${pollInterval / 1000}s`);
    console.log('');

    // Initialize services
    const stateManager = new StateManager(rootDir);
    const issuesService = new GitHubIssuesService(githubCreds.token);
    const projectsService = new GitHubProjectsService(githubCreds.token);

    // Ensure project cache
    let projectCache = stateManager.getProjectCache();
    if (!stateManager.isProjectCacheValid()) {
      console.log('Fetching project info...');
      const project = await projectsService.getProject(owner, options.project);
      const statusField = await projectsService.getStatusField(project.id);

      projectCache = {
        projectId: project.id,
        statusFieldId: statusField.fieldId,
        statusOptions: Object.fromEntries(
          statusField.options.map((o) => [o.name.toLowerCase(), o.id])
        ),
        cachedAt: new Date().toISOString(),
      };
      stateManager.setProjectCache(projectCache);
    }

    stateManager.setConfig({
      owner,
      repo,
      projectNumber: options.project,
    });

    const context: DaemonContext = {
      rootDir,
      owner,
      repo,
      stateManager,
      issuesService,
      projectsService,
      projectCache: projectCache!,
      claudeAuth: claudeCreds ?? undefined,
      githubToken: githubCreds.token,
    };

    // Main loop
    let running = true;

    process.on('SIGINT', () => {
      console.log('\nReceived SIGINT, shutting down...');
      running = false;
    });

    process.on('SIGTERM', () => {
      console.log('\nReceived SIGTERM, shutting down...');
      running = false;
    });

    while (running) {
      try {
        await runDaemonCycle(context);
        stateManager.updateLastDaemonRun();
      } catch (error) {
        console.error('Daemon cycle error:', error);
      }

      if (options.once) {
        console.log('\nRan once, exiting.');
        break;
      }

      console.log(`\nSleeping for ${pollInterval / 1000}s...`);
      await sleep(pollInterval);
    }

    console.log('\nDaemon stopped.');
  });

interface DaemonContext {
  rootDir: string;
  owner: string;
  repo: string;
  stateManager: StateManager;
  issuesService: GitHubIssuesService;
  projectsService: GitHubProjectsService;
  projectCache: {
    projectId: string;
    statusFieldId: string;
    statusOptions: Record<string, string>;
    cachedAt: string;
  };
  claudeAuth?: ClaudeAuth;
  githubToken: string;
}

async function runDaemonCycle(ctx: DaemonContext): Promise<void> {
  const { stateManager } = ctx;
  const config = stateManager.getState().config;

  console.log('\n--- Daemon Cycle ---');
  console.log(new Date().toISOString());

  // Step 1: Discover new tasks
  console.log('\n1. Discovering tasks...');
  await discoverAndSync(ctx);

  // Step 2: Move backlog -> ready (top 3 by priority)
  console.log('\n2. Moving tasks to Ready...');
  await moveBacklogToReady(ctx, config.maxReady);

  // Step 3: Move ready -> in_progress (max 3)
  console.log('\n3. Starting task execution...');
  await startTasks(ctx, config.maxInProgress);

  // Step 4: Check in_progress tasks
  console.log('\n4. Checking in-progress tasks...');
  await checkInProgressTasks(ctx);

  // Step 5: Review completed tasks
  console.log('\n5. Reviewing completed tasks...');
  await reviewCompletedTasks(ctx);

  // Print summary
  const stats = stateManager.getStats();
  console.log('\nStatus:', Object.entries(stats.byStatus).map(([k, v]) => `${k}:${v}`).join(' '));
}

async function discoverAndSync(ctx: DaemonContext): Promise<void> {
  const { rootDir, owner, repo, stateManager, issuesService, projectsService, projectCache } = ctx;
  const backlogCount = stateManager.getTasks('backlog').length;

  // Check throttling
  if (backlogCount > 10) {
    console.log('   Backlog >10, only scanning TODOs');
  }

  const todoScanner = new TodoScannerService();
  const todos = await todoScanner.scan(rootDir);

  // Get existing issues
  const existingIssues = await issuesService.listIssues(owner, repo, {
    labels: ['auto-task'],
    state: 'open',
  });
  const existingTitles = new Set(existingIssues.map((i) => i.title));

  // Find new tasks
  let created = 0;
  for (const todo of todos) {
    const title = `[${todo.type.toUpperCase()}] ${todo.text.slice(0, 80)}`;
    if (existingTitles.has(title)) continue;

    try {
      const issue = await issuesService.createIssue(owner, repo, {
        title,
        body: `**File:** \`${todo.file}:${todo.line}\`\n\n${todo.text}\n\n---\n*Created by auto-task*`,
        labels: ['auto-task', todo.type],
      });

      const { itemId } = await projectsService.addItemToProject(
        projectCache.projectId,
        issue.nodeId
      );

      const backlogId = projectCache.statusOptions['backlog'];
      if (backlogId) {
        await projectsService.updateItemStatus(
          projectCache.projectId,
          itemId,
          projectCache.statusFieldId,
          backlogId
        );
      }

      stateManager.addTask({
        issueNumber: issue.number,
        issueNodeId: issue.nodeId,
        projectItemId: itemId,
        title,
        status: 'backlog',
        priority: todo.priority === 'critical' ? 200 : todo.priority === 'high' ? 100 : 50,
        source: todo.type as 'todo' | 'spec' | 'analysis',
      });

      created++;
    } catch (error) {
      console.error(`   Failed to create issue: ${error}`);
    }
  }

  console.log(`   Created ${created} new issues`);
}

async function moveBacklogToReady(ctx: DaemonContext, maxReady: number): Promise<void> {
  const { stateManager, projectsService, projectCache } = ctx;

  const readyCount = stateManager.getTasks('ready').length;
  const slotsAvailable = maxReady - readyCount;

  if (slotsAvailable <= 0) {
    console.log('   Ready queue full');
    return;
  }

  const backlog = stateManager.getTasks('backlog')
    .sort((a, b) => b.priority - a.priority)
    .slice(0, slotsAvailable);

  const readyId = projectCache.statusOptions['ready'];
  if (!readyId) {
    console.log('   No "Ready" column found');
    return;
  }

  for (const task of backlog) {
    try {
      if (task.projectItemId) {
        await projectsService.updateItemStatus(
          projectCache.projectId,
          task.projectItemId,
          projectCache.statusFieldId,
          readyId
        );
      }

      stateManager.updateTask(task.id, { status: 'ready' });
      console.log(`   Moved #${task.issueNumber} to Ready`);
    } catch (error) {
      console.error(`   Failed to move task: ${error}`);
    }
  }
}

async function startTasks(ctx: DaemonContext, maxInProgress: number): Promise<void> {
  const { stateManager, projectsService, projectCache, claudeAuth, owner, repo } = ctx;

  if (!claudeAuth) {
    console.log('   Skipping: No Claude credentials');
    return;
  }

  const inProgressCount = stateManager.getTasks('in_progress').length;
  const slotsAvailable = maxInProgress - inProgressCount;

  if (slotsAvailable <= 0) {
    console.log('   In-progress slots full');
    return;
  }

  const ready = stateManager.getTasks('ready')
    .sort((a, b) => b.priority - a.priority)
    .slice(0, slotsAvailable);

  const inProgressId = projectCache.statusOptions['in progress'];
  if (!inProgressId) {
    console.log('   No "In Progress" column found');
    return;
  }

  for (const task of ready) {
    try {
      // Update status
      if (task.projectItemId) {
        await projectsService.updateItemStatus(
          projectCache.projectId,
          task.projectItemId,
          projectCache.statusFieldId,
          inProgressId
        );
      }

      stateManager.updateTask(task.id, { status: 'in_progress' });

      // Start Claude execution
      console.log(`   Starting #${task.issueNumber}: ${task.title.slice(0, 40)}...`);

      // TODO: Actually execute with ClaudeWebClient
      // For now, just mark it
      // const client = new ClaudeWebClient({...});
      // const result = await client.execute({...});

    } catch (error) {
      console.error(`   Failed to start task: ${error}`);
      stateManager.incrementError(task.id, String(error));
    }
  }
}

async function checkInProgressTasks(ctx: DaemonContext): Promise<void> {
  const { stateManager, projectsService, projectCache } = ctx;

  const inProgress = stateManager.getTasks('in_progress');
  if (inProgress.length === 0) {
    console.log('   No tasks in progress');
    return;
  }

  const inReviewId = projectCache.statusOptions['in review'];

  for (const task of inProgress) {
    // TODO: Check if Claude session is complete
    // For now, skip
    console.log(`   Checking #${task.issueNumber}...`);
  }
}

async function reviewCompletedTasks(ctx: DaemonContext): Promise<void> {
  const { stateManager, projectsService, projectCache } = ctx;

  const inReview = stateManager.getTasks('in_review');
  if (inReview.length === 0) {
    console.log('   No tasks to review');
    return;
  }

  const doneId = projectCache.statusOptions['done'];

  for (const task of inReview) {
    // TODO: Run CodeReviewerService on PR
    console.log(`   Reviewing #${task.issueNumber}...`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOwnerRepo(
  rootDir: string,
  options: { owner?: string; repo?: string }
): Promise<{ owner: string; repo: string }> {
  if (options.owner && options.repo) {
    return { owner: options.owner, repo: options.repo };
  }

  try {
    const { execSync } = await import('child_process');
    const remote = execSync('git remote get-url origin', {
      cwd: rootDir,
      encoding: 'utf-8',
    }).trim();

    const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // Ignore
  }

  console.error('Error: Could not determine owner/repo');
  process.exit(1);
}
