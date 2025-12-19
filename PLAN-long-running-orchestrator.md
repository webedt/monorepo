# Long-Running Orchestrator Plan

## Overview

A recursive, parallel agent orchestration system that continuously works toward achieving goals defined in a request document. The orchestrator runs in cycles, discovering tasks, executing them in parallel, and converging before the next cycle.

## Cycle Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR CYCLE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. DISCOVERY PHASE                                                      │
│     ├─ Read current repo state (git status, file structure)             │
│     ├─ Read request document (goal definition)                          │
│     ├─ Read TASKLIST.md (current task status)                           │
│     └─ Use LLM to identify tasks that move toward goal                  │
│           └─ Determine which tasks can run in parallel                  │
│                                                                          │
│  2. EXECUTION PHASE                                                      │
│     ├─ Launch parallel agent sessions for each task                     │
│     ├─ Each agent gets: task description, workspace, context            │
│     ├─ Stream events from all agents to orchestrator                    │
│     └─ Track individual agent status (running/completed/failed)         │
│                                                                          │
│  3. CONVERGENCE PHASE                                                    │
│     ├─ Wait for all agents to complete (or timeout)                     │
│     ├─ Collect results and summaries from each agent                    │
│     ├─ Handle failures (retry logic, mark as blocked)                   │
│     └─ Merge changes (git operations)                                   │
│                                                                          │
│  4. UPDATE PHASE                                                         │
│     ├─ Update TASKLIST.md with completions and summaries                │
│     ├─ Update request document with new learnings (optional)            │
│     ├─ Check termination conditions:                                    │
│     │   └─ Time limit reached?                                          │
│     │   └─ All tasks complete?                                          │
│     │   └─ User cancelled?                                              │
│     │   └─ Max cycles reached?                                          │
│     └─ If not terminated: GOTO step 1                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Database Schema

### New Tables

```sql
-- Orchestrator jobs (long-running parent session)
CREATE TABLE orchestrator_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id) NOT NULL,

  -- Repository context
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  working_branch TEXT NOT NULL,
  session_path TEXT NOT NULL,

  -- Goal/Request document
  request_document TEXT NOT NULL,  -- Markdown content defining the goal
  task_list TEXT,                  -- Current TASKLIST.md content

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, paused, completed, cancelled, error
  current_cycle INTEGER NOT NULL DEFAULT 0,

  -- Limits
  max_cycles INTEGER,              -- Optional cycle limit
  time_limit_minutes INTEGER,      -- Optional time limit
  max_parallel_tasks INTEGER DEFAULT 3,

  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Error tracking
  last_error TEXT,
  error_count INTEGER DEFAULT 0
);

-- Individual cycles within a job
CREATE TABLE orchestrator_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES orchestrator_jobs(id) ON DELETE CASCADE NOT NULL,

  cycle_number INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'discovery',  -- discovery, execution, convergence, update

  -- Task tracking
  tasks_discovered INTEGER DEFAULT 0,
  tasks_launched INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,

  -- Results
  summary TEXT,                    -- LLM-generated cycle summary
  learnings TEXT,                  -- New information discovered

  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,

  UNIQUE(job_id, cycle_number)
);

-- Individual tasks within a cycle
CREATE TABLE orchestrator_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID REFERENCES orchestrator_cycles(id) ON DELETE CASCADE NOT NULL,
  job_id UUID REFERENCES orchestrator_jobs(id) ON DELETE CASCADE NOT NULL,

  -- Task definition
  task_number INTEGER NOT NULL,
  description TEXT NOT NULL,       -- What the agent should do
  context TEXT,                    -- Additional context for the agent

  -- Execution
  agent_session_id UUID REFERENCES chat_sessions(id),  -- The spawned agent session
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, skipped

  -- Results
  result_summary TEXT,             -- What the agent accomplished
  files_modified TEXT[],           -- List of files changed
  commits_made TEXT[],             -- Commit hashes

  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Error tracking
  error_message TEXT,
  retry_count INTEGER DEFAULT 0
);

-- Indexes
CREATE INDEX idx_orchestrator_jobs_user ON orchestrator_jobs(user_id);
CREATE INDEX idx_orchestrator_jobs_status ON orchestrator_jobs(status);
CREATE INDEX idx_orchestrator_cycles_job ON orchestrator_cycles(job_id);
CREATE INDEX idx_orchestrator_tasks_cycle ON orchestrator_tasks(cycle_id);
CREATE INDEX idx_orchestrator_tasks_status ON orchestrator_tasks(status);
```

