import { CodebaseAnalyzer, type CodebaseAnalysis, type AnalyzerConfig, type TodoComment } from './analyzer.js';
import { type Issue } from '../github/issues.js';
import {
  logger,
  getCorrelationId,
  timeOperation,
  createOperationContext,
  finalizeOperationContext,
  startPhase,
  endPhase,
  recordPhaseOperation,
  recordPhaseError,
  isDebugModeEnabled,
  type RequestPhase,
} from '../utils/logger.js';
import { ClaudeError, ErrorCode } from '../utils/errors.js';
import { metrics } from '../utils/metrics.js';
import {
  extractRetryAfterMs,
  extractHttpStatus,
  isClaudeErrorRetryable,
} from '../utils/retry.js';
import {
  CircuitBreaker,
  getClaudeCircuitBreaker,
  type CircuitBreakerConfig,
} from '../utils/circuit-breaker.js';

/** Task priority levels aligned with worker pool prioritization */
export type DiscoveredTaskPriority = 'critical' | 'high' | 'medium' | 'low';

/** Task category for classification - aligned with worker pool */
export type DiscoveredTaskCategory = 'security' | 'bugfix' | 'feature' | 'refactor' | 'docs' | 'test' | 'chore';

/** Task complexity - affects timeout and resource allocation */
export type DiscoveredTaskComplexity = 'simple' | 'moderate' | 'complex';

export interface DiscoveredTask {
  title: string;
  description: string;
  priority: DiscoveredTaskPriority;
  category: DiscoveredTaskCategory;
  estimatedComplexity: DiscoveredTaskComplexity;
  affectedPaths: string[];
  /** Optional estimated duration in minutes for better scheduling */
  estimatedDurationMinutes?: number;
  /** Related issue numbers for dependency awareness (populated by deduplicator) */
  relatedIssues?: number[];
}

/**
 * Token refresh callback type for Claude authentication
 */
export type TokenRefreshCallback = (
  refreshToken: string
) => Promise<{ accessToken: string; refreshToken: string; expiresAt?: number }>;

export interface TaskGeneratorOptions {
  claudeAuth: {
    accessToken: string;
    refreshToken: string;
    expiresAt?: number;
  };
  repoPath: string;
  excludePaths: string[];
  tasksPerCycle: number;
  existingIssues: Issue[];
  repoContext?: string; // Optional context about what the repo does
  analyzerConfig?: AnalyzerConfig; // Optional analyzer configuration (maxDepth, maxFiles)
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>; // Optional circuit breaker configuration
  /** Enable fallback task generation when Claude fails (default: true) */
  enableFallbackGeneration?: boolean;
  /** Callback to refresh Claude tokens on 401/403 auth failures */
  onTokenRefresh?: TokenRefreshCallback;
}

/**
 * Result of task generation with status information
 */
export interface TaskGenerationResult {
  tasks: DiscoveredTask[];
  success: boolean;
  usedFallback: boolean;
  error?: {
    code: string;
    message: string;
    isRetryable: boolean;
  };
  duration: number;
}

export class TaskGenerator {
  private claudeAuth: { accessToken: string; refreshToken: string; expiresAt?: number };
  private repoPath: string;
  private excludePaths: string[];
  private tasksPerCycle: number;
  private existingIssues: Issue[];
  private repoContext: string;
  private analyzerConfig: AnalyzerConfig;
  private circuitBreaker: CircuitBreaker;
  private enableFallbackGeneration: boolean;
  private onTokenRefresh?: TokenRefreshCallback;
  private tokenRefreshAttempted: boolean = false;

