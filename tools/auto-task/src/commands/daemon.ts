/**
 * Daemon Command
 * Runs continuous task processing loop
 *
 * Reads tasks directly from GitHub Project (source of truth).
 * Session tracking is done via GitHub issue comments - no local state.
 */

import { Command } from 'commander';
import * as path from 'path';
import {
  TodoScannerService,
  GitHubIssuesService,
  GitHubProjectsService,
  ClaudeWebClient,
  getGitHubCredentials,
  getClaudeCredentials,
  shouldRefreshClaudeToken,
  DaemonTokenRefreshService,
  GitHubRateLimiter,
} from '@webedt/shared';

import type { ClaudeAuth } from '@webedt/shared';
import type { ClaudeSessionEvent } from '@webedt/shared';
import type { ReviewIssue } from '@webedt/shared';
import type { ProjectItem } from '@webedt/shared';
import type { AutoTaskCommentInfo } from '@webedt/shared';

/**
 * Default poll interval: 5 minutes
 * This is a reasonable default that balances responsiveness with rate limit considerations.
 *
 * GitHub rate limits:
 * - Primary: 5,000 requests/hour (authenticated)
 * - Secondary: 80 content-creation/min, 500/hr
 * - GraphQL: 5,000 points/hour
 *
 * With a 5-minute poll interval:
 * - ~12 cycles/hour
 * - Each cycle makes ~10-20 API calls (varies with task count)
 * - Well under the 5,000/hour limit
 */
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export const daemonCommand = new Command('daemon')
  .description('Run continuous task processing daemon')
  .requiredOption('--project <number>', 'GitHub Project number', parseInt)
  .option('--owner <owner>', 'Repository owner')
  .option('--repo <repo>', 'Repository name')
  .option('--root <path>', 'Repository root directory', process.cwd())
  .option('--poll-interval <ms>', 'Poll interval in milliseconds', parseInt)
  .option('--once', 'Run once and exit')
  .option('--max-ready <n>', 'Max tasks in Ready column', parseInt)
  .option('--max-in-progress <n>', 'Max tasks in In Progress', parseInt)
  .option('--no-discover', 'Disable task discovery (only process existing tasks)')
  .action(async (options) => {
    const rootDir = path.resolve(options.root);
    const pollInterval = options.pollInterval || POLL_INTERVAL_MS;
    const maxReady = options.maxReady || 6;
    const maxInProgress = options.maxInProgress || 6;
    const enableDiscovery = options.discover !== false;

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
    console.log(`Max Ready: ${maxReady}, Max In Progress: ${maxInProgress}`);
    console.log(`Task discovery: ${enableDiscovery ? 'enabled' : 'disabled'}`);
    console.log('');

    // Initialize services
    const issuesService = new GitHubIssuesService(githubCreds.token);
    const projectsService = new GitHubProjectsService(githubCreds.token);

    // Fetch project info (always fresh from GitHub)
    console.log('Fetching project info...');
    const project = await projectsService.getProject(owner, options.project);
    const statusField = await projectsService.getStatusField(project.id);

    const projectCache = {
      projectId: project.id,
      statusFieldId: statusField.fieldId,
      statusOptions: Object.fromEntries(
        statusField.options.map((o) => [o.name.toLowerCase(), o.id])
      ),
    };

    console.log('Project columns:', Object.keys(projectCache.statusOptions).join(', '));

    // Initialize token refresh service
    const tokenRefreshService = new DaemonTokenRefreshService();

    // Initialize rate limiter for GitHub API calls
    const rateLimiter = new GitHubRateLimiter({
      mutationDelayMs: 1000, // 1 second between mutations
      maxMutationsPerMinute: 60, // Conservative (GitHub allows 80)
      maxMutationsPerHour: 400, // Conservative (GitHub allows 500)
      primaryLimitBuffer: 100, // Keep buffer before hitting 5000/hr limit
    });

    const context: DaemonContext = {
      rootDir,
      owner,
      repo,
      issuesService,
      projectsService,
      projectCache,
      claudeAuth: claudeCreds ?? undefined,
      githubToken: githubCreds.token,
      maxReady,
      maxInProgress,
      enableDiscovery,
      tokenRefreshService,
      pollInterval: pollInterval,
      basePollInterval: pollInterval,
      refreshFailureCount: 0,
      issueCooldowns: new Map(),
      rateLimiter,
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
        // Check and refresh token at start of each cycle
        await refreshTokenIfNeeded(context);

        await runDaemonCycle(context);
      } catch (error) {
        console.error('Daemon cycle error:', error);
      }

      if (options.once) {
        console.log('\nRan once, exiting.');
        break;
      }

      console.log(`\nSleeping for ${context.pollInterval / 1000}s...`);
      await sleep(context.pollInterval);
    }

    console.log('\nDaemon stopped.');
  });

/**
 * Tracks cooldown state for an issue to prevent re-processing too quickly
 */
interface IssueCooldown {
  /** Timestamp when the action was taken */
  actionTime: Date;
  /** What action was taken */
  action: 'conflict_resolution' | 'review_started' | 'task_started' | 'rework_started';
  /** Number of cycles we've been waiting */
  cycleCount: number;
  /** Session ID associated with this action (if any) */
  sessionId?: string;
}

/** Default number of cycles to wait before re-checking an issue */
const DEFAULT_COOLDOWN_CYCLES = 3;

/**
 * Maximum time (ms) a session can be "running" before considered stuck.
 * This is the PRIMARY stuck detection mechanism.
 * Set to 30 minutes to give Claude enough time to work.
 */
const MAX_RUNNING_TIME_MS = 30 * 60 * 1000;

/**
 * Number of failed attempts before deprioritizing an issue.
 * After this many timeouts/failures, the issue will be moved to the bottom of backlog.
 */
const MAX_FAILURE_ATTEMPTS = 3;

interface DaemonContext {
  rootDir: string;
  owner: string;
  repo: string;
  issuesService: GitHubIssuesService;
  projectsService: GitHubProjectsService;
  projectCache: {
    projectId: string;
    statusFieldId: string;
    statusOptions: Record<string, string>;
  };
  claudeAuth?: ClaudeAuth;
  githubToken: string;
  maxReady: number;
  maxInProgress: number;
  /** Whether to discover new tasks (TODOs and AI discovery) */
  enableDiscovery: boolean;
  /** Service for refreshing Claude tokens */
  tokenRefreshService: DaemonTokenRefreshService;
  /** Current poll interval (may increase with backoff on refresh failures) */
  pollInterval: number;
  /** Base poll interval (the original value to restore after success) */
  basePollInterval: number;
  /** Count of consecutive token refresh failures */
  refreshFailureCount: number;
  /** Tracks cooldown state for issues to prevent re-processing too quickly */
  issueCooldowns: Map<number, IssueCooldown>;
  /** Rate limiter for GitHub API calls */
  rateLimiter: GitHubRateLimiter;
}

/**
 * Execute a GitHub API call with rate limiting.
 * @param ctx - Daemon context containing the rate limiter
 * @param fn - Async function to execute
 * @param isMutation - Whether this is a mutation (write) operation
 * @returns Result of the function call
 */
async function withGitHubRateLimit<T>(
  ctx: DaemonContext,
  fn: () => Promise<T>,
  isMutation: boolean = false
): Promise<T> {
  await ctx.rateLimiter.waitForSlot(isMutation);
  try {
    return await fn();
  } catch (error) {
    // Check for rate limit errors
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status;
      if (status === 403 || status === 429) {
        const headers =
          'headers' in error ? (error as { headers: Record<string, string> }).headers : {};
        ctx.rateLimiter.handleRateLimitError(status, headers);
      }
    }
    throw error;
  }
}

/**
 * Check if token needs refresh and refresh if needed.
 * Implements exponential backoff on failures.
 */
