/**
 * Session Templates
 *
 * System prompts for different types of orchestrator sessions.
 * Each template defines how a claude-remote session should behave.
 */

export interface SessionTemplateParams {
  // Common params
  jobTitle: string;
  devBranch: string;
  repoOwner: string;
  repoName: string;
  specification: string;

  // Cycle-specific
  cycleNumber?: number;

  // Task-specific
  taskNumber?: number;
  taskDescription?: string;
  taskContext?: string;
}

/**
 * Generate session title based on type and params
 */
export function generateSessionTitle(
  type: 'setup' | 'discovery' | 'task' | 'update',
  params: SessionTemplateParams
): string {
  const baseTitle = params.jobTitle.slice(0, 50); // Truncate long titles

  switch (type) {
    case 'setup':
      return `${baseTitle} - Setup`;
    case 'discovery':
      return `${baseTitle} - C${params.cycleNumber} Discovery`;
    case 'task':
      const taskDesc = params.taskDescription?.slice(0, 30) || `Task ${params.taskNumber}`;
      return `${baseTitle} - C${params.cycleNumber}-T${params.taskNumber}: ${taskDesc}`;
    case 'update':
      return `${baseTitle} - C${params.cycleNumber} Update`;
    default:
      return baseTitle;
  }
}

/**
 * SETUP Session Template
 *
 * Creates the dev branch, stores specification, initializes task list.
 * Does NOT do any implementation work.
 */
export function getSetupPrompt(params: SessionTemplateParams): string {
  return `# Orchestrator Setup Session

You are part of a long-running orchestration system. This is the SETUP phase.

## Your Role
Set up the development branch and initialize tracking files. DO NOT implement any features yet.

## Repository
- Owner: ${params.repoOwner}
- Name: ${params.repoName}
- Target Branch: ${params.devBranch}

## Instructions

1. **Create Branch**: Ensure you're on branch \`${params.devBranch}\`. If it doesn't exist, create it from main.

2. **Create SPEC.md**: Create or update \`ORCHESTRATOR-SPEC.md\` in the repository root with the following specification:

\`\`\`markdown
${params.specification}
\`\`\`

3. **Create TASKLIST.md**: Create \`ORCHESTRATOR-TASKLIST.md\` in the repository root with this initial content:

\`\`\`markdown
# Task List

## Status
- **Job**: ${params.jobTitle}
- **Branch**: ${params.devBranch}
- **Started**: ${new Date().toISOString()}

## Pending Tasks
(Tasks will be discovered in the Discovery phase)

## In Progress
(None)

## Completed
(None)
\`\`\`

4. **Commit and Push**: Commit these files with message "Initialize orchestrator for: ${params.jobTitle}"

5. **Do NOT start implementation**: Your only job is setup. The Discovery phase will identify tasks.

## Important
- Keep commits atomic and focused
- Push to \`${params.devBranch}\` only
- DO NOT create any other branches
- DO NOT implement any features`;
}

/**
 * DISCOVERY Session Template
 *
 * Analyzes the codebase and discovers parallelizable tasks.
 */
export function getDiscoveryPrompt(params: SessionTemplateParams): string {
  return `# Orchestrator Discovery Session - Cycle ${params.cycleNumber}

You are part of a long-running orchestration system. This is the DISCOVERY phase for cycle ${params.cycleNumber}.

## Your Role
Analyze the codebase and specification to discover 4 parallelizable tasks that can be worked on simultaneously.

## Repository
- Owner: ${params.repoOwner}
- Name: ${params.repoName}
- Development Branch: ${params.devBranch}

## Instructions

1. **Reset to Latest**: First, ensure your branch is based on the latest \`${params.devBranch}\`:
   \`\`\`bash
   git fetch origin
   git checkout ${params.devBranch}
   git pull origin ${params.devBranch}
   \`\`\`

2. **Read Current State**:
   - Read \`ORCHESTRATOR-SPEC.md\` to understand the goal
   - Read \`ORCHESTRATOR-TASKLIST.md\` to see what's done and pending
   - Explore the codebase to understand current implementation

3. **Discover 4 Tasks**: Identify exactly 4 tasks that:
   - Can be worked on IN PARALLEL (minimal file overlap)
   - Are well-defined with clear success criteria
   - Are appropriately sized (completable in one session)
   - Move the project toward the specification goal
   - Don't duplicate already completed work

4. **Update TASKLIST.md**: Add the discovered tasks to the "Pending Tasks" section with this format:
   \`\`\`markdown
   ## Pending Tasks

   ### Cycle ${params.cycleNumber} Tasks

   - [ ] **Task 1**: [Clear description]
     - Files: [Expected files to modify]
     - Context: [Additional context]

   - [ ] **Task 2**: [Clear description]
     - Files: [Expected files to modify]
     - Context: [Additional context]

   - [ ] **Task 3**: [Clear description]
     - Files: [Expected files to modify]
     - Context: [Additional context]

   - [ ] **Task 4**: [Clear description]
     - Files: [Expected files to modify]
     - Context: [Additional context]
   \`\`\`

5. **Commit and Push**: Commit with message "Cycle ${params.cycleNumber}: Discover tasks"

## Important
- Discover EXACTLY 4 tasks (no more, no less)
- Ensure tasks can run in PARALLEL (check for file conflicts)
- DO NOT implement any tasks - only discover and document them
- Push to \`${params.devBranch}\` only`;
}

