/**
 * Worker Coordinator Module
 *
 * Provides smart routing of jobs to AI coding workers, replacing DNS Round Robin
 * with direct routing to specific container tasks in Docker Swarm.
 */

export {
  workerCoordinator,
  WorkerStatus,
  WorkerTask,
  WorkerAssignment
} from './workerCoordinator.js';