  constructor(options: TaskGeneratorOptions) {
    this.claudeAuth = options.claudeAuth;
    this.repoPath = options.repoPath;
    this.excludePaths = options.excludePaths;
    this.tasksPerCycle = options.tasksPerCycle;
    this.existingIssues = options.existingIssues;
    this.repoContext = options.repoContext || '';
    this.analyzerConfig = options.analyzerConfig || {};
    // Get or create the Claude API circuit breaker with optional config overrides
    this.circuitBreaker = getClaudeCircuitBreaker(options.circuitBreakerConfig);
    // Enable fallback generation by default
    this.enableFallbackGeneration = options.enableFallbackGeneration !== false;
    // Store token refresh callback for auth failure recovery
    this.onTokenRefresh = options.onTokenRefresh;
  }

  /**
   * Attempt to refresh Claude tokens when authentication fails.
   * Returns true if refresh was successful, false otherwise.
   */
  private async attemptTokenRefresh(): Promise<boolean> {
    // Only attempt refresh once per request cycle to prevent infinite loops
    if (this.tokenRefreshAttempted || !this.onTokenRefresh) {
      return false;
    }

    this.tokenRefreshAttempted = true;

    try {
      logger.info('Attempting to refresh Claude tokens after auth failure');

      const newTokens = await this.onTokenRefresh(this.claudeAuth.refreshToken);

      // Update the stored tokens
      this.claudeAuth = {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.expiresAt,
      };

      logger.info('Claude tokens refreshed successfully');
      return true;
    } catch (refreshError) {
      logger.error('Failed to refresh Claude tokens', {
        error: refreshError instanceof Error ? refreshError.message : String(refreshError),
      });
      return false;
    }
  }

  /**
   * Reset the token refresh attempt flag for a new request cycle.
   */
  resetTokenRefreshState(): void {
    this.tokenRefreshAttempted = false;
  }

  /**
   * Check if tokens are about to expire and proactively refresh.
   * Returns true if tokens are valid or were successfully refreshed.
   */
  async validateAndRefreshTokensIfNeeded(): Promise<boolean> {
    // Check if we have expiration info and token is about to expire (within 5 minutes)
    if (this.claudeAuth.expiresAt) {
      const now = Date.now();
      const expiresIn = this.claudeAuth.expiresAt - now;

      if (expiresIn < 5 * 60 * 1000) {
        logger.info('Claude token expiring soon, proactively refreshing', {
          expiresIn: Math.round(expiresIn / 1000),
        });
        return this.attemptTokenRefresh();
      }
    }

    return true;
  }

  /**
   * Get the circuit breaker health status
   */
  getCircuitBreakerHealth() {
    return this.circuitBreaker.getHealth();
  }

  async generateTasks(): Promise<DiscoveredTask[]> {
    const result = await this.generateTasksWithFallback();
    return result.tasks;
  }

