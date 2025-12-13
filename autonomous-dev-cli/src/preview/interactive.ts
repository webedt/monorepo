/**
 * Interactive Task Preview CLI
 *
 * Provides an interactive command-line interface for reviewing,
 * filtering, and approving discovered tasks before execution.
 */

import * as readline from 'readline';
import chalk from 'chalk';
import type {
  PreviewTask,
  TaskAction,
  TaskFilterOptions,
  TaskSortOptions,
  TaskSortField,
  MenuOption,
  PreviewResult,
} from './types.js';
import type { DiscoveredTaskPriority, DiscoveredTaskCategory, DiscoveredTaskComplexity } from '../discovery/index.js';
import { PreviewSessionManager } from './session.js';
import { logger } from '../utils/logger.js';

/**
 * Color mapping for priorities
 */
const PRIORITY_COLORS: Record<string, (text: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

/**
 * Color mapping for categories
 */
const CATEGORY_COLORS: Record<string, (text: string) => string> = {
  security: chalk.red.bold,
  bugfix: chalk.red,
  feature: chalk.green,
  refactor: chalk.blue,
  docs: chalk.cyan,
  test: chalk.magenta,
  chore: chalk.gray,
};

/**
 * Color mapping for complexity
 */
const COMPLEXITY_COLORS: Record<string, (text: string) => string> = {
  complex: chalk.red,
  moderate: chalk.yellow,
  simple: chalk.green,
};

/**
 * Color mapping for approval status
 */
const STATUS_COLORS: Record<string, (text: string) => string> = {
  pending: chalk.yellow,
  approved: chalk.green,
  rejected: chalk.red,
  deferred: chalk.gray,
};

/**
 * Status icons
 */
const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  approved: '✓',
  rejected: '✗',
  deferred: '⏸',
};

/**
 * Main menu options for task review
 */
const MAIN_MENU: MenuOption[] = [
  { key: 'a', label: 'Approve', action: 'approve', description: 'Approve this task for execution' },
  { key: 'r', label: 'Reject', action: 'reject', description: 'Reject this task' },
  { key: 'd', label: 'Defer', action: 'defer', description: 'Defer for later review' },
  { key: 'e', label: 'Edit', action: 'edit', description: 'Edit title or description' },
  { key: 'n', label: 'Notes', action: 'notes', description: 'Add notes to this task' },
  { key: 'v', label: 'View', action: 'details', description: 'View full details' },
  { key: 's', label: 'Skip', action: 'skip', description: 'Skip to next task' },
  { key: 'b', label: 'Back', action: 'back', description: 'Go back to previous task' },
  { key: 'f', label: 'Filter', action: 'filter', description: 'Apply filters' },
  { key: 'o', label: 'Sort', action: 'sort', description: 'Change sort order' },
  { key: 'A', label: 'Approve All', action: 'approveAll', description: 'Approve all remaining tasks' },
  { key: 'R', label: 'Reject All', action: 'rejectAll', description: 'Reject all remaining tasks' },
  { key: 'w', label: 'Save', action: 'save', description: 'Save current state to file' },
  { key: 'q', label: 'Done', action: 'done', description: 'Finish review session' },
];

/**
 * Interactive preview session handler
 */
export class InteractivePreview {
  private session: PreviewSessionManager;
  private rl: readline.Interface;
  private currentIndex: number = 0;
  private running: boolean = false;
  private savePath?: string;