async function refreshTokenIfNeeded(ctx: DaemonContext): Promise<void> {
  if (!ctx.claudeAuth) {
    return; // No credentials to refresh
  }

  // Check if token needs refresh
  if (!shouldRefreshClaudeToken(ctx.claudeAuth)) {
    // Token is still valid - reset backoff if we had failures
    if (ctx.refreshFailureCount > 0) {
      console.log('   Token valid, resetting poll interval');
      ctx.pollInterval = ctx.basePollInterval;
      ctx.refreshFailureCount = 0;
    }
    return;
  }

  console.log('\n--- Token Refresh ---');
  console.log(`Token expires soon, attempting refresh...`);
  console.log(`Source: ${ctx.claudeAuth.source || 'unknown'}`);

  try {
    const refreshedAuth = await ctx.tokenRefreshService.ensureValidToken(ctx.claudeAuth);

    // Update context with new tokens
    ctx.claudeAuth = refreshedAuth;

    // Reset backoff on success
    if (ctx.refreshFailureCount > 0) {
      console.log('   Token refresh succeeded, resetting poll interval');
      ctx.pollInterval = ctx.basePollInterval;
      ctx.refreshFailureCount = 0;
    }

    const expiryDate = refreshedAuth.expiresAt ? new Date(refreshedAuth.expiresAt).toISOString() : 'unknown';
    console.log(`   Token refreshed successfully, new expiry: ${expiryDate}`);
  } catch (error) {
    // Increment failure count and apply backoff
    ctx.refreshFailureCount++;
    const backoffMultiplier = Math.pow(2, Math.min(ctx.refreshFailureCount, 4)); // Cap at 16x
    ctx.pollInterval = ctx.basePollInterval * backoffMultiplier;

    console.warn(`   Token refresh failed (attempt ${ctx.refreshFailureCount})`);
    console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    console.warn(`   Poll interval increased to ${ctx.pollInterval / 1000}s (${backoffMultiplier}x backoff)`);

    // Log specific guidance based on source
    if (ctx.claudeAuth.source === 'environment') {
      console.warn('   Note: Tokens from environment variables cannot be auto-refreshed.');
      console.warn('   Update CLAUDE_ACCESS_TOKEN and restart the daemon.');
    } else if (ctx.claudeAuth.source === 'cli-option') {
      console.warn('   Note: Tokens from CLI options cannot be auto-refreshed.');
      console.warn('   Restart the daemon with a fresh --token value.');
    }
  }
}

/**
 * Increment cycle counts for all active cooldowns
 */
function incrementCooldownCycles(ctx: DaemonContext): void {
  for (const [issueNumber, cooldown] of ctx.issueCooldowns.entries()) {
    cooldown.cycleCount++;

    // Clean up old cooldowns (after 1 hour of cycles)
    // At 5s intervals, that's 720 cycles
    if (cooldown.cycleCount > 720) {
      ctx.issueCooldowns.delete(issueNumber);
    }
  }
}

/**
 * Check if an issue is in cooldown (should be skipped this cycle)
 */
function isInCooldown(ctx: DaemonContext, issueNumber: number): boolean {
  const cooldown = ctx.issueCooldowns.get(issueNumber);
  if (!cooldown) return false;

  return cooldown.cycleCount < DEFAULT_COOLDOWN_CYCLES;
}


/**
 * Set cooldown for an issue
 */
function setCooldown(
  ctx: DaemonContext,
  issueNumber: number,
  action: IssueCooldown['action'],
  sessionId?: string
): void {
  ctx.issueCooldowns.set(issueNumber, {
    actionTime: new Date(),
    action,
    cycleCount: 0,
    sessionId,
  });
}

/**
 * Clear cooldown for an issue (operation completed successfully)
 */
function clearCooldown(ctx: DaemonContext, issueNumber: number): void {
  ctx.issueCooldowns.delete(issueNumber);
}

/**
 * Check if a session has been running too long (30 min timeout)
 */
function isSessionTimedOut(startTime: Date): boolean {
  const elapsed = Date.now() - startTime.getTime();
  return elapsed > MAX_RUNNING_TIME_MS;
}

async function runDaemonCycle(ctx: DaemonContext): Promise<void> {
  const { projectsService, projectCache, maxReady, maxInProgress } = ctx;

  console.log('\n--- Daemon Cycle ---');
  console.log(new Date().toISOString());
  console.log(`Rate limit: ${ctx.rateLimiter.getSummary()}`);

  // Increment cycle counts for all active cooldowns
  incrementCooldownCycles(ctx);

  // Get current project items from GitHub (source of truth)
  console.log('\nFetching project items from GitHub...');
  const itemsByStatus = await withGitHubRateLimit(ctx, () =>
    projectsService.getItemsByStatus(projectCache.projectId)
  );

  // Print current state - normalize status names to lowercase for lookup
  const statusCounts: Record<string, number> = {};
  const normalizedItemsByStatus = new Map<string, ProjectItem[]>();
  for (const [status, items] of itemsByStatus) {
    const normalizedStatus = status.toLowerCase();
    statusCounts[normalizedStatus] = items.length;
    normalizedItemsByStatus.set(normalizedStatus, items);
  }
  console.log('Current status:', Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(' '));

  // Get items by column (using normalized lowercase keys)
  const backlog = normalizedItemsByStatus.get('backlog') || [];
  const ready = normalizedItemsByStatus.get('ready') || [];
  const inProgress = normalizedItemsByStatus.get('in progress') || [];
  const inReview = normalizedItemsByStatus.get('in review') || [];

  // Step 1: Discover new tasks (create issues, add to backlog)
  console.log('\n1. Discovering tasks...');
  await discoverAndSync(ctx, backlog.length, ready.length, maxReady);

  // Step 2: Move backlog -> ready (top items up to maxReady)
  console.log('\n2. Moving tasks to Ready...');
  await moveBacklogToReady(ctx, backlog, ready.length, maxReady);

  // Step 3: Start tasks from ready -> in_progress
  console.log('\n3. Starting task execution...');
  await startTasks(ctx, ready, inProgress.length, maxInProgress);

  // Step 4: Check in_progress tasks
  console.log('\n4. Checking in-progress tasks...');
  await checkInProgressTasks(ctx, inProgress);

  // Step 5: Review completed tasks
  console.log('\n5. Reviewing completed tasks...');
  await reviewCompletedTasks(ctx, inReview);
}

async function discoverAndSync(
  ctx: DaemonContext,
  backlogCount: number,
  readyCount: number,
  maxReady: number
): Promise<void> {
  const { rootDir, owner, repo, issuesService, projectsService, projectCache, claudeAuth, enableDiscovery } = ctx;

  // Skip discovery if disabled
  if (!enableDiscovery) {
    console.log('   Task discovery disabled');
    return;
  }

  // Check throttling
  if (backlogCount > 10) {
    console.log('   Backlog >10, only scanning TODOs');
  }

  const todoScanner = new TodoScannerService();
  const todos = await todoScanner.scan(rootDir);

  // Get existing issues with auto-task label
  const existingIssues = await withGitHubRateLimit(ctx, () =>
    issuesService.listIssues(owner, repo, {
      labels: ['auto-task'],
      state: 'open',
    })
  );
  const existingTitles = new Set(existingIssues.map((i) => i.title));

  // Find new tasks from TODO comments
  let created = 0;
  for (const todo of todos) {
    const title = `[${todo.type.toUpperCase()}] ${todo.text.slice(0, 80)}`;
    if (existingTitles.has(title)) continue;

    try {
      const issue = await withGitHubRateLimit(
        ctx,
        () =>
          issuesService.createIssue(owner, repo, {
            title,
            body: `**File:** \`${todo.file}:${todo.line}\`\n\n${todo.text}\n\n---\n*Created by auto-task*`,
            labels: ['auto-task', todo.type],
          }),
        true
      );

      const { itemId } = await withGitHubRateLimit(
        ctx,
        () => projectsService.addItemToProject(projectCache.projectId, issue.nodeId),
        true
      );

      const backlogId = projectCache.statusOptions['backlog'];
      if (backlogId) {
        await withGitHubRateLimit(
          ctx,
          () =>
            projectsService.updateItemStatus(
              projectCache.projectId,
              itemId,
              projectCache.statusFieldId,
              backlogId
            ),
          true
        );
      }

      console.log(`   Created issue #${issue.number}: ${title.slice(0, 50)}...`);
      created++;
    } catch (error) {
      console.error(`   Failed to create issue: ${error}`);
    }
  }

  console.log(`   Created ${created} new issues from TODOs`);

  // If backlog is empty, ready queue is not full, and no TODOs found, use Claude to discover new tasks
  const totalPending = backlogCount + readyCount;
  if (totalPending < maxReady && created === 0 && claudeAuth) {
    console.log(`   Backlog empty, triggering AI task discovery...`);
    await discoverTasksWithClaude(ctx, maxReady - totalPending, existingTitles);
  }
}

