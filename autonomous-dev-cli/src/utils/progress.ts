import ora, { type Ora } from 'ora';
import chalk from 'chalk';

/**
 * Progress phase for daemon cycle tracking
 */
export type CyclePhase =
  | 'fetch-issues'
  | 'discover-tasks'
  | 'execute-tasks'
  | 'evaluate'
  | 'create-prs'
  | 'merge-prs'
  | 'waiting';

/**
 * Phase descriptions for display
 */
const PHASE_DESCRIPTIONS: Record<CyclePhase, string> = {
  'fetch-issues': 'Fetching existing issues',
  'discover-tasks': 'Discovering new tasks',
  'execute-tasks': 'Executing tasks',
  'evaluate': 'Running evaluation pipeline',
  'create-prs': 'Creating pull requests',
  'merge-prs': 'Merging pull requests',
  'waiting': 'Waiting for next cycle',
};

/**
 * Phase icons for visual feedback
 */
const PHASE_ICONS: Record<CyclePhase, string> = {
  'fetch-issues': '📋',
  'discover-tasks': '🔍',
  'execute-tasks': '⚙️',
  'evaluate': '🧪',
  'create-prs': '📝',
  'merge-prs': '🔀',
  'waiting': '⏳',
};

/**
 * Progress bar configuration
 */
export interface ProgressBarConfig {
  total: number;
  width?: number;
  completeChar?: string;
  incompleteChar?: string;
  showPercentage?: boolean;
  showCount?: boolean;
  showETA?: boolean;
}

/**
 * Worker progress state
 */
export interface WorkerProgressState {
  workerId: string;
  taskId: string;
  issueNumber: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startTime?: number;
  progress?: number;
  message?: string;
}

/**
 * Phase timing information for breakdown
 */
export interface PhaseTimingInfo {
  phase: CyclePhase;
  startTime: number;
  endTime?: number;
  duration?: number;
}

/**
 * Cycle progress state
 */
export interface CycleProgressState {
  cycleNumber: number;
  phase: CyclePhase;
  stepNumber: number;
  totalSteps: number;
  startTime: number;
  phaseStartTime?: number;
  tasksDiscovered: number;
  tasksCompleted: number;
  tasksFailed: number;
  prsMerged: number;
  workers: Map<string, WorkerProgressState>;
  /** Timing breakdown by phase */
  phaseTimings: PhaseTimingInfo[];
}

/**
 * Cycle summary for display and JSON output
 */
export interface CycleSummary {
  cycleNumber: number;
  success: boolean;
  totalDuration: number;
  phaseBreakdown: Array<{
    phase: CyclePhase;
    duration: number;
    percentage: number;
  }>;
  tasks: {
    discovered: number;
    completed: number;
    failed: number;
    successRate: number;
  };
  prs: {
    merged: number;
  };
  workers: {
    total: number;
    completed: number;
    failed: number;
  };
}

/**
 * Estimated time calculator
 */
export class ETACalculator {
  private samples: number[] = [];
  private maxSamples = 10;

