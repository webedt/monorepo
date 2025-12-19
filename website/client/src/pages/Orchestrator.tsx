import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { orchestratorApi, githubApi, type OrchestratorJob } from '@/lib/api';
import { useAuthStore, useRecentReposStore } from '@/lib/store';
import type { GitHubRepository } from '@/shared';

interface OrchestratorEvent {
  type: string;
  jobId: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export default function Orchestrator() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { recentRepoUrls, addRecentRepo, removeRecentRepo } = useRecentReposStore();

  // Form state
  const [selectedRepo, setSelectedRepo] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [requestDocument, setRequestDocument] = useState('');
  const [maxCycles, setMaxCycles] = useState<number | ''>('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number | ''>('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Repository dropdown state
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);
  const repoListRef = useRef<HTMLDivElement>(null);

  // Branch dropdown state
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState('');

  // Active job streaming
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<OrchestratorEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const hasGithubAuth = !!user?.githubAccessToken;
  const hasClaudeAuth = !!user?.claudeAuth;

  // Load repositories
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: githubApi.getRepos,
    enabled: hasGithubAuth,
  });

  const repositories: GitHubRepository[] = reposData?.data || [];

  // Sort repositories alphabetically
  const sortedRepositories = [...repositories].sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );

  // Get recent repos
  const recentRepos = recentRepoUrls
    .map(url => repositories.find(r => r.cloneUrl === url))
    .filter((r): r is GitHubRepository => r !== undefined);

  const nonRecentRepos = sortedRepositories.filter(
    repo => !recentRepoUrls.includes(repo.cloneUrl)
  );

  // Filter repos by search
  const matchesSearch = (repo: GitHubRepository) => {
    if (!repoSearchQuery.trim()) return true;
    const searchTerms = repoSearchQuery.toLowerCase().trim().split(/\s+/);
    const repoName = repo.fullName.toLowerCase();
    return searchTerms.every(term => repoName.includes(term));
  };

  const filteredRecentRepos = recentRepos.filter(matchesSearch);
  const filteredNonRecentRepos = nonRecentRepos.filter(matchesSearch);
  const filteredRepositories = [...filteredRecentRepos, ...filteredNonRecentRepos];

  // Parse selected repo for owner/name
  const selectedRepoRaw = selectedRepo
    ? repositories.find(r => r.cloneUrl === selectedRepo)
    : null;

  // Parse owner and name from fullName (format: "owner/name")
  const selectedRepoInfo = selectedRepoRaw
    ? {
        ...selectedRepoRaw,
        owner: selectedRepoRaw.fullName.split('/')[0],
        repoName: selectedRepoRaw.fullName.split('/')[1] || selectedRepoRaw.name,
      }
    : null;

  // Load branches for selected repo
  const { data: branchesData, isLoading: isLoadingBranches } = useQuery({
    queryKey: ['branches', selectedRepoInfo?.owner, selectedRepoInfo?.repoName],
    queryFn: () => githubApi.getBranches(selectedRepoInfo!.owner, selectedRepoInfo!.repoName),
    enabled: !!selectedRepoInfo,
  });

  const branches: string[] = branchesData?.data || [];

  // Filter branches by search
  const filteredBranches = branches.filter(b =>
    !branchSearchQuery.trim() || b.toLowerCase().includes(branchSearchQuery.toLowerCase())
  );

  // Load orchestrator jobs
  const { data: jobsData, isLoading: isLoadingJobs } = useQuery({
    queryKey: ['orchestrator-jobs'],
    queryFn: () => orchestratorApi.list(),
    enabled: hasClaudeAuth,
  });

  const jobs: OrchestratorJob[] = jobsData?.data || [];

  // Create job mutation
  const createMutation = useMutation({
    mutationFn: orchestratorApi.create,
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-jobs'] });
      if (response.data) {
        setActiveJobId(response.data.id);
        // Clear form
        setRequestDocument('');
        setMaxCycles('');
        setTimeLimitMinutes('');
      }
    },
  });

  // Job control mutations
  const startMutation = useMutation({
    mutationFn: orchestratorApi.start,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orchestrator-jobs'] }),
  });

  const pauseMutation = useMutation({
    mutationFn: orchestratorApi.pause,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orchestrator-jobs'] }),
  });

  const cancelMutation = useMutation({
    mutationFn: orchestratorApi.cancel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orchestrator-jobs'] }),
  });

  // SSE event streaming for active job
  useEffect(() => {
    if (!activeJobId) return;

    const eventSource = orchestratorApi.createEventSource(activeJobId);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as OrchestratorEvent;
        setEvents(prev => [...prev, event]);
      } catch {
        console.error('[Orchestrator] Failed to parse event:', e.data);
      }
    };

    eventSource.addEventListener('job_completed', () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-jobs'] });
    });

    eventSource.addEventListener('job_ended', () => {
      eventSource.close();
      setActiveJobId(null);
      queryClient.invalidateQueries({ queryKey: ['orchestrator-jobs'] });
    });

    eventSource.onerror = () => {
      console.error('[Orchestrator] EventSource error');
      eventSource.close();
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [activeJobId, queryClient]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isRepoDropdownOpen && !target.closest('.repo-dropdown')) {
        setIsRepoDropdownOpen(false);
        setRepoSearchQuery('');
      }
      if (isBranchDropdownOpen && !target.closest('.branch-dropdown')) {
        setIsBranchDropdownOpen(false);
        setBranchSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isRepoDropdownOpen, isBranchDropdownOpen]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedRepoInfo || !requestDocument.trim()) return;

    createMutation.mutate({
      repositoryOwner: selectedRepoInfo.owner,
      repositoryName: selectedRepoInfo.repoName,
      baseBranch,
      requestDocument: requestDocument.trim(),
      maxCycles: maxCycles || undefined,
      timeLimitMinutes: timeLimitMinutes || undefined,
      provider: 'claude-remote',
      autoStart: true,
    });
  };

  // Get status badge color
  const getStatusBadge = (status: OrchestratorJob['status']) => {
    switch (status) {
      case 'running':
        return 'badge-info';
      case 'completed':
        return 'badge-success';
      case 'paused':
        return 'badge-warning';
      case 'cancelled':
        return 'badge-ghost';
      case 'error':
        return 'badge-error';
      default:
        return 'badge-ghost';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-base-content mb-2">Orchestrator</h1>
        <p className="text-sm text-base-content/70">
          Long-running autonomous agent that executes tasks in parallel cycles
        </p>
      </div>

      {/* Prerequisites check */}
      {!hasGithubAuth && (
        <div className="alert alert-warning mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Please connect your GitHub account in Settings to use the Orchestrator.</span>
          <button onClick={() => navigate('/settings')} className="btn btn-sm">
            Go to Settings
          </button>
        </div>
      )}

      {!hasClaudeAuth && (
        <div className="alert alert-warning mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Please connect your Claude account in Settings to use the Orchestrator.</span>
          <button onClick={() => navigate('/settings')} className="btn btn-sm">
            Go to Settings
          </button>
        </div>
      )}

      {/* Create Job Form */}
      <div className="card bg-base-100 shadow-xl mb-8">
        <div className="card-body">
          <h2 className="card-title mb-4">Start New Orchestrator Job</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Repository and Branch row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Repository Selector */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold">Repository *</span>
                </label>
                <div className="relative repo-dropdown">
                  <button
                    type="button"
                    onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
                    className="btn btn-outline w-full justify-between"
                    disabled={!hasGithubAuth || isLoadingRepos}
                  >
                    <span className="truncate">
                      {isLoadingRepos
                        ? 'Loading...'
                        : selectedRepoInfo?.fullName || 'Select repository'}
                    </span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isRepoDropdownOpen && (
                    <div className="absolute top-full left-0 mt-2 w-full max-h-80 bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
                      <div className="p-2 sticky top-0 bg-base-100 border-b border-base-300">
                        <input
                          type="text"
                          placeholder="Search repositories..."
                          value={repoSearchQuery}
                          onChange={(e) => setRepoSearchQuery(e.target.value)}
                          className="input input-bordered input-sm w-full"
                          autoFocus
                        />
                      </div>
                      <div className="overflow-y-auto max-h-64" ref={repoListRef}>
                        {filteredRecentRepos.length > 0 && (
                          <>
                            <div className="px-4 py-1 text-xs font-semibold text-base-content/50 bg-base-200">
                              Recent
                            </div>
                            {filteredRecentRepos.map((repo) => (
                              <div
                                key={`recent-${repo.id}`}
                                className="flex items-center group hover:bg-primary"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedRepo(repo.cloneUrl);
                                    addRecentRepo(repo.cloneUrl);
                                    setIsRepoDropdownOpen(false);
                                    setRepoSearchQuery('');
                                  }}
                                  className="flex-1 text-left px-4 py-2 text-sm group-hover:text-primary-content"
                                >
                                  {repo.fullName}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeRecentRepo(repo.cloneUrl);
                                  }}
                                  className="px-2 py-1 mr-2 text-base-content/40 hover:text-error opacity-0 group-hover:opacity-100"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                        {filteredNonRecentRepos.length > 0 && (
                          <>
                            {filteredRecentRepos.length > 0 && (
                              <div className="px-4 py-1 text-xs font-semibold text-base-content/50 bg-base-200 border-y border-base-300">
                                All Repositories
                              </div>
                            )}
                            {filteredNonRecentRepos.map((repo) => (
                              <button
                                key={repo.id}
                                type="button"
                                onClick={() => {
                                  setSelectedRepo(repo.cloneUrl);
                                  addRecentRepo(repo.cloneUrl);
                                  setIsRepoDropdownOpen(false);
                                  setRepoSearchQuery('');
                                }}
                                className="w-full text-left px-4 py-2 text-sm hover:bg-primary hover:text-primary-content"
                              >
                                {repo.fullName}
                              </button>
                            ))}
                          </>
                        )}
                        {filteredRepositories.length === 0 && (
                          <div className="p-4 text-xs text-base-content/50 text-center">
                            No repositories found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Branch Selector */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold">Base Branch *</span>
                </label>
                <div className="relative branch-dropdown">
                  <button
                    type="button"
                    onClick={() => setIsBranchDropdownOpen(!isBranchDropdownOpen)}
                    className="btn btn-outline w-full justify-between"
                    disabled={!selectedRepoInfo || isLoadingBranches}
                  >
                    <span className="truncate">
                      {isLoadingBranches ? 'Loading...' : baseBranch || 'Select branch'}
                    </span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isBranchDropdownOpen && (
                    <div className="absolute top-full left-0 mt-2 w-full max-h-60 bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
                      <div className="p-2 sticky top-0 bg-base-100 border-b border-base-300">
                        <input
                          type="text"
                          placeholder="Search branches..."
                          value={branchSearchQuery}
                          onChange={(e) => setBranchSearchQuery(e.target.value)}
                          className="input input-bordered input-sm w-full"
                          autoFocus
                        />
                      </div>
                      <div className="overflow-y-auto max-h-48">
                        {filteredBranches.map((branch) => (
                          <button
                            key={branch}
                            type="button"
                            onClick={() => {
                              setBaseBranch(branch);
                              setIsBranchDropdownOpen(false);
                              setBranchSearchQuery('');
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-primary hover:text-primary-content ${
                              baseBranch === branch ? 'bg-primary/20 font-semibold' : ''
                            }`}
                          >
                            {branch}
                          </button>
                        ))}
                        {filteredBranches.length === 0 && (
                          <div className="p-4 text-xs text-base-content/50 text-center">
                            No branches found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Request Document */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">Specification / Request *</span>
              </label>
              <textarea
                value={requestDocument}
                onChange={(e) => setRequestDocument(e.target.value)}
                placeholder="Describe what you want the orchestrator to build. Be specific about features, requirements, and architecture. The orchestrator will break this down into parallelizable tasks and execute them in cycles."
                className="textarea textarea-bordered h-32"
                required
              />
            </div>

            {/* Advanced Options Toggle */}
            <div className="divider">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="btn btn-ghost btn-sm gap-2"
              >
                Advanced Options
                <svg
                  className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Advanced Options */}
            {showAdvanced && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-base-200 rounded-lg">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Max Cycles</span>
                    <span className="label-text-alt text-base-content/50">Optional</span>
                  </label>
                  <input
                    type="number"
                    value={maxCycles}
                    onChange={(e) => setMaxCycles(e.target.value ? parseInt(e.target.value) : '')}
                    placeholder="No limit"
                    className="input input-bordered"
                    min={1}
                  />
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Time Limit (minutes)</span>
                    <span className="label-text-alt text-base-content/50">Optional</span>
                  </label>
                  <input
                    type="number"
                    value={timeLimitMinutes}
                    onChange={(e) => setTimeLimitMinutes(e.target.value ? parseInt(e.target.value) : '')}
                    placeholder="No limit"
                    className="input input-bordered"
                    min={1}
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            <div className="card-actions justify-end pt-4">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  !selectedRepoInfo ||
                  !requestDocument.trim() ||
                  !hasGithubAuth ||
                  !hasClaudeAuth ||
                  createMutation.isPending
                }
              >
                {createMutation.isPending ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Starting...
                  </>
                ) : (
                  'Start Orchestrator'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Active Job Events */}
      {activeJobId && events.length > 0 && (
        <div className="card bg-base-100 shadow-xl mb-8">
          <div className="card-body">
            <div className="flex justify-between items-center mb-4">
              <h2 className="card-title">Live Events</h2>
              <button
                onClick={() => {
                  eventSourceRef.current?.close();
                  setActiveJobId(null);
                  setEvents([]);
                }}
                className="btn btn-ghost btn-sm"
              >
                Close
              </button>
            </div>
            <div className="bg-base-200 rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-sm">
              {events.map((event, i) => (
                <div key={i} className="mb-1">
                  <span className="text-primary">[{event.type}]</span>{' '}
                  <span className="text-base-content/70">
                    {JSON.stringify(event.data || {})}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Jobs List */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title mb-4">My Orchestrator Jobs</h2>

          {isLoadingJobs && (
            <div className="text-center py-8">
              <span className="loading loading-spinner loading-lg text-primary"></span>
            </div>
          )}

          {!isLoadingJobs && jobs.length === 0 && (
            <div className="text-center py-8 text-base-content/70">
              No orchestrator jobs yet. Start one above!
            </div>
          )}

          {!isLoadingJobs && jobs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Branch</th>
                    <th>Status</th>
                    <th>Cycles</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="hover">
                      <td className="font-medium">
                        {job.repositoryOwner}/{job.repositoryName}
                      </td>
                      <td>
                        <code className="text-sm">{job.workingBranch}</code>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          {job.status === 'running' && (
                            <span className="loading loading-spinner loading-xs"></span>
                          )}
                          <span className={`badge ${getStatusBadge(job.status)}`}>
                            {job.status}
                          </span>
                        </div>
                      </td>
                      <td>{job.currentCycle}</td>
                      <td className="text-sm text-base-content/70">
                        {new Date(job.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div className="flex gap-2">
                          {job.status === 'pending' && (
                            <button
                              onClick={() => startMutation.mutate(job.id)}
                              className="btn btn-xs btn-success"
                              disabled={startMutation.isPending}
                            >
                              Start
                            </button>
                          )}
                          {job.status === 'running' && (
                            <button
                              onClick={() => pauseMutation.mutate(job.id)}
                              className="btn btn-xs btn-warning"
                              disabled={pauseMutation.isPending}
                            >
                              Pause
                            </button>
                          )}
                          {job.status === 'paused' && (
                            <button
                              onClick={() => startMutation.mutate(job.id)}
                              className="btn btn-xs btn-success"
                              disabled={startMutation.isPending}
                            >
                              Resume
                            </button>
                          )}
                          {(job.status === 'running' || job.status === 'paused') && (
                            <button
                              onClick={() => cancelMutation.mutate(job.id)}
                              className="btn btn-xs btn-error"
                              disabled={cancelMutation.isPending}
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setActiveJobId(job.id);
                              setEvents([]);
                            }}
                            className="btn btn-xs btn-ghost"
                          >
                            Watch
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
