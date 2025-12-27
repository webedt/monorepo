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
} from '@webedt/shared';

import type { ClaudeAuth } from '@webedt/shared';
import type { ClaudeSessionEvent } from '@webedt/shared';
import type { ReviewIssue } from '@webedt/shared';
import type { ProjectItem } from '@webedt/shared';
import type { AutoTaskCommentInfo } from '@webedt/shared';

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
  .action(async (options) => {
    const rootDir = path.resolve(options.root);
    const pollInterval = options.pollInterval || POLL_INTERVAL_MS;
    const maxReady = options.maxReady || 3;
    const maxInProgress = options.maxInProgress || 3;

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
}

async function runDaemonCycle(ctx: DaemonContext): Promise<void> {
  const { projectsService, projectCache, maxReady, maxInProgress } = ctx;

  console.log('\n--- Daemon Cycle ---');
  console.log(new Date().toISOString());

  // Get current project items from GitHub (source of truth)
  console.log('\nFetching project items from GitHub...');
  const itemsByStatus = await projectsService.getItemsByStatus(projectCache.projectId);

  // Print current state
  const statusCounts: Record<string, number> = {};
  for (const [status, items] of itemsByStatus) {
    statusCounts[status] = items.length;
  }
  console.log('Current status:', Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(' '));

  // Get items by column
  const backlog = itemsByStatus.get('backlog') || [];
  const ready = itemsByStatus.get('ready') || [];
  const inProgress = itemsByStatus.get('in progress') || [];
  const inReview = itemsByStatus.get('in review') || [];

  // Step 1: Discover new tasks (create issues, add to backlog)
  console.log('\n1. Discovering tasks...');
  await discoverAndSync(ctx, backlog.length);

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

async function discoverAndSync(ctx: DaemonContext, backlogCount: number): Promise<void> {
  const { rootDir, owner, repo, issuesService, projectsService, projectCache } = ctx;

  // Check throttling
  if (backlogCount > 10) {
    console.log('   Backlog >10, only scanning TODOs');
  }

  const todoScanner = new TodoScannerService();
  const todos = await todoScanner.scan(rootDir);

  // Get existing issues with auto-task label
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

      console.log(`   Created issue #${issue.number}: ${title.slice(0, 50)}...`);
      created++;
    } catch (error) {
      console.error(`   Failed to create issue: ${error}`);
    }
  }

  console.log(`   Created ${created} new issues`);
}

