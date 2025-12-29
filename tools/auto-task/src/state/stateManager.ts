/**
 * State Manager
 * Persists auto-task state to JSON file
 */

import * as fs from 'fs';
import * as path from 'path';

import type { AutoTaskState } from './types.js';
import type { TaskState } from './types.js';
import type { ProjectCache } from './types.js';
import { DEFAULT_STATE } from './types.js';

const STATE_FILE = '.auto-task-state.json';

export class StateManager {
  private statePath: string;
  private state: AutoTaskState;

  constructor(rootDir: string) {
    this.statePath = path.join(rootDir, STATE_FILE);
    this.state = this.load();
  }

  private load(): AutoTaskState {
    try {
      if (fs.existsSync(this.statePath)) {
        const content = fs.readFileSync(this.statePath, 'utf-8');
        const parsed = JSON.parse(content);

        // Migrate if needed
        if (!parsed.version || parsed.version < DEFAULT_STATE.version) {
          return this.migrate(parsed);
        }

        return parsed;
      }
    } catch {
      console.error('Failed to load state, using defaults');
    }

    return { ...DEFAULT_STATE };
  }

  private migrate(oldState: Partial<AutoTaskState>): AutoTaskState {
    return {
      ...DEFAULT_STATE,
      ...oldState,
      version: DEFAULT_STATE.version,
    };
  }

  save(): void {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  getState(): AutoTaskState {
    return this.state;
  }

  setConfig(config: Partial<AutoTaskState['config']>): void {
    this.state.config = { ...this.state.config, ...config };
    this.save();
  }

  // Task operations

  getTasks(status?: TaskState['status']): TaskState[] {
    if (status) {
      return this.state.tasks.filter((t) => t.status === status);
    }
    return this.state.tasks;
  }

  getTask(id: string): TaskState | undefined {
    return this.state.tasks.find((t) => t.id === id);
  }

  getTaskByIssue(issueNumber: number): TaskState | undefined {
    return this.state.tasks.find((t) => t.issueNumber === issueNumber);
  }

  addTask(task: Omit<TaskState, 'id' | 'createdAt' | 'updatedAt' | 'errorCount'>): TaskState {
    const now = new Date().toISOString();
    const newTask: TaskState = {
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
      errorCount: 0,
    };

    this.state.tasks.push(newTask);
    this.save();
    return newTask;
  }

  updateTask(id: string, updates: Partial<TaskState>): TaskState | undefined {
    const index = this.state.tasks.findIndex((t) => t.id === id);
    if (index === -1) return undefined;

    this.state.tasks[index] = {
      ...this.state.tasks[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.save();
    return this.state.tasks[index];
  }

  removeTask(id: string): boolean {
    const index = this.state.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;

    this.state.tasks.splice(index, 1);
    this.save();
    return true;
  }

  incrementError(id: string, error: string): void {
    const task = this.getTask(id);
    if (task) {
      this.updateTask(id, {
        errorCount: task.errorCount + 1,
        lastError: error,
      });
    }
  }

  // Project cache

  getProjectCache(): ProjectCache | undefined {
    return this.state.projectCache;
  }

  setProjectCache(cache: ProjectCache): void {
    this.state.projectCache = cache;
    this.save();
  }

  isProjectCacheValid(): boolean {
    if (!this.state.projectCache) return false;

    const cacheAge = Date.now() - new Date(this.state.projectCache.cachedAt).getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    return cacheAge < maxAge;
  }

  // Discovery tracking

  updateLastDiscoveryRun(): void {
    this.state.lastDiscoveryRun = new Date().toISOString();
    this.save();
  }

  updateLastDaemonRun(): void {
    this.state.lastDaemonRun = new Date().toISOString();
    this.save();
  }

  // Stats

  getStats(): {
    total: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
    errorCount: number;
  } {
    const tasks = this.state.tasks;

    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let errorCount = 0;

    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
      bySource[task.source] = (bySource[task.source] || 0) + 1;
      if (task.errorCount > 0) errorCount++;
    }

    return {
      total: tasks.length,
      byStatus,
      bySource,
      errorCount,
    };
  }
}
