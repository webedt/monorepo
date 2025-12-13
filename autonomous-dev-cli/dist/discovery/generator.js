import { CodebaseAnalyzer } from './analyzer.js';
import { logger } from '../utils/logger.js';
import { ClaudeError, ErrorCode, withRetry, } from '../utils/errors.js';
import { fetchWithTimeout, isTimeoutError } from '../utils/timeout.js';
export class TaskGenerator {
    claudeAuth;
    repoPath;
    excludePaths;
    tasksPerCycle;
    existingIssues;
    repoContext;
    analyzerConfig;
    constructor(options) {
        this.claudeAuth = options.claudeAuth;
        this.repoPath = options.repoPath;
        this.excludePaths = options.excludePaths;
        this.tasksPerCycle = options.tasksPerCycle;
        this.existingIssues = options.existingIssues;
        this.repoContext = options.repoContext || '';
        this.analyzerConfig = options.analyzerConfig || {};
    }
    async generateTasks() {
        logger.info('Generating tasks with Claude...');
        // First, analyze the codebase
        const analyzer = new CodebaseAnalyzer(this.repoPath, this.excludePaths, this.analyzerConfig);
        const analysis = await analyzer.analyze();
        const summary = analyzer.generateSummary(analysis);
        // Format existing issues to avoid duplicates
        const existingIssuesList = this.existingIssues
            .map((i) => `- #${i.number}: ${i.title}`)
            .join('\n') || 'None';
        // Build the prompt
        const prompt = this.buildPrompt(summary, existingIssuesList, analysis);
        // Call Claude API
        const tasks = await this.callClaude(prompt);
        logger.info(`Generated ${tasks.length} tasks`);
        return tasks;
    }
    buildPrompt(codebaseSummary, existingIssues, analysis) {
        return `You are an expert software developer analyzing a codebase to identify the next set of improvements.

## Repository Context
${this.repoContext || 'This is a web application project.'}

## Current Codebase Analysis
${codebaseSummary}

## Existing Open Issues (DO NOT DUPLICATE)
${existingIssues}

## Your Task
Identify exactly ${this.tasksPerCycle} actionable improvements for this codebase. Focus on:

1. **High Impact** - Changes that improve user experience, performance, or reliability
2. **Clear Scope** - Tasks that can be completed independently in a single PR
3. **Testable** - Changes where success can be verified
4. **Incremental** - Build on existing patterns, don't require major rewrites

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
    async callClaude(prompt) {
        // Claude API timeout: 5 minutes for task generation
        const CLAUDE_API_TIMEOUT_MS = 5 * 60 * 1000;
        // Retry configuration for transient failures
        const retryConfig = {
            maxRetries: 3,
            baseDelayMs: 2000,
            maxDelayMs: 30000,
            backoffMultiplier: 2,
        };
        return withRetry(async () => {
            // Use direct API with OAuth tokens and timeout
            const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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
                timeoutMs: CLAUDE_API_TIMEOUT_MS,
            });
            if (!response.ok) {
                const error = await response.text();
                logger.error('Claude API error', { status: response.status, error });
                // Map HTTP status to appropriate error
                if (response.status === 401) {
                    throw new ClaudeError(ErrorCode.CLAUDE_AUTH_FAILED, `Claude authentication failed: ${error}`, { context: { status: response.status } });
                }
                else if (response.status === 429) {
                    throw new ClaudeError(ErrorCode.CLAUDE_QUOTA_EXCEEDED, `Claude rate limit exceeded: ${error}`, { context: { status: response.status } });
                }
                else if (response.status >= 500) {
                    throw new ClaudeError(ErrorCode.CLAUDE_API_ERROR, `Claude API server error: ${response.status} - ${error}`, { context: { status: response.status } });
                }
                else {
                    throw new ClaudeError(ErrorCode.CLAUDE_API_ERROR, `Claude API error: ${response.status} - ${error}`, { context: { status: response.status } });
                }
            }
            const data = await response.json();
            const content = data.content[0]?.text || '';
            // Parse JSON from response
            try {
                // Find JSON array in response (in case there's extra text)
                const jsonMatch = content.match(/\[[\s\S]*\]/);
                if (!jsonMatch) {
                    logger.error('No JSON array found in Claude response', { content });
                    throw new ClaudeError(ErrorCode.CLAUDE_INVALID_RESPONSE, 'No JSON array found in Claude response', { context: { contentLength: content.length } });
                }
                const tasks = JSON.parse(jsonMatch[0]);
                // Validate tasks
                const validTasks = tasks.filter((task) => {
                    const isValid = (typeof task.title === 'string' &&
                        typeof task.description === 'string' &&
                        ['critical', 'high', 'medium', 'low'].includes(task.priority) &&
                        ['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'].includes(task.category) &&
                        ['simple', 'moderate', 'complex'].includes(task.estimatedComplexity) &&
                        Array.isArray(task.affectedPaths) &&
                        (task.estimatedDurationMinutes === undefined || typeof task.estimatedDurationMinutes === 'number'));
                    return isValid;
                });
                if (validTasks.length !== tasks.length) {
                    logger.warn(`Filtered out ${tasks.length - validTasks.length} invalid tasks`);
                }
                return validTasks.slice(0, this.tasksPerCycle);
            }
            catch (error) {
                if (error instanceof ClaudeError)
                    throw error;
                logger.error('Failed to parse Claude response', { error, content });
                throw new ClaudeError(ErrorCode.CLAUDE_INVALID_RESPONSE, 'Failed to parse task suggestions from Claude', { context: { contentLength: content.length }, cause: error instanceof Error ? error : undefined });
            }
        }, {
            config: retryConfig,
            onRetry: (error, attempt, delay) => {
                logger.warn(`Claude API retry (attempt ${attempt}): ${error.message}, waiting ${delay}ms`);
            },
            shouldRetry: (error) => {
                // Retry on timeout
                if (isTimeoutError(error))
                    return true;
                // Retry on server errors
                if (error instanceof ClaudeError) {
                    return error.isRetryable || error.code === ErrorCode.CLAUDE_API_ERROR;
                }
                // Retry on network errors
                const message = error.message.toLowerCase();
                return (message.includes('network') ||
                    message.includes('timeout') ||
                    message.includes('enotfound') ||
                    message.includes('etimedout') ||
                    message.includes('econnreset'));
            },
        }).catch((error) => {
            // Wrap timeout errors as CLAUDE_TIMEOUT
            if (isTimeoutError(error) && !(error instanceof ClaudeError)) {
                throw new ClaudeError(ErrorCode.CLAUDE_TIMEOUT, `Claude API request timed out after ${CLAUDE_API_TIMEOUT_MS / 1000}s`, { context: { operation: 'generateTasks' }, cause: error instanceof Error ? error : undefined });
            }
            throw error;
        });
    }
}
export async function discoverTasks(options) {
    const generator = new TaskGenerator(options);
    return generator.generateTasks();
}
//# sourceMappingURL=generator.js.map