  /**
   * Generate tasks with detailed result information including fallback status
   */
  async generateTasksWithFallback(): Promise<TaskGenerationResult> {
    const correlationId = getCorrelationId();
    const startTime = Date.now();

    // Start discovery phase tracking
    if (correlationId) {
      startPhase(correlationId, 'discovery', {
        repoPath: this.repoPath,
        existingIssueCount: this.existingIssues.length,
        tasksPerCycle: this.tasksPerCycle,
        fallbackEnabled: this.enableFallbackGeneration,
      });
    }

    // Create operation context for structured logging
    const operationContext = createOperationContext('TaskGenerator', 'generateTasks', {
      repoPath: this.repoPath,
      excludePathCount: this.excludePaths.length,
      existingIssueCount: this.existingIssues.length,
    });

    logger.info('Generating tasks with Claude...', {
      correlationId,
      repoPath: this.repoPath,
      existingIssueCount: this.existingIssues.length,
      fallbackEnabled: this.enableFallbackGeneration,
    });

    let analysis: CodebaseAnalysis | undefined;

    try {
      // First, analyze the codebase with timing
      if (correlationId) {
        recordPhaseOperation(correlationId, 'discovery', 'analyzeCodebase');
      }

      const { result: analysisResult, duration: analysisDuration } = await timeOperation(
        async () => {
          const analyzer = new CodebaseAnalyzer(this.repoPath, this.excludePaths, this.analyzerConfig);
          return analyzer.analyze();
        },
        {
          operationName: 'analyzeCodebase',
          component: 'TaskGenerator',
          phase: 'discovery',
        }
      );

      analysis = analysisResult;

      logger.debug('Codebase analysis complete', {
        duration: analysisDuration,
        fileCount: analysis.fileCount,
        todoCount: analysis.todoComments.length,
        correlationId,
      });

      const analyzer = new CodebaseAnalyzer(this.repoPath, this.excludePaths, this.analyzerConfig);
      const summary = analyzer.generateSummary(analysis);

      // Format existing issues to avoid duplicates
      const existingIssuesList = this.existingIssues
        .map((i) => `- #${i.number}: ${i.title}`)
        .join('\n') || 'None';

      // Build the prompt
      const prompt = this.buildPrompt(summary, existingIssuesList, analysis);

      // Call Claude API with timing
      if (correlationId) {
        recordPhaseOperation(correlationId, 'discovery', 'callClaudeAPI');
      }

      const { result: tasks, duration: claudeDuration } = await timeOperation(
        () => this.callClaude(prompt),
        {
          operationName: 'callClaudeAPI',
          component: 'TaskGenerator',
          phase: 'discovery',
        }
      );

      const totalDuration = Date.now() - startTime;

      // End discovery phase successfully
      if (correlationId) {
        endPhase(correlationId, 'discovery', true, {
          tasksGenerated: tasks.length,
          analysisDuration,
          claudeDuration,
          totalDuration,
          usedFallback: false,
        });
      }

      // Log operation completion with metrics
      const operationMetadata = finalizeOperationContext(operationContext, true, {
        tasksGenerated: tasks.length,
        analysisDuration,
        claudeDuration,
        fileCount: analysis.fileCount,
      });
      logger.operationComplete('TaskGenerator', 'generateTasks', true, operationMetadata);

      // Record discovery metrics
      metrics.recordDiscovery(tasks.length, totalDuration, false, {
        repository: this.repoPath.split('/').slice(-2).join('/'),
      });

      logger.info(`Generated ${tasks.length} tasks`, {
        correlationId,
        duration: totalDuration,
        analysisDuration,
        claudeDuration,
        usedFallback: false,
      });

      return {
        tasks,
        success: true,
        usedFallback: false,
        duration: totalDuration,
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorCode = error instanceof ClaudeError ? error.code : 'UNKNOWN';
      const isRetryable = error instanceof ClaudeError ? error.isRetryable : true;

      // Record error in phase tracking
      if (correlationId) {
        recordPhaseError(correlationId, 'discovery', errorCode);
      }

      logger.warn('Claude task generation failed', {
        correlationId,
        errorCode,
        errorMessage: error instanceof Error ? error.message : String(error),
        fallbackEnabled: this.enableFallbackGeneration,
        duration: totalDuration,
      });

      // Try fallback generation if enabled
      if (this.enableFallbackGeneration && analysis) {
        logger.info('Attempting fallback task generation from codebase analysis', {
          correlationId,
        });

        try {
          const fallbackTasks = this.generateFallbackTasks(analysis);

          if (correlationId) {
            endPhase(correlationId, 'discovery', true, {
              tasksGenerated: fallbackTasks.length,
              duration: totalDuration,
              usedFallback: true,
              originalError: errorCode,
            });
          }

          const operationMetadata = finalizeOperationContext(operationContext, true, {
            tasksGenerated: fallbackTasks.length,
            usedFallback: true,
            originalError: errorCode,
          });
          logger.operationComplete('TaskGenerator', 'generateTasks', true, operationMetadata);

          // Record discovery metrics (with fallback flag)
          metrics.recordDiscovery(fallbackTasks.length, totalDuration, true, {
            repository: this.repoPath.split('/').slice(-2).join('/'),
          });

          logger.info(`Generated ${fallbackTasks.length} fallback tasks`, {
            correlationId,
            duration: totalDuration,
            usedFallback: true,
          });

          return {
            tasks: fallbackTasks,
            success: true,
            usedFallback: true,
            error: {
              code: errorCode,
              message: error instanceof Error ? error.message : String(error),
              isRetryable,
            },
            duration: totalDuration,
          };
        } catch (fallbackError) {
          logger.error('Fallback task generation also failed', {
            correlationId,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }

      // End phase as failed
      if (correlationId) {
        endPhase(correlationId, 'discovery', false, {
          errorCode,
          duration: totalDuration,
        });
      }

      // Log operation failure
      const operationMetadata = finalizeOperationContext(operationContext, false, {
        error: error instanceof Error ? error.message : String(error),
      });
      logger.operationComplete('TaskGenerator', 'generateTasks', false, operationMetadata);

      // Return empty result with error info instead of throwing
      return {
        tasks: [],
        success: false,
        usedFallback: false,
        error: {
          code: errorCode,
          message: error instanceof Error ? error.message : String(error),
          isRetryable,
        },
        duration: totalDuration,
      };
    }
  }

  /**
   * Generate fallback tasks from codebase analysis when Claude is unavailable.
   * Creates basic tasks from TODO comments, FIXME items, and other signals.
   */
  private generateFallbackTasks(analysis: CodebaseAnalysis): DiscoveredTask[] {
    const tasks: DiscoveredTask[] = [];
    const existingTitles = new Set(this.existingIssues.map(i => i.title.toLowerCase()));

    // Prioritize FIXME comments as they usually indicate bugs
    const fixmeComments = analysis.todoComments.filter(t => t.type === 'FIXME');
    const todoComments = analysis.todoComments.filter(t => t.type === 'TODO');
    const otherComments = analysis.todoComments.filter(t => !['FIXME', 'TODO'].includes(t.type));

    // Generate tasks from FIXME comments (higher priority)
    for (const fixme of fixmeComments.slice(0, Math.ceil(this.tasksPerCycle / 2))) {
      const title = `Fix: ${fixme.text.slice(0, 80)}${fixme.text.length > 80 ? '...' : ''}`;

      if (existingTitles.has(title.toLowerCase())) continue;

      tasks.push({
        title,
        description: `Found FIXME comment in ${fixme.file} at line ${fixme.line}:\n\n\`\`\`\n${fixme.text}\n\`\`\`\n\nThis indicates a known issue that needs to be fixed.`,
        priority: 'medium',
        category: 'bugfix',
        estimatedComplexity: 'moderate',
        affectedPaths: [fixme.file],
        estimatedDurationMinutes: 45,
      });

      if (tasks.length >= this.tasksPerCycle) break;
    }

    // Generate tasks from TODO comments
    for (const todo of todoComments.slice(0, this.tasksPerCycle * 2)) {
      if (tasks.length >= this.tasksPerCycle) break;

      const title = `Address TODO: ${todo.text.slice(0, 80)}${todo.text.length > 80 ? '...' : ''}`;

      if (existingTitles.has(title.toLowerCase())) continue;

      tasks.push({
        title,
        description: `Found TODO comment in ${todo.file} at line ${todo.line}:\n\n\`\`\`\n${todo.text}\n\`\`\`\n\nPlease review and address this TODO item.`,
        priority: 'low',
        category: 'chore',
        estimatedComplexity: 'simple',
        affectedPaths: [todo.file],
        estimatedDurationMinutes: 30,
      });
    }

    // Generate tasks from HACK/XXX comments (if we need more tasks)
    for (const other of otherComments.slice(0, this.tasksPerCycle - tasks.length)) {
      if (tasks.length >= this.tasksPerCycle) break;

      const title = `Review ${other.type}: ${other.text.slice(0, 70)}${other.text.length > 70 ? '...' : ''}`;

      if (existingTitles.has(title.toLowerCase())) continue;

      tasks.push({
        title,
        description: `Found ${other.type} comment in ${other.file} at line ${other.line}:\n\n\`\`\`\n${other.text}\n\`\`\`\n\nThis indicates code that needs review or cleanup.`,
        priority: 'low',
        category: 'refactor',
        estimatedComplexity: 'simple',
        affectedPaths: [other.file],
        estimatedDurationMinutes: 30,
      });
    }

    // If still not enough tasks, generate generic improvement suggestions
    if (tasks.length < Math.min(2, this.tasksPerCycle)) {
      const genericTasks: DiscoveredTask[] = [
        {
          title: 'Review and update documentation',
          description: 'Review existing documentation for accuracy and completeness. Update outdated information and add missing documentation where needed.',
          priority: 'low',
          category: 'docs',
          estimatedComplexity: 'simple',
          affectedPaths: ['README.md', 'docs/'],
          estimatedDurationMinutes: 60,
        },
        {
          title: 'Run security audit on dependencies',
          description: 'Run `npm audit` or equivalent to check for security vulnerabilities in dependencies. Update any packages with known security issues.',
          priority: 'high',
          category: 'security',
          estimatedComplexity: 'simple',
          affectedPaths: ['package.json', 'package-lock.json'],
          estimatedDurationMinutes: 30,
        },
      ];

      for (const genericTask of genericTasks) {
        if (tasks.length >= this.tasksPerCycle) break;
        if (!existingTitles.has(genericTask.title.toLowerCase())) {
          tasks.push(genericTask);
        }
      }
    }

    logger.debug(`Generated ${tasks.length} fallback tasks`, {
      fromFixmes: Math.min(fixmeComments.length, tasks.filter(t => t.category === 'bugfix').length),
      fromTodos: Math.min(todoComments.length, tasks.filter(t => t.category === 'chore').length),
      fromOther: Math.min(otherComments.length, tasks.filter(t => t.category === 'refactor').length),
    });

    return tasks.slice(0, this.tasksPerCycle);
  }

  private buildPrompt(codebaseSummary: string, existingIssues: string, analysis: CodebaseAnalysis): string {
    // Build git analysis section if available
    let gitAnalysisSection = '';
    if (analysis.gitAnalysis) {
      const { summary, fileChangeStats, dependencyGraph } = analysis.gitAnalysis;

      gitAnalysisSection = `
## Recent Development Activity

### Change Frequency Analysis (Last ${summary.totalCommits} commits)
**Most Frequently Changed Files (Hotspots):**
${fileChangeStats.slice(0, 10).map(s => `- ${s.file} (${s.changeCount} changes, impact: ${s.impactScore.toFixed(1)})`).join('\n')}

**Key Contributors:** ${summary.topContributors.slice(0, 5).join(', ')}

### Dependency Impact Analysis
**High-Impact Files (Many Dependents):**
${dependencyGraph.hotspots.slice(0, 5).map(f => `- ${f}`).join('\n')}

**Note:** Changes to high-impact files affect many other parts of the codebase. Consider this when prioritizing tasks.
`;
    }

    return `You are an expert software developer analyzing a codebase to identify the next set of improvements.

## Repository Context
${this.repoContext || 'This is a web application project.'}

## Current Codebase Analysis
${codebaseSummary}
${gitAnalysisSection}
## Existing Open Issues (DO NOT DUPLICATE)
${existingIssues}

## Your Task
Identify exactly ${this.tasksPerCycle} actionable improvements for this codebase. Focus on:

1. **High Impact** - Changes that improve user experience, performance, or reliability
2. **Clear Scope** - Tasks that can be completed independently in a single PR
3. **Testable** - Changes where success can be verified
4. **Incremental** - Build on existing patterns, don't require major rewrites
5. **Active Development Areas** - Prioritize improvements to frequently changed files (see hotspots above)

### Categories to consider:
- **security**: Security vulnerabilities, auth issues, data protection
- **bugfix**: Fix existing broken behavior
- **feature**: New functionality users will notice
- **refactor**: Improve code quality without changing behavior
- **docs**: Improve documentation
- **test**: Add or improve tests
- **chore**: Maintenance tasks (dependencies, configs)

### Priorities:
- **critical**: Security vulnerabilities, data loss risks, production blockers
- **high**: User-facing bugs, important regressions
- **medium**: Important improvements, new features
- **low**: Nice-to-have, cleanup, minor improvements

### Complexity:
- **simple**: < 1 hour, few files
- **moderate**: 1-4 hours, multiple files
- **complex**: 4+ hours, architectural changes

## Output Format
Return a JSON array of tasks. Each task should have:
- title: Short, actionable title (imperative mood, e.g., "Add loading states to dashboard")
- description: Detailed description including:
  - What needs to be done
  - Why it's important
  - Acceptance criteria
  - Any relevant file paths or code references
- priority: "critical" | "high" | "medium" | "low"
- category: "security" | "bugfix" | "feature" | "refactor" | "docs" | "test" | "chore"
- estimatedComplexity: "simple" | "moderate" | "complex"
- affectedPaths: Array of file/directory paths that will likely be modified
- estimatedDurationMinutes: Optional number estimating how long the task will take

Example:
\`\`\`json
[
  {
    "title": "Add loading states to dashboard components",
    "description": "The dashboard currently shows no feedback while data is loading. Add skeleton loaders or spinners to:\\n- UserStats component\\n- RecentActivity component\\n\\nAcceptance criteria:\\n- Users see visual feedback within 100ms of navigation\\n- Loading states match existing design system\\n- No layout shift when content loads",
    "priority": "medium",
    "category": "feature",
    "estimatedComplexity": "simple",
    "affectedPaths": ["src/components/dashboard/", "src/styles/loading.css"],
    "estimatedDurationMinutes": 30
  }
]
\`\`\`

Remember:
- DO NOT suggest tasks that overlap with existing issues
- Each task should be self-contained (can be merged independently)
- Be specific about file paths when you know them
- Focus on practical improvements, not theoretical best practices

Return ONLY the JSON array, no other text.`;
  }

  private async callClaude(prompt: string): Promise<DiscoveredTask[]> {
    // Reset token refresh state for this new API call cycle
    this.resetTokenRefreshState();

    // Proactively refresh tokens if they're about to expire
    await this.validateAndRefreshTokensIfNeeded();

    // Use circuit breaker with exponential backoff for resilience
    return this.circuitBreaker.executeWithRetry(
      async () => {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.claudeAuth.accessToken,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const statusCode = response.status;

          // Handle 401/403 auth errors with token refresh
          if (statusCode === 401 || statusCode === 403) {
            const refreshed = await this.attemptTokenRefresh();
            if (refreshed) {
              // Retry with new tokens - throw a retryable error
              throw new ClaudeError(
                ErrorCode.CLAUDE_AUTH_FAILED,
                `Claude API authentication failed (${statusCode}), tokens refreshed - retrying`,
                {
                  context: {
                    statusCode,
                    errorText,
                    tokensRefreshed: true,
                  },
                }
              );
            }
          }

          // Create a structured error with proper classification
          const error = this.createApiError(statusCode, errorText, response.headers);
          throw error;
        }

        const data = await response.json() as { content: Array<{ text?: string }> };
        const content = data.content[0]?.text || '';

        // Parse JSON from response
        return this.parseClaudeResponse(content);
      },
      {
        maxRetries: 5,
        operationName: 'Claude API call (discovery)',
        context: {
          component: 'TaskGenerator',
          operation: 'generateTasks',
        },
        shouldRetry: (error) => {
          // Allow retry if tokens were just refreshed
          if (error instanceof ClaudeError && error.context?.tokensRefreshed) {
            return true;
          }
          return isClaudeErrorRetryable(error);
        },
        onRetry: (error, attempt, delay) => {
          const statusCode = extractHttpStatus(error);
          logger.warn(`Claude API retry (attempt ${attempt})`, {
            error: error.message,
            statusCode,
            retryInMs: Math.round(delay),
            circuitState: this.circuitBreaker.getState(),
            tokensRefreshed: error instanceof ClaudeError ? error.context?.tokensRefreshed : false,
          });
        },
      }
    );
  }

  /**
   * Create a structured error from Claude API response
   */
  private createApiError(statusCode: number, errorText: string, headers: Headers): ClaudeError {
    let code: ErrorCode;
    let message: string;

    switch (statusCode) {
      case 401:
        code = ErrorCode.CLAUDE_AUTH_FAILED;
        message = `Claude API authentication failed: ${errorText}`;
        break;
      case 403:
        code = ErrorCode.CLAUDE_AUTH_FAILED;
        message = `Claude API access denied: ${errorText}`;
        break;
      case 429:
        code = ErrorCode.CLAUDE_RATE_LIMITED;
        message = `Claude API rate limited: ${errorText}`;
        break;
      case 408:
      case 504:
        code = ErrorCode.CLAUDE_TIMEOUT;
        message = `Claude API request timed out: ${errorText}`;
        break;
      case 500:
      case 502:
      case 503:
        code = ErrorCode.CLAUDE_API_ERROR;
        message = `Claude API server error (${statusCode}): ${errorText}`;
        break;
      default:
        code = ErrorCode.CLAUDE_API_ERROR;
        message = `Claude API error (${statusCode}): ${errorText}`;
    }

    // Extract Retry-After header if present
    const retryAfter = headers.get('retry-after') || headers.get('Retry-After');

    return new ClaudeError(code, message, {
      context: {
        statusCode,
        errorText,
        retryAfter,
      },
    });
  }

  /**
   * Parse and validate Claude response JSON
   */
  private parseClaudeResponse(content: string): DiscoveredTask[] {
    // Find JSON array in response (in case there's extra text)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.error('No JSON array found in Claude response', { content });
      throw new ClaudeError(
        ErrorCode.CLAUDE_INVALID_RESPONSE,
        'No JSON array found in Claude response',
        {
          context: { contentLength: content.length },
        }
      );
    }

    let tasks: DiscoveredTask[];
    try {
      tasks = JSON.parse(jsonMatch[0]) as DiscoveredTask[];
    } catch (parseError) {
      logger.error('Failed to parse Claude response JSON', { error: parseError, content });
      throw new ClaudeError(
        ErrorCode.CLAUDE_INVALID_RESPONSE,
        'Failed to parse task suggestions from Claude',
        {
          context: { parseError: String(parseError) },
          cause: parseError instanceof Error ? parseError : undefined,
        }
      );
    }

    // Validate tasks
    const validTasks = tasks.filter((task) => {
      const isValid = (
        typeof task.title === 'string' &&
        typeof task.description === 'string' &&
        ['critical', 'high', 'medium', 'low'].includes(task.priority) &&
        ['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'].includes(task.category) &&
        ['simple', 'moderate', 'complex'].includes(task.estimatedComplexity) &&
        Array.isArray(task.affectedPaths) &&
        (task.estimatedDurationMinutes === undefined || typeof task.estimatedDurationMinutes === 'number')
      );
      return isValid;
    });

    if (validTasks.length !== tasks.length) {
      logger.warn(`Filtered out ${tasks.length - validTasks.length} invalid tasks`);
    }

    return validTasks.slice(0, this.tasksPerCycle);
  }
}

export async function discoverTasks(options: TaskGeneratorOptions): Promise<DiscoveredTask[]> {
  const generator = new TaskGenerator(options);
  return generator.generateTasks();
}

/**
 * Discover tasks with detailed result including fallback status
 */
export async function discoverTasksWithFallback(options: TaskGeneratorOptions): Promise<TaskGenerationResult> {
  const generator = new TaskGenerator(options);
  return generator.generateTasksWithFallback();
}
