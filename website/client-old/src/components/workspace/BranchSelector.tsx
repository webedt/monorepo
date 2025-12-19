import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { githubApi } from '@/lib/api';
import { useAuthStore, useRecentReposStore } from '@/lib/store';
import type { GitHubRepository } from '@/shared';

interface BranchSelectorProps {
  /** Called when a branch is selected/created */
  onBranchSelected?: (owner: string, repo: string, branch: string) => void;
  /** Default destination page after branch selection */
  defaultPage?: 'code' | 'images' | 'sounds' | 'scenes' | 'chat';
  /** Whether to show as a modal or inline */
  variant?: 'modal' | 'inline' | 'page';
}

type BranchMode = 'existing' | 'auto' | 'custom';

// Helper to extract owner from fullName (format: "owner/repo")
function getOwnerFromFullName(fullName: string): string {
  return fullName.split('/')[0] || '';
}

export default function BranchSelector({
  onBranchSelected,
  defaultPage = 'code',
  variant = 'page'
}: BranchSelectorProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { recentRepoUrls, addRecentRepo } = useRecentReposStore();

  // Repository selection
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);
  const repoDropdownRef = useRef<HTMLDivElement>(null);

  // Branch selection
  const [branchMode, setBranchMode] = useState<BranchMode>('existing');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [customPrefix, setCustomPrefix] = useState('');
  const [branchSearchQuery, setBranchSearchQuery] = useState('');

  // Fetch repositories
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: githubApi.getRepos,
    enabled: !!user?.githubAccessToken,
  });

  const repositories: GitHubRepository[] = reposData?.data || [];

  // Get owner from selected repo
  const selectedOwner = selectedRepo ? getOwnerFromFullName(selectedRepo.fullName) : '';

  // Fetch branches for selected repo
  const { data: branchesData, isLoading: isLoadingBranches } = useQuery({
    queryKey: ['branches', selectedOwner, selectedRepo?.name],
    queryFn: () => githubApi.getBranches(selectedOwner, selectedRepo!.name),
    enabled: !!selectedRepo && !!selectedOwner,
  });

  const branches: string[] = branchesData?.data?.branches || [];

  // Create branch mutation
  const createBranchMutation = useMutation({
    mutationFn: async ({ owner, repo, branchName, baseBranch }: {
      owner: string;
      repo: string;
      branchName: string;
      baseBranch: string;
    }) => {
      return githubApi.createBranch(owner, repo, { branchName, baseBranch });
    },
  });

  // Filter and sort repositories
  const filteredRepos = repositories
    .filter((repo) => {
      if (!repoSearchQuery.trim()) return true;
      return repo.fullName.toLowerCase().includes(repoSearchQuery.toLowerCase());
    })
    .sort((a, b) => {
      // Sort recent repos first
      const aRecent = recentRepoUrls.includes(a.cloneUrl);
      const bRecent = recentRepoUrls.includes(b.cloneUrl);
      if (aRecent && !bRecent) return -1;
      if (!aRecent && bRecent) return 1;
      return a.fullName.localeCompare(b.fullName);
    });

  // Filter branches
  const filteredBranches = branches.filter((branch) => {
    if (!branchSearchQuery.trim()) return true;
    return branch.toLowerCase().includes(branchSearchQuery.toLowerCase());
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(event.target as Node)) {
        setIsRepoDropdownOpen(false);
      }
    };

    if (isRepoDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isRepoDropdownOpen]);

  // Generate branch name
  const generateBranchName = (prefix?: string): string => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    const suffix = `${timestamp}-${random}`;

    if (prefix) {
      // Sanitize prefix: lowercase, replace spaces with hyphens
      const sanitized = prefix.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      return `${sanitized}-${suffix}`;
    }
    return `branch-${suffix}`;
  };

  // Handle branch selection/creation
  const handleGo = async () => {
    if (!selectedRepo || !selectedOwner) return;

    let branchName: string;

    if (branchMode === 'existing') {
      if (!selectedBranch) return;
      branchName = selectedBranch;
    } else if (branchMode === 'auto') {
      branchName = generateBranchName();
      // Create the branch
      try {
        await createBranchMutation.mutateAsync({
          owner: selectedOwner,
          repo: selectedRepo.name,
          branchName,
          baseBranch: selectedRepo.defaultBranch || 'main',
        });
      } catch (error) {
        console.error('Failed to create branch:', error);
        return;
      }
    } else {
      // custom
      branchName = generateBranchName(customPrefix);
      // Create the branch
      try {
        await createBranchMutation.mutateAsync({
          owner: selectedOwner,
          repo: selectedRepo.name,
          branchName,
          baseBranch: selectedRepo.defaultBranch || 'main',
        });
      } catch (error) {
        console.error('Failed to create branch:', error);
        return;
      }
    }

    // Add to recent repos
    addRecentRepo(selectedRepo.cloneUrl);

    // Call callback or navigate
    if (onBranchSelected) {
      onBranchSelected(selectedOwner, selectedRepo.name, branchName);
    } else {
      // Navigate to the workspace
      const safeBranch = branchName.replace(/\//g, '-');
      navigate(`/github/${selectedOwner}/${selectedRepo.name}/${safeBranch}/${defaultPage}`);
    }
  };

  // Check if we can proceed
  const canProceed = () => {
    if (branchMode === 'existing') {
      return !!selectedBranch;
    }
    if (branchMode === 'custom') {
      return customPrefix.trim().length > 0;
    }
    return true; // auto mode always ready
  };

  const hasGithubAuth = !!user?.githubAccessToken;

  if (!hasGithubAuth) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <svg className="w-16 h-16 text-warning mb-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
        </svg>
        <h2 className="text-xl font-bold mb-2">Connect GitHub</h2>
        <p className="text-base-content/70 mb-4">
          You need to connect your GitHub account to access workspaces.
        </p>
        <button
          onClick={() => navigate('/settings')}
          className="btn btn-primary"
        >
          Go to Settings
        </button>
      </div>
    );
  }

  return (
    <div className={`${variant === 'page' ? 'max-w-2xl mx-auto p-8' : 'p-4'}`}>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold mb-2">Select Workspace</h1>
        <p className="text-base-content/70">
          Choose a repository and branch to start working
        </p>
      </div>

      {/* Step 1: Repository Selection */}
      <div className="card bg-base-100 shadow-lg mb-6">
        <div className="card-body">
          <h2 className="card-title text-lg">
            <span className="badge badge-primary badge-lg mr-2">1</span>
            Select Repository
          </h2>

          {isLoadingRepos ? (
            <div className="flex items-center justify-center py-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : (
            <div className="relative" ref={repoDropdownRef}>
              <button
                type="button"
                onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
                className="btn btn-outline w-full justify-between"
              >
                <span className="truncate">
                  {selectedRepo ? selectedRepo.fullName : 'Select a repository...'}
                </span>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isRepoDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
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
                  <div className="max-h-64 overflow-y-auto">
                    {filteredRepos.length === 0 ? (
                      <div className="p-4 text-center text-base-content/50">
                        No repositories found
                      </div>
                    ) : (
                      filteredRepos.map((repo) => (
                        <button
                          key={repo.id}
                          type="button"
                          onClick={() => {
                            setSelectedRepo(repo);
                            setIsRepoDropdownOpen(false);
                            setRepoSearchQuery('');
                            setSelectedBranch('');
                          }}
                          className={`w-full text-left px-4 py-2 hover:bg-base-200 flex items-center gap-2 ${
                            selectedRepo?.id === repo.id ? 'bg-primary/10 font-semibold' : ''
                          }`}
                        >
                          {recentRepoUrls.includes(repo.cloneUrl) && (
                            <span className="badge badge-xs badge-ghost">Recent</span>
                          )}
                          <span className="truncate">{repo.fullName}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Branch Selection */}
      {selectedRepo && (
        <div className="card bg-base-100 shadow-lg mb-6">
          <div className="card-body">
            <h2 className="card-title text-lg">
              <span className="badge badge-primary badge-lg mr-2">2</span>
              Select or Create Branch
            </h2>

            {/* Branch mode selection */}
            <div className="form-control">
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="radio"
                  name="branch-mode"
                  className="radio radio-primary"
                  checked={branchMode === 'existing'}
                  onChange={() => setBranchMode('existing')}
                />
                <span className="label-text">Select existing branch</span>
              </label>
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="radio"
                  name="branch-mode"
                  className="radio radio-primary"
                  checked={branchMode === 'auto'}
                  onChange={() => setBranchMode('auto')}
                />
                <span className="label-text">Auto-generate new branch</span>
              </label>
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="radio"
                  name="branch-mode"
                  className="radio radio-primary"
                  checked={branchMode === 'custom'}
                  onChange={() => setBranchMode('custom')}
                />
                <span className="label-text">Custom prefix + auto-suffix</span>
              </label>
            </div>

            {/* Branch selection based on mode */}
            <div className="mt-4">
              {branchMode === 'existing' && (
                <div>
                  {isLoadingBranches ? (
                    <div className="flex items-center justify-center py-4">
                      <span className="loading loading-spinner loading-md"></span>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder="Search branches..."
                        value={branchSearchQuery}
                        onChange={(e) => setBranchSearchQuery(e.target.value)}
                        className="input input-bordered input-sm w-full mb-2"
                      />
                      <div className="max-h-48 overflow-y-auto border border-base-300 rounded-lg">
                        {filteredBranches.length === 0 ? (
                          <div className="p-4 text-center text-base-content/50">
                            No branches found
                          </div>
                        ) : (
                          filteredBranches.map((branch) => (
                            <button
                              key={branch}
                              type="button"
                              onClick={() => setSelectedBranch(branch)}
                              className={`w-full text-left px-4 py-2 hover:bg-base-200 ${
                                selectedBranch === branch ? 'bg-primary/10 font-semibold' : ''
                              }`}
                            >
                              {branch}
                              {branch === selectedRepo.defaultBranch && (
                                <span className="badge badge-xs badge-ghost ml-2">default</span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {branchMode === 'auto' && (
                <div className="bg-base-200 rounded-lg p-4">
                  <p className="text-sm text-base-content/70 mb-2">
                    A new branch will be created from <span className="font-mono text-primary">{selectedRepo.defaultBranch || 'main'}</span>
                  </p>
                  <p className="font-mono text-sm">
                    Preview: <span className="text-primary">{generateBranchName()}</span>
                  </p>
                </div>
              )}

              {branchMode === 'custom' && (
                <div>
                  <label className="label">
                    <span className="label-text">Branch prefix</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., feature, fix, experiment"
                    value={customPrefix}
                    onChange={(e) => setCustomPrefix(e.target.value)}
                    className="input input-bordered w-full"
                  />
                  {customPrefix && (
                    <div className="bg-base-200 rounded-lg p-4 mt-2">
                      <p className="text-sm text-base-content/70 mb-1">
                        Branch will be created from <span className="font-mono text-primary">{selectedRepo.defaultBranch || 'main'}</span>
                      </p>
                      <p className="font-mono text-sm">
                        Preview: <span className="text-primary">{generateBranchName(customPrefix)}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {selectedRepo && (
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedRepo(null);
              setBranchMode('existing');
              setSelectedBranch('');
              setCustomPrefix('');
            }}
            className="btn btn-ghost"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleGo}
            disabled={!canProceed() || createBranchMutation.isPending}
            className="btn btn-primary"
          >
            {createBranchMutation.isPending ? (
              <>
                <span className="loading loading-spinner loading-sm"></span>
                Creating branch...
              </>
            ) : (
              'Go to Workspace'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