/**
 * Use Claude to analyze the codebase and discover new tasks
 */
async function discoverTasksWithClaude(
  ctx: DaemonContext,
  numTasks: number,
  existingTitles: Set<string>
): Promise<void> {
  const { owner, repo, issuesService, projectsService, projectCache, claudeAuth, githubToken } = ctx;

  if (!claudeAuth) {
    console.log('   Skipping AI discovery: No Claude credentials');
    return;
  }

  const environmentId = process.env.CLAUDE_ENVIRONMENT_ID;
  if (!environmentId) {
    console.log('   Skipping AI discovery: CLAUDE_ENVIRONMENT_ID not set');
    return;
  }

  const claudeClient = new ClaudeWebClient({
    accessToken: claudeAuth.accessToken,
    environmentId,
  });

  let sessionId: string | undefined;

  try {
    const gitUrl = `https://github.com/${owner}/${repo}`;

    const prompt = `Analyze this codebase and suggest ${numTasks} high-value tasks that would improve the project.

Focus on:
1. Code quality improvements (refactoring, removing duplication)
2. Missing features based on existing patterns
3. Test coverage gaps
4. Documentation improvements
5. Performance optimizations
6. Security improvements

For each task, provide:
- A clear, actionable title (prefix with [SPEC] for features, [TODO] for improvements, [BUG] for fixes)
- A brief description of what needs to be done
- Why it would be valuable

Format your response as a JSON array:
\`\`\`json
[
  {
    "title": "[SPEC] Feature name:: Brief description",
    "body": "Detailed description of what needs to be done and why it's valuable."
  }
]
\`\`\`

Note: Existing tasks are: ${Array.from(existingTitles).slice(0, 20).join(', ')}
Do NOT suggest tasks that duplicate these existing ones.`;

    console.log('   Starting AI task discovery session...');
    const result = await claudeClient.createSession({
      prompt,
      gitUrl,
      title: 'Auto-task discovery',
    });
    sessionId = result.sessionId;

    console.log(`   Discovery session: ${result.webUrl}`);

    // Wait for the session to complete (with timeout)
    const maxWaitMs = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();
    let sessionComplete = false;
    let lastResult: string | undefined;

    while (!sessionComplete && Date.now() - startTime < maxWaitMs) {
      await sleep(10000); // Check every 10 seconds

      const session = await claudeClient.getSession(sessionId);
      if (session.session_status === 'idle' || session.session_status === 'completed') {
        sessionComplete = true;
        // Get the session events to find the response
        const events = await claudeClient.getEvents(sessionId);
        for (const event of events.data.reverse()) {
          if (event.type === 'result' || event.type === 'assistant') {
            const content = typeof event.message?.content === 'string'
              ? event.message.content
              : Array.isArray(event.message?.content)
                ? event.message.content.map((c: { text?: string }) => c.text || '').join('')
                : '';
            if (content.includes('[')) {
              lastResult = content;
              break;
            }
          }
        }
      } else if (session.session_status === 'failed' || session.session_status === 'archived') {
        console.log(`   Discovery session ${session.session_status}`);
        return;
      }
    }

    if (!sessionComplete) {
      console.log('   Discovery session timed out');
      return;
    }

    // Parse the response
    if (!lastResult) {
      console.log('   No tasks discovered');
      return;
    }

    // Extract JSON from the response
    const jsonMatch = lastResult.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      console.log('   Could not parse discovery response');
      return;
    }

    let tasks: Array<{ title: string; body: string }>;
    try {
      tasks = JSON.parse(jsonMatch[1]);
    } catch {
      console.log('   Invalid JSON in discovery response');
      return;
    }

    // Create issues for discovered tasks
    let created = 0;
    for (const task of tasks) {
      if (existingTitles.has(task.title)) continue;

      try {
        const issue = await withGitHubRateLimit(
          ctx,
          () =>
            issuesService.createIssue(owner, repo, {
              title: task.title,
              body: `${task.body}\n\n---\n*Discovered by auto-task AI*`,
              labels: ['auto-task', 'ai-discovered'],
            }),
          true
        );

        const { itemId } = await withGitHubRateLimit(
          ctx,
          () => projectsService.addItemToProject(projectCache.projectId, issue.nodeId),
          true
        );

        const backlogId = projectCache.statusOptions['backlog'];
        if (backlogId) {
          await withGitHubRateLimit(
            ctx,
            () =>
              projectsService.updateItemStatus(
                projectCache.projectId,
                itemId,
                projectCache.statusFieldId,
                backlogId
              ),
            true
          );
        }

        console.log(`   Created AI-discovered issue #${issue.number}: ${task.title.slice(0, 50)}...`);
        existingTitles.add(task.title);
        created++;
      } catch (error) {
        console.error(`   Failed to create issue: ${error}`);
      }
    }

    console.log(`   Created ${created} AI-discovered issues`);
  } catch (error) {
    console.error(`   AI discovery failed: ${error}`);
  } finally {
    // Always archive the discovery session when finished (success, failure, or timeout)
    if (sessionId) {
      try {
        await claudeClient.archiveSession(sessionId);
        console.log(`   Discovery session archived`);
      } catch {
        // Ignore archive errors
      }
    }
  }
}

async function moveBacklogToReady(
  ctx: DaemonContext,
  backlog: ProjectItem[],
  readyCount: number,
  maxReady: number
): Promise<void> {
  const { projectsService, projectCache, issuesService, owner, repo } = ctx;

  const slotsAvailable = maxReady - readyCount;

  if (slotsAvailable <= 0) {
    console.log('   Ready queue full');
    return;
  }

  // Filter to issues only
  const backlogIssues = backlog.filter((item) => item.contentType === 'Issue' && item.number);

  if (backlogIssues.length === 0) {
    console.log('   No items in backlog');
    return;
  }

  // Get failure counts for backlog items (from GitHub comments)
  const issueFailureCounts = new Map<number, number>();
  for (const item of backlogIssues) {
    if (!item.number) continue;
    try {
      const taskInfo = await withGitHubRateLimit(ctx, () =>
        issuesService.getLatestAutoTaskInfo(owner, repo, item.number!)
      );
      issueFailureCounts.set(item.number, taskInfo?.failureCount || 0);
    } catch {
      issueFailureCounts.set(item.number, 0);
    }
  }

  // Sort by: 1) failure count (lower first), 2) issue number (lower = older = higher priority)
  // This ensures items that keep failing get deprioritized
  const sorted = backlogIssues.sort((a, b) => {
    const failA = issueFailureCounts.get(a.number!) || 0;
    const failB = issueFailureCounts.get(b.number!) || 0;
    if (failA !== failB) return failA - failB; // Lower failures first
    return (a.number || 0) - (b.number || 0); // Then by issue number
  });

  const toMove = sorted.slice(0, slotsAvailable);

  const readyId = projectCache.statusOptions['ready'];
  if (!readyId) {
    console.log('   No "Ready" column found');
    return;
  }

  for (const item of toMove) {
    const failures = issueFailureCounts.get(item.number!) || 0;
    try {
      await withGitHubRateLimit(
        ctx,
        () =>
          projectsService.updateItemStatus(
            projectCache.projectId,
            item.id,
            projectCache.statusFieldId,
            readyId
          ),
        true
      );
      console.log(`   Moved #${item.number} to Ready${failures > 0 ? ` (${failures} prior failures)` : ''}`);
    } catch (error) {
      console.error(`   Failed to move task: ${error}`);
    }
  }
}