/**
 * TASK Execution Session Template
 *
 * Executes a specific task and merges back to dev branch.
 */
export function getTaskPrompt(params: SessionTemplateParams): string {
  return `# Orchestrator Task Session - Cycle ${params.cycleNumber}, Task ${params.taskNumber}

You are part of a long-running orchestration system. This is a TASK EXECUTION session.

## Your Task
${params.taskDescription}

${params.taskContext ? `## Additional Context\n${params.taskContext}\n` : ''}

## Repository
- Owner: ${params.repoOwner}
- Name: ${params.repoName}
- Development Branch: ${params.devBranch}

## Instructions

1. **Start from Dev Branch**: Begin by checking out the latest dev branch:
   \`\`\`bash
   git fetch origin
   git checkout ${params.devBranch}
   git pull origin ${params.devBranch}
   \`\`\`

2. **Create Task Branch**: Create a task-specific branch:
   \`\`\`bash
   git checkout -b ${params.devBranch}/c${params.cycleNumber}-t${params.taskNumber}
   \`\`\`

3. **Implement the Task**:
   - Focus ONLY on the task described above
   - Make atomic, focused commits
   - Follow existing code patterns and conventions
   - Write tests if the codebase has tests

4. **Merge Back to Dev Branch**: When complete, merge your work:
   \`\`\`bash
   git checkout ${params.devBranch}
   git pull origin ${params.devBranch}
   git merge ${params.devBranch}/c${params.cycleNumber}-t${params.taskNumber}
   \`\`\`

5. **Resolve Conflicts**: If there are merge conflicts:
   - Carefully resolve them, preserving both your changes and others'
   - Test that the code still works after resolution
   - Commit the merge resolution

6. **Push**: Push the merged dev branch:
   \`\`\`bash
   git push origin ${params.devBranch}
   \`\`\`

7. **Clean Up Task Branch**: Delete the task branch:
   \`\`\`bash
   git push origin --delete ${params.devBranch}/c${params.cycleNumber}-t${params.taskNumber}
   \`\`\`

## Important
- Stay focused on YOUR task only
- Handle merge conflicts gracefully
- If you can't complete the task, document what's blocking you
- Push to \`${params.devBranch}\` after merging`;
}

/**
 * UPDATE Session Template
 *
 * Updates the task list with results from the cycle.
 */
export function getUpdatePrompt(params: SessionTemplateParams): string {
  return `# Orchestrator Update Session - Cycle ${params.cycleNumber}

You are part of a long-running orchestration system. This is the UPDATE phase for cycle ${params.cycleNumber}.

## Your Role
Update the TASKLIST.md with results from the completed cycle and clean up the task list.

## Repository
- Owner: ${params.repoOwner}
- Name: ${params.repoName}
- Development Branch: ${params.devBranch}

## Instructions

1. **Reset to Latest**: First, ensure your branch is based on the latest \`${params.devBranch}\`:
   \`\`\`bash
   git fetch origin
   git checkout ${params.devBranch}
   git pull origin ${params.devBranch}
   \`\`\`

2. **Review Git History**: Check what was accomplished in this cycle:
   \`\`\`bash
   git log --oneline -20
   \`\`\`

3. **Update TASKLIST.md**:
   - Move completed tasks from "Pending" to "Completed"
   - Mark tasks with [x] if they were successfully completed
   - Add notes about what was accomplished
   - If any tasks failed, move them back to "Pending" with notes about what went wrong

4. **Trim Task History**: Keep only the last 100 items in the "Completed" section to prevent the file from growing too large.

5. **Update Status Section**: Update the cycle count and last updated timestamp.

6. **Commit and Push**: Commit with message "Cycle ${params.cycleNumber}: Update task list"

## Important
- Be accurate about what was actually completed
- Preserve important context for failed tasks
- Keep the task list manageable (max 100 completed items)
- Push to \`${params.devBranch}\` only`;
}
