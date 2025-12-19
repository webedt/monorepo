-- Orchestrator Jobs - Long-running multi-cycle agent orchestration
CREATE TABLE IF NOT EXISTS orchestrator_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Repository context
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  working_branch TEXT NOT NULL,
  session_path TEXT NOT NULL,

  -- Goal/Request document
  request_document TEXT NOT NULL,
  task_list TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  current_cycle INTEGER NOT NULL DEFAULT 0,

  -- Limits
  max_cycles INTEGER,
  time_limit_minutes INTEGER,
  max_parallel_tasks INTEGER NOT NULL DEFAULT 3,

  -- Provider configuration
  provider TEXT NOT NULL DEFAULT 'claude',

  -- Timestamps
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Error tracking
  last_error TEXT,
  error_count INTEGER NOT NULL DEFAULT 0
);

-- Orchestrator Cycles - Individual cycles within a job
CREATE TABLE IF NOT EXISTS orchestrator_cycles (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES orchestrator_jobs(id) ON DELETE CASCADE,

  cycle_number INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'discovery',

  -- Task tracking
  tasks_discovered INTEGER NOT NULL DEFAULT 0,
  tasks_launched INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,

  -- Results
  summary TEXT,
  learnings TEXT,

  -- Timestamps
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,

  UNIQUE(job_id, cycle_number)
);

-- Orchestrator Tasks - Individual tasks within a cycle
CREATE TABLE IF NOT EXISTS orchestrator_tasks (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES orchestrator_cycles(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES orchestrator_jobs(id) ON DELETE CASCADE,

  -- Task definition
  task_number INTEGER NOT NULL,
  description TEXT NOT NULL,
  context TEXT,
  priority TEXT DEFAULT 'P1',
  can_run_parallel BOOLEAN NOT NULL DEFAULT TRUE,

  -- Execution
  agent_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  task_branch TEXT,
  status TEXT NOT NULL DEFAULT 'pending',

  -- Results
  result_summary TEXT,
  files_modified JSONB,
  commits_made JSONB,

  -- Timestamps
  started_at TIMESTAMP,
  completed_at TIMESTAMP,

  -- Error tracking
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_orchestrator_jobs_user ON orchestrator_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_orchestrator_jobs_status ON orchestrator_jobs(status);
CREATE INDEX IF NOT EXISTS idx_orchestrator_cycles_job ON orchestrator_cycles(job_id);
CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_cycle ON orchestrator_tasks(cycle_id);
CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_job ON orchestrator_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_orchestrator_tasks_status ON orchestrator_tasks(status);