  constructor(session: PreviewSessionManager, savePath?: string) {
    this.session = session;
    this.savePath = savePath;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Start the interactive preview session
   */
  async start(): Promise<PreviewResult> {
    this.running = true;

    this.displayHeader();
    this.displayProgress();

    const tasks = this.session.getTasks();
    if (tasks.length === 0) {
      console.log(chalk.yellow('\nNo tasks to review.\n'));
      this.rl.close();
      return this.session.getResult();
    }

    while (this.running) {
      const filteredTasks = this.session.getTasks();
      if (filteredTasks.length === 0) {
        console.log(chalk.yellow('\nNo tasks match current filters.\n'));
        const action = await this.promptAction(['filter', 'done']);
        await this.handleAction(action);
        continue;
      }

      // Ensure index is valid
      this.currentIndex = Math.max(0, Math.min(this.currentIndex, filteredTasks.length - 1));
      const currentTask = filteredTasks[this.currentIndex];

      this.displayTask(currentTask, this.currentIndex, filteredTasks.length);
      const action = await this.promptAction();
      await this.handleAction(action, currentTask);
    }

    this.rl.close();
    return this.session.getResult();
  }

  /**
   * Display the preview header
   */
  private displayHeader(): void {
    console.log();
    logger.header('Task Preview & Approval');
    console.log(chalk.gray('Review discovered tasks before execution.'));
    console.log(chalk.gray('Use the menu options below to approve, reject, or defer tasks.'));
    console.log();
  }

  /**
   * Display current progress
   */
  private displayProgress(): void {
    const counts = this.session.getStatusCounts();
    const total = this.session.getSession().tasks.length;

    console.log(chalk.bold('Progress:'));
    console.log(`  ${STATUS_ICONS.approved} Approved: ${chalk.green(counts.approved)}`);
    console.log(`  ${STATUS_ICONS.rejected} Rejected: ${chalk.red(counts.rejected)}`);
    console.log(`  ${STATUS_ICONS.deferred} Deferred: ${chalk.gray(counts.deferred)}`);
    console.log(`  ${STATUS_ICONS.pending} Pending:  ${chalk.yellow(counts.pending)}`);
    console.log(`  Total:    ${total}`);
    console.log();
  }

  /**
   * Display a task for review
   */
  private displayTask(task: PreviewTask, index: number, total: number): void {
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold(`Task ${index + 1}/${total}`));
    console.log();

    // Title
    console.log(chalk.bold.white(task.title));

    // Status badges
    const priorityColor = PRIORITY_COLORS[task.priority] || chalk.white;
    const categoryColor = CATEGORY_COLORS[task.category] || chalk.white;
    const complexityColor = COMPLEXITY_COLORS[task.estimatedComplexity] || chalk.white;
    const statusColor = STATUS_COLORS[task.approvalStatus] || chalk.white;

    console.log(
      `  ${priorityColor(`[${task.priority}]`)} ` +
      `${categoryColor(`[${task.category}]`)} ` +
      `${complexityColor(`[${task.estimatedComplexity}]`)} ` +
      `${statusColor(`${STATUS_ICONS[task.approvalStatus]} ${task.approvalStatus}`)}`
    );
    console.log();

    // Description preview (first 150 chars)
    const descPreview = task.description.length > 150
      ? task.description.slice(0, 150) + '...'
      : task.description;
    console.log(chalk.gray(descPreview));
    console.log();

    // Affected paths
    console.log(chalk.bold('Affected paths:'));
    for (const path of task.affectedPaths.slice(0, 3)) {
      console.log(`  • ${chalk.cyan(path)}`);
    }
    if (task.affectedPaths.length > 3) {
      console.log(chalk.gray(`  ... and ${task.affectedPaths.length - 3} more`));
    }

    // Estimated duration
    if (task.estimatedDurationMinutes) {
      console.log(chalk.gray(`\nEstimated time: ${task.estimatedDurationMinutes} minutes`));
    }

    // User notes if present
    if (task.userNotes) {
      console.log(chalk.yellow(`\nNotes: ${task.userNotes}`));
    }

    console.log();
  }

  /**
   * Display full task details
   */
  private displayFullDetails(task: PreviewTask): void {
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('Full Task Details'));
    console.log();

    console.log(chalk.bold('Title:'));
    console.log(`  ${task.title}`);
    if (task.originalTitle) {
      console.log(chalk.gray(`  (Original: ${task.originalTitle})`));
    }
    console.log();

    console.log(chalk.bold('Description:'));
    console.log(task.description.split('\n').map(line => `  ${line}`).join('\n'));
    if (task.originalDescription) {
      console.log(chalk.gray('\n  (Description was edited)'));
    }
    console.log();