async function startTasks(
  ctx: DaemonContext,
  ready: ProjectItem[],
  inProgressCount: number,
  maxInProgress: number
): Promise<void> {
  const { projectsService, projectCache, claudeAuth, issuesService, owner, repo } = ctx;

  if (!claudeAuth) {
    console.log('   Skipping: No Claude credentials');
    return;
  }

  const slotsAvailable = maxInProgress - inProgressCount;

  if (slotsAvailable <= 0) {
    console.log('   In-progress slots full');
    return;
  }

  // Filter to issues only and take available slots
  const toStart = ready
    .filter((item) => item.contentType === 'Issue' && item.number)
    .slice(0, slotsAvailable);

  const inProgressId = projectCache.statusOptions['in progress'];
  if (!inProgressId) {
    console.log('   No "In Progress" column found');
    return;
  }

  // Check for environment ID
  const environmentId = process.env.CLAUDE_ENVIRONMENT_ID;
  if (!environmentId) {
    console.log('   Skipping: CLAUDE_ENVIRONMENT_ID not set');
    return;
  }

  // Initialize Claude client
  const claudeClient = new ClaudeWebClient({
    accessToken: claudeAuth.accessToken,
    environmentId,
  });

  for (const item of toStart) {
    if (!item.number) continue;

    try {
      // Update status in GitHub Project
      await withGitHubRateLimit(
        ctx,
        () =>
          projectsService.updateItemStatus(
            projectCache.projectId,
            item.id,
            projectCache.statusFieldId,
            inProgressId
          ),
        true
      );

      // Get issue details for prompt
      const issue = await withGitHubRateLimit(ctx, () =>
        issuesService.getIssue(owner, repo, item.number!)
      );
      const gitUrl = `https://github.com/${owner}/${repo}`;

      // Check if this is a re-work by looking at previous comments
      const previousInfo = await withGitHubRateLimit(ctx, () =>
        issuesService.getLatestAutoTaskInfo(owner, repo, item.number!)
      );
      const isRework = previousInfo?.branchName && previousInfo?.prNumber;

      console.log(`   Starting #${item.number}: ${item.title.slice(0, 40)}...`);
      console.log(`   ${isRework ? 'Re-work' : 'New task'}`);

      let sessionId: string;
      let webUrl: string;

      if (isRework && previousInfo?.sessionId) {
        // Re-work: Send message to existing session (fire-and-forget, don't block)
        const resumePrompt = buildReworkPrompt(previousInfo, item, issue);

        console.log(`   Resuming session: ${previousInfo.sessionId}`);

        try {
          // Check if session can be resumed first
          const session = await claudeClient.getSession(previousInfo.sessionId);
          if (session.session_status === 'archived' || session.session_status === 'failed') {
            throw new Error(`Session is ${session.session_status}`);
          }

          // Send message to resume the session (non-blocking)
          await claudeClient.sendMessage(previousInfo.sessionId, resumePrompt);
          sessionId = previousInfo.sessionId;
          webUrl = previousInfo.sessionUrl || `https://claude.ai/code/${previousInfo.sessionId}`;
          console.log(`   Session resumed (message sent)`);
        } catch (resumeError) {
          // If resume fails (session may be archived/unavailable), fall back to new session
          console.log(`   Resume failed: ${resumeError}`);
          console.log(`   Creating new session instead...`);

          const prompt = buildReworkPrompt(previousInfo, item, issue);
          const result = await claudeClient.createSession({
            prompt,
            gitUrl,
            branchPrefix: previousInfo.branchName,
            title: `Rework #${item.number}: ${issue.title.slice(0, 50)}`,
          });
          sessionId = result.sessionId;
          webUrl = result.webUrl;
        }
      } else {
        // New task: Create new session
        const prompt = buildTaskPrompt(issue.title, issue.body);
        const branchPrefix = `claude/issue-${item.number}`;

        const result = await claudeClient.createSession({
          prompt,
          gitUrl,
          branchPrefix,
          title: `Issue #${item.number}: ${issue.title.slice(0, 50)}`,
        });
        sessionId = result.sessionId;
        webUrl = result.webUrl;
        console.log(`   Session created: ${sessionId}`);
      }

      console.log(`   View at: ${webUrl}`);

      // Set cooldown immediately so checkInProgressTasks doesn't timeout this session prematurely
      setCooldown(ctx, item.number, isRework ? 'rework_started' : 'task_started', sessionId);

      // Add comment to issue with session link (this IS our session tracking)
      const commentBody = isRework && previousInfo
        ? `### 🔄 Re-work\n\nAddressing code review feedback (resuming session).\n\n**Session:** [View in Claude](${webUrl})\n**Branch:** \`${previousInfo.branchName}\`\n**PR:** #${previousInfo.prNumber}`
        : `### 🤖 Auto-Task Started\n\nClaude is working on this issue.\n\n**Session:** [View in Claude](${webUrl})`;

      await withGitHubRateLimit(
        ctx,
        () => issuesService.addComment(owner, repo, item.number!, commentBody),
        true
      );

    } catch (error) {
      console.error(`   Failed to start task: ${error}`);
    }
  }
}

