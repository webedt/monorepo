/**
 * Sync Command
 * Syncs discovered tasks to GitHub Issues and Projects
 */

import { Command } from 'commander';
import * as path from 'path';
import {
  TodoScannerService,
  SpecReaderService,
  GitHubIssuesService,
  GitHubProjectsService,
  getGitHubCredentials,
} from '@webedt/shared';

import { StateManager } from '../state/index.js';

import type { DiscoveredTask } from '@webedt/shared';

export const syncCommand = new Command('sync')
  .description('Sync discovered tasks to GitHub Issues and Projects')
  .requiredOption('--project <number>', 'GitHub Project number', parseInt)
  .option('--owner <owner>', 'Repository owner')
  .option('--repo <repo>', 'Repository name')
  .option('--root <path>', 'Repository root directory', process.cwd())
  .option('--dry-run', 'Show what would be synced without making changes')
  .option('--label <label>', 'Label for auto-task issues', 'auto-task')
  .action(async (options) => {
    const rootDir = path.resolve(options.root);

    // Get GitHub credentials
    const credentials = getGitHubCredentials({});
    if (!credentials) {
      console.error('Error: GitHub token not found');
      console.error('Set GITHUB_TOKEN or run `gh auth login`');
      process.exit(1);
    }

    // Determine owner/repo from git remote or options
    const { owner, repo } = await getOwnerRepo(rootDir, options);

    console.log(`\nSyncing tasks for ${owner}/${repo} to Project #${options.project}`);
    console.log('='.repeat(60));

    // Initialize services
    const issuesService = new GitHubIssuesService(credentials.token);
    const projectsService = new GitHubProjectsService(credentials.token);
    const stateManager = new StateManager(rootDir);

    // Get or cache project info
    let projectCache = stateManager.getProjectCache();
    if (!stateManager.isProjectCacheValid()) {
      console.log('\nFetching project info...');
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
      console.log(`  Project: ${project.title}`);
      console.log(`  Columns: ${statusField.options.map((o) => o.name).join(', ')}`);
    }

    // Save config
    stateManager.setConfig({
      owner,
      repo,
      projectNumber: options.project,
    });

    // Get existing issues with our label
    console.log('\nFetching existing auto-task issues...');
    const existingIssues = await issuesService.listIssues(owner, repo, {
      labels: [options.label],
      state: 'open',
    });
    console.log(`  Found ${existingIssues.length} existing issues`);

    const existingTitles = new Set(existingIssues.map((i) => i.title));

    // Discover tasks
    console.log('\nDiscovering tasks...');
    const backlogCount = stateManager.getTasks('backlog').length;
    const todosOnly = backlogCount > 10;

    if (todosOnly) {
      console.log('  (Backlog >10, skipping SPEC and analysis)');
    }

    const allTasks: DiscoveredTask[] = [];

    // TODOs
    const todoScanner = new TodoScannerService();
    const todos = await todoScanner.scan(rootDir);
    allTasks.push(...todos);
    console.log(`  TODOs: ${todos.length}`);

    if (!todosOnly) {
      // SPEC
      const specReader = new SpecReaderService();
      const specTasks = await specReader.getUnimplementedTasks(rootDir);
      for (const spec of specTasks) {
        allTasks.push({
          type: 'spec',
          file: '.aidev/SPEC.md',
          line: 0,
          text: `${spec.feature}: ${spec.description}`,
          priority: 'medium',
        });
      }
      console.log(`  SPEC features: ${specTasks.length}`);
    }

    // Filter out tasks that already have issues
    const newTasks = allTasks.filter((task) => {
      const title = generateIssueTitle(task);
      return !existingTitles.has(title);
    });

    console.log(`\nNew tasks to sync: ${newTasks.length}`);

    if (newTasks.length === 0) {
      console.log('All tasks already have issues!');
      return;
    }

    if (options.dryRun) {
      console.log('\n[Dry run] Would create these issues:');
      for (const task of newTasks.slice(0, 10)) {
        console.log(`  - ${generateIssueTitle(task)}`);
      }
      if (newTasks.length > 10) {
        console.log(`  ... and ${newTasks.length - 10} more`);
      }
      return;
    }

    // Create issues and add to project
    console.log('\nCreating issues...');
    let created = 0;
    let errors = 0;

    for (const task of newTasks) {
      try {
        const title = generateIssueTitle(task);
        const body = generateIssueBody(task);

        // Create issue
        const issue = await issuesService.createIssue(owner, repo, {
          title,
          body,
          labels: [options.label, task.type],
        });

        console.log(`  Created #${issue.number}: ${title.slice(0, 50)}...`);

        // Add to project
        const { itemId } = await projectsService.addItemToProject(
          projectCache!.projectId,
          issue.nodeId
        );

        // Move to Backlog column
        const backlogOptionId = projectCache!.statusOptions['backlog'];
        if (backlogOptionId) {
          await projectsService.updateItemStatus(
            projectCache!.projectId,
            itemId,
            projectCache!.statusFieldId,
            backlogOptionId
          );
        }

        // Track in state
        stateManager.addTask({
          issueNumber: issue.number,
          issueNodeId: issue.nodeId,
          projectItemId: itemId,
          title,
          status: 'backlog',
          priority: calculatePriority(task),
          source: task.type as 'todo' | 'spec' | 'analysis',
        });

        created++;
      } catch (error) {
        console.error(`  Error creating issue: ${error}`);
        errors++;
      }
    }

    stateManager.updateLastDiscoveryRun();

    console.log('\n' + '='.repeat(60));
    console.log(`Sync complete: ${created} created, ${errors} errors`);
  });

function generateIssueTitle(task: DiscoveredTask): string {
  const prefix = task.type === 'spec' ? '[SPEC]' : `[${task.type.toUpperCase()}]`;
  const text = task.text.split('\n')[0].slice(0, 80);
  return `${prefix} ${text}`;
}

function generateIssueBody(task: DiscoveredTask): string {
  const lines = [
    '## Description',
    task.text,
    '',
    '## Source',
    `- **Type:** ${task.type}`,
    `- **File:** \`${task.file}\``,
  ];

  if (task.line > 0) {
    lines.push(`- **Line:** ${task.line}`);
  }

  if (task.priority) {
    lines.push(`- **Priority:** ${task.priority}`);
  }

  lines.push('', '---', '*Created by auto-task*');

  return lines.join('\n');
}

function calculatePriority(task: DiscoveredTask): number {
  const sourceScore: Record<string, number> = {
    spec: 100,
    todo: 50,
    fixme: 60,
    hack: 40,
    analysis: 25,
  };

  const priorityMult: Record<string, number> = {
    critical: 2.0,
    high: 1.5,
    medium: 1.0,
    low: 0.5,
  };

  const source = sourceScore[task.type] || 25;
  const mult = priorityMult[task.priority || 'medium'] || 1.0;

  return Math.round(source * mult);
}

async function getOwnerRepo(
  rootDir: string,
  options: { owner?: string; repo?: string }
): Promise<{ owner: string; repo: string }> {
  if (options.owner && options.repo) {
    return { owner: options.owner, repo: options.repo };
  }

  // Try to get from git remote
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
  console.error('Use --owner and --repo options');
  process.exit(1);
}