async function moveBacklogToReady(
  ctx: DaemonContext,
  backlog: ProjectItem[],
  readyCount: number,
  maxReady: number
): Promise<void> {
  const { projectsService, projectCache } = ctx;

  const slotsAvailable = maxReady - readyCount;

  if (slotsAvailable <= 0) {
    console.log('   Ready queue full');
    return;
  }

  // Sort by issue number (lower = older = higher priority) since we don't have priority stored
  // Could also sort by labels or other criteria
  const toMove = backlog
    .filter((item) => item.contentType === 'Issue' && item.number)
    .sort((a, b) => (a.number || 0) - (b.number || 0))
    .slice(0, slotsAvailable);

  const readyId = projectCache.statusOptions['ready'];
  if (!readyId) {
    console.log('   No "Ready" column found');
    return;
  }

  for (const item of toMove) {
    try {
      await projectsService.updateItemStatus(
        projectCache.projectId,
        item.id,
        projectCache.statusFieldId,
        readyId
      );
      console.log(`   Moved #${item.number} to Ready`);
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
      await projectsService.updateItemStatus(
        projectCache.projectId,
        item.id,
        projectCache.statusFieldId,
        inProgressId
      );

      // Get issue details for prompt
      const issue = await issuesService.getIssue(owner, repo, item.number);
      const gitUrl = `https://github.com/${owner}/${repo}`;

      // Check if this is a re-work by looking at previous comments
      const previousInfo = await issuesService.getLatestAutoTaskInfo(owner, repo, item.number);
      const isRework = previousInfo?.branchName && previousInfo?.prNumber;

      const prompt = isRework && previousInfo
        ? buildReworkPrompt(previousInfo, item, issue)
        : buildTaskPrompt(issue.title, issue.body);

      console.log(`   Starting #${item.number}: ${item.title.slice(0, 40)}...`);
      console.log(`   ${isRework ? 'Re-work' : 'New task'}`);

      // Create Claude session
      const branchPrefix = isRework && previousInfo?.branchName
        ? previousInfo.branchName
        : `claude/issue-${item.number}`;

      const { sessionId, webUrl } = await claudeClient.createSession({
        prompt,
        gitUrl,
        branchPrefix,
        title: `${isRework ? 'Rework' : 'Issue'} #${item.number}: ${issue.title.slice(0, 50)}`,
      });

      console.log(`   Session created: ${sessionId}`);
      console.log(`   View at: ${webUrl}`);

      // Add comment to issue with session link (this IS our session tracking)
      const commentBody = isRework && previousInfo
        ? `### 🔄 Re-work\n\nAddressing code review feedback.\n\n**Session:** [View in Claude](${webUrl})\n**Branch:** \`${previousInfo.branchName}\`\n**PR:** #${previousInfo.prNumber}`
        : `### 🤖 Auto-Task Started\n\nClaude is working on this issue.\n\n**Session:** [View in Claude](${webUrl})`;

      await issuesService.addComment(owner, repo, item.number, commentBody);

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
    const taskInfo = await issuesService.getLatestAutoTaskInfo(owner, repo, item.number);
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
                await projectsService.updateItemStatus(
                  projectCache.projectId,
                  item.id,
                  projectCache.statusFieldId,
                  backlogId
                );
              }
              continue;
            }
          } else {
            console.log(`   PR #${prNumber} found`);
          }

          // Move to In Review
          if (inReviewId) {
            await projectsService.updateItemStatus(
              projectCache.projectId,
              item.id,
              projectCache.statusFieldId,
              inReviewId
            );
          }
          console.log(`   Moved to In Review`);

          // Add comment to issue with branch/PR info (for future lookups)
          await issuesService.addComment(
            owner,
            repo,
            item.number,
            `### ✅ Implementation Complete\n\nClaude has finished working on this issue.\n\n**Branch:** \`${branchName}\`\n**PR:** #${prNumber}\n\nThe PR is now being reviewed.`
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
            await projectsService.updateItemStatus(
              projectCache.projectId,
              item.id,
              projectCache.statusFieldId,
              backlogId
            );
          }

          // Add failure comment
          await issuesService.addComment(
            owner,
            repo,
            item.number,
            `### ⚠️ Session Issue\n\n${errorMsg}\n\nTask moved back to backlog and will be retried.`
          );
        }
      } else if (session.session_status === 'failed') {
        console.log(`   Session failed, moving back to backlog`);

        if (backlogId) {
          await projectsService.updateItemStatus(
            projectCache.projectId,
            item.id,
            projectCache.statusFieldId,
            backlogId
          );
        }

        // Add failure comment
        await issuesService.addComment(
          owner,
          repo,
          item.number,
          `### ❌ Session Failed\n\nThe Claude session failed to complete.\n\nTask moved back to backlog and will be retried.`
        );
      } else {
        console.log(`   Still running...`);
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

  for (const item of inReview) {
    if (!item.number) continue;

    // Get task info from GitHub comments to find PR number
    const taskInfo = await issuesService.getLatestAutoTaskInfo(owner, repo, item.number);
    if (!taskInfo?.prNumber) {
      console.log(`   #${item.number}: No PR found in comments, skipping review`);
      continue;
    }

    try {
      console.log(`   Reviewing PR #${taskInfo.prNumber} for issue #${item.number}...`);

      // Run code review
      const result = await reviewer.reviewPR(owner, repo, taskInfo.prNumber, {
        autoApprove: true,
        strict: false,
      });

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
          process.env.CLAUDE_ENVIRONMENT_ID || ''
        );

        if (mergeResult.merged) {
          // Successfully merged - move to Done
          console.log(`   PR merged successfully`);

          if (doneId) {
            await projectsService.updateItemStatus(
              projectCache.projectId,
              item.id,
              projectCache.statusFieldId,
              doneId
            );
          }

          // Close the issue (should auto-close from PR, but ensure it)
          await issuesService.closeIssue(owner, repo, item.number);
          console.log(`   Moved to Done, issue closed`);

          // Add completion comment
          await issuesService.addComment(
            owner,
            repo,
            item.number,
            `### 🎉 Task Complete\n\nPR #${taskInfo.prNumber} has been reviewed, approved, and merged.\n\nThis issue is now closed.`
          );
        } else if (mergeResult.hasConflicts) {
          // Has merge conflicts - needs resolution
          console.log(`   PR has merge conflicts: ${mergeResult.reason}`);

          if (mergeResult.conflictResolutionStarted) {
            // Claude is fixing conflicts - add comment with new session
            console.log(`   Conflict resolution session started`);

            await issuesService.addComment(
              owner,
              repo,
              item.number,
              `### 🔧 Resolving Merge Conflicts\n\nPR #${taskInfo.prNumber} has merge conflicts. Claude is working on resolving them.\n\n**Session:** [View in Claude](https://claude.ai/code/${mergeResult.sessionId})\n**Branch:** \`${taskInfo.branchName}\`\n**PR:** #${taskInfo.prNumber}`
            );
          } else {
            // Failed to start conflict resolution - move back to ready
            console.log(`   Moving back to Ready for manual conflict resolution`);

            if (readyId) {
              await projectsService.updateItemStatus(
                projectCache.projectId,
                item.id,
                projectCache.statusFieldId,
                readyId
              );
            }

            await issuesService.addComment(
              owner,
              repo,
              item.number,
              `### ⚠️ Merge Conflicts\n\nPR #${taskInfo.prNumber} has merge conflicts that could not be automatically resolved.\n\nMoving back to Ready for re-work.`
            );
          }
        } else {
          // Other merge failure
          console.log(`   Merge failed: ${mergeResult.reason}`);
          // Keep in review for manual intervention
        }
      } else {
        // Review rejected - move back to Ready for re-work
        console.log(`   Review rejected, moving back to Ready for re-work`);

        if (readyId) {
          await projectsService.updateItemStatus(
            projectCache.projectId,
            item.id,
            projectCache.statusFieldId,
            readyId
          );
        }

        // Format review issues for comment (will be visible to Claude on re-work via PR comments)
        const issuesText = formatReviewIssuesForComment(result.issues);

        // Add comment about review rejection WITH the actual issues
        await issuesService.addComment(
          owner,
          repo,
          item.number,
          `### 🔄 Review Feedback\n\nCode review found ${result.issues.length} issue(s) that need to be addressed:\n\n${issuesText}\n\nPR #${taskInfo.prNumber} is being sent back for re-work.`
        );
      }
    } catch (error) {
      console.error(`   Error reviewing task: ${error}`);
    }
  }
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
  environmentId: string
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
          const conflictPrompt = `The branch "${branchName}" has merge conflicts with the main branch.

Please:
1. Fetch the latest changes from origin
2. Merge the main branch into this branch
3. Resolve any merge conflicts carefully, preserving the intended functionality
4. Commit the merge resolution
5. Push the updated branch

Be careful to understand both sides of the conflicts before resolving them.`;

          const claudeClient = new ClaudeWebClient({
            accessToken: claudeAuth.accessToken,
            environmentId,
          });

          const { sessionId } = await claudeClient.createSession({
            prompt: conflictPrompt,
            gitUrl,
            branchPrefix: branchName, // Use existing branch
            title: `Resolve conflicts: PR #${prNumber}`,
          });

          return {
            merged: false,
            hasConflicts: true,
            conflictResolutionStarted: true,
            sessionId,
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