function buildTaskPrompt(title: string, body?: string): string {
  const cleanTitle = title.replace(/^\[(TODO|FIXME|HACK|SPEC)\]\s*/i, '');

  let prompt = `Please complete the following task:\n\n**${cleanTitle}**`;

  if (body) {
    // Extract the actual task description from the issue body
    // Remove the "Created by auto-task" footer and file location
    const cleanBody = body
      .replace(/---\s*\n\*Created by auto-task\*\s*$/, '')
      .replace(/\*\*File:\*\*\s*`[^`]+`\s*\n\n?/, '')
      .trim();

    if (cleanBody) {
      prompt += `\n\n${cleanBody}`;
    }
  }

  prompt += `\n\n---\n**Instructions:**
- Create a new branch and implement the changes
- Write clean, well-tested code
- Commit your changes with a descriptive message
- Push the branch when complete`;

  return prompt;
}

function buildReworkPrompt(
  previousInfo: AutoTaskCommentInfo,
  item: ProjectItem,
  issue: { title: string; body?: string }
): string {
  const cleanTitle = issue.title.replace(/^\[(TODO|FIXME|HACK|SPEC)\]\s*/i, '');

  const prompt = `## Re-work Required

The previous implementation for this task received code review feedback that needs to be addressed.

**Task:** ${cleanTitle}

**Existing Branch:** \`${previousInfo.branchName}\`
**PR:** #${previousInfo.prNumber}

---

**Instructions:**
1. Check out the existing branch \`${previousInfo.branchName}\`
2. Review the code review comments on PR #${previousInfo.prNumber}
3. Address all the feedback and issues raised
4. Commit your changes with a message like "Address code review feedback"
5. Push the updated branch

**Important:**
- Do NOT create a new branch - use the existing one
- The PR will automatically update when you push
- Focus on addressing the specific issues from the code review`;

  return prompt;
}

/**
 * Format review issues for display in comments/prompts
 */
function formatReviewIssuesForComment(issues: ReviewIssue[]): string {
  if (issues.length === 0) return 'No specific issues listed.';

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const infos = issues.filter((i) => i.severity === 'info');

  const lines: string[] = [];

  if (errors.length > 0) {
    lines.push(`**Errors (${errors.length})** - Must fix:`);
    for (const issue of errors) {
      const loc = issue.file ? `\`${issue.file}${issue.line ? `:${issue.line}` : ''}\`` : '';
      lines.push(`- ${loc ? `${loc}: ` : ''}${issue.message}`);
      if (issue.suggestion) lines.push(`  - 💡 ${issue.suggestion}`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(`**Warnings (${warnings.length})** - Should address:`);
    for (const issue of warnings) {
      const loc = issue.file ? `\`${issue.file}${issue.line ? `:${issue.line}` : ''}\`` : '';
      lines.push(`- ${loc ? `${loc}: ` : ''}${issue.message}`);
      if (issue.suggestion) lines.push(`  - 💡 ${issue.suggestion}`);
    }
    lines.push('');
  }

  if (infos.length > 0) {
    lines.push(`**Suggestions (${infos.length})** - Nice to have:`);
    for (const issue of infos) {
      const loc = issue.file ? `\`${issue.file}${issue.line ? `:${issue.line}` : ''}\`` : '';
      lines.push(`- ${loc ? `${loc}: ` : ''}${issue.message}`);
      if (issue.suggestion) lines.push(`  - 💡 ${issue.suggestion}`);
    }
  }

  return lines.join('\n');
}

async function checkInProgressTasks(ctx: DaemonContext, inProgress: ProjectItem[]): Promise<void> {
  const { projectsService, projectCache, claudeAuth, issuesService, owner, repo, githubToken } = ctx;

  if (inProgress.length === 0) {
    console.log('   No tasks in progress');
    return;
  }

  if (!claudeAuth) {
    console.log('   Skipping: No Claude credentials');
    return;
  }

  const inReviewId = projectCache.statusOptions['in review'];
  const backlogId = projectCache.statusOptions['backlog'];

  // Check for environment ID
  const environmentId = process.env.CLAUDE_ENVIRONMENT_ID;
  if (!environmentId) {
    console.log('   Skipping: CLAUDE_ENVIRONMENT_ID not set');
    return;
  }

  // Initialize Claude client
  const claudeClient = new ClaudeWebClient({
    accessToken: claudeAuth.accessToken,
    environmentId,
  });

  for (const item of inProgress) {
    if (!item.number) continue;

    // Get session info from GitHub comments
    const taskInfo = await withGitHubRateLimit(ctx, () =>
      issuesService.getLatestAutoTaskInfo(owner, repo, item.number!)
    );
    if (!taskInfo?.sessionId) {
      console.log(`   #${item.number}: No session ID found in comments, skipping`);
      continue;
    }

    try {
      console.log(`   Checking #${item.number}...`);

      // Get session status
      const session = await claudeClient.getSession(taskInfo.sessionId);
      console.log(`   Status: ${session.session_status}`);

      if (session.session_status === 'completed' || session.session_status === 'idle') {
        // Session is done - check for branch/PR info
        const events = await claudeClient.getEvents(taskInfo.sessionId);
        const branchName = taskInfo.branchName || extractBranchFromEvents(events.data, session);

        if (branchName) {
          console.log(`   Branch: ${branchName}`);

          // Check if PR exists for this branch
          let prNumber = taskInfo.prNumber || await findPRForBranch(owner, repo, branchName, githubToken);

          if (!prNumber) {
            // No PR exists - create one
            console.log(`   No PR found, creating PR...`);
            prNumber = await createPRForBranch(
              owner,
              repo,
              branchName,
              item.number,
              item.title,
              githubToken
            );

            if (prNumber) {
              console.log(`   Created PR #${prNumber}`);
            } else {
              // Failed to create PR - move back to backlog
              console.log(`   Failed to create PR, moving to backlog`);

              if (backlogId) {
                await withGitHubRateLimit(
                  ctx,
                  () =>
                    projectsService.updateItemStatus(
                      projectCache.projectId,
                      item.id,
                      projectCache.statusFieldId,
                      backlogId
                    ),
                  true
                );
              }
              continue;
            }
          } else {
            console.log(`   PR #${prNumber} found`);
          }

          // Move to In Review
          if (inReviewId) {
            await withGitHubRateLimit(
              ctx,
              () =>
                projectsService.updateItemStatus(
                  projectCache.projectId,
                  item.id,
                  projectCache.statusFieldId,
                  inReviewId
                ),
              true
            );
          }
          console.log(`   Moved to In Review`);

          // Extract implementation summary from the session
          const implementationSummary = extractImplementationSummary(events.data);

          // Add comment to issue with branch/PR info and implementation summary
          const summarySection = implementationSummary
            ? `\n\n<details>\n<summary>Implementation Details</summary>\n\n${implementationSummary}\n\n</details>`
            : '';

          await withGitHubRateLimit(
            ctx,
            () =>
              issuesService.addComment(
                owner,
                repo,
                item.number!,
                `### ✅ Implementation Complete\n\nClaude has finished working on this issue.\n\n**Branch:** \`${branchName}\`\n**PR:** #${prNumber}${summarySection}\n\nThe PR is now being reviewed.`
              ),
            true
          );
        } else {
          // No branch created - session failed to produce output
          console.log(`   No branch found in session events`);

          // Check events for errors
          const hasError = events.data.some((e) => e.type === 'error');
          const errorMsg = hasError
            ? 'Session completed with errors'
            : 'Session completed but no branch was pushed';

          console.log(`   ${errorMsg}, moving back to backlog`);

          if (backlogId) {
            await withGitHubRateLimit(
              ctx,
              () =>
                projectsService.updateItemStatus(
                  projectCache.projectId,
                  item.id,
                  projectCache.statusFieldId,
                  backlogId
                ),
              true
            );
          }

          // Add failure comment
          await withGitHubRateLimit(
            ctx,
            () =>
              issuesService.addComment(
                owner,
                repo,
                item.number!,
                `### ⚠️ Session Issue\n\n${errorMsg}\n\nTask moved back to backlog and will be retried.`
              ),
            true
          );
        }
      } else if (session.session_status === 'failed') {
        console.log(`   Session failed, moving back to backlog`);

        if (backlogId) {
          await withGitHubRateLimit(
            ctx,
            () =>
              projectsService.updateItemStatus(
                projectCache.projectId,
                item.id,
                projectCache.statusFieldId,
                backlogId
              ),
            true
          );
        }

        // Add failure comment
        await withGitHubRateLimit(
          ctx,
          () =>
            issuesService.addComment(
              owner,
              repo,
              item.number!,
              `### ❌ Session Failed\n\nThe Claude session failed to complete.\n\nTask moved back to backlog and will be retried.`
            ),
          true
        );
      } else if (session.session_status === 'archived') {
        // Session was archived - check if there's a PR to review
        console.log(`   Session archived`);

        if (taskInfo.prNumber) {
          // Has PR - move to In Review
          console.log(`   PR #${taskInfo.prNumber} exists, moving to In Review`);
          if (inReviewId) {
            await withGitHubRateLimit(
              ctx,
              () =>
                projectsService.updateItemStatus(
                  projectCache.projectId,
                  item.id,
                  projectCache.statusFieldId,
                  inReviewId
                ),
              true
            );
          }
        } else {
          // No PR - move back to Ready for re-work with new session
          console.log(`   No PR found, moving to Ready for re-work`);
          const readyId = projectCache.statusOptions['ready'];
          if (readyId) {
            await withGitHubRateLimit(
              ctx,
              () =>
                projectsService.updateItemStatus(
                  projectCache.projectId,
                  item.id,
                  projectCache.statusFieldId,
                  readyId
                ),
              true
            );
          }

          // Add comment about archived session
          await withGitHubRateLimit(
            ctx,
            () =>
              issuesService.addComment(
                owner,
                repo,
                item.number!,
                `### ⚠️ Session Archived\n\nThe Claude session was archived before completing.\n\nTask moved to Ready for a new attempt.`
              ),
            true
          );
        }
      } else {
        // Session is still running - check for timeout
        // Use cooldown actionTime (when we started tracking) rather than comment time
        // Comment time may be from a previous attempt
        const cooldown = ctx.issueCooldowns.get(item.number);

        // Track this session in cooldown if not already tracked
        if (!cooldown) {
          setCooldown(ctx, item.number, 'task_started', taskInfo.sessionId);
          console.log(`   Still running (just started tracking)...`);
          return; // Give it at least one cycle before checking timeout
        }

        const trackingStartTime = cooldown.actionTime;

        // Check if stuck (30 min timeout only - cycles are just for cooldown)
        if (isSessionTimedOut(trackingStartTime)) {
          const elapsed = Math.round((Date.now() - trackingStartTime.getTime()) / 60000);
          console.log(`   Session timed out (running for ${elapsed} min), interrupting and moving to backlog`);

          // Interrupt the stuck session
          try {
            await claudeClient.interruptSession(taskInfo.sessionId);
            console.log(`   Interrupted session ${taskInfo.sessionId}`);
          } catch (interruptError) {
            console.log(`   Failed to interrupt: ${interruptError}`);
          }

          // Move back to backlog for retry
          if (backlogId) {
            await withGitHubRateLimit(
              ctx,
              () =>
                projectsService.updateItemStatus(
                  projectCache.projectId,
                  item.id,
                  projectCache.statusFieldId,
                  backlogId
                ),
              true
            );
          }

          // Clear cooldown so it gets picked up fresh
          clearCooldown(ctx, item.number);

          // Add comment about timeout
          await withGitHubRateLimit(
            ctx,
            () =>
              issuesService.addComment(
                owner,
                repo,
                item.number!,
                `### ⏱️ Session Timeout\n\nThe Claude session was running for ${elapsed} minutes without completing.\n\nSession interrupted and task moved back to backlog for retry.\n\n**Previous Session:** ${taskInfo.sessionId}`
              ),
            true
          );
        } else {
          const elapsed = Math.round((Date.now() - trackingStartTime.getTime()) / 60000);
          console.log(`   Still running (${elapsed} min elapsed, timeout at 30 min)...`);
        }
      }
    } catch (error) {
      console.error(`   Error checking task: ${error}`);
    }
  }
}

function extractBranchFromEvents(
  events: ClaudeSessionEvent[],
  session: { session_context?: { outcomes?: Array<{ type: string; git_info?: { branches?: string[] } }> } }
): string | undefined {
  // First, check session context for branch info (most reliable)
  if (session.session_context?.outcomes) {
    for (const outcome of session.session_context.outcomes) {
      if (outcome.git_info?.branches && outcome.git_info.branches.length > 0) {
        return outcome.git_info.branches[0];
      }
    }
  }

  // Look for git push events or branch creation in events
  for (const event of events) {
    // Check for tool_use events that might have branch info
    if (event.type === 'tool_use' && event.tool_use?.name === 'Bash') {
      const input = event.tool_use.input as { command?: string };
      if (input.command?.includes('git push')) {
        // Match various push patterns
        const patterns = [
          /-u origin (\S+)/,
          /origin (\S+)/,
          /--set-upstream origin (\S+)/,
        ];
        for (const pattern of patterns) {
          const match = input.command.match(pattern);
          if (match) return match[1];
        }
      }
    }

    // Check assistant messages for branch mentions
    if (event.type === 'result' || event.type === 'assistant') {
      const content = typeof event.message?.content === 'string'
        ? event.message.content
        : '';
      // Look for common branch mention patterns
      const patterns = [
        /pushed.*branch[:\s]+`?([a-zA-Z0-9/_-]+)`?/i,
        /branch[:\s]+`?([a-zA-Z0-9/_-]+)`?\s+(?:has been|was|is)/i,
        /created branch[:\s]+`?([a-zA-Z0-9/_-]+)`?/i,
      ];
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) return match[1];
      }
    }
  }

  return undefined;
}

/**
 * Extract a summary of what was implemented from the session events.
 * Looks for the final assistant message that summarizes the work done.
 */
function extractImplementationSummary(events: ClaudeSessionEvent[]): string | undefined {
  // Look for the last assistant/result message that contains implementation details
  // Go in reverse to find the most recent summary
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'result' || event.type === 'assistant') {
      let content = '';
      if (typeof event.message?.content === 'string') {
        content = event.message.content;
      } else if (Array.isArray(event.message?.content)) {
        content = event.message.content
          .map((c: { text?: string }) => c.text || '')
          .join('');
      }

      // Skip very short messages or tool results
      if (content.length < 100) continue;

      // Look for summary-like content (implementation complete, changes made, etc.)
      const summaryIndicators = [
        /(?:completed|finished|implemented|done|pushed|created|added)/i,
        /(?:changes|modifications|updates|fixes)/i,
        /(?:branch|PR|pull request)/i,
      ];

      const hasSummaryContent = summaryIndicators.some(pattern => pattern.test(content));
      if (hasSummaryContent) {
        // Truncate if too long, keeping the most relevant part
        if (content.length > 2000) {
          // Try to find a natural break point
          const lines = content.split('\n');
          let truncated = '';
          for (const line of lines) {
            if (truncated.length + line.length > 1800) break;
            truncated += line + '\n';
          }
          return truncated.trim() + '\n\n*[truncated]*';
        }
        return content;
      }
    }
  }

  return undefined;
}

