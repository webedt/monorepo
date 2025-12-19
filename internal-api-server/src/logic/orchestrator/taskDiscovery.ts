/**
 * TaskDiscovery
 *
 * Uses LLM to analyze the codebase and discover tasks that need to be done
 * to achieve the goal defined in the request document.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ContentBlock, TextBlock } from '@anthropic-ai/sdk/resources/messages';

export interface DiscoveredTask {
  description: string;
  files: string[];
  parallel: boolean;
  priority: 'P0' | 'P1' | 'P2';
  context: string;
}

export interface TaskDiscoveryResult {
  tasks: DiscoveredTask[];
  reasoning: string;
  blockers: string[];
}

export interface TaskDiscoveryContext {
  requestDocument: string;
  taskList: string | null;
  repoOwner: string;
  repoName: string;
  branch: string;
  recentCommits: string[];
  fileTree: string;
  gitStatus: string;
  previousCycleSummary?: string;
}

const TASK_DISCOVERY_PROMPT = `You are analyzing a codebase to identify the next tasks needed to achieve a goal.

### Goal Document
{requestDocument}

### Current Task List
{taskList}

### Repository State
- Owner: {repoOwner}
- Repo: {repoName}
- Branch: {branch}
- Recent commits:
{recentCommits}

### File Structure
{fileTree}

### Git Status (changed files)
{gitStatus}

### Previous Cycle Summary
{previousCycleSummary}

### Instructions
1. Identify 1-5 tasks that can be worked on NOW to move toward the goal
2. For each task, specify:
   - A clear, actionable description
   - Which files will likely be modified
   - Whether it can run in parallel with other tasks
   - Priority (P0 = critical, P1 = important, P2 = nice to have)
3. Focus on tasks that are:
   - Independent (can be done without waiting for other tasks)
   - Well-defined (clear success criteria)
   - Appropriately sized (can be done in one agent session)

### Output Format (JSON only, no markdown)
{
  "tasks": [
    {
      "description": "Implement user authentication middleware",
      "files": ["src/middleware/auth.ts", "src/routes/protected.ts"],
      "parallel": true,
      "priority": "P0",
      "context": "Additional context for the agent..."
    }
  ],
  "reasoning": "Why these tasks were chosen...",
  "blockers": ["Any tasks that can't be done yet and why"]
}`;

export async function discoverTasks(
  context: TaskDiscoveryContext,
  apiKey: string
): Promise<TaskDiscoveryResult> {
  const anthropic = new Anthropic({ apiKey });

  // Build the prompt with context
  const prompt = TASK_DISCOVERY_PROMPT
    .replace('{requestDocument}', context.requestDocument)
    .replace('{taskList}', context.taskList || 'No tasks defined yet.')
    .replace('{repoOwner}', context.repoOwner)
    .replace('{repoName}', context.repoName)
    .replace('{branch}', context.branch)
    .replace('{recentCommits}', context.recentCommits.length > 0 ? context.recentCommits.join('\n') : 'No recent commits')
    .replace('{fileTree}', context.fileTree || 'File tree not available')
    .replace('{gitStatus}', context.gitStatus || 'No uncommitted changes')
    .replace('{previousCycleSummary}', context.previousCycleSummary || 'This is the first cycle.');

  console.log('[TaskDiscovery] Requesting task discovery from Claude...');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extract the text content
  const textContent = response.content.find((block: ContentBlock) => block.type === 'text') as TextBlock | undefined;
  if (!textContent) {
    throw new Error('No text response from Claude');
  }

  // Parse the JSON response
  const responseText = textContent.text.trim();

  // Try to extract JSON from the response (handle potential markdown code blocks)
  let jsonStr = responseText;
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    const result = JSON.parse(jsonStr) as TaskDiscoveryResult;

    console.log(`[TaskDiscovery] Discovered ${result.tasks.length} tasks`);
    result.tasks.forEach((task, i) => {
      console.log(`  ${i + 1}. [${task.priority}] ${task.description}`);
    });

    return result;
  } catch (parseError) {
    console.error('[TaskDiscovery] Failed to parse Claude response:', parseError);
    console.error('[TaskDiscovery] Response was:', responseText);

    // Return empty result on parse error
    return {
      tasks: [],
      reasoning: 'Failed to parse task discovery response',
      blockers: ['Parse error: ' + (parseError as Error).message],
    };
  }
}

/**
 * Generate a summary of what was accomplished in a cycle
 */
export async function generateCycleSummary(
  completedTasks: Array<{ description: string; resultSummary?: string; filesModified?: string[] }>,
  failedTasks: Array<{ description: string; errorMessage?: string }>,
  apiKey: string
): Promise<string> {
  const anthropic = new Anthropic({ apiKey });

  const prompt = `Summarize what was accomplished in this cycle of work.

### Completed Tasks
${completedTasks.map((t, i) => `${i + 1}. ${t.description}
   Result: ${t.resultSummary || 'No summary'}
   Files modified: ${t.filesModified?.join(', ') || 'None'}`).join('\n\n')}

### Failed Tasks
${failedTasks.length > 0
    ? failedTasks.map((t, i) => `${i + 1}. ${t.description}
   Error: ${t.errorMessage || 'Unknown error'}`).join('\n\n')
    : 'None'}

Provide a 2-3 sentence summary of the cycle's progress. Focus on what was accomplished and any blockers encountered.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const textContent = response.content.find((block: ContentBlock) => block.type === 'text') as TextBlock | undefined;
  if (!textContent) {
    return 'Cycle completed with no summary available.';
  }

  return textContent.text.trim();
}

/**
 * Update the task list based on cycle results
 */
export async function updateTaskList(
  currentTaskList: string | null,
  completedTasks: Array<{ description: string; resultSummary?: string }>,
  failedTasks: Array<{ description: string; errorMessage?: string }>,
  newTasks: DiscoveredTask[],
  apiKey: string
): Promise<string> {
  const anthropic = new Anthropic({ apiKey });

  const prompt = `Update the task list based on the cycle results.

### Current Task List
${currentTaskList || '(Empty - create a new task list)'}

### Completed This Cycle
${completedTasks.map(t => `- [x] ${t.description}`).join('\n') || 'None'}

### Failed This Cycle (may need retry or alternative approach)
${failedTasks.map(t => `- [ ] ${t.description} (Failed: ${t.errorMessage || 'Unknown error'})`).join('\n') || 'None'}

### Newly Discovered Tasks
${newTasks.map(t => `- [ ] [${t.priority}] ${t.description}`).join('\n') || 'None'}

Generate an updated task list in markdown format. Mark completed tasks with [x], and organize by priority (P0 first, then P1, then P2). Add a "## Completed" section at the bottom for finished tasks.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const textContent = response.content.find((block: ContentBlock) => block.type === 'text') as TextBlock | undefined;
  if (!textContent) {
    return currentTaskList || '# Task List\n\nNo tasks defined.';
  }

  return textContent.text.trim();
}