## API Design

### Endpoints

```
POST   /api/orchestrator                    - Start new orchestrator job
GET    /api/orchestrator                    - List user's orchestrator jobs
GET    /api/orchestrator/:id                - Get job details
GET    /api/orchestrator/:id/stream         - SSE stream of job events
POST   /api/orchestrator/:id/pause          - Pause job (finish current cycle)
POST   /api/orchestrator/:id/resume         - Resume paused job
POST   /api/orchestrator/:id/cancel         - Cancel job immediately
GET    /api/orchestrator/:id/cycles         - List all cycles
GET    /api/orchestrator/:id/cycles/:num    - Get cycle details with tasks
PUT    /api/orchestrator/:id/request        - Update request document
PUT    /api/orchestrator/:id/tasklist       - Update task list
```

### Start Job Request

```typescript
interface StartOrchestratorRequest {
  // Repository
  repositoryOwner: string;
  repositoryName: string;
  baseBranch: string;
  workingBranch?: string;  // Auto-generated if not provided

  // Goal definition
  requestDocument: string;  // Markdown describing what to achieve

  // Optional initial task list
  initialTaskList?: string;

  // Limits (all optional)
  maxCycles?: number;           // Default: unlimited
  timeLimitMinutes?: number;    // Default: unlimited
  maxParallelTasks?: number;    // Default: 3

  // Provider configuration
  provider: 'claude' | 'claude-remote';
}
```

### SSE Event Types

```typescript
// Job lifecycle events
{ type: 'job_started', jobId, cycle: 0 }
{ type: 'job_paused', jobId, cycle }
{ type: 'job_resumed', jobId, cycle }
{ type: 'job_completed', jobId, cycles, totalTasks, summary }
{ type: 'job_cancelled', jobId, reason }
{ type: 'job_error', jobId, error }

// Cycle events
{ type: 'cycle_started', jobId, cycle, phase: 'discovery' }
{ type: 'cycle_phase', jobId, cycle, phase }
{ type: 'cycle_tasks_discovered', jobId, cycle, tasks: [...] }
{ type: 'cycle_completed', jobId, cycle, summary, tasksCompleted, tasksFailed }

// Task events
{ type: 'task_started', jobId, cycle, taskId, description, agentSessionId }
{ type: 'task_progress', jobId, cycle, taskId, message }
{ type: 'task_completed', jobId, cycle, taskId, summary, filesModified }
{ type: 'task_failed', jobId, cycle, taskId, error }

// Agent passthrough events (from individual agent sessions)
{ type: 'agent_message', jobId, cycle, taskId, agentSessionId, ...originalEvent }
```

## Implementation Structure

### Files to Create

```
internal-api-server/src/
├── api/routes/orchestrator.ts           # API endpoints
├── logic/orchestrator/
│   ├── index.ts                         # Export all
│   ├── orchestratorService.ts           # Main orchestrator logic
│   ├── cycleManager.ts                  # Cycle execution logic
│   ├── taskDiscovery.ts                 # LLM-based task discovery
│   ├── taskExecutor.ts                  # Parallel task execution
│   ├── convergenceManager.ts            # Wait & merge logic
│   ├── documentUpdater.ts               # Update request doc & tasklist
│   └── orchestratorBroadcaster.ts       # SSE event broadcasting
└── logic/db/
    └── schema.ts                        # Add new tables
```