  addSample(durationMs: number): void {
    this.samples.push(durationMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getAverageMs(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  estimateRemaining(completed: number, total: number): number {
    if (completed === 0 || total === 0) return 0;
    const avgPerItem = this.getAverageMs() / completed;
    return avgPerItem * (total - completed);
  }

  reset(): void {
    this.samples = [];
  }
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

/**
 * Format ETA in human-readable format
 */
export function formatETA(ms: number): string {
  if (ms <= 0) return 'calculating...';
  if (ms < 1000) return '< 1s';
  return `~${formatDuration(ms)}`;
}

/**
 * Create a text-based progress bar
 */
export function createProgressBar(
  current: number,
  config: ProgressBarConfig
): string {
  const {
    total,
    width = 30,
    completeChar = '█',
    incompleteChar = '░',
    showPercentage = true,
    showCount = true,
  } = config;

  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const completed = Math.round((percentage / 100) * width);
  const remaining = width - completed;

  const bar = completeChar.repeat(completed) + incompleteChar.repeat(remaining);

  const parts: string[] = [chalk.cyan(`[${bar}]`)];

  if (showPercentage) {
    parts.push(chalk.yellow(`${percentage.toString().padStart(3)}%`));
  }

  if (showCount) {
    parts.push(chalk.gray(`(${current}/${total})`));
  }

  return parts.join(' ');
}

/**
 * Progress indicator manager for daemon operations
 */
export class ProgressManager {
  private spinner: Ora | null = null;
  private state: CycleProgressState | null = null;
  private isJsonMode: boolean;
  private updateInterval: NodeJS.Timeout | null = null;
  private phaseETAs: Map<CyclePhase, ETACalculator> = new Map();
  private lastOutputLines: number = 0;

  constructor(jsonMode: boolean = false) {
    this.isJsonMode = jsonMode;
    // Initialize ETA calculators for each phase
    for (const phase of Object.keys(PHASE_DESCRIPTIONS) as CyclePhase[]) {
      this.phaseETAs.set(phase, new ETACalculator());
    }
  }

  /**
   * Set JSON mode (disables spinners for structured output)
   */
  setJsonMode(enabled: boolean): void {
    this.isJsonMode = enabled;
    if (enabled && this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  /**
   * Start a new cycle
   */
  startCycle(cycleNumber: number, totalSteps: number = 6): void {
    this.state = {
      cycleNumber,
      phase: 'fetch-issues',
      stepNumber: 1,
      totalSteps,
      startTime: Date.now(),
      tasksDiscovered: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      prsMerged: 0,
      workers: new Map(),
      phaseTimings: [],
    };

    if (!this.isJsonMode) {
      this.startSpinner(`Cycle #${cycleNumber} starting...`);
    }
  }

  /**
   * Update the current phase
   */
  setPhase(phase: CyclePhase, stepNumber: number): void {
    if (!this.state) return;

    const now = Date.now();

    // Record duration of previous phase for ETA calculation and timing breakdown
    if (this.state.phaseStartTime) {
      const phaseDuration = now - this.state.phaseStartTime;
      this.phaseETAs.get(this.state.phase)?.addSample(phaseDuration);

      // Update the timing for the previous phase
      const lastTiming = this.state.phaseTimings.find(t => t.phase === this.state!.phase && !t.endTime);
      if (lastTiming) {
        lastTiming.endTime = now;
        lastTiming.duration = phaseDuration;
      }
    }

    this.state.phase = phase;
    this.state.stepNumber = stepNumber;
    this.state.phaseStartTime = now;

    // Add timing entry for the new phase
    this.state.phaseTimings.push({
      phase,
      startTime: now,
    });

    const description = PHASE_DESCRIPTIONS[phase];
    const icon = PHASE_ICONS[phase];

    if (!this.isJsonMode) {
      const stepText = `[${stepNumber}/${this.state.totalSteps}]`;
      this.updateSpinner(`${icon} ${chalk.cyan(stepText)} ${description}`);
    }
  }

  /**
   * Update task counts
   */
  updateTaskCounts(discovered: number, completed: number, failed: number, merged: number): void {
    if (!this.state) return;

    this.state.tasksDiscovered = discovered;
    this.state.tasksCompleted = completed;
    this.state.tasksFailed = failed;
    this.state.prsMerged = merged;
  }

  /**
   * Start tracking a worker
   */
  startWorker(workerId: string, taskId: string, issueNumber: number): void {
    if (!this.state) return;

    this.state.workers.set(workerId, {
      workerId,
      taskId,
      issueNumber,
      status: 'running',
      startTime: Date.now(),
      progress: 0,
    });

    this.updateWorkerDisplay();
  }

  /**
   * Update worker progress
   */
  updateWorker(workerId: string, progress: number, message?: string): void {
    if (!this.state) return;

    const worker = this.state.workers.get(workerId);
    if (worker) {
      worker.progress = progress;
      worker.message = message;
      this.updateWorkerDisplay();
    }
  }

  /**
   * Mark worker as completed
   */
  completeWorker(workerId: string, success: boolean): void {
    if (!this.state) return;

    const worker = this.state.workers.get(workerId);
    if (worker) {
      worker.status = success ? 'completed' : 'failed';
      worker.progress = 100;

      if (success) {
        this.state.tasksCompleted++;
      } else {
        this.state.tasksFailed++;
      }

      this.updateWorkerDisplay();
    }
  }

  /**
   * Show waiting state between cycles
   */
  showWaiting(nextCycleInMs: number): void {
    if (this.isJsonMode) return;

    this.setPhase('waiting', 0);
    this.startCountdown(nextCycleInMs);
  }

  /**
   * Start countdown for next cycle
   */
  private startCountdown(durationMs: number): void {
    if (this.isJsonMode) return;

    const endTime = Date.now() + durationMs;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      const remaining = endTime - Date.now();
      if (remaining <= 0) {
        this.stopCountdown();
        return;
      }

      const remainingStr = formatDuration(remaining);
      this.updateSpinner(`${PHASE_ICONS['waiting']} Waiting for next cycle... ${chalk.yellow(remainingStr)}`);
    }, 1000);
  }

  /**
   * Stop countdown
   */
  private stopCountdown(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * End the current cycle
   */
  endCycle(success: boolean): void {
    this.stopCountdown();

    if (!this.state) return;

    const now = Date.now();
    const duration = now - this.state.startTime;
    const durationStr = formatDuration(duration);

    // Finalize the last phase timing
    if (this.state.phaseStartTime) {
      const lastTiming = this.state.phaseTimings.find(t => t.phase === this.state!.phase && !t.endTime);
      if (lastTiming) {
        lastTiming.endTime = now;
        lastTiming.duration = now - this.state.phaseStartTime;
      }
    }

    if (!this.isJsonMode) {
      const icon = success ? chalk.green('✓') : chalk.red('✗');
      const status = success ? 'completed' : 'failed';
      this.stopSpinner(`${icon} Cycle #${this.state.cycleNumber} ${status} in ${durationStr}`);
    }

    this.state = null;
  }

  /**
   * Get cycle summary with timing breakdown
   */
  getCycleSummary(success: boolean): CycleSummary | null {
    if (!this.state) return null;

    const now = Date.now();
    const totalDuration = now - this.state.startTime;

    // Calculate phase breakdown with percentages
    const phaseBreakdown = this.state.phaseTimings
      .filter(t => t.duration !== undefined)
      .map(t => ({
        phase: t.phase,
        duration: t.duration!,
        percentage: totalDuration > 0 ? Math.round((t.duration! / totalDuration) * 100) : 0,
      }));

    // Get worker stats
    const workers = Array.from(this.state.workers.values());
    const completedWorkers = workers.filter(w => w.status === 'completed').length;
    const failedWorkers = workers.filter(w => w.status === 'failed').length;

    // Calculate task success rate
    const totalTasks = this.state.tasksCompleted + this.state.tasksFailed;
    const successRate = totalTasks > 0 ? Math.round((this.state.tasksCompleted / totalTasks) * 100) : 0;

    return {
      cycleNumber: this.state.cycleNumber,
      success,
      totalDuration,
      phaseBreakdown,
      tasks: {
        discovered: this.state.tasksDiscovered,
        completed: this.state.tasksCompleted,
        failed: this.state.tasksFailed,
        successRate,
      },
      prs: {
        merged: this.state.prsMerged,
      },
      workers: {
        total: workers.length,
        completed: completedWorkers,
        failed: failedWorkers,
      },
    };
  }

  /**
   * Display formatted cycle summary with color coding
   */
  displayCycleSummary(success: boolean): void {
    const summary = this.getCycleSummary(success);
    if (!summary) return;

    if (this.isJsonMode) {
      console.log(JSON.stringify({ type: 'cycle_summary', ...summary }));
      return;
    }

    console.log();
    console.log(chalk.bold('━'.repeat(60)));
    console.log(chalk.bold('  Cycle Summary'));
    console.log(chalk.bold('━'.repeat(60)));

    // Overall status with color coding
    const statusIcon = success ? chalk.green('✓') : chalk.red('✗');
    const statusColor = success ? chalk.green : chalk.red;
    const statusText = success ? 'COMPLETED' : 'FAILED';
    console.log(`  Status:     ${statusIcon} ${statusColor(statusText)}`);
    console.log(`  Duration:   ${chalk.cyan(formatDuration(summary.totalDuration))}`);
    console.log();

    // Tasks section with color coding
    console.log(chalk.bold('  Tasks:'));
    console.log(`    Discovered:  ${chalk.white(summary.tasks.discovered.toString())}`);
    const completedColor = summary.tasks.completed > 0 ? chalk.green : chalk.gray;
    console.log(`    Completed:   ${completedColor(summary.tasks.completed.toString())}`);
    const failedColor = summary.tasks.failed > 0 ? chalk.red : chalk.gray;
    console.log(`    Failed:      ${failedColor(summary.tasks.failed.toString())}`);
    const rateColor = summary.tasks.successRate >= 80 ? chalk.green :
                      summary.tasks.successRate >= 50 ? chalk.yellow : chalk.red;
    console.log(`    Success:     ${rateColor(summary.tasks.successRate + '%')}`);
    console.log();

    // PRs section
    console.log(chalk.bold('  Pull Requests:'));
    const mergedColor = summary.prs.merged > 0 ? chalk.green : chalk.gray;
    console.log(`    Merged:      ${mergedColor(summary.prs.merged.toString())}`);
    console.log();

    // Timing breakdown section
    if (summary.phaseBreakdown.length > 0) {
      console.log(chalk.bold('  Timing Breakdown:'));
      for (const phase of summary.phaseBreakdown) {
        const phaseName = PHASE_DESCRIPTIONS[phase.phase] || phase.phase;
        const duration = formatDuration(phase.duration);
        const bar = this.createMiniBar(phase.percentage);
        console.log(`    ${phaseName.padEnd(25)} ${bar} ${chalk.cyan(duration)} ${chalk.gray(`(${phase.percentage}%)`)}`);
      }
      console.log();
    }

    console.log(chalk.bold('━'.repeat(60)));
    console.log();
  }

  /**
   * Create a mini progress bar for timing breakdown
   */
  private createMiniBar(percentage: number): string {
    const width = 15;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  }

  /**
   * Get estimated time remaining for current cycle
   */
  getEstimatedTimeRemaining(): number {
    if (!this.state) return 0;

    let totalETA = 0;
    const currentPhaseIndex = Object.keys(PHASE_DESCRIPTIONS).indexOf(this.state.phase);

    // Add remaining time for current phase
    if (this.state.phaseStartTime) {
      const elapsed = Date.now() - this.state.phaseStartTime;
      const avgForPhase = this.phaseETAs.get(this.state.phase)?.getAverageMs() || 0;
      if (avgForPhase > elapsed) {
        totalETA += avgForPhase - elapsed;
      }
    }

    // Add estimated time for remaining phases
    const phases = Object.keys(PHASE_DESCRIPTIONS) as CyclePhase[];
    for (let i = currentPhaseIndex + 1; i < phases.length - 1; i++) { // Exclude 'waiting'
      const phaseAvg = this.phaseETAs.get(phases[i])?.getAverageMs() || 0;
      totalETA += phaseAvg;
    }

    return totalETA;
  }

  /**
   * Get current progress state for external monitoring
   */
  getState(): CycleProgressState | null {
    return this.state;
  }

  /**
   * Start or update the spinner
   */
  private startSpinner(text: string): void {
    if (this.isJsonMode) return;

    if (this.spinner) {
      this.spinner.text = text;
    } else {
      this.spinner = ora({
        text,
        spinner: 'dots',
        color: 'cyan',
      }).start();
    }
  }

  /**
   * Update spinner text
   */
  private updateSpinner(text: string): void {
    if (this.isJsonMode) return;

    if (this.spinner) {
      this.spinner.text = text;
    } else {
      this.startSpinner(text);
    }
  }

  /**
   * Stop spinner with final message
   */
  private stopSpinner(text?: string): void {
    if (this.spinner) {
      if (text) {
        this.spinner.stopAndPersist({ text });
      } else {
        this.spinner.stop();
      }
      this.spinner = null;
    }
  }

  /**
   * Update worker display (multi-line progress)
   */
  private updateWorkerDisplay(): void {
    if (this.isJsonMode || !this.state) return;

    const workers = Array.from(this.state.workers.values());
    const activeWorkers = workers.filter(w => w.status === 'running');

    if (activeWorkers.length === 0) return;

    // Build status line
    const statusParts: string[] = [];
    for (const worker of activeWorkers) {
      const progress = worker.progress ?? 0;
      const elapsed = worker.startTime ? formatDuration(Date.now() - worker.startTime) : '';
      const progressBar = createProgressBar(progress, { total: 100, width: 10, showPercentage: false, showCount: false });
      statusParts.push(`#${worker.issueNumber} ${progressBar}`);
    }

    const completedCount = workers.filter(w => w.status === 'completed').length;
    const failedCount = workers.filter(w => w.status === 'failed').length;
    const totalCount = workers.length;

    const summaryText = chalk.gray(`(${completedCount}✓ ${failedCount}✗ / ${totalCount})`);
    const workersText = statusParts.join(' | ');

    this.updateSpinner(`${PHASE_ICONS['execute-tasks']} Executing: ${workersText} ${summaryText}`);
  }

  /**
   * Display a progress bar for batch operations
   */
  showBatchProgress(
    current: number,
    total: number,
    label: string,
    etaMs?: number
  ): void {
    if (this.isJsonMode) return;

    const bar = createProgressBar(current, { total, width: 20 });
    let text = `${label}: ${bar}`;

    if (etaMs !== undefined && etaMs > 0) {
      text += ` ${chalk.gray(`ETA: ${formatETA(etaMs)}`)}`;
    }

    this.updateSpinner(text);
  }

  /**
   * Show success message
   */
  succeed(message: string): void {
    if (this.isJsonMode) return;

    if (this.spinner) {
      this.spinner.succeed(message);
      this.spinner = null;
    } else {
      console.log(`${chalk.green('✓')} ${message}`);
    }
  }

  /**
   * Show failure message
   */
  fail(message: string): void {
    if (this.isJsonMode) return;

    if (this.spinner) {
      this.spinner.fail(message);
      this.spinner = null;
    } else {
      console.log(`${chalk.red('✗')} ${message}`);
    }
  }

  /**
   * Show info message
   */
  info(message: string): void {
    if (this.isJsonMode) return;

    if (this.spinner) {
      this.spinner.info(message);
      this.spinner = null;
    } else {
      console.log(`${chalk.blue('ℹ')} ${message}`);
    }
  }

  /**
   * Show warning message
   */
  warn(message: string): void {
    if (this.isJsonMode) return;

    if (this.spinner) {
      this.spinner.warn(message);
      this.spinner = null;
    } else {
      console.log(`${chalk.yellow('⚠')} ${message}`);
    }
  }

  /**
   * Clear all progress state
   */
  clear(): void {
    this.stopCountdown();
    this.stopSpinner();
    this.state = null;
  }
}

// Global progress manager instance
let globalProgressManager: ProgressManager | null = null;

/**
 * Get or create the global progress manager
 */
export function getProgressManager(jsonMode?: boolean): ProgressManager {
  if (!globalProgressManager) {
    globalProgressManager = new ProgressManager(jsonMode);
  } else if (jsonMode !== undefined) {
    globalProgressManager.setJsonMode(jsonMode);
  }
  return globalProgressManager;
}

/**
 * Create a scoped progress indicator for a specific operation
 */
export function createScopedProgress(label: string, jsonMode: boolean = false): {
  start: (message?: string) => void;
  update: (message: string) => void;
  succeed: (message?: string) => void;
  fail: (message?: string) => void;
  stop: () => void;
} {
  let spinner: Ora | null = null;

  return {
    start: (message?: string) => {
      if (jsonMode) return;
      spinner = ora({
        text: message || label,
        spinner: 'dots',
        prefixText: chalk.gray(`[${label}]`),
      }).start();
    },
    update: (message: string) => {
      if (jsonMode || !spinner) return;
      spinner.text = message;
    },
    succeed: (message?: string) => {
      if (jsonMode || !spinner) return;
      spinner.succeed(message || label);
      spinner = null;
    },
    fail: (message?: string) => {
      if (jsonMode || !spinner) return;
      spinner.fail(message || `${label} failed`);
      spinner = null;
    },
    stop: () => {
      if (spinner) {
        spinner.stop();
        spinner = null;
      }
    },
  };
}