async function findPRForBranch(
  owner: string,
  repo: string,
  branchName: string,
  token: string
): Promise<number | undefined> {
  try {
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${branchName}`,
      state: 'open',
    });

    if (prs.length > 0) {
      return prs[0].number;
    }
  } catch (error) {
    console.error(`   Error finding PR: ${error}`);
  }

  return undefined;
}

async function createPRForBranch(
  owner: string,
  repo: string,
  branchName: string,
  issueNumber: number,
  title: string,
  token: string
): Promise<number | undefined> {
  try {
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    // Get default branch
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const baseBranch = repoData.default_branch;

    // Clean up the title for PR
    const prTitle = title.replace(/^\[(TODO|FIXME|HACK|SPEC)\]\s*/i, '');

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: prTitle,
      head: branchName,
      base: baseBranch,
      body: `## Summary
Automated implementation for issue #${issueNumber}.

Closes #${issueNumber}

---
*Created by auto-task daemon*`,
    });

    return pr.number;
  } catch (error) {
    console.error(`   Error creating PR: ${error}`);
    return undefined;
  }
}

async function reviewCompletedTasks(ctx: DaemonContext, inReview: ProjectItem[]): Promise<void> {
  const { projectsService, projectCache, claudeAuth, issuesService, owner, repo, githubToken } = ctx;

  if (inReview.length === 0) {
    console.log('   No tasks to review');
    return;
  }

  if (!claudeAuth) {
    console.log('   Skipping: No Claude credentials');
    return;
  }

  const doneId = projectCache.statusOptions['done'];
  const readyId = projectCache.statusOptions['ready'];

  // Dynamically import CodeReviewerService
  const { CodeReviewerService } = await import('@webedt/shared');
  const environmentId = process.env.CLAUDE_ENVIRONMENT_ID || '';
  const reviewer = new CodeReviewerService(
    { accessToken: claudeAuth.accessToken },
    environmentId,
    githubToken
  );

  // Review all tasks in parallel
  await Promise.all(
    inReview.map(async (item) => {
      if (!item.number) return;

      // Check cooldown - skip if we recently took action on this issue
      if (isInCooldown(ctx, item.number)) {
        const cooldown = ctx.issueCooldowns.get(item.number);
        console.log(`   #${item.number}: In cooldown (${cooldown?.action}, cycle ${cooldown?.cycleCount}/${DEFAULT_COOLDOWN_CYCLES})`);
        return;
      }

      // Get task info from GitHub comments to find PR number
      const taskInfo = await withGitHubRateLimit(ctx, () =>
        issuesService.getLatestAutoTaskInfo(owner, repo, item.number!)
      );
      if (!taskInfo?.prNumber) {
        console.log(`   #${item.number}: No PR found in comments, skipping review`);
        return;
      }

      // Check if a conflict resolution or rework is in progress
      if (taskInfo.type === 'conflict' || taskInfo.type === 'rework') {
        // Check if session is still running or stuck
        if (taskInfo.sessionId) {
          const claudeClient = new ClaudeWebClient({
            accessToken: claudeAuth.accessToken,
            environmentId,
          });

          try {
            const session = await claudeClient.getSession(taskInfo.sessionId);
            console.log(`   #${item.number}: ${taskInfo.type} session status: ${session.session_status}`);

            if (session.session_status === 'running') {
              // Get or create cooldown to track when we started waiting
              let cooldown = ctx.issueCooldowns.get(item.number);
              if (!cooldown) {
                setCooldown(ctx, item.number, 'conflict_resolution', taskInfo.sessionId);
                cooldown = ctx.issueCooldowns.get(item.number)!;
              }

              // Check if timed out (30 min since we started tracking)
              if (isSessionTimedOut(cooldown.actionTime)) {
                const elapsed = Math.round((Date.now() - cooldown.actionTime.getTime()) / 60000);
                console.log(`   #${item.number}: Session timed out (${elapsed} min), interrupting`);

                // Interrupt the stuck session
                try {
                  await claudeClient.interruptSession(taskInfo.sessionId);
                  console.log(`   Interrupted session ${taskInfo.sessionId}`);
                } catch (interruptError) {
                  console.log(`   Failed to interrupt: ${interruptError}`);
                }

                // Clear cooldown so it gets processed next cycle as a fresh task
                clearCooldown(ctx, item.number);

                // Add comment about restart
                await withGitHubRateLimit(
                  ctx,
                  () =>
                    issuesService.addComment(
                      owner,
                      repo,
                      item.number!,
                      `### ⚠️ Session Timeout\n\nThe ${taskInfo.type} session was running for ${elapsed} minutes without completing.\n\n**Previous Session:** ${taskInfo.sessionId}`
                    ),
                  true
                );
                return;
              }

              // Still running, not timed out yet
              const elapsed = Math.round((Date.now() - cooldown.actionTime.getTime()) / 60000);
              console.log(`   Still running (${elapsed} min elapsed, timeout at 30 min)...`);
              return;
            } else if (session.session_status === 'idle' || session.session_status === 'completed') {
              // Session finished - clear cooldown and continue with review
              console.log(`   ${taskInfo.type} session completed, proceeding with review`);
              clearCooldown(ctx, item.number);
            } else {
              // Session failed or archived
              console.log(`   ${taskInfo.type} session ${session.session_status}, clearing and retrying`);
              clearCooldown(ctx, item.number);
            }
          } catch (error) {
            console.log(`   Session check failed: ${error}, proceeding with review`);
            clearCooldown(ctx, item.number);
          }
        }
      }

      try {
        console.log(`   Reviewing PR #${taskInfo.prNumber} for issue #${item.number}...`);

        // Check if we can resume the implementation session for review
        let sessionIdForReview: string | undefined;

        if (taskInfo.sessionId) {
          const claudeClient = new ClaudeWebClient({
            accessToken: claudeAuth.accessToken,
            environmentId,
          });

          try {
            const session = await claudeClient.getSession(taskInfo.sessionId);
            if (!['archived', 'failed', 'completed'].includes(session.session_status)) {
              sessionIdForReview = taskInfo.sessionId;
              console.log(`   Resuming session ${taskInfo.sessionId} for review`);
            } else {
              console.log(`   Session ${session.session_status}, creating new review session`);
            }
          } catch (error) {
            console.log(`   Session check failed, creating new review session`);
          }
        }

        // Run code review
        const result = await reviewer.reviewPR(
          owner,
          repo,
          taskInfo.prNumber,
          {
            autoApprove: true,
            strict: false,
          },
          sessionIdForReview
        );

        console.log(`   Review result: ${result.approved ? 'Approved' : 'Changes Requested'}`);
        console.log(`   Issues found: ${result.issues.length}`);

        // Submit the review to GitHub
        await reviewer.submitReview(owner, repo, taskInfo.prNumber, result);
        console.log(`   Review submitted to GitHub`);

        if (result.approved) {
          // Check if PR is mergeable
          const mergeResult = await checkAndMergePR(
            owner,
            repo,
            taskInfo.prNumber,
            taskInfo.branchName,
            githubToken,
            claudeAuth,
            process.env.CLAUDE_ENVIRONMENT_ID || '',
            taskInfo
          );

          if (mergeResult.merged) {
            // Successfully merged - move to Done
            console.log(`   PR merged successfully`);

            if (doneId) {
              await withGitHubRateLimit(
                ctx,
                () =>
                  projectsService.updateItemStatus(
                    projectCache.projectId,
                    item.id,
                    projectCache.statusFieldId,
                    doneId
                  ),
                true
              );
            }

            // Close the issue (should auto-close from PR, but ensure it)
            await withGitHubRateLimit(
              ctx,
              () => issuesService.closeIssue(owner, repo, item.number!),
              true
            );
            console.log(`   Moved to Done, issue closed`);

            // Archive the Claude session now that work is complete
            if (taskInfo.sessionId) {
              try {
                const claudeClient = new ClaudeWebClient({
                  accessToken: claudeAuth.accessToken,
                  environmentId: process.env.CLAUDE_ENVIRONMENT_ID || '',
                });
                await claudeClient.archiveSession(taskInfo.sessionId);
                console.log(`   Session archived: ${taskInfo.sessionId}`);
              } catch (archiveError) {
                console.log(`   Warning: Failed to archive session: ${archiveError}`);
              }
            }

            // Add completion comment with review summary
            const reviewSummarySection = result.summary
              ? `\n\n<details>\n<summary>Review Summary</summary>\n\n${result.summary}\n\n</details>`
              : '';

            await withGitHubRateLimit(
              ctx,
              () =>
                issuesService.addComment(
                  owner,
                  repo,
                  item.number!,
                  `### 🎉 Task Complete\n\nPR #${taskInfo.prNumber} has been reviewed, approved, and merged.${reviewSummarySection}\n\nThis issue is now closed.`
                ),
              true
            );
          } else if (mergeResult.hasConflicts) {
            // Has merge conflicts - needs resolution
            console.log(`   PR has merge conflicts: ${mergeResult.reason}`);

            if (mergeResult.conflictResolutionStarted) {
              // Claude is fixing conflicts - add comment with new session
              console.log(`   Conflict resolution session started`);

              // Set cooldown to prevent re-processing while conflict resolution runs
              setCooldown(ctx, item.number, 'conflict_resolution', mergeResult.sessionId);

              await withGitHubRateLimit(
                ctx,
                () =>
                  issuesService.addComment(
                    owner,
                    repo,
                    item.number!,
                    `### 🔧 Resolving Merge Conflicts\n\nPR #${taskInfo.prNumber} has merge conflicts. Claude is working on resolving them.\n\n**Session:** [View in Claude](https://claude.ai/code/${mergeResult.sessionId})\n**Branch:** \`${taskInfo.branchName}\`\n**PR:** #${taskInfo.prNumber}`
                  ),
                true
              );
            } else {
              // Failed to start conflict resolution - move back to ready
              console.log(`   Moving back to Ready for manual conflict resolution`);

              if (readyId) {
                await withGitHubRateLimit(
                  ctx,
                  () =>
                    projectsService.updateItemStatus(
                      projectCache.projectId,
                      item.id,
                      projectCache.statusFieldId,
                      readyId
                    ),
                  true
                );
              }

              await withGitHubRateLimit(
                ctx,
                () =>
                  issuesService.addComment(
                    owner,
                    repo,
                    item.number!,
                    `### ⚠️ Merge Conflicts\n\nPR #${taskInfo.prNumber} has merge conflicts that could not be automatically resolved.\n\nMoving back to Ready for re-work.`
                  ),
                true
              );
            }
          } else {
            // Other merge failure (status checks blocked, merge API failed, etc.)
            console.log(`   Merge failed: ${mergeResult.reason}`);
            console.log(`   Moving back to Ready for re-work`);

            // Move back to Ready so it gets picked up again
            if (readyId) {
              await withGitHubRateLimit(
                ctx,
                () =>
                  projectsService.updateItemStatus(
                    projectCache.projectId,
                    item.id,
                    projectCache.statusFieldId,
                    readyId
                  ),
                true
              );
            }

            // Add comment explaining the merge failure
            await withGitHubRateLimit(
              ctx,
              () =>
                issuesService.addComment(
                  owner,
                  repo,
                  item.number!,
                  `### ⚠️ Merge Failed\n\nPR #${taskInfo.prNumber} could not be merged.\n\n**Reason:** ${mergeResult.reason}\n\nMoving back to Ready for re-work. The issue will be picked up in the next cycle to resolve the problem.`
                ),
              true
            );
          }
        } else {
          // Review rejected - move back to Ready for re-work
          console.log(`   Review rejected, moving back to Ready for re-work`);

          if (readyId) {
            await withGitHubRateLimit(
              ctx,
              () =>
                projectsService.updateItemStatus(
                  projectCache.projectId,
                  item.id,
                  projectCache.statusFieldId,
                  readyId
                ),
              true
            );
          }

          // Format review issues for comment (will be visible to Claude on re-work via PR comments)
          const issuesText = formatReviewIssuesForComment(result.issues);

          // Add comment about review rejection WITH the actual issues
          await withGitHubRateLimit(
            ctx,
            () =>
              issuesService.addComment(
                owner,
                repo,
                item.number!,
                `### 🔄 Review Feedback\n\nCode review found ${result.issues.length} issue(s) that need to be addressed:\n\n${issuesText}\n\nPR #${taskInfo.prNumber} is being sent back for re-work.`
              ),
            true
          );
        }
      } catch (error) {
        console.error(`   Error reviewing task: ${error}`);
      }
    })
  );
}