### Core Service Class

```typescript
class OrchestratorService {
  // Job lifecycle
  async createJob(userId: string, config: StartOrchestratorRequest): Promise<OrchestratorJob>;
  async startJob(jobId: string): Promise<void>;
  async pauseJob(jobId: string): Promise<void>;
  async resumeJob(jobId: string): Promise<void>;
  async cancelJob(jobId: string): Promise<void>;

  // Main cycle loop
  private async runCycleLoop(jobId: string): Promise<void>;

  // Cycle phases
  private async discoveryPhase(job: OrchestratorJob, cycle: OrchestratorCycle): Promise<Task[]>;
  private async executionPhase(job: OrchestratorJob, cycle: OrchestratorCycle, tasks: Task[]): Promise<void>;
  private async convergencePhase(job: OrchestratorJob, cycle: OrchestratorCycle): Promise<void>;
  private async updatePhase(job: OrchestratorJob, cycle: OrchestratorCycle): Promise<boolean>; // returns shouldContinue

  // Helpers
  private async spawnAgentSession(task: OrchestratorTask): Promise<string>;
  private async waitForAllTasks(cycle: OrchestratorCycle): Promise<void>;
  private async checkTerminationConditions(job: OrchestratorJob): Promise<{terminate: boolean, reason?: string}>;
}
```

## Task Discovery Prompt

The LLM receives:
1. Current repository structure (file tree)
2. Git status (changed files, current branch)
3. Request document (the goal)
4. Current task list with status
5. Previous cycle summaries

And outputs:
1. List of tasks that can be done now
2. For each task: description, estimated complexity, dependencies
3. Which tasks can run in parallel
4. Priority ordering

```markdown
## Task Discovery Prompt Template

You are analyzing a codebase to identify the next tasks needed to achieve a goal.

### Goal Document
{requestDocument}

### Current Task List
{taskList}

### Repository State
- Branch: {branch}
- Recent commits: {recentCommits}
- File structure: {fileTree}
- Changed files: {gitStatus}

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

### Output Format (JSON)
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
}
```

## Agent Task Prompt

Each spawned agent receives:

```markdown
## Your Task
{task.description}

## Context
{task.context}

## Repository
You are working on branch `{workingBranch}` in `{owner}/{repo}`.

## Goal (for reference)
{requestDocumentSummary}

## Instructions
1. Complete the task described above
2. Make atomic, focused commits
3. If you encounter blockers, document them clearly
4. Provide a summary of what you accomplished

## Success Criteria
{task.successCriteria}
```

## Convergence & Merging Strategy

### Per-Task Branches
Each task runs on its own branch:
- `{workingBranch}/task-{cycleNum}-{taskNum}`

### Merge Process
After all tasks complete:
1. Switch to working branch
2. For each completed task branch:
   - Attempt merge
   - If conflict: flag for next cycle
3. Push merged result

### Conflict Resolution
- Simple conflicts: Auto-resolve if possible
- Complex conflicts: Create a "resolve conflicts" task for next cycle

## Pause/Resume Logic

### Pause
- Finish current phase
- Save state to database
- Set status = 'paused'
- Close SSE connection

### Resume
- Load state from database
- Resume from last completed phase
- Reconnect SSE

## Implementation Priority

1. **Phase 1: Core Infrastructure**
   - Database schema
   - Basic API endpoints
   - Job creation/listing

2. **Phase 2: Cycle Execution**
   - Discovery phase with LLM
   - Task spawning
   - Event streaming

3. **Phase 3: Convergence**
   - Wait for completion
   - Result collection
   - Task list updates

4. **Phase 4: Polish**
   - Pause/resume
   - Conflict resolution
   - Document updates
   - Error recovery

## Testing Strategy

1. Unit tests for each phase
2. Integration test with mock LLM
3. End-to-end test with real agents (limited scope)
4. Load test for parallel execution
