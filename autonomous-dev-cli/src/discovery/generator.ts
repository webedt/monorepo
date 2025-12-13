import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodebaseAnalyzer, type CodebaseAnalysis } from './analyzer.js';
import { type Issue } from '../github/issues.js';
import { logger } from '../utils/logger.js';

export interface DiscoveredTask {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'chore';
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  affectedPaths: string[];
}

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
}

/**
 * Write Claude credentials to ~/.claude/.credentials.json for SDK usage
 */
function ensureClaudeCredentials(claudeAuth: { accessToken: string; refreshToken: string; expiresAt?: number }): void {
  const claudeDir = path.join(os.homedir(), '.claude');
  const credentialPath = path.join(claudeDir, '.credentials.json');

  // Create directory if it doesn't exist
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
  }

  // Write credentials in the format the SDK expects
  const credentials = {
    claudeAiOauth: {
      accessToken: claudeAuth.accessToken,
      refreshToken: claudeAuth.refreshToken,
      expiresAt: claudeAuth.expiresAt || (Date.now() + 86400000), // Default to 24h
      scopes: ['user:inference', 'user:profile'],
    }
  };

  fs.writeFileSync(credentialPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  logger.info('Claude credentials written to ~/.claude/.credentials.json');
}

export class TaskGenerator {
  private claudeAuth: { accessToken: string; refreshToken: string };
  private repoPath: string;
  private excludePaths: string[];
  private tasksPerCycle: number;
  private existingIssues: Issue[];
  private repoContext: string;

  constructor(options: TaskGeneratorOptions) {
    this.claudeAuth = options.claudeAuth;
    this.repoPath = options.repoPath;
    this.excludePaths = options.excludePaths;
    this.tasksPerCycle = options.tasksPerCycle;
    this.existingIssues = options.existingIssues;
    this.repoContext = options.repoContext || '';
  }

  async generateTasks(): Promise<DiscoveredTask[]> {
    logger.info('Generating tasks with Claude...');

    // First, analyze the codebase
    const analyzer = new CodebaseAnalyzer(this.repoPath, this.excludePaths);
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

  private buildPrompt(codebaseSummary: string, existingIssues: string, analysis: CodebaseAnalysis): string {
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
- **feature**: New functionality users will notice
- **bugfix**: Fix existing broken behavior
- **refactor**: Improve code quality without changing behavior
- **docs**: Improve documentation
- **test**: Add or improve tests
- **chore**: Maintenance tasks (dependencies, configs)

### Priorities:
- **high**: Critical issues, user-facing bugs, security
- **medium**: Important improvements, new features
- **low**: Nice-to-have, cleanup

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
- priority: "high" | "medium" | "low"
- category: "feature" | "bugfix" | "refactor" | "docs" | "test" | "chore"
- estimatedComplexity: "simple" | "moderate" | "complex"
- affectedPaths: Array of file/directory paths that will likely be modified

Example:
\`\`\`json
[
  {
    "title": "Add loading states to dashboard components",
    "description": "The dashboard currently shows no feedback while data is loading. Add skeleton loaders or spinners to:\\n- UserStats component\\n- RecentActivity component\\n\\nAcceptance criteria:\\n- Users see visual feedback within 100ms of navigation\\n- Loading states match existing design system\\n- No layout shift when content loads",
    "priority": "medium",
    "category": "feature",
    "estimatedComplexity": "simple",
    "affectedPaths": ["src/components/dashboard/", "src/styles/loading.css"]
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
    // Ensure credentials are written for the SDK
    ensureClaudeCredentials(this.claudeAuth);

    // Use Claude Agent SDK which handles OAuth automatically
    // maxTurns needs to be high enough for Claude to explore and return results
    const options: Options = {
      model: 'claude-sonnet-4-20250514',
      cwd: this.repoPath,
      maxTurns: 20,
      allowDangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
    };

    let content = '';

    try {
      logger.info('Starting Claude SDK query...');
      logger.info(`Prompt length: ${prompt.length} chars`);
      logger.info(`Working directory: ${this.repoPath}`);

      const startTime = Date.now();
      const queryStream = query({ prompt, options });
      let messageCount = 0;

      for await (const message of queryStream) {
        messageCount++;
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        // Capture the final result
        if (message.type === 'result' && message.subtype === 'success') {
          content = message.result;
          logger.info(`[${elapsed}s] ✅ Got final result`, { resultLength: content.length });
        }
        // Log assistant text messages with actual content
        else if (message.type === 'assistant' && message.message?.content) {
          const msgContent = message.message.content;
          if (Array.isArray(msgContent)) {
            for (const item of msgContent) {
              if (item.type === 'text' && item.text) {
                content = item.text;
                // Show first 200 chars of response
                const preview = item.text.slice(0, 200).replace(/\n/g, ' ');
                logger.info(`[${elapsed}s] 🤖 Claude: ${preview}${item.text.length > 200 ? '...' : ''}`);
              } else if (item.type === 'tool_use') {
                logger.info(`[${elapsed}s] 🔧 Tool: ${(item as any).name || 'unknown'}`);
              }
            }
          }
        }
        // Log tool results
        else if (message.type === 'user' && message.message?.content) {
          const msgContent = message.message.content;
          if (Array.isArray(msgContent)) {
            for (const item of msgContent) {
              if ((item as any).type === 'tool_result') {
                const result = (item as any).content;
                if (typeof result === 'string') {
                  const preview = result.slice(0, 100).replace(/\n/g, ' ');
                  logger.info(`[${elapsed}s] 📄 Result: ${preview}${result.length > 100 ? '...' : ''}`);
                }
              }
            }
          }
        }
        // Log system messages
        else if (message.type === 'system') {
          logger.info(`[${elapsed}s] ⚙️ System: ${(message as any).subtype || 'init'}`);
        }
      }

      const totalTime = Math.round((Date.now() - startTime) / 1000);
      logger.info(`Claude SDK query complete in ${totalTime}s (${messageCount} messages)`);
    } catch (error) {
      logger.error('Claude SDK error', { error });
      throw new Error(`Claude SDK error: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!content) {
      logger.error('No response from Claude SDK');
      throw new Error('No response from Claude');
    }

    // Parse JSON from response
    try {
      // Find JSON array in response (in case there's extra text)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.error('No JSON array found in Claude response', { content });
        throw new Error('No JSON array found in response');
      }

      const tasks = JSON.parse(jsonMatch[0]) as DiscoveredTask[];

      // Validate tasks
      const validTasks = tasks.filter((task) => {
        return (
          typeof task.title === 'string' &&
          typeof task.description === 'string' &&
          ['high', 'medium', 'low'].includes(task.priority) &&
          ['feature', 'bugfix', 'refactor', 'docs', 'test', 'chore'].includes(task.category) &&
          ['simple', 'moderate', 'complex'].includes(task.estimatedComplexity) &&
          Array.isArray(task.affectedPaths)
        );
      });

      if (validTasks.length !== tasks.length) {
        logger.warn(`Filtered out ${tasks.length - validTasks.length} invalid tasks`);
      }

      return validTasks.slice(0, this.tasksPerCycle);
    } catch (error) {
      logger.error('Failed to parse Claude response', { error, content });
      throw new Error('Failed to parse task suggestions from Claude');
    }
  }
}

export async function discoverTasks(options: TaskGeneratorOptions): Promise<DiscoveredTask[]> {
  const generator = new TaskGenerator(options);
  return generator.generateTasks();
}