interface MergeResult {
  merged: boolean;
  hasConflicts: boolean;
  conflictResolutionStarted: boolean;
  sessionId?: string;
  reason?: string;
}

async function checkAndMergePR(
  owner: string,
  repo: string,
  prNumber: number,
  branchName: string | undefined,
  token: string,
  claudeAuth: ClaudeAuth,
  environmentId: string,
  taskInfo?: AutoTaskCommentInfo
): Promise<MergeResult> {
  try {
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });

    // Get PR details including merge status
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Check mergeable state
    if (pr.mergeable === null) {
      // GitHub is still computing mergeability
      return {
        merged: false,
        hasConflicts: false,
        conflictResolutionStarted: false,
        reason: 'Mergeability status pending, will retry next cycle',
      };
    }

    if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
      // Has merge conflicts
      console.log(`   PR has merge conflicts (mergeable_state: ${pr.mergeable_state})`);

      // Try to start a conflict resolution session
      if (branchName && environmentId) {
        try {
          const gitUrl = `https://github.com/${owner}/${repo}`;
          const conflictPrompt = `URGENT: The branch "${branchName}" has merge conflicts with the main branch that MUST be resolved before the PR can be merged.

## Steps to resolve:

1. First, make sure you're on the correct branch:
   \`\`\`
   git checkout ${branchName}
   \`\`\`

2. Fetch the latest changes:
   \`\`\`
   git fetch origin
   \`\`\`

3. Merge main into this branch (this will show conflicts):
   \`\`\`
   git merge origin/main
   \`\`\`

4. Git will show you which files have conflicts. For each conflicted file:
   - Open the file and find the conflict markers (<<<<<<, =======, >>>>>>>)
   - Understand what changes came from main vs this branch
   - Resolve the conflict by keeping the correct code (usually combining both changes appropriately)
   - Remove the conflict markers
   - Save the file

5. After resolving all conflicts:
   \`\`\`
   git add .
   git commit -m "Merge main and resolve conflicts"
   git push origin ${branchName}
   \`\`\`

## Important:
- Do NOT skip this task - the PR cannot be merged until conflicts are resolved
- Make sure to actually run the git commands and resolve the conflicts
- After pushing, verify that the push succeeded`;

          const claudeClient = new ClaudeWebClient({
            accessToken: claudeAuth.accessToken,
            environmentId,
          });

          let conflictSessionId: string;

          if (taskInfo?.sessionId) {
            // Try to resume existing session for conflict resolution
            try {
              const session = await claudeClient.getSession(taskInfo.sessionId);

              if (!['archived', 'failed', 'completed'].includes(session.session_status)) {
                // Session can be resumed
                console.log(`   Resuming session ${taskInfo.sessionId} for conflict resolution`);
                await claudeClient.sendMessage(taskInfo.sessionId, conflictPrompt);
                conflictSessionId = taskInfo.sessionId;
              } else {
                throw new Error(`Session is ${session.session_status}`);
              }
            } catch (error) {
              // Fall back to new session
              console.log(`   Cannot resume session: ${error}, creating new session`);
              const { sessionId } = await claudeClient.createSession({
                prompt: conflictPrompt,
                gitUrl,
                branchPrefix: branchName,
                title: `Resolve conflicts: PR #${prNumber}`,
              });
              conflictSessionId = sessionId;
            }
          } else {
            // No session ID - create new (shouldn't happen in normal flow)
            const { sessionId } = await claudeClient.createSession({
              prompt: conflictPrompt,
              gitUrl,
              branchPrefix: branchName,
              title: `Resolve conflicts: PR #${prNumber}`,
            });
            conflictSessionId = sessionId;
          }

          return {
            merged: false,
            hasConflicts: true,
            conflictResolutionStarted: true,
            sessionId: conflictSessionId,
            reason: 'Merge conflicts detected',
          };
        } catch (error) {
          console.error(`   Failed to start conflict resolution: ${error}`);
          return {
            merged: false,
            hasConflicts: true,
            conflictResolutionStarted: false,
            reason: `Merge conflicts, failed to start resolution: ${error}`,
          };
        }
      }

      return {
        merged: false,
        hasConflicts: true,
        conflictResolutionStarted: false,
        reason: 'Merge conflicts detected, no branch name to resolve',
      };
    }

    // Check if blocked by status checks
    if (pr.mergeable_state === 'blocked') {
      return {
        merged: false,
        hasConflicts: false,
        conflictResolutionStarted: false,
        reason: 'Blocked by status checks',
      };
    }

    // PR is mergeable - merge it
    try {
      await octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: 'squash', // or 'merge' or 'rebase'
        commit_title: `${pr.title} (#${prNumber})`,
      });

      // Delete the branch after successful merge
      if (branchName) {
        try {
          await octokit.git.deleteRef({
            owner,
            repo,
            ref: `heads/${branchName}`,
          });
          console.log(`   Deleted branch: ${branchName}`);
        } catch {
          // Branch deletion failed, not critical
          console.log(`   Warning: Could not delete branch ${branchName}`);
        }
      }

      return {
        merged: true,
        hasConflicts: false,
        conflictResolutionStarted: false,
      };
    } catch (error) {
      return {
        merged: false,
        hasConflicts: false,
        conflictResolutionStarted: false,
        reason: `Merge failed: ${error}`,
      };
    }
  } catch (error) {
    return {
      merged: false,
      hasConflicts: false,
      conflictResolutionStarted: false,
      reason: `Error checking PR: ${error}`,
    };
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