    console.log(chalk.bold('Classification:'));
    console.log(`  Priority:   ${PRIORITY_COLORS[task.priority](task.priority)}`);
    console.log(`  Category:   ${CATEGORY_COLORS[task.category](task.category)}`);
    console.log(`  Complexity: ${COMPLEXITY_COLORS[task.estimatedComplexity](task.estimatedComplexity)}`);
    console.log();

    console.log(chalk.bold('Affected Paths:'));
    for (const path of task.affectedPaths) {
      console.log(`  • ${chalk.cyan(path)}`);
    }
    console.log();

    if (task.estimatedDurationMinutes) {
      console.log(chalk.bold('Estimated Duration:'));
      console.log(`  ${task.estimatedDurationMinutes} minutes`);
      console.log();
    }

    if (task.relatedIssues && task.relatedIssues.length > 0) {
      console.log(chalk.bold('Related Issues:'));
      for (const issue of task.relatedIssues) {
        console.log(`  • #${issue}`);
      }
      console.log();
    }

    if (task.userNotes) {
      console.log(chalk.bold('User Notes:'));
      console.log(`  ${task.userNotes}`);
      console.log();
    }

    console.log(chalk.gray(`Preview ID: ${task.previewId}`));
    if (task.statusUpdatedAt) {
      console.log(chalk.gray(`Last updated: ${task.statusUpdatedAt.toISOString()}`));
    }
    console.log();
  }

  /**
   * Display the action menu
   */
  private displayMenu(options: MenuOption[]): void {
    console.log(chalk.bold('Actions:'));
    for (const option of options) {
      const keyStyle = chalk.cyan.bold(`[${option.key}]`);
      console.log(`  ${keyStyle} ${option.label}`);
    }
    console.log();
  }

  /**
   * Prompt for user action
   */
  private async promptAction(allowedActions?: TaskAction[]): Promise<TaskAction> {
    const options = allowedActions
      ? MAIN_MENU.filter(o => allowedActions.includes(o.action))
      : MAIN_MENU;

    this.displayMenu(options);

    return new Promise((resolve) => {
      const prompt = chalk.cyan('> ');
      this.rl.question(prompt, (answer) => {
        const key = answer.trim().toLowerCase();

        // Check for uppercase actions
        const upperAnswer = answer.trim();
        const option = options.find(o => o.key === key || o.key === upperAnswer);

        if (option) {
          resolve(option.action);
        } else {
          console.log(chalk.yellow('Invalid option. Please try again.'));
          resolve(this.promptAction(allowedActions));
        }
      });
    });
  }

  /**
   * Prompt for text input
   */
  private async promptText(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(chalk.cyan(prompt + ' '), (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Prompt for confirmation
   */
  private async promptConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl.question(chalk.cyan(`${message} [y/N] `), (answer) => {
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  }

  /**
   * Handle user action
   */
  private async handleAction(action: TaskAction, task?: PreviewTask): Promise<void> {
    switch (action) {
      case 'approve':
        if (task) {
          this.session.approveTask(task.previewId);
          console.log(chalk.green(`✓ Task approved: ${task.title.slice(0, 50)}...`));
          this.moveToNext();
        }
        break;

      case 'reject':
        if (task) {
          this.session.rejectTask(task.previewId);
          console.log(chalk.red(`✗ Task rejected: ${task.title.slice(0, 50)}...`));
          this.moveToNext();
        }
        break;

      case 'defer':
        if (task) {
          this.session.deferTask(task.previewId);
          console.log(chalk.gray(`⏸ Task deferred: ${task.title.slice(0, 50)}...`));
          this.moveToNext();
        }
        break;

      case 'edit':
        if (task) {
          await this.handleEdit(task);
        }
        break;

      case 'notes':
        if (task) {
          const notes = await this.promptText('Enter notes:');
          if (notes) {
            this.session.addTaskNotes(task.previewId, notes);
            console.log(chalk.green('Notes added.'));
          }
        }
        break;

      case 'details':
        if (task) {
          this.displayFullDetails(task);
          await this.promptText('Press Enter to continue...');
        }
        break;

      case 'skip':
        this.moveToNext();
        break;

      case 'back':
        this.moveToPrevious();
        break;

      case 'filter':
        await this.handleFilter();
        break;

      case 'sort':
        await this.handleSort();
        break;

      case 'approveAll':
        if (await this.promptConfirm('Approve all pending tasks?')) {
          const count = this.session.approveAllPending();
          console.log(chalk.green(`✓ Approved ${count} tasks.`));
          this.displayProgress();
        }
        break;

      case 'rejectAll':
        if (await this.promptConfirm('Reject all pending tasks?')) {
          const count = this.session.rejectAllPending();
          console.log(chalk.red(`✗ Rejected ${count} tasks.`));
          this.displayProgress();
        }
        break;

      case 'save':
        await this.handleSave();
        break;

      case 'done':
        if (await this.promptConfirm('Finish review session?')) {
          this.running = false;
          this.displaySummary();
        }
        break;
    }
  }

  /**
   * Handle task editing
   */
  private async handleEdit(task: PreviewTask): Promise<void> {
    console.log(chalk.bold('\nEdit Task'));
    console.log('1. Edit title');
    console.log('2. Edit description');
    console.log('3. Cancel');

    const choice = await this.promptText('Choose (1-3):');

    switch (choice) {
      case '1':
        console.log(chalk.gray(`Current title: ${task.title}`));
        const newTitle = await this.promptText('New title:');
        if (newTitle) {
          this.session.updateTaskTitle(task.previewId, newTitle);
          console.log(chalk.green('Title updated.'));
        }
        break;

      case '2':
        console.log(chalk.gray('Current description:'));
        console.log(task.description.slice(0, 200) + '...');
        console.log(chalk.gray('\nEnter new description (end with empty line):'));
        const lines: string[] = [];
        let line = await this.promptText('');
        while (line) {
          lines.push(line);
          line = await this.promptText('');
        }
        if (lines.length > 0) {
          this.session.updateTaskDescription(task.previewId, lines.join('\n'));
          console.log(chalk.green('Description updated.'));
        }
        break;
    }
  }

  /**
   * Handle filtering
   */
  private async handleFilter(): Promise<void> {
    console.log(chalk.bold('\nFilter Tasks'));
    console.log('1. By priority (critical, high, medium, low)');
    console.log('2. By category (security, bugfix, feature, refactor, docs, test, chore)');
    console.log('3. By complexity (simple, moderate, complex)');
    console.log('4. By status (pending, approved, rejected, deferred)');
    console.log('5. Search by text');
    console.log('6. Clear filters');
    console.log('7. Cancel');

    const choice = await this.promptText('Choose (1-7):');
    const currentFilters = this.session.getSession().filters;

    switch (choice) {
      case '1':
        const priorities = await this.promptText('Priorities (comma-separated):');
        const validPriorities = priorities.split(',')
          .map(p => p.trim() as DiscoveredTaskPriority)
          .filter(p => ['critical', 'high', 'medium', 'low'].includes(p));
        this.session.setFilters({ ...currentFilters, priorities: validPriorities });
        console.log(chalk.green(`Filter applied: ${validPriorities.join(', ')}`));
        break;

      case '2':
        const categories = await this.promptText('Categories (comma-separated):');
        const validCategories = categories.split(',')
          .map(c => c.trim() as DiscoveredTaskCategory)
          .filter(c => ['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'].includes(c));
        this.session.setFilters({ ...currentFilters, categories: validCategories });
        console.log(chalk.green(`Filter applied: ${validCategories.join(', ')}`));
        break;

      case '3':
        const complexities = await this.promptText('Complexities (comma-separated):');
        const validComplexities = complexities.split(',')
          .map(c => c.trim() as DiscoveredTaskComplexity)
          .filter(c => ['simple', 'moderate', 'complex'].includes(c));
        this.session.setFilters({ ...currentFilters, complexities: validComplexities });
        console.log(chalk.green(`Filter applied: ${validComplexities.join(', ')}`));
        break;

      case '4':
        const statuses = await this.promptText('Statuses (comma-separated):');
        const validStatuses = statuses.split(',')
          .map(s => s.trim())
          .filter(s => ['pending', 'approved', 'rejected', 'deferred'].includes(s));
        this.session.setFilters({ ...currentFilters, statuses: validStatuses as any[] });
        console.log(chalk.green(`Filter applied: ${validStatuses.join(', ')}`));
        break;

      case '5':
        const searchTerm = await this.promptText('Search term:');
        this.session.setFilters({ ...currentFilters, searchTerm });
        console.log(chalk.green(`Search filter applied: "${searchTerm}"`));
        break;

      case '6':
        this.session.setFilters({});
        console.log(chalk.green('Filters cleared.'));
        break;
    }

    this.currentIndex = 0;
  }

  /**
   * Handle sorting
   */
  private async handleSort(): Promise<void> {
    console.log(chalk.bold('\nSort Tasks'));
    console.log('1. By priority');
    console.log('2. By category');
    console.log('3. By complexity');
    console.log('4. By title');
    console.log('5. By status');
    console.log('6. Cancel');

    const choice = await this.promptText('Choose (1-6):');
    const fields: TaskSortField[] = ['priority', 'category', 'complexity', 'title', 'status'];

    if (choice >= '1' && choice <= '5') {
      const field = fields[parseInt(choice) - 1];
      const orderChoice = await this.promptText('Order (a)scending or (d)escending:');
      const order = orderChoice.toLowerCase().startsWith('a') ? 'asc' : 'desc';

      this.session.setSort({ field, order });
      console.log(chalk.green(`Sorted by ${field} (${order})`));
      this.currentIndex = 0;
    }
  }

  /**
   * Handle saving to file
   */
  private async handleSave(): Promise<void> {
    const path = this.savePath || await this.promptText('Save path (default: approved-tasks.json):');
    const finalPath = path || 'approved-tasks.json';

    try {
      this.session.saveToBatchFile(finalPath);
      console.log(chalk.green(`Saved to ${finalPath}`));
    } catch (error) {
      console.log(chalk.red(`Failed to save: ${error}`));
    }
  }

  /**
   * Move to next task
   */
  private moveToNext(): void {
    const tasks = this.session.getTasks();
    if (this.currentIndex < tasks.length - 1) {
      this.currentIndex++;
    } else {
      const counts = this.session.getStatusCounts();
      if (counts.pending === 0) {
        console.log(chalk.green('\nAll tasks have been reviewed!'));
        this.displayProgress();
      } else {
        console.log(chalk.yellow('\nEnd of list. Some tasks are still pending.'));
        this.currentIndex = 0;
      }
    }
  }

  /**
   * Move to previous task
   */
  private moveToPrevious(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
    } else {
      console.log(chalk.yellow('Already at the beginning.'));
    }
  }

  /**
   * Display final summary
   */
  private displaySummary(): void {
    const result = this.session.getResult();

    console.log(chalk.gray('\n' + '─'.repeat(60)));
    console.log(chalk.bold('\nReview Session Summary'));
    console.log();

    console.log(`  ${chalk.green('✓')} Approved: ${result.approvedTasks.length}`);
    console.log(`  ${chalk.red('✗')} Rejected: ${result.rejectedTasks.length}`);
    console.log(`  ${chalk.gray('⏸')} Deferred: ${result.deferredTasks.length}`);
    console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);
    console.log();

    if (result.approvedTasks.length > 0) {
      console.log(chalk.bold('Approved Tasks:'));
      for (const task of result.approvedTasks.slice(0, 5)) {
        console.log(`  • ${task.title.slice(0, 60)}...`);
      }
      if (result.approvedTasks.length > 5) {
        console.log(chalk.gray(`  ... and ${result.approvedTasks.length - 5} more`));
      }
      console.log();
    }
  }
}

/**
 * Run an interactive preview session
 */
export async function runInteractivePreview(
  session: PreviewSessionManager,
  savePath?: string
): Promise<PreviewResult> {
  const interactive = new InteractivePreview(session, savePath);
  return interactive.start();
}